package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
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

// answer is a model answer as JSON text.
func answer(good, risk string, steps ...[2]any) string {
	list := []map[string]any{}
	for _, s := range steps {
		list = append(list, map[string]any{"text": s[0], "screen": s[1]})
	}
	b, _ := json.Marshal(map[string]any{"good": good, "risk": risk, "steps": list})
	return string(b)
}

const reviewSummary = `{"month":"2026-10","daysToPayday":12,"income":{"total":1200000,"byPerson":[{"who":"участник 1","amount":700000},{"who":"участник 2","amount":500000}]},"dues":{"total":220000,"items":[{"name":"Аренда","amount":220000}]},"spend":{"total":120000,"fact":85000,"byCategory":[{"name":"Продукты","amount":85000}]},"rest":310000,"short":0,"free":860000,"saved":0,"debts":{"total":1000000,"items":[{"name":"Кредит","left":1000000,"payment":58000,"ratePercent":16.5,"endMonth":"2028-06"}]},"prepay":{"name":"Кредит","monthlyPut":90000,"doneMonth":"2027-07"},"goals":[{"name":"Квартира","want":10000000,"have":1000000,"monthlyPut":150000,"doneMonth":"2031-02","paused":false,"afterPlan":false}]}`

var cleanAnswer = answer("Остаётся 310 000 ₸ после целей.", "Кредит под 16,5% — до июня 2028.",
	[2]any{"Отложим 150 000 ₸ на квартиру.", "/month"}, [2]any{"Посмотрим долги.", "/money/debts"})

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

// The instruction names every field of the summary the model reads (ревью frontend Блока 2, Н-1: prepay and
// goals[].afterPlan — without them a plan «Сначала долги» is invisible and the model advises what it already does).
func TestReviewSystemNamesSummaryFields(t *testing.T) {
	var s map[string]any
	if err := json.Unmarshal([]byte(reviewSummary), &s); err != nil {
		t.Fatal(err)
	}
	fields := []string{}
	for k := range s {
		fields = append(fields, k)
	}
	for _, part := range []map[string]any{s["prepay"].(map[string]any), s["goals"].([]any)[0].(map[string]any)} {
		for k := range part {
			if k != "name" {
				fields = append(fields, k)
			}
		}
	}
	for _, f := range fields {
		if !strings.Contains(reviewSystem, f) {
			t.Errorf("reviewSystem does not name %q", f)
		}
	}
}

func TestReviewSendsOnlyInstructionAndSummary(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
	rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
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
	wantSys, _ := json.Marshal([]any{map[string]any{"text": reviewSystem, "type": "text"}})
	if !bytes.Equal(sys, wantSys) {
		t.Errorf("system = %s", sys)
	}
	// The user message is the summary as sent (compacted) — nothing added: no ids, emails, dates.
	msgs, _ := json.Marshal(sent["messages"])
	wantMsgs, _ := json.Marshal([]any{map[string]any{"content": []any{map[string]any{"text": reviewSummary, "type": "text"}}, "role": "user"}})
	if !bytes.Equal(msgs, wantMsgs) {
		t.Errorf("messages = %s", msgs)
	}
	for _, leak := range []string{f.family, "a@example.com", "2026-10-15"} {
		if raw, _ := json.Marshal(sent); bytes.Contains(raw, []byte(leak)) {
			t.Errorf("request leaks %q", leak)
		}
	}
	if sent["model"] != "claude-opus-5-5" {
		t.Errorf("model = %v", sent["model"])
	}
	if oc, _ := sent["output_config"].(map[string]any); oc["effort"] != "medium" {
		t.Errorf("effort = %v", oc["effort"])
	}

	var got ReviewAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.Good == "" || len(got.Steps) != 2 || *got.Steps[0].Screen != "/month" {
		t.Errorf("answer = %s", rec.Body.String())
	}
	if u := f.usage(); u.Requests != 1 || u.InputTokens != 1000 || u.OutputTokens != 200 || u.CostMicros != ai.CostMicros(ai.Usage{Model: "claude-opus-5-5", InputTokens: 1000, OutputTokens: 200}) {
		t.Errorf("usage = %+v", u)
	}
}

func TestReviewRetriesOnInventedNumber(t *testing.T) {
	invented := answer("Платежи — 18% дохода.", "Риск — 215 000 ₸ лишних трат.", [2]any{"Отложим.", "/month"}, [2]any{"Сверим.", nil})
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented, cleanAnswer}}, true)
	rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	if len(f.claude.sent) != 2 {
		t.Fatalf("calls = %d, want 2", len(f.claude.sent))
	}
	sys, _ := json.Marshal(f.claude.sent[1]["system"])
	if !strings.Contains(string(sys), "В прошлом ответе были числа, которых нет во входе: 18; 215 000. Используй только числа входа.") {
		t.Errorf("retry system = %s", sys)
	}
	// Both attempts are spent, one request of the limit (Р-14).
	if u := f.usage(); u.Requests != 1 || u.InputTokens != 2000 || u.OutputTokens != 400 {
		t.Errorf("usage = %+v", u)
	}
}

func TestReviewTwoDefectsFail(t *testing.T) {
	invented := answer("Платежи — 18% дохода.", "Риск.", [2]any{"Отложим.", "/month"})
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented}}, true)
	rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
		t.Fatalf("status %d %s, want 502 ai_failed", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "18%") {
		t.Error("an unchecked answer must not be shown")
	}
	// Not a request of the limit; the billed tokens go into «≈ $» (хвост §4).
	if u := f.usage(); u.Requests != 0 || u.InputTokens != 2000 || u.CostMicros == 0 {
		t.Errorf("usage = %+v, want 0 requests and both attempts' tokens", u)
	}
}

func TestReviewModelErrorFailsWithoutSpend(t *testing.T) {
	f := newReviewFixture(t, &fakeClaudeQueue{status: 500}, true)
	rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"ai_failed"`) {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	if _, ok := f.aiRepo.Usage[f.family]; ok {
		t.Errorf("an unbilled failure must not write usage: %+v", f.usage())
	}
}

func TestReviewScreenOutsideListIsNull(t *testing.T) {
	// The schema's enum keeps the model in the list; a stray path is still dropped here.
	odd := answer("Остаётся 310 000 ₸.", "Риск.", [2]any{"Шаг один.", "/admin"}, [2]any{"Шаг два.", "/month"},
		[2]any{"Шаг три.", nil}, [2]any{"Последний шаг.", "/"})
	f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{odd}}, true)
	rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`)
	var got ReviewAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
	if len(got.Steps) != 3 || got.Steps[0].Screen != nil || got.Steps[0].Text != "Шаг один." || *got.Steps[1].Screen != "/month" {
		t.Errorf("steps = %+v", got.Steps)
	}
}

func TestReviewGate(t *testing.T) {
	t.Run("viewer 403", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		if rec := f.post(t, f.viewer, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusForbidden {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("viewer must not reach the model")
		}
	})
	t.Run("no key 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{}, false)
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("family off 503", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		_ = f.aiRepo.SetEnabled(context.Background(), f.family, false)
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), `"ai_off"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("limit 429", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 3, 0, 0, f.limit)
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"ai_limit"`) {
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
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusOK {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
	})
	t.Run("billed failure spends toward the limit", func(t *testing.T) {
		// Two defective attempts: no request of the limit, but their cost (2 × 8 000 µ$) crosses
		// the edge, so the next call is 429.
		invented := answer("Платежи — 18% дохода.", "Риск.", [2]any{"Отложим.", "/month"})
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{invented}}, true)
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 0, 0, 0, f.limit-10_000)
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusBadGateway {
			t.Fatalf("status %d %s, want 502", rec.Code, rec.Body.String())
		}
		if u := f.usage(); u.Requests != 0 || u.CostMicros != f.limit+6_000 {
			t.Errorf("usage = %+v, want 0 requests and %d µ$", u, f.limit+6_000)
		}
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusTooManyRequests {
			t.Errorf("after the billed failure: status %d, want 429", rec.Code)
		}
		if len(f.claude.sent) != 2 {
			t.Errorf("calls = %d, want 2 (the 429 must not reach the model)", len(f.claude.sent))
		}
	})
	t.Run("body", func(t *testing.T) {
		f := newReviewFixture(t, &fakeClaudeQueue{texts: []string{cleanAnswer}}, true)
		big := `{"summary":{"x":"` + strings.Repeat("a", 33<<10) + `"}}`
		for body, want := range map[string]int{
			big:                                   http.StatusRequestEntityTooLarge,
			`{"summary":[1,2]}`:                   http.StatusBadRequest,
			`{"summary":{"a":1},"household":"x"}`: http.StatusBadRequest,
			`{}`:                                  http.StatusBadRequest,
			`not json`:                            http.StatusBadRequest,
		} {
			if rec := f.post(t, f.member, body); rec.Code != want {
				t.Errorf("%.40s: status %d, want %d", body, rec.Code, want)
			}
		}
		if len(f.claude.sent) != 0 {
			t.Error("a bad body must not reach the model")
		}
	})
}

// TestLiveReview runs the review against the real API: AI_LIVE=1, ANTHROPIC_API_KEY
// (memory/secrets/anthropic.md), AI_LIVE_SUMMARY — a file with an AI-07 summary (default: the
// synthetic one above), AI_LIVE_EFFORT — low/medium (default medium), AI_LIVE_N — runs.
// It logs the time and the answer: run it on the demo or a de-identified copy only.
func TestLiveReview(t *testing.T) {
	key := os.Getenv("ANTHROPIC_API_KEY")
	if key == "" || os.Getenv("AI_LIVE") != "1" {
		t.Skip("live review: set AI_LIVE=1 and ANTHROPIC_API_KEY")
	}
	summary := reviewSummary
	if p := os.Getenv("AI_LIVE_SUMMARY"); p != "" {
		raw, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		summary = string(raw)
	}
	runs, _ := strconv.Atoi(os.Getenv("AI_LIVE_N"))
	runs = max(runs, 1)
	f := newReviewFixture(t, &fakeClaudeQueue{}, false)
	f.handler.gate.client = ai.New(key, "")
	if e := os.Getenv("AI_LIVE_EFFORT"); e != "" {
		f.handler.effort = e
	}
	for i := range runs {
		start := time.Now()
		rec := f.post(t, f.member, `{"summary": `+summary+`}`)
		t.Logf("run %d: %d in %v: %s", i+1, rec.Code, time.Since(start).Round(100*time.Millisecond), rec.Body.String())
	}
	u := f.usage()
	t.Logf("usage: %d requests, %d in, %d out, %d µ$", u.Requests, u.InputTokens, u.OutputTokens, u.CostMicros)
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
