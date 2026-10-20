package handlers

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/ai"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

type adminAIFixture struct {
	router   *chi.Mux
	tokens   *auth.TokenService
	aiRepo   *repository.MockAIRepo
	events   *repository.MockEventRepo
	repos    *repository.MockRepositories
	users    map[string]string // email → id
	admin    string            // token
	stranger string            // token
	familyA  string            // AI on, spent this month
	familyB  string            // AI off
}

// newAdminAIFixture: owner@example.com is the admin; two families, A with AI on and usage
// this month and last month, B off. client nil = no key.
func newAdminAIFixture(t *testing.T, admins []string, client *ai.Client) *adminAIFixture {
	t.Helper()
	ctx := context.Background()
	repos := repository.NewMockRepositories()
	tokens := auth.NewTokenService("test-secret-salt-key", time.Hour)
	aiRepo := repository.NewMockAIRepo(repos.Households, repos.Users)
	events := &repository.MockEventRepo{}
	aiRepo.Events = events
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	users := map[string]string{}

	mkUser := func(email string) string {
		u, err := repos.Users.Create(ctx, email, "hash")
		if err != nil {
			t.Fatal(err)
		}
		users[email] = u.ID
		return u.ID
	}
	owner := mkUser("owner@example.com")
	stranger := mkUser("stranger@example.com")
	a1 := mkUser("aigul@example.com")
	a2 := mkUser("ilyas@example.com")
	b1 := mkUser("bota@example.com")

	hA, _, err := repos.Households.CreateHousehold(ctx, "", a1, "Айгуль")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := repos.Households.CreateInvite(ctx, hA.ID, a1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repos.Households.JoinHousehold(ctx, inv.Code, a2, "Ильяс"); err != nil {
		t.Fatal(err)
	}
	hB, _, err := repos.Households.CreateHousehold(ctx, "", b1, "Бота")
	if err != nil {
		t.Fatal(err)
	}
	if err := aiRepo.SetEnabled(ctx, hA.ID, true); err != nil {
		t.Fatal(err)
	}
	_ = aiRepo.AddUsage(ctx, hA.ID, "2026-10", 3, 300, 60, 420_000)
	_ = aiRepo.AddUsage(ctx, hA.ID, "2026-09", 9, 900, 90, 9_000_000)

	h := NewAdminAIHandler(aiRepo, repos.Users, admins, client, "claude-haiku-5-5", 2_000_000)
	h.now = func() time.Time { return now }

	r := chi.NewRouter()
	r.Group(func(p chi.Router) {
		p.Use(auth.Middleware(tokens, nil))
		p.Get("/api/admin/families", h.Families)
		p.Put("/api/admin/families/{id}/ai", h.SetAI)
		p.Post("/api/admin/ai-check", h.AICheck)
	})
	tok := func(id string) string {
		s, err := tokens.GenerateToken(id, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	return &adminAIFixture{router: r, tokens: tokens, aiRepo: aiRepo, events: events, repos: repos, users: users, admin: tok(owner), stranger: tok(stranger), familyA: hA.ID, familyB: hB.ID}
}

func (f *adminAIFixture) do(t *testing.T, token, method, path, body string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

func TestAdminAINotFoundForOthers(t *testing.T) {
	for _, admins := range [][]string{{"owner@example.com"}, nil} {
		f := newAdminAIFixture(t, admins, nil)
		token := f.stranger
		if admins == nil {
			token = f.admin // without ADMIN_EMAILS nobody is the admin
		}
		for _, c := range []struct{ method, path, body string }{
			{http.MethodGet, "/api/admin/families", ""},
			{http.MethodPut, "/api/admin/families/" + f.familyB + "/ai", `{"on":true}`},
			{http.MethodPost, "/api/admin/ai-check", ""},
		} {
			if code, body := f.do(t, token, c.method, c.path, c.body); code != http.StatusNotFound {
				t.Errorf("admins=%v %s %s → %d %s, want 404", admins, c.method, c.path, code, body)
			}
		}
	}
	f := newAdminAIFixture(t, []string{"owner@example.com"}, nil)
	if on, _ := f.aiRepo.Enabled(context.Background(), f.familyB); on {
		t.Error("a stranger's PUT must not switch AI on")
	}
}

func TestAdminFamiliesList(t *testing.T) {
	f := newAdminAIFixture(t, []string{"owner@example.com"}, nil)
	code, body := f.do(t, f.admin, http.MethodGet, "/api/admin/families", "")
	if code != http.StatusOK {
		t.Fatalf("families: %d %s", code, body)
	}
	var resp struct {
		Families []repository.AIFamily `json:"families"`
		Limit    int64                 `json:"limit_micros"`
		Key      bool                  `json:"key"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Limit != 2_000_000 || resp.Key || strings.Contains(body, `"limit":`) {
		t.Errorf("limit_micros/key = %d/%v, want 2 000 000/false (and no old \"limit\"): %s", resp.Limit, resp.Key, body)
	}
	if len(resp.Families) != 2 {
		t.Fatalf("families = %+v", resp.Families)
	}
	a, b := resp.Families[0], resp.Families[1]
	if a.ID != f.familyA || !a.AI || b.ID != f.familyB || b.AI {
		t.Fatalf("order: AI on first — %+v", resp.Families)
	}
	if strings.Join(a.Emails, ",") != "aigul@example.com,ilyas@example.com" {
		t.Errorf("emails by slot = %v", a.Emails)
	}
	// This month only: last month's 9 requests do not show.
	if a.Month != "2026-10" || a.Requests != 3 || a.CostMicros != 420_000 {
		t.Errorf("A usage = %s %d %d", a.Month, a.Requests, a.CostMicros)
	}
	if b.Requests != 0 || b.CostMicros != 0 {
		t.Errorf("B usage = %d %d", b.Requests, b.CostMicros)
	}
	// Nobody opened the app: the field is there and null.
	if a.LastActiveAt != nil || !strings.Contains(body, `"last_active_at":null`) {
		t.Errorf("no app_open → last_active_at null: %s", body)
	}
}

// Last activity (бэклог «Семьи в админке», Р-1): the latest app_open of any member — other
// events do not count; within the AI flag the freshest family goes first, never-active last.
func TestAdminFamiliesLastActive(t *testing.T) {
	f := newAdminAIFixture(t, []string{"owner@example.com"}, nil)
	ctx := context.Background()
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)
	family := func(email string) string {
		u, err := f.repos.Users.Create(ctx, email, "hash")
		if err != nil {
			t.Fatal(err)
		}
		f.users[email] = u.ID
		h, _, err := f.repos.Households.CreateHousehold(ctx, "", u.ID, email)
		if err != nil {
			t.Fatal(err)
		}
		return h.ID
	}
	cID, dID := family("cara@example.com"), family("dana@example.com")
	open := func(email string, ago time.Duration, kind string) {
		if err := f.events.Record(ctx, f.users[email], "", kind, now.Add(-ago)); err != nil {
			t.Fatal(err)
		}
	}
	open("aigul@example.com", 5*24*time.Hour, "app_open")
	open("ilyas@example.com", 26*time.Hour, "app_open")  // the partner is fresher
	open("ilyas@example.com", time.Hour, "week_done")    // not an app_open
	open("bota@example.com", 3*24*time.Hour, "app_open") // B: older than C, but fresher
	open("cara@example.com", 10*24*time.Hour, "app_open")
	open("stranger@example.com", 10*time.Minute, "app_open") // no family: no row

	code, body := f.do(t, f.admin, http.MethodGet, "/api/admin/families", "")
	if code != http.StatusOK {
		t.Fatalf("families: %d %s", code, body)
	}
	var resp struct {
		Families []repository.AIFamily `json:"families"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, fam := range resp.Families {
		ids = append(ids, fam.ID)
	}
	if strings.Join(ids, ",") != strings.Join([]string{f.familyA, f.familyB, cID, dID}, ",") {
		t.Fatalf("order = %v, want A (AI), B (3 days), C (10 days), D (never, newest)", ids)
	}
	a, b, c, d := resp.Families[0], resp.Families[1], resp.Families[2], resp.Families[3]
	if a.LastActiveAt == nil || !a.LastActiveAt.Equal(now.Add(-26*time.Hour)) {
		t.Errorf("A last = %v, want the partner's app_open 26 h ago", a.LastActiveAt)
	}
	if b.LastActiveAt == nil || !b.LastActiveAt.Equal(now.Add(-72*time.Hour)) {
		t.Errorf("B last = %v", b.LastActiveAt)
	}
	if c.LastActiveAt == nil || !c.LastActiveAt.Equal(now.Add(-240*time.Hour)) {
		t.Errorf("C last = %v", c.LastActiveAt)
	}
	if d.LastActiveAt != nil {
		t.Errorf("D last = %v, want null", d.LastActiveAt)
	}
}

func TestAdminSetAI(t *testing.T) {
	f := newAdminAIFixture(t, []string{"owner@example.com"}, nil)
	path := "/api/admin/families/" + f.familyB + "/ai"

	code, body := f.do(t, f.admin, http.MethodPut, path, `{"on":true}`)
	if code != http.StatusOK || !strings.Contains(body, `"ai":true`) || !strings.Contains(body, f.familyB) {
		t.Fatalf("on: %d %s", code, body)
	}
	if on, _ := f.aiRepo.Enabled(context.Background(), f.familyB); !on {
		t.Fatal("flag not stored")
	}
	if code, body := f.do(t, f.admin, http.MethodPut, path, `{"on":false}`); code != http.StatusOK || !strings.Contains(body, `"ai":false`) {
		t.Fatalf("off: %d %s", code, body)
	}
	// An upper-case id is the same family (Postgres compares uuids, answers lower case).
	upper := "/api/admin/families/" + strings.ToUpper(f.familyB) + "/ai"
	if code, body := f.do(t, f.admin, http.MethodPut, upper, `{"on":false}`); code != http.StatusOK || !strings.Contains(body, f.familyB) {
		t.Fatalf("upper-case id: %d %s", code, body)
	}

	for _, c := range []struct {
		path, body string
		want       int
	}{
		{"/api/admin/families/00000000-0000-0000-0000-000000000000/ai", `{"on":true}`, http.StatusNotFound},
		{"/api/admin/families/not-a-uuid/ai", `{"on":true}`, http.StatusNotFound},
		{path, `{"on":true,"limit":100}`, http.StatusBadRequest},
		{path, `{}`, http.StatusBadRequest},
		{path, `{"on":"yes"}`, http.StatusBadRequest},
		{path, `{"on":true,"pad":"` + strings.Repeat("x", 80) + `"}`, http.StatusRequestEntityTooLarge},
	} {
		if code, body := f.do(t, f.admin, http.MethodPut, c.path, c.body); code != c.want {
			t.Errorf("PUT %s %q → %d %s, want %d", c.path, c.body, code, body, c.want)
		}
	}
}

// fakeCheck is a Claude stand-in answering every call with status and body.
func fakeCheck(t *testing.T, status int, body string) *ai.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("retry-after-ms", "1")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return ai.New("test-key", srv.URL+"/")
}

const okMessage = `{"id":"m","type":"message","role":"assistant","model":"claude-haiku-5-5","stop_reason":"end_turn",
"content":[{"type":"text","text":"{\"ok\":true}"}],"usage":{"input_tokens":20,"output_tokens":4}}`

func TestAdminAICheck(t *testing.T) {
	cases := []struct {
		name   string
		client func(t *testing.T) *ai.Client
		want   []string
	}{
		{"no key", func(t *testing.T) *ai.Client { return nil }, []string{`"ok":false`, `"reason":"no_key"`}},
		{"ok", func(t *testing.T) *ai.Client { return fakeCheck(t, 200, okMessage) }, []string{`"ok":true`, `"model":"claude-haiku-5-5"`, `"ms":`}},
		{"500", func(t *testing.T) *ai.Client {
			return fakeCheck(t, 500, `{"type":"error","error":{"type":"api_error","message":"x"}}`)
		}, []string{`"ok":false`, `"reason":"failed"`}},
		{"429", func(t *testing.T) *ai.Client {
			return fakeCheck(t, 429, `{"type":"error","error":{"type":"rate_limit_error","message":"x"}}`)
		}, []string{`"ok":false`, `"reason":"rate_limited"`}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newAdminAIFixture(t, []string{"owner@example.com"}, tc.client(t))
			before := f.aiRepo.Usage[f.familyA]["2026-10"]
			code, body := f.do(t, f.admin, http.MethodPost, "/api/admin/ai-check", "")
			if code != http.StatusOK {
				t.Fatalf("check: %d %s", code, body)
			}
			for _, w := range tc.want {
				if !strings.Contains(body, w) {
					t.Errorf("body %s lacks %s", body, w)
				}
			}
			// The check is the owner's, not a family's: no usage anywhere.
			if after := f.aiRepo.Usage[f.familyA]["2026-10"]; after != before || len(f.aiRepo.Usage) != 1 {
				t.Errorf("ai-check changed usage: %+v", f.aiRepo.Usage)
			}
		})
	}
}
