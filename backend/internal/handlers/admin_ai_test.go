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
	admin    string // token
	stranger string // token
	familyA  string // AI on, spent this month
	familyB  string // AI off
}

// newAdminAIFixture: owner@example.com is the admin; two families, A with AI on and usage
// this month and last month, B off. client nil = no key.
func newAdminAIFixture(t *testing.T, admins []string, client *ai.Client) *adminAIFixture {
	t.Helper()
	ctx := context.Background()
	repos := repository.NewMockRepositories()
	tokens := auth.NewTokenService("test-secret-salt-key", time.Hour)
	aiRepo := repository.NewMockAIRepo(repos.Households, repos.Users)
	now := time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)

	mkUser := func(email string) string {
		u, err := repos.Users.Create(ctx, email, "hash")
		if err != nil {
			t.Fatal(err)
		}
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

	h := NewAdminAIHandler(aiRepo, repos.Users, admins, client, "claude-haiku-5-5", 30)
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
	return &adminAIFixture{router: r, tokens: tokens, aiRepo: aiRepo, admin: tok(owner), stranger: tok(stranger), familyA: hA.ID, familyB: hB.ID}
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
		Limit    int                   `json:"limit"`
		Key      bool                  `json:"key"`
	}
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.Limit != 30 || resp.Key {
		t.Errorf("limit/key = %d/%v, want 30/false", resp.Limit, resp.Key)
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
