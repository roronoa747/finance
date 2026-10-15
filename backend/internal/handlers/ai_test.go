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

const reviewSummary = `{"month":"2026-10","daysToPayday":12,"income":{"total":1200000,"byPerson":[{"who":"участник 1","amount":700000},{"who":"участник 2","amount":500000}]},"dues":{"total":220000,"items":[{"name":"Аренда","amount":220000}]},"spend":{"total":120000,"fact":85000,"byCategory":[{"name":"Продукты","amount":85000}]},"rest":310000,"short":0,"free":860000,"saved":0,"debts":{"total":1000000,"items":[{"name":"Кредит","left":1000000,"payment":58000,"ratePercent":16.5,"endMonth":"2028-06"}]},"goals":[{"name":"Квартира","want":10000000,"have":1000000,"monthlyPut":150000,"doneMonth":"2031-02","paused":false}]}`

var cleanAnswer = answer("Остаётся 310 000 ₸ после целей.", "Кредит под 16,5% — до июня 2028.",
	[2]any{"Отложим 150 000 ₸ на квартиру.", "/month"}, [2]any{"Посмотрим долги.", "/money/debts"})

type reviewFixture struct {
	router  *chi.Mux
	aiRepo  *repository.MockAIRepo
	claude  *fakeClaudeQueue
	family  string
	member  string // token
	viewer  string // token
	limit   int
	month   string
	handler *AIReviewHandler
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
	gate := NewAIGate(aiRepo, client, 30)
	gate.now = func() time.Time { return time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC) }
	handler := NewAIReviewHandler(gate, "claude-opus-5-5")
	r := chi.NewRouter()
	r.Group(func(p chi.Router) {
		p.Use(auth.Middleware(tokens, nil))
		p.Post("/api/ai/review", handler.Review)
	})
	member, _ := tokens.GenerateToken(u.ID, h.ID, "member", "a")
	viewer, _ := tokens.GenerateToken("viewer-1", h.ID, "viewer", "c")
	return &reviewFixture{router: r, aiRepo: aiRepo, claude: claude, family: h.ID, member: member, viewer: viewer, limit: 30, month: "2026-10", handler: handler}
}

func (f *reviewFixture) post(t *testing.T, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/ai/review", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec
}

func (f *reviewFixture) usage() repository.MockAIUsage {
	return f.aiRepo.Usage[f.family][f.month]
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
		_ = f.aiRepo.AddUsage(context.Background(), f.family, f.month, 30, 0, 0, 0)
		if rec := f.post(t, f.member, `{"summary": `+reviewSummary+`}`); rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"ai_limit"`) {
			t.Errorf("status %d %s", rec.Code, rec.Body.String())
		}
		if len(f.claude.sent) != 0 {
			t.Error("over the limit must not reach the model")
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
