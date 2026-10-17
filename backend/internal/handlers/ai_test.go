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

// answer is a model answer v2 as JSON text; candidate is nil or an id.
func answer(good, risk, step string, candidate any) string {
	b, _ := json.Marshal(map[string]any{"good": good, "risk": risk, "step": map[string]any{"text": step, "candidate": candidate}})
	return string(b)
}

// reviewBody is a review v2 body as the phone sends it (AU-11): facts with about/value/raw, one candidate.
const reviewBody = `{"reason":"month","facts":[` +
	`{"id":"f1","about":"доход месяца","value":"1 200 000 ₸","raw":1200000},` +
	`{"id":"f2","about":"траты на «Кафе» в этом месяце","value":"80 000 ₸","raw":80000},` +
	`{"id":"f3","about":"главная мечта «Море» — срок","value":"к июню 2028","raw":"2028-06"},` +
	`{"id":"f4","about":"срок мечты «Море» за месяц отодвинулся (кафе выше плана) на","value":"2 недели","raw":15},` +
	`{"id":"f5","about":"первым закрываем «Кредит» — самая высокая ставка","value":"16,5 %","raw":16.5},` +
	`{"id":"f6","about":"во что складывается привычка «Такси»","value":"Такси за 4 года 10 месяцев — мечта «iPhone 17» без долга","raw":[58]}` +
	`],"candidates":[{"id":"c1","kind":"move","about":"из плана «Кафе» в мечту «Море»","value":"40 000 ₸","effect":"на 2 недели раньше"}]}`

var cleanAnswer = answer("Мечту «Море» соберём {f3}.", "На «Кафе» ушло {f2} — мечта отодвинулась на {f4}.", "Перенесём из «Кафе» в «Море»", "c1")

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

// The instruction (Р-2, Р-19): no number of its own — only references; one step with a candidate; «мы».
func TestReviewSystemV2(t *testing.T) {
	for _, want := range []string{"{f3}", "Не пиши ни одной цифры", "step.candidate", "«мы»", "до 14 слов", "до 8 слов", "Не сравнивай участников", "мечту, подушку или свободу от долгов"} {
		if !strings.Contains(reviewSystem, want) {
			t.Errorf("reviewSystem has no %q", want)
		}
	}
	if strings.Contains(reviewSystem, "summary") || strings.Contains(reviewSystem, "screen") {
		t.Error("reviewSystem still speaks of v1")
	}
}

func TestReviewSendsOnlyInstructionFactsAndCandidates(t *testing.T) {
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
	// The user message is the body as sent without raw — nothing added: no ids, emails, dates.
	msgs, _ := sent["messages"].([]any)
	content := msgs[0].(map[string]any)["content"].([]any)[0].(map[string]any)["text"].(string)
	var gotText, want map[string]any
	_ = json.Unmarshal([]byte(content), &gotText)
	_ = json.Unmarshal([]byte(reviewBody), &want)
	for _, fact := range want["facts"].([]any) {
		delete(fact.(map[string]any), "raw")
	}
	if !reflect.DeepEqual(gotText, want) {
		t.Errorf("model text = %s", content)
	}
	for _, leak := range []string{f.family, "a@example.com", "2026-10-15", `"raw"`} {
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
	// The candidate is one of the ids sent or null.
	if schema, _ := json.Marshal(oc["format"]); !bytes.Contains(schema, []byte(`"enum":["c1"]`)) {
		t.Errorf("schema = %s", schema)
	}

	// The answer comes with the values put in.
	if got.Good != "Мечту «Море» соберём к июню 2028." || got.Risk != "На «Кафе» ушло 80 000 ₸ — мечта отодвинулась на 2 недели." {
		t.Errorf("answer = %+v", got)
	}
	if got.Step.Text != "Перенесём из «Кафе» в «Море»" || got.Step.Candidate == nil || *got.Step.Candidate != "c1" {
		t.Errorf("step = %+v", got.Step)
	}
	if u := f.usage(); u.Requests != 1 || u.InputTokens != 1000 || u.OutputTokens != 200 || u.CostMicros != ai.CostMicros(ai.Usage{Model: "claude-opus-5-5", InputTokens: 1000, OutputTokens: 200}) {
		t.Errorf("usage = %+v", u)
	}
}

func TestReviewNoCandidatesSchemaIsNull(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{answer("Доход месяца — {f1}.", "Риск небольшой.", "Посмотрим план месяца", nil)}}, true)
	body := `{"reason":"refresh","facts":[{"id":"f1","about":"доход месяца","value":"1 200 000 ₸","raw":1200000}]}`
	got := decodeReview(t, f.post(t, f.member, body))
	if got.Good != "Доход месяца — 1 200 000 ₸." || got.Step.Candidate != nil {
		t.Errorf("answer = %+v", got)
	}
	oc, _ := f.claude.sent[0]["output_config"].(map[string]any)
	if schema, _ := json.Marshal(oc["format"]); bytes.Contains(schema, []byte(`"enum"`)) {
		t.Errorf("no candidates — no enum: %s", schema)
	}
}

// A defect is asked again once with what was wrong (Р-19); the retry's answer is checked the same way.
func TestReviewDefectsRetry(t *testing.T) {
	cases := []struct {
		name, first, violation string
	}{
		{"digit", answer("Доход — 1 200 000 ₸.", "Риск.", "Шаг.", nil), "цифры в тексте"},
		{"digit in the step", answer("Хорошо.", "Риск.", "Отложим 5 000 ₸", nil), "цифры в тексте"},
		{"ratio", answer("Кафе в 2 раза выше.", "Риск.", "Шаг.", nil), "цифры в тексте"},
		{"fact not sent", answer("Доход — {f99}.", "Риск.", "Шаг.", nil), "ссылка {f99} — такого факта нет"},
		{"candidate as a fact", answer("Хорошо.", "Перенесём {c1}.", "Шаг.", nil), "ссылка {c1} — такого факта нет"},
		{"name not sent", answer("Копим на «iPhone 18».", "Риск.", "Шаг.", nil), "цифры в тексте"},
		{"number in words", answer("Сэкономим двести тысяч.", "Риск.", "Шаг.", nil), "числа не из фактов: двести; тысяч"},
		{"comparison in words", answer("Кафе вдвое выше {f2}.", "Риск.", "Шаг.", nil), "числа не из фактов: вдвое"},
		// Приёмка Блока 3 «ИИ-польза»: shares, multiples and a month without a year are numbers too.
		{"share in words", answer("На «Кафе» ушла пятая часть дохода.", "Траты выросли дважды.", "Шаг.", nil), "числа не из фактов: пятая; дважды"},
		{"month without a year", answer("Хорошо.", "Риск.", "Соберём к декабрю", nil), "числа не из фактов: декабрю"},
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
			// Both attempts are spent, one request of the limit.
			if u := f.usage(); u.Requests != 1 || u.InputTokens != 2000 {
				t.Errorf("usage = %+v", u)
			}
		})
	}
}

func TestReviewTwoDefectsFail(t *testing.T) {
	invented := answer("Доход — 1 200 000 ₸.", "Риск.", "Шаг.", nil)
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented}}, true)
	rec := f.post(t, f.member, reviewBody)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
		t.Fatalf("status %d %s, want 502 ai_failed", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "1 200 000") {
		t.Error("an unchecked answer must not be shown")
	}
	// Not a request of the limit; the billed tokens go into «≈ $» (хвост §4 «ИИ»).
	if u := f.usage(); u.Requests != 0 || u.InputTokens != 2000 || u.CostMicros == 0 {
		t.Errorf("usage = %+v, want 0 requests and both attempts' tokens", u)
	}
}

func TestReviewKeepsNamesAndDropsForeignCandidate(t *testing.T) {
	// A goal «iPhone 17» sent in an about keeps its digits; a candidate the phone did not send is null.
	odd := answer("Такси копит на «iPhone 17»: {f6}.", "Ставка «Кредит» — {f5}.", "Перенесём из «Кафе»", "c7")
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{odd}}, true)
	got := decodeReview(t, f.post(t, f.member, reviewBody))
	if len(f.claude.sent) != 1 {
		t.Fatalf("calls = %d, want 1 (no defect)", len(f.claude.sent))
	}
	if got.Good != "Такси копит на «iPhone 17»: Такси за 4 года 10 месяцев — мечта «iPhone 17» без долга." || got.Risk != "Ставка «Кредит» — 16,5 %." {
		t.Errorf("answer = %+v", got)
	}
	if got.Step.Candidate != nil {
		t.Errorf("foreign candidate = %v, want null", *got.Step.Candidate)
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
	// Not a defect: an answer off the schema or with a blank block is not retried, but its tokens are paid
	// and count toward the money limit (AU-09).
	for name, text := range map[string]string{
		"not json":    "not json",
		"blank block": answer("", "Риск.", "Шаг", nil),
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

// reviewWith is reviewBody with its facts replaced.
func reviewWith(facts string) string {
	return `{"reason":"month","facts":[` + facts + `],"candidates":[]}`
}

func TestReviewBody(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
	fact := func(id string) string { return `{"id":"` + id + `","about":"доход","value":"1 ₸","raw":1}` }
	many := make([]string, 31)
	for i := range many {
		many[i] = fact(fmt.Sprintf("f%d", i+1))
	}
	cand := `{"id":"c1","kind":"move","about":"из «Кафе»","value":"1 ₸","effect":""}`
	big := reviewWith(`{"id":"f1","about":"доход","value":"` + strings.Repeat("а", 33<<10) + `","raw":1}`)
	for name, tc := range map[string]struct {
		body string
		want int
	}{
		"v1 summary":        {`{"summary":{"month":"2026-10"}}`, http.StatusBadRequest},
		"extra field":       {`{"reason":"month","facts":[` + fact("f1") + `],"household":"x"}`, http.StatusBadRequest},
		"extra fact field":  {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":1,"name":"Ильяс"}`), http.StatusBadRequest},
		"no facts":          {reviewWith(``), http.StatusBadRequest},
		"31 facts":          {reviewWith(strings.Join(many, ",")), http.StatusBadRequest},
		"duplicate id":      {reviewWith(fact("f1") + "," + fact("f1")), http.StatusBadRequest},
		"bad fact id":       {reviewWith(fact("x1")), http.StatusBadRequest},
		"bad reason":        {`{"reason":"week","facts":[` + fact("f1") + `]}`, http.StatusBadRequest},
		"long about":        {reviewWith(`{"id":"f1","about":"` + strings.Repeat("а", 201) + `","value":"1 ₸","raw":1}`), http.StatusBadRequest},
		"blank value":       {reviewWith(`{"id":"f1","about":"доход","value":" ","raw":1}`), http.StatusBadRequest},
		"raw text":          {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":"много"}`), http.StatusBadRequest},
		"raw object":        {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":{"a":1}}`), http.StatusBadRequest},
		"raw huge exponent": {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":1e999999}`), http.StatusBadRequest},
		"raw huge in list":  {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":[1,1e999999]}`), http.StatusBadRequest},
		"raw 6 numbers":     {reviewWith(`{"id":"f1","about":"доход","value":"1 ₸","raw":[1,2,3,4,5,6]}`), http.StatusBadRequest},
		"bad kind":          {`{"reason":"month","facts":[` + fact("f1") + `],"candidates":[{"id":"c1","kind":"loan","about":"x","value":"1 ₸","effect":""}]}`, http.StatusBadRequest},
		"4 candidates":      {`{"reason":"month","facts":[` + fact("f1") + `],"candidates":[` + strings.Repeat(cand+",", 3) + cand + `]}`, http.StatusBadRequest},
		"candidate fact id": {`{"reason":"month","facts":[` + fact("f1") + `],"candidates":[{"id":"f1","kind":"move","about":"x","value":"1 ₸","effect":""}]}`, http.StatusBadRequest},
		"too large":         {big, http.StatusRequestEntityTooLarge},
		"not json":          {`not json`, http.StatusBadRequest},
	} {
		if rec := f.post(t, f.member, tc.body); rec.Code != tc.want {
			t.Errorf("%s: status %d, want %d (%s)", name, rec.Code, tc.want, rec.Body.String())
		}
	}
	if len(f.claude.sent) != 0 {
		t.Errorf("a bad body must not reach the model: calls = %d", len(f.claude.sent))
	}
	// raw: a month and a list of numbers are fine; no candidates key at all — too.
	ok := newReviewFixture(t, &fakeClaudeQueue{texts: []string{answer("Соберём {f1}.", "Образ — {f2}.", "Посмотрим план", nil)}}, true)
	body := `{"reason":"salary","facts":[{"id":"f1","about":"срок","value":"к июню 2028","raw":"2028-06"},{"id":"f2","about":"образ","value":"Доставка за год — 40 % мечты","raw":[480000,40]}]}`
	if got := decodeReview(t, ok.post(t, ok.member, body)); got.Good != "Соберём к июню 2028." || got.Risk != "Образ — Доставка за год — 40 % мечты." {
		t.Errorf("answer = %+v", got)
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
	t.Run("billed failure spends toward the limit", func(t *testing.T) {
		// Two defective attempts: no request of the limit, but their cost (2 × 8 000 µ$) crosses
		// the edge, so the next call is 429.
		invented := answer("Доход — 1 200 000 ₸.", "Риск.", "Шаг.", nil)
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

// TestLiveReviewV2 runs the review v2 against the real API: AI_LIVE=1, ANTHROPIC_API_KEY
// (memory/secrets/anthropic.md), AI_LIVE_BODY — a file with a review body (AU-11 payload of the demo
// or a de-identified copy; default: the synthetic one above), AI_LIVE_EFFORT — low/medium (default
// medium), AI_LIVE_N — runs. It logs each run's time, attempts (by tokens) and the answer.
func TestLiveReviewV2(t *testing.T) {
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
		if rec.Code == http.StatusOK {
			ok++
		}
		t.Logf("run %d: %d in %v, %d in / %d out tokens, %d µ$: %s", i+1, rec.Code, time.Since(start).Round(100*time.Millisecond),
			after.InputTokens-before.InputTokens, after.OutputTokens-before.OutputTokens, after.CostMicros-before.CostMicros, rec.Body.String())
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
