package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/ai"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// fakeClaudeQueue answers /v1/messages with the queued texts in order (the last repeats) and
// keeps every request body.
type fakeClaudeQueue struct {
	texts  []string
	status int
	sent   []map[string]any
}

func (f *fakeClaudeQueue) start(t *testing.T) *ai.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.sent = append(f.sent, body)
		w.Header().Set("Content-Type", "application/json")
		if f.status != 0 {
			w.WriteHeader(f.status)
			_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"boom"}}`)
			return
		}
		text := f.texts[min(len(f.sent), len(f.texts))-1]
		b, _ := json.Marshal(map[string]any{
			"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "stop_reason": "end_turn",
			"content": []any{map[string]any{"type": "text", "text": text}},
			"usage":   map[string]any{"input_tokens": 1000, "output_tokens": 200},
		})
		_, _ = w.Write(b)
	}))
	t.Cleanup(srv.Close)
	return ai.New("test-key", srv.URL+"/")
}

// adv is one advice of a model answer v3; figure is nil or a fact id.
type adv struct {
	title, text string
	figure      any
	action      string
}

// answer is a model answer v3 as JSON text.
func answer(where string, advices ...adv) string {
	list := make([]map[string]any, len(advices))
	for i, a := range advices {
		list[i] = map[string]any{"title": a.title, "text": a.text, "figure": a.figure, "action": a.action}
	}
	b, _ := json.Marshal(map[string]any{"where": where, "advices": list})
	return string(b)
}

// reviewBody is a review v3 body as the phone sends it (RZ-03): facts with about/value/raw — a find among them —
// and actions: a step of the code and the screens of the finds.
const reviewBody = `{"v":3,"reason":"month","facts":[` +
	`{"id":"f1","about":"доход месяца","value":"1 200 000 ₸","raw":1200000},` +
	`{"id":"f2","about":"траты на «Кафе» выше обычного на","value":"80 000 ₸","raw":80000},` +
	`{"id":"f3","about":"главная мечта «Море» — срок","value":"к июню 2028","raw":"2028-06"},` +
	`{"id":"f4","about":"срок мечты «Море» за месяц отодвинулся (кафе выше плана) на","value":"2 недели","raw":15},` +
	`{"id":"f5","about":"первым закрываем «Кредит» — самая высокая ставка","value":"16,5 %","raw":16.5},` +
	`{"id":"f6","about":"во что складывается привычка «Такси»","value":"Такси за 4 года 10 месяцев — мечта «iPhone 17» без долга","raw":[58]},` +
	`{"id":"f7","about":"частые траты у «Apteka 24» — за год","value":"144 000 ₸","raw":144000}` +
	`],"actions":[` +
	`{"id":"a1","kind":"do","about":"из плана «Кафе» в мечту «Море»","value":"40 000 ₸","effect":"на 2 недели раньше"},` +
	`{"id":"a2","kind":"open","about":"открыть покупки у «Apteka 24»","value":"","effect":""},` +
	`{"id":"a3","kind":"open","about":"открыть траты «Кафе»","value":"","effect":""},` +
	`{"id":"a4","kind":"open","about":"открыть мечту «Море»","value":"","effect":""}]}`

var cleanAnswer = answer("На «Кафе» ушло {f2} — мечта отодвинулась на {f4}.",
	adv{"Кафе в мечту", "Перенесём часть плана «Кафе» в «Море» — соберём {f3}.", "f3", "a1"},
	adv{"Аптека у дома", "Частые траты у «Apteka 24» за год — {f7}.", "f7", "a2"},
	// Three advices — the usual live answer (ревью backend Н-1: 17/17 live answers had three).
	adv{"Мечта ближе", "Откроем мечту «Море».", nil, "a4"},
)

type reviewFixture struct {
	router  *chi.Mux
	aiRepo  *repository.MockAIRepo
	claude  *fakeClaudeQueue
	family  string
	member  string // token
	viewer  string // token
	limit   int64  // micro-dollars
	month   string
	handler *AIReviewHandler
	sellers *AISellersHandler
}

// newReviewFixture: a family with AI on, its member and viewer; client nil = no key.
func newReviewFixture(t *testing.T, claude *fakeClaudeQueue, withKey bool) *reviewFixture {
	t.Helper()
	ctx := context.Background()
	repos := repository.NewMockRepositories()
	tokens := auth.NewTokenService("test-secret-salt-key", time.Hour)
	aiRepo := repository.NewMockAIRepo(repos.Households, repos.Users)
	u, err := repos.Users.Create(ctx, "a@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	h, _, err := repos.Households.CreateHousehold(ctx, "", u.ID, "Айгуль")
	if err != nil {
		t.Fatal(err)
	}
	if err := aiRepo.SetEnabled(ctx, h.ID, true); err != nil {
		t.Fatal(err)
	}
	var client *ai.Client
	if withKey {
		client = claude.start(t)
	}
	gate := NewAIGate(aiRepo, client, 2_000_000)
	gate.now = func() time.Time { return time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC) }
	handler := NewAIReviewHandler(gate, "claude-opus-5-5")
	sellers := NewAISellersHandler(gate, "claude-haiku-5-5")
	r := chi.NewRouter()
	r.Group(func(p chi.Router) {
		p.Use(auth.Middleware(tokens, nil))
		p.Post("/api/ai/review", handler.Review)
		p.Post("/api/ai/sellers", sellers.Sellers)
	})
	member, _ := tokens.GenerateToken(u.ID, h.ID, "member", "a")
	viewer, _ := tokens.GenerateToken("viewer-1", h.ID, "viewer", "c")
	return &reviewFixture{router: r, aiRepo: aiRepo, claude: claude, family: h.ID, member: member, viewer: viewer, limit: 2_000_000, month: "2026-10", handler: handler, sellers: sellers}
}

func (f *reviewFixture) post(t *testing.T, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	return f.postTo(t, "/api/ai/review", token, body)
}

func (f *reviewFixture) postTo(t *testing.T, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec
}

func (f *reviewFixture) usage() repository.MockAIUsage {
	return f.aiRepo.Usage[f.family][f.month]
}

// systemOf is the instruction of the n-th call.
func (f *reviewFixture) systemOf(n int) string {
	list, _ := f.claude.sent[n]["system"].([]any)
	if len(list) == 0 {
		return ""
	}
	s, _ := list[0].(map[string]any)["text"].(string)
	return s
}

func decodeReview(t *testing.T, rec *httptest.ResponseRecorder) ReviewAnswer {
	t.Helper()
	var got ReviewAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	return got
}

// The instruction v3 (Р-1, Р-24): the work for the family, one to three advices on actions, no number of its own.
func TestReviewSystemV3(t *testing.T) {
	for _, want := range []string{"наняли", "от одного до трёх советов", "Не пиши ни одной цифры", "{f3}", "«мы»", "Два совета не могут вести на одно действие",
		"Не сравнивай участников", "без причины и без действия — не совет", "чего не видно на экранах"} {
		if !strings.Contains(reviewSystem, want) {
			t.Errorf("reviewSystem has no %q", want)
		}
	}
	for _, old := range []string{"step.candidate", "good —", "candidates"} {
		if strings.Contains(reviewSystem, old) {
			t.Errorf("reviewSystem still speaks of v2: %q", old)
		}
	}
}

// A name is sent as written: «&» escaped to a \u code would put digits the second check never saw.
func TestReviewModelTextKeepsAmpersand(t *testing.T) {
	q := reviewRequest{V: 3, Reason: "month", Facts: []reviewFact{{ID: "f1", About: "мечта «Дом & сад»", Value: "к маю 2027"}}}
	text := q.modelText()
	if !strings.Contains(text, "«Дом & сад»") || strings.Contains(text, "u0026") {
		t.Errorf("model text = %s", text)
	}
}

func TestReviewSendsOnlyInstructionFactsAndActions(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
	rec := f.post(t, f.member, reviewBody)
	got := decodeReview(t, rec)
	if len(f.claude.sent) != 1 {
		t.Fatalf("calls = %d, want 1", len(f.claude.sent))
	}
	sent := f.claude.sent[0]
	keys := make([]string, 0, len(sent))
	for k := range sent {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"max_tokens", "messages", "model", "output_config", "system"}; !slices.Equal(keys, want) {
		t.Fatalf("body keys = %v, want %v", keys, want)
	}
	if f.systemOf(0) != reviewSystem {
		t.Errorf("system = %s", f.systemOf(0))
	}
	// The user message is {reason, facts without raw, actions} — nothing added: no ids, emails, dates, no v.
	msgs, _ := sent["messages"].([]any)
	content := msgs[0].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	var gotText, want map[string]any
	_ = json.Unmarshal([]byte(content), &gotText)
	_ = json.Unmarshal([]byte(reviewBody), &want)
	delete(want, "v")
	for _, fact := range want["facts"].([]any) {
		delete(fact.(map[string]any), "raw")
	}
	if !reflect.DeepEqual(gotText, want) {
		t.Errorf("model text = %s", content)
	}
	for _, leak := range []string{f.family, "a@example.com", "2026-10-15", `"raw"`, `"v"`} {
		if raw, _ := json.Marshal(sent); bytes.Contains(raw, []byte(leak)) {
			t.Errorf("request leaks %q", leak)
		}
	}
	if sent["model"] != "claude-opus-5-5" {
		t.Errorf("model = %v", sent["model"])
	}
	oc, _ := sent["output_config"].(map[string]any)
	if oc["effort"] != "medium" {
		t.Errorf("effort = %v", oc["effort"])
	}
	// The action is one of the actions sent (never null), the figure one of the facts sent or null.
	schema, _ := json.Marshal(oc["format"])
	for _, part := range []string{`"enum":["a1","a2","a3","a4"]`, `"enum":["f1","f2","f3","f4","f5","f6","f7"]`, `{"type":"null"}`} {
		if !bytes.Contains(schema, []byte(part)) {
			t.Errorf("schema has no %s: %s", part, schema)
		}
	}
	if bytes.Count(schema, []byte(`{"type":"null"}`)) != 1 {
		t.Errorf("only the figure may be null: %s", schema)
	}

	// The answer comes with the values put in; figure and action stay ids.
	if got.Where != "На «Кафе» ушло 80 000 ₸ — мечта отодвинулась на 2 недели." || len(got.Advices) != 3 {
		t.Fatalf("answer = %+v", got)
	}
	a, b, c := got.Advices[0], got.Advices[1], got.Advices[2]
	if a.Title != "Кафе в мечту" || a.Text != "Перенесём часть плана «Кафе» в «Море» — соберём к июню 2028." || *a.Figure != "f3" || a.Action != "a1" {
		t.Errorf("advice 1 = %+v", a)
	}
	if b.Text != "Частые траты у «Apteka 24» за год — 144 000 ₸." || b.Action != "a2" {
		t.Errorf("advice 2 = %+v", b)
	}
	if c.Title != "Мечта ближе" || c.Figure != nil || c.Action != "a4" {
		t.Errorf("advice 3 = %+v", c)
	}
	if u := f.usage(); u.Requests != 1 || u.InputTokens != 1000 || u.OutputTokens != 200 || u.CostMicros != ai.CostMicros(ai.Usage{Model: "claude-opus-5-5", InputTokens: 1000, OutputTokens: 200}) {
		t.Errorf("usage = %+v", u)
	}
}

// A defect is asked again once with what was wrong (Р-16, Р-19); the retry's answer is checked the same way.
func TestReviewDefectsRetry(t *testing.T) {
	ok := adv{"Кафе в мечту", "Перенесём часть плана «Кафе».", nil, "a1"}
	cases := []struct {
		name, first, violation string
	}{
		{"digit in where", answer("Доход — 1 200 000 ₸.", ok), "цифры в тексте"},
		{"digit in a text", answer("Хорошо.", adv{"Подушка", "Отложим 5 000 ₸.", nil, "a1"}), "цифры в тексте"},
		{"digit in a title", answer("Хорошо.", adv{"Сбережём 5 тысяч", "Отложим.", nil, "a1"}), "цифры в тексте"},
		{"ratio", answer("Кафе в 2 раза выше.", ok), "цифры в тексте"},
		{"fact not sent", answer("Доход — {f99}.", ok), "ссылка {f99} — такого факта нет"},
		{"action as a fact", answer("Перенесём {a1}.", ok), "ссылка {a1} — такого факта нет"},
		{"name not sent", answer("Копим на «iPhone 18».", ok), "цифры в тексте"},
		{"number in words", answer("Сэкономим двести тысяч.", ok), "числа не из фактов: двести; тысяч"},
		{"comparison in words", answer("Кафе вдвое выше {f2}.", ok), "числа не из фактов: вдвое"},
		{"share in words", answer("На «Кафе» ушла пятая часть дохода.", adv{"Траты", "Траты выросли дважды.", nil, "a1"}), "числа не из фактов: пятая; дважды"},
		{"month without a year", answer("Соберём к декабрю.", ok), "числа не из фактов: декабрю"},
		// v3 (RZ-04): how many advices, one action each, a short title and text, ids from the ones sent.
		{"no advices", answer("Хорошо."), "советов должно быть от одного до трёх"},
		{"4 advices", answer("Хорошо.", adv{"Раз", "Текст.", nil, "a1"}, adv{"Два", "Текст.", nil, "a2"}, adv{"Три", "Текст.", nil, "a3"}, adv{"Четыре", "Текст.", nil, "a4"}), "советов должно быть от одного до трёх"},
		{"one action twice", answer("Хорошо.", adv{"Раз", "Текст.", nil, "a2"}, adv{"Два", "Текст.", nil, "a2"}), "одно действие на совет"},
		{"5 words title", answer("Хорошо.", adv{"Очень длинный заголовок совета здесь", "Текст.", nil, "a1"}), "заголовок до четырёх слов вместе с подставленным значением и названием — лучше без {fN} в заголовке"},
		{"long text", answer("Хорошо.", adv{"Совет", strings.Repeat("слово ", 30), nil, "a1"}), "совет — одно короткое предложение"},
		{"action not sent", answer("Хорошо.", adv{"Совет", "Текст.", nil, "a9"}), "действие a9 — такого нет"},
		{"figure not sent", answer("Хорошо.", adv{"Совет", "Текст.", "f99", "a1"}), "figure f99 — такого факта нет"},
		// Критик Блока 1: слова заголовка — как их увидят, после подстановки: «Аптека за год 144 000 ₸» — шесть.
		{"title long after fill", answer("Хорошо.", adv{"Аптека за год {f7}", "Текст.", "f7", "a2"}), "заголовок до четырёх слов вместе с подставленным значением и названием — лучше без {fN} в заголовке"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{tc.first, cleanAnswer}}, true)
			decodeReview(t, f.post(t, f.member, reviewBody))
			if len(f.claude.sent) != 2 {
				t.Fatalf("calls = %d, want 2", len(f.claude.sent))
			}
			if want := fmt.Sprintf(reviewRetry, tc.violation); f.systemOf(1) != reviewSystem+want {
				t.Errorf("retry system tail = %q, want %q", strings.TrimPrefix(f.systemOf(1), reviewSystem), want)
			}
			// Both attempts are spent, one request in the admin counter.
			if u := f.usage(); u.Requests != 1 || u.InputTokens != 2000 {
				t.Errorf("usage = %+v", u)
			}
		})
	}
}

func TestReviewTwoDefectsFail(t *testing.T) {
	invented := answer("Доход — 1 200 000 ₸.", adv{"Совет", "Текст.", nil, "a1"})
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented}}, true)
	rec := f.post(t, f.member, reviewBody)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
		t.Fatalf("status %d %s, want 502 ai_failed", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "1 200 000") {
		t.Error("an unchecked answer must not be shown")
	}
	// Not a request in the admin counter; the billed tokens go into «≈ $» (хвост §4 «ИИ»).
	if u := f.usage(); u.Requests != 0 || u.InputTokens != 2000 || u.CostMicros == 0 {
		t.Errorf("usage = %+v, want 0 requests and both attempts' tokens", u)
	}
}

// Filled: references put in where, titles and texts; a name in «» the phone sent keeps its digits; figure and
// action come back as ids.
func TestReviewFilled(t *testing.T) {
	odd := answer("Такси копит на «iPhone 17»: {f6}.",
		adv{"«Apteka 24» каждый день", "Ставка «Кредит» — {f5}, а аптека за год — {f7}.", nil, "a2"},
		adv{"Мечта {f3}", "Перенесём из «Кафе».", "f4", "a4"},
	)
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{odd}}, true)
	got := decodeReview(t, f.post(t, f.member, reviewBody))
	if len(f.claude.sent) != 1 {
		t.Fatalf("calls = %d, want 1 (no defect)", len(f.claude.sent))
	}
	if got.Where != "Такси копит на «iPhone 17»: Такси за 4 года 10 месяцев — мечта «iPhone 17» без долга." {
		t.Errorf("where = %q", got.Where)
	}
	a, b := got.Advices[0], got.Advices[1]
	if a.Title != "«Apteka 24» каждый день" || a.Text != "Ставка «Кредит» — 16,5 %, а аптека за год — 144 000 ₸." || a.Figure != nil || a.Action != "a2" {
		t.Errorf("advice 1 = %+v", a)
	}
	if b.Title != "Мечта к июню 2028" || *b.Figure != "f4" || b.Action != "a4" {
		t.Errorf("advice 2 = %+v", b)
	}
}

func TestReviewModelErrorFailsWithoutSpend(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{status: 500}, true)
	rec := f.post(t, f.member, reviewBody)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := f.aiRepo.Usage[f.family]; ok {
		t.Errorf("an unbilled failure must not write usage: %+v", f.usage())
	}
}

func TestReviewBilledFailures(t *testing.T) {
	// Not a defect: an answer off the schema or with a blank part is not retried, but its tokens are paid
	// and count toward the money limit (AU-09).
	for name, text := range map[string]string{
		"not json":    "not json",
		"blank where": answer("", adv{"Совет", "Текст.", nil, "a1"}),
		"blank title": answer("Хорошо.", adv{" ", "Текст.", nil, "a1"}),
	} {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{text}}, true)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
			t.Errorf("%s: status %d %s", name, rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 1 {
			t.Errorf("%s: calls = %d, want 1 (no retry)", name, len(f.claude.sent))
		}
		if u := f.usage(); u.Requests != 0 || u.InputTokens == 0 || u.CostMicros == 0 {
			t.Errorf("%s: usage = %+v, want 0 requests and the billed tokens", name, u)
		}
	}
}

// reviewWith is a v3 body with its facts and actions replaced.
func reviewWith(facts, actions string) string {
	return `{"v":3,"reason":"month","facts":[` + facts + `],"actions":[` + actions + `]}`
}

func TestReviewBody(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
	fact := func(id string) string { return `{"id":"` + id + `","about":"доход","value":"1 ₸","raw":1}` }
	do := func(id string) string {
		return `{"id":"` + id + `","kind":"do","about":"из «Кафе»","value":"1 ₸","effect":""}`
	}
	open := `{"id":"a1","kind":"open","about":"открыть траты «Кафе»","value":"","effect":""}`
	f1 := fact("f1")
	many := make([]string, 41)
	for i := range many {
		many[i] = fact(fmt.Sprintf("f%d", i+1))
	}
	tenActions := make([]string, 10)
	for i := range tenActions {
		tenActions[i] = do(fmt.Sprintf("a%d", i+1))
	}
	big := reviewWith(`{"id":"f1","about":"доход","value":"`+strings.Repeat("а", 49<<10)+`","raw":1}`, open)
	for name, tc := range map[string]struct {
		body string
		want int
	}{
		"v1 summary":         {`{"summary":{"month":"2026-10"}}`, http.StatusBadRequest},
		"v2 body":            {`{"reason":"month","facts":[` + f1 + `],"candidates":[]}`, http.StatusBadRequest},
		"no v":               {`{"reason":"month","facts":[` + f1 + `],"actions":[` + open + `]}`, http.StatusBadRequest},
		"v 2":                {`{"v":2,"reason":"month","facts":[` + f1 + `],"actions":[` + open + `]}`, http.StatusBadRequest},
		"extra field":        {`{"v":3,"reason":"month","facts":[` + f1 + `],"actions":[` + open + `],"household":"x"}`, http.StatusBadRequest},
		"extra fact field":   {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":1,"name":"Ильяс"}`, open), http.StatusBadRequest},
		"extra action field": {reviewWith(f1, `{"id":"a1","kind":"open","about":"x","value":"","effect":"","date":"2026-10-01"}`), http.StatusBadRequest},
		"no facts":           {reviewWith(``, open), http.StatusBadRequest},
		"41 facts":           {reviewWith(strings.Join(many, ","), open), http.StatusBadRequest},
		"no actions":         {reviewWith(f1, ``), http.StatusBadRequest},
		"10 actions":         {reviewWith(f1, strings.Join(tenActions, ",")), http.StatusBadRequest},
		"open with value":    {reviewWith(f1, `{"id":"a1","kind":"open","about":"открыть","value":"1 ₸","effect":""}`), http.StatusBadRequest},
		"open with effect":   {reviewWith(f1, `{"id":"a1","kind":"open","about":"открыть","value":"","effect":"раньше"}`), http.StatusBadRequest},
		"do without value":   {reviewWith(f1, `{"id":"a1","kind":"do","about":"в подушку","value":" ","effect":""}`), http.StatusBadRequest},
		"blank about":        {reviewWith(f1, `{"id":"a1","kind":"open","about":" ","value":"","effect":""}`), http.StatusBadRequest},
		"bad kind":           {reviewWith(f1, `{"id":"a1","kind":"move","about":"x","value":"1 ₸","effect":""}`), http.StatusBadRequest},
		"bad action id":      {reviewWith(f1, `{"id":"c1","kind":"open","about":"x","value":"","effect":""}`), http.StatusBadRequest},
		"action fact id":     {reviewWith(f1, `{"id":"f1","kind":"open","about":"x","value":"","effect":""}`), http.StatusBadRequest},
		"duplicate fact id":  {reviewWith(f1+","+f1, open), http.StatusBadRequest},
		"duplicate action":   {reviewWith(f1, open+","+open), http.StatusBadRequest},
		"bad fact id":        {reviewWith(fact("x1"), open), http.StatusBadRequest},
		"bad reason":         {`{"v":3,"reason":"week","facts":[` + f1 + `],"actions":[` + open + `]}`, http.StatusBadRequest},
		"long about":         {reviewWith(`{"id":"f1","about":"`+strings.Repeat("а", 201)+`","value":"1 ₸","raw":1}`, open), http.StatusBadRequest},
		"blank value":        {reviewWith(`{"id":"f1","about":"доход","value":" ","raw":1}`, open), http.StatusBadRequest},
		"raw text":           {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":"много"}`, open), http.StatusBadRequest},
		"raw object":         {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":{"a":1}}`, open), http.StatusBadRequest},
		"raw huge exponent":  {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":1e999999}`, open), http.StatusBadRequest},
		"raw huge in list":   {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":[1,1e999999]}`, open), http.StatusBadRequest},
		"raw 6 numbers":      {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":[1,2,3,4,5,6]}`, open), http.StatusBadRequest},
		"too large":          {big, http.StatusRequestEntityTooLarge},
		"not json":           {`not json`, http.StatusBadRequest},
	} {
		if rec := f.post(t, f.member, tc.body); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", name, rec.Code, tc.want, rec.Body.String())
		}
	}
	if len(f.claude.sent) != 0 {
		t.Errorf("a bad body must not reach the model: calls = %d", len(f.claude.sent))
	}
	// raw: a month and a list of numbers are fine; 40 facts and 9 actions — too.
	ok := newReviewFixture(t, &fakeClaudeQueue{texts: []string{answer("Соберём {f1}.", adv{"Образ", "Образ — {f2}.", nil, "a1"})}}, true)
	body := reviewWith(`{"id":"f1","about":"срок","value":"к июню 2028","raw":"2028-06"},{"id":"f2","about":"образ","value":"Доставка за год — 40 % мечты","raw":[480000,40]}`, open)
	if got := decodeReview(t, ok.post(t, ok.member, body)); got.Where != "Соберём к июню 2028." || got.Advices[0].Text != "Образ — Доставка за год — 40 % мечты." {
		t.Errorf("answer = %+v", got)
	}
	full := newReviewFixture(t, &fakeClaudeQueue{texts: []string{answer("Хорошо.", adv{"Совет", "Текст.", nil, "a9"})}}, true)
	if rec := full.post(t, full.member, reviewWith(strings.Join(many[:40], ","), strings.Join(tenActions[:9], ","))); rec.Code != http.StatusOK {
		t.Errorf("40 facts and 9 actions: status %d %s", rec.Code, rec.Body.String())
	}
	// A term of this year comes without a year (monthBy: «к декабрю»): put in by a reference, it is not a
	// month the model wrote (критик возврата Блока 3 «ИИ-польза»).
	cur := newReviewFixture(t, &fakeClaudeQueue{texts: []string{answer("Соберём {f1}.", adv{"Совет", "Текст.", nil, "a1"})}}, true)
	body = reviewWith(`{"id":"f1","about":"главная мечта «Море» — срок","value":"к декабрю","raw":"2026-12"}`, open)
	if got := decodeReview(t, cur.post(t, cur.member, body)); got.Where != "Соберём к декабрю." || len(cur.claude.sent) != 1 {
		t.Errorf("answer = %+v, calls = %d", got, len(cur.claude.sent))
	}
}

func TestReviewGate(t *testing.T) {
	t.Run("viewer 403", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		if rec := f.post(t, f.viewer, reviewBody); rec.Code != http.StatusForbidden {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("viewer must not reach the model")
		}
	})
	t.Run("no key 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{}, false)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("family off 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		_ = f.aiRepo.SetEnabled(context.Background(), f.family, false)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("limit 429", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 3, 0, 0, f.limit)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"ai_limit"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("over the limit must not reach the model")
		}
	})
	t.Run("under the money limit 200", func(t *testing.T) {
		// Many requests, little money: the limit is dollars, not requests (Р-11).
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 500, 0, 0, f.limit-1)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusOK {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("model missing from the price table still reaches the limit", func(t *testing.T) {
		// A dated snapshot in AI_MODEL_REVIEW: billed as the priciest model, so the edge holds.
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		f.handler.model = "claude-opus-5-5-20261001"
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 0, 0, 0, f.limit-1_000)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusOK {
			t.Fatalf("status %d %s", rec.Code, rec.Body.String())
		}
		if u := f.usage(); u.CostMicros <= f.limit {
			t.Errorf("cost = %d µ$, want past the %d µ$ limit", u.CostMicros, f.limit)
		}
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusTooManyRequests {
			t.Errorf("next call: status %d, want 429", rec.Code)
		}
	})
	t.Run("billed failure spends toward the limit", func(t *testing.T) {
		// Two defective attempts: no request in the admin counter, but their cost (2 × 8 000 µ$) crosses
		// the edge, so the next call is 429.
		invented := answer("Доход — 1 200 000 ₸.", adv{"Совет", "Текст.", nil, "a1"})
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 0, 0, 0, f.limit-10_000)
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusBadGateway {
			t.Fatalf("status %d %s, want 502", rec.Code, rec.Body.String())
		}
		if u := f.usage(); u.Requests != 0 || u.CostMicros != f.limit+6_000 {
			t.Errorf("usage = %+v, want 0 requests and %d µ$", u, f.limit+6_000)
		}
		if rec := f.post(t, f.member, reviewBody); rec.Code != http.StatusTooManyRequests {
			t.Errorf("after the billed failure: status %d, want 429", rec.Code)
		}
		if len(f.claude.sent) != 2 {
			t.Errorf("calls = %d, want 2 (the 429 must not reach the model)", len(f.claude.sent))
		}
	})
}

// TestLiveReviewV3 runs the review v3 against the real API: AI_LIVE=1, ANTHROPIC_API_KEY
// (memory/secrets/anthropic.md), AI_LIVE_BODY — a file with a review v3 body (RZ-03 payload of the demo or a
// de-identified copy of real statements; default: the synthetic one above), AI_LIVE_EFFORT — low/medium (default
// medium), AI_LIVE_N — runs. It logs each run's time, attempts (by tokens), price, where, the advices and their
// actions, and the total.
func TestLiveReviewV3(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" || os.Getenv("AI_LIVE") != "1" {
		t.Skip("live review: set AI_LIVE=1 and ANTHROPIC_API_KEY")
	}
	body := reviewBody
	if p := os.Getenv("AI_LIVE_BODY"); p != "" {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		body = string(raw)
	}
	var req reviewRequest
	_ = json.Unmarshal([]byte(body), &req)
	kinds := map[string]string{}
	for _, a := range req.Actions {
		kinds[a.ID] = a.Kind + " " + a.About
	}
	runs, _ := strconv.Atoi(os.Getenv("AI_LIVE_N"))
	runs = max(runs, 1)
	f := newReviewFixture(t, &fakeClaudeQueue{}, false)
	f.handler.gate.client = ai.New(key, "")
	if e := os.Getenv("AI_LIVE_EFFORT"); e != "" {
		f.handler.effort = e
	}
	ok := 0
	for i := range runs {
		before := f.usage()
		start := time.Now()
		rec := f.post(t, f.member, body)
		after := f.usage()
		in := after.InputTokens - before.InputTokens
		t.Logf("run %d: %d in %v, %d in / %d out tokens, %d µ$ (retry ≈ 2× tokens)", i+1, rec.Code, time.Since(start).Round(100*time.Millisecond),
			in, after.OutputTokens-before.OutputTokens, after.CostMicros-before.CostMicros)
		if rec.Code != http.StatusOK {
			continue
		}
		ok++
		var got ReviewAnswer
		_ = json.Unmarshal(rec.Body.Bytes(), &got)
		t.Logf("  where: %s", got.Where)
		for _, a := range got.Advices {
			fig := "—"
			if a.Figure != nil {
				fig = *a.Figure
			}
			t.Logf("  · %s — %s [figure %s · %s: %s]", a.Title, a.Text, fig, a.Action, kinds[a.Action])
		}
	}
	u := f.usage()
	t.Logf("total: %d/%d ok, %d requests, %d in, %d out, %d µ$", ok, runs, u.Requests, u.InputTokens, u.OutputTokens, u.CostMicros)
}

// sellersCategories are the starting sections (DEFAULT_SPEND_CATEGORIES, dictionary.ts) as the phone sends them.
const sellersCategories = `[{"id":"sc_food","name":"Продукты"},{"id":"sc_cafe","name":"Кафе и рестораны"},{"id":"sc_transport","name":"Транспорт"},{"id":"sc_telecom","name":"Связь и интернет"},{"id":"sc_subscriptions","name":"Подписки"},{"id":"sc_health","name":"Здоровье и аптеки"},{"id":"sc_home","name":"Дом и быт"},{"id":"sc_shopping","name":"Одежда и покупки"},{"id":"sc_fun","name":"Развлечения"},{"id":"sc_people","name":"Переводы людям"},{"id":"sc_credit","name":"Кредиты и рассрочки"},{"id":"sc_utilities","name":"Коммуналка"},{"id":"sc_education","name":"Образование"},{"id":"sc_travel","name":"Путешествия"},{"id":"sc_cash","name":"Наличные"},{"id":"sc_fees","name":"Комиссии"},{"id":"sc_other","name":"Прочее"},{"id":"sc_rent","name":"Аренда"}]`

func sellersBody(names ...string) string {
	b, _ := json.Marshal(names)
	return `{"names":` + string(b) + `,"categories":` + sellersCategories + `}`
}

// sellersAnswer is a model answer: pairs of name and section id ("" — null).
func sellersAnswer(pairs ...[2]string) string {
	items := []map[string]any{}
	for _, p := range pairs {
		var id any
		if p[1] != "" {
			id = p[1]
		}
		items = append(items, map[string]any{"name": p[0], "categoryId": id})
	}
	b, _ := json.Marshal(map[string]any{"items": items})
	return string(b)
}

func decodeSellers(t *testing.T, rec *httptest.ResponseRecorder) []SellerSuggestion {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Items []SellerSuggestion `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	return got.Items
}

func suggested(s SellerSuggestion) string {
	if s.CategoryID == nil {
		return "null"
	}
	return *s.CategoryID
}

func TestSellersSendsOnlyNamesAndSections(t *testing.T) {
	names := []string{"Magnum Cash&Carry", "ИП Сулейменов Аптека Плюс", "YANDEX.GO"}
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer(
		[2]string{"ИП Сулейменов Аптека Плюс", "sc_health"}, [2]string{"Magnum Cash&Carry", "sc_food"},
		[2]string{"Лишний продавец", "sc_food"}, [2]string{"YANDEX.GO", "sc_taxi"},
	)}}, true)
	rec := f.postTo(t, "/api/ai/sellers", f.member, sellersBody(names...))
	got := decodeSellers(t, rec)

	if len(f.claude.sent) != 1 {
		t.Fatalf("calls = %d, want 1", len(f.claude.sent))
	}
	sent := f.claude.sent[0]
	keys := make([]string, 0, len(sent))
	for k := range sent {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"max_tokens", "messages", "model", "output_config", "system"}; !slices.Equal(keys, want) {
		t.Fatalf("body keys = %v, want %v", keys, want)
	}
	sys, _ := json.Marshal(sent["system"])
	wantSys, _ := json.Marshal([]any{map[string]any{"text": sellersSystem, "type": "text"}})
	if !bytes.Equal(sys, wantSys) {
		t.Errorf("system = %s", sys)
	}
	// The user message is the names and the sections — nothing else: no ids, emails, sums, dates.
	wantText := `{"names":["Magnum Cash&Carry","ИП Сулейменов Аптека Плюс","YANDEX.GO"],"categories":` + sellersCategories + `}`
	msgs, _ := json.Marshal(sent["messages"])
	wantMsgs, _ := json.Marshal([]any{map[string]any{"content": []any{map[string]any{"text": wantText, "type": "text"}}, "role": "user"}})
	if !bytes.Equal(msgs, wantMsgs) {
		t.Errorf("messages = %s\nwant %s", msgs, wantMsgs)
	}
	raw, _ := json.Marshal(sent)
	for _, leak := range []string{f.family, "a@example.com", "2026-10", "₸"} {
		if bytes.Contains(raw, []byte(leak)) {
			t.Errorf("request leaks %q", leak)
		}
	}
	if sent["model"] != "claude-haiku-5-5" {
		t.Errorf("model = %v", sent["model"])
	}
	if oc, _ := sent["output_config"].(map[string]any); oc["effort"] != "low" {
		t.Errorf("effort = %v", oc["effort"])
	}

	// In the order of the names; a section outside the list is null; a name not sent is dropped.
	if len(got) != 3 || got[0].Name != names[0] || suggested(got[0]) != "sc_food" || got[1].Name != names[1] ||
		suggested(got[1]) != "sc_health" || got[2].Name != names[2] || suggested(got[2]) != "null" {
		t.Errorf("items = %s", rec.Body.String())
	}
	if u := f.usage(); u.Requests != 1 || u.InputTokens != 1000 || u.OutputTokens != 200 || u.CostMicros != ai.CostMicros(ai.Usage{Model: "claude-haiku-5-5", InputTokens: 1000, OutputTokens: 200}) {
		t.Errorf("usage = %+v", u)
	}
}

func TestSellersMissingNameIsNull(t *testing.T) {
	// The model skipped one name, changed the case of another and repeated a third: the first item wins.
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer(
		[2]string{"magnum  cash&carry", "sc_food"}, [2]string{"Аптека Плюс", ""}, [2]string{"Аптека Плюс", "sc_health"},
	)}}, true)
	got := decodeSellers(t, f.postTo(t, "/api/ai/sellers", f.member, sellersBody("Magnum Cash&Carry", "YANDEX.GO", "Аптека Плюс")))
	if len(got) != 3 || suggested(got[0]) != "sc_food" || got[0].Name != "Magnum Cash&Carry" || suggested(got[1]) != "null" ||
		got[1].Name != "YANDEX.GO" || suggested(got[2]) != "null" {
		t.Errorf("items = %+v", got)
	}
}

func TestSellersGuard(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer()}}, true)
	many := make([]string, 51)
	for i := range many {
		many[i] = "Продавец " + strconv.Itoa(i)
	}
	cats := make([]string, 41)
	for i := range cats {
		cats[i] = `{"id":"c` + strconv.Itoa(i) + `","name":"Раздел"}`
	}
	one := `{"names":["Magnum"],`
	for body, want := range map[string]int{
		sellersBody("KASPI 1234567"):                                        http.StatusBadRequest, // 6+ digits — a card or an account
		sellersBody("Magnum", "ИИН 870101300123 ИП"):                        http.StatusBadRequest,
		sellersBody(many...):                                                http.StatusBadRequest,
		sellersBody():                                                       http.StatusBadRequest,
		sellersBody("Magnum", "Magnum"):                                     http.StatusBadRequest,
		sellersBody("  "):                                                   http.StatusBadRequest,
		sellersBody(strings.Repeat("я", 81)):                                http.StatusBadRequest,
		one + `"categories":[]}`:                                            http.StatusBadRequest,
		one + `"categories":[` + strings.Join(cats, ",") + `]}`:             http.StatusBadRequest,
		one + `"categories":[{"id":"sc_food","name":""}]}`:                  http.StatusBadRequest,
		one + `"categories":[{"id":"a","name":"A"},{"id":"a","name":"B"}]}`: http.StatusBadRequest,
		one + `"categories":[{"id":"sc_food","name":"Продукты","hue":"green"}]}`:    http.StatusBadRequest,
		one + `"amounts":[5000],"categories":[{"id":"sc_food","name":"Продукты"}]}`: http.StatusBadRequest,
		`not json`: http.StatusBadRequest,
		`{"names":["` + strings.Repeat("a", 17<<10) + `"],"categories":[]}`: http.StatusRequestEntityTooLarge,
	} {
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != want {
			t.Errorf("%.60s: status %d, want %d", body, rec.Code, want)
		}
	}
	// 50 names of 80 characters fit.
	ok := make([]string, 50)
	for i := range ok {
		ok[i] = strings.Repeat("я", 78) + strconv.Itoa(10+i)
	}
	if rec := f.postTo(t, "/api/ai/sellers", f.member, sellersBody(ok...)); rec.Code != http.StatusOK {
		t.Errorf("50 × 80: status %d %s", rec.Code, rec.Body.String())
	}
	if len(f.claude.sent) != 1 {
		t.Errorf("calls = %d, want 1: a bad body must not reach the model", len(f.claude.sent))
	}
}

func TestSellersGate(t *testing.T) {
	body := sellersBody("Magnum")
	t.Run("viewer 403", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer()}}, true)
		if rec := f.postTo(t, "/api/ai/sellers", f.viewer, body); rec.Code != http.StatusForbidden {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("viewer must not reach the model")
		}
	})
	t.Run("no key 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{}, false)
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("family off 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer()}}, true)
		_ = f.aiRepo.SetEnabled(context.Background(), f.family, false)
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("limit 429", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{sellersAnswer()}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 3, 0, 0, f.limit)
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"ai_limit"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("over the limit must not reach the model")
		}
	})
	t.Run("model error 502 without spend", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{status: 500}, true)
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if _, ok := f.aiRepo.Usage[f.family]; ok {
			t.Errorf("an unbilled failure must not write usage: %+v", f.usage())
		}
	})
	t.Run("off-schema 502, tokens billed", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{`{"items":[],"note":"x"}`}}, true)
		if rec := f.postTo(t, "/api/ai/sellers", f.member, body); rec.Code != http.StatusBadGateway {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if u := f.usage(); u.Requests != 0 || u.InputTokens != 1000 {
			t.Errorf("usage = %+v, want 0 requests and the billed tokens", u)
		}
	})
}

// liveSellers are de-identified names in the style of unknown sellers of real statements (no «ИП + фамилия»).
var liveSellers = []string{"SMALL ALMATY", "IP ZHANNA COFFEE", "TOO SULPAK", "WOLT KZ", "CHOCOFOOD", "AIRBA FRESH",
	"Kaspi Магазин", "EUROPHARMA", "INVIVO", "TOO KINOPARK 8"}

// TestLiveSellers asks the real API: AI_LIVE=1, ANTHROPIC_API_KEY (memory/secrets/anthropic.md),
// AI_LIVE_NAMES — a file with one name per line (default: liveSellers). It logs the time and the answer.
func TestLiveSellers(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" || os.Getenv("AI_LIVE") != "1" {
		t.Skip("live sellers: set AI_LIVE=1 and ANTHROPIC_API_KEY")
	}
	names := liveSellers
	if p := os.Getenv("AI_LIVE_NAMES"); p != "" {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		names = nil
		for _, l := range strings.Split(string(raw), "\n") {
			if l = strings.TrimSpace(l); l != "" {
				names = append(names, l)
			}
		}
	}
	f := newReviewFixture(t, &fakeClaudeQueue{}, false)
	f.sellers.gate.client = ai.New(key, "")
	start := time.Now()
	rec := f.postTo(t, "/api/ai/sellers", f.member, sellersBody(names...))
	t.Logf("%d in %v", rec.Code, time.Since(start).Round(100*time.Millisecond))
	if rec.Code == http.StatusOK {
		for _, s := range decodeSellers(t, rec) {
			t.Logf("  %-28s → %s", s.Name, suggested(s))
		}
	} else {
		t.Log(rec.Body.String())
	}
	u := f.usage()
	t.Logf("usage: %d requests, %d in, %d out, %d µ$", u.Requests, u.InputTokens, u.OutputTokens, u.CostMicros)
}
