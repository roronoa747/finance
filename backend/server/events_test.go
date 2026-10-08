package server

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

func newEventsApp(t *testing.T, admins []string) (*googleApp, *repository.MockEventRepo) {
	t.Helper()
	mocks := repository.NewMockRepositories()
	mocks.Households.SetDocRepo(mocks.Docs)
	cfg := devConfig()
	cfg.AdminEmails = admins
	tokens := auth.NewTokenService(cfg.JWTSecret, time.Hour)
	events := &repository.MockEventRepo{}
	r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx,
		Accounts: repository.NewMockAccountRepo(mocks), Events: events, Metrics: repository.MockMetricsRepo{}}, tokens, fx.NewClient(), fakeGoogle{})
	return &googleApp{r: r, mocks: mocks, tokens: tokens}, events
}

func TestEventsRecord(t *testing.T) {
	a, events := newEventsApp(t, nil)
	_, dana := a.google(t, "id:sub-dana:dana@example.com")

	// Without a household too; app_open twice a day — one row.
	for range 2 {
		if rec := a.do(t, http.MethodPost, "/api/events", dana.Token, map[string]string{"kind": "app_open"}); rec.Code != http.StatusNoContent {
			t.Fatalf("app_open: %d %s", rec.Code, rec.Body.String())
		}
	}
	if rec := a.do(t, http.MethodPost, "/api/events", dana.Token, map[string]string{"kind": "first_run_goal", "at": time.Now().Add(-time.Hour).Format(time.RFC3339)}); rec.Code != http.StatusNoContent {
		t.Fatalf("first_run_goal: %d", rec.Code)
	}
	if len(events.Events) != 2 || events.Events[0].Kind != "app_open" || events.Events[0].HouseholdID != "" {
		t.Errorf("events = %+v", events.Events)
	}

	for name, body := range map[string]any{
		"unknown kind":   map[string]string{"kind": "purchase"},
		"no kind":        map[string]string{},
		"free text":      map[string]string{"kind": "app_open", "note": "Magnum 5000"},
		"amount smuggle": map[string]any{"kind": "week_done", "amount": 12000},
	} {
		if rec := a.do(t, http.MethodPost, "/api/events", dana.Token, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, rec.Code)
		}
	}
	big := map[string]string{"kind": "app_open", "at": strings.Repeat("9", 2048)}
	if rec := a.do(t, http.MethodPost, "/api/events", dana.Token, big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("body over 1 KB: %d", rec.Code)
	}
	if rec := a.do(t, http.MethodPost, "/api/events", "", map[string]string{"kind": "app_open"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", rec.Code)
	}
	// A time from the future or the distant past is taken as now.
	a.do(t, http.MethodPost, "/api/events", dana.Token, map[string]string{"kind": "week_done", "at": "2030-01-01T00:00:00Z"})
	if last := events.Events[len(events.Events)-1]; time.Since(last.At) > time.Minute {
		t.Errorf("future time kept: %v", last.At)
	}
}

func TestAdminMetricsOnlyForAdminEmails(t *testing.T) {
	// Without ADMIN_EMAILS — 404 for everyone, me.admin false.
	a, _ := newEventsApp(t, nil)
	_, owner := a.google(t, "id:sub-owner:owner@example.com")
	if rec := a.do(t, http.MethodGet, "/api/admin/metrics", owner.Token, nil); rec.Code != http.StatusNotFound {
		t.Errorf("without ADMIN_EMAILS: %d", rec.Code)
	}
	if rec := a.do(t, http.MethodGet, "/api/auth/me", owner.Token, nil); !strings.Contains(rec.Body.String(), `"admin":false`) {
		t.Errorf("me without admins: %s", rec.Body.String())
	}

	a, _ = newEventsApp(t, []string{"owner@example.com"})
	_, owner = a.google(t, "id:sub-owner:Owner@Example.com")
	_, partner := a.google(t, "id:sub-partner:partner@example.com")
	rec := a.do(t, http.MethodGet, "/api/admin/metrics", owner.Token, nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"second_upload_14d"`) || !strings.Contains(rec.Body.String(), `"weeks"`) {
		t.Errorf("admin metrics: %d %s", rec.Code, rec.Body.String())
	}
	if rec := a.do(t, http.MethodGet, "/api/auth/me", owner.Token, nil); !strings.Contains(rec.Body.String(), `"admin":true`) {
		t.Errorf("me of the admin: %s", rec.Body.String())
	}
	if rec := a.do(t, http.MethodGet, "/api/admin/metrics", partner.Token, nil); rec.Code != http.StatusNotFound {
		t.Errorf("partner: %d", rec.Code)
	}
	if rec := a.do(t, http.MethodGet, "/api/admin/metrics", "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: %d", rec.Code)
	}
}
