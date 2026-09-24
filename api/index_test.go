package handler

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"finance-backend/server"
)

func reset(t *testing.T, fn func() (http.Handler, error)) {
	t.Helper()
	api, build = nil, fn
	t.Cleanup(func() { api, build = nil, server.FromEnv })
}

func call(path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	Handler(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestHandlerServesHealthAndBuildsOnce(t *testing.T) {
	t.Setenv("APP_ENV", "")
	t.Setenv("DATABASE_URL", "")
	builds := 0
	reset(t, func() (http.Handler, error) {
		builds++
		return server.FromEnv()
	})

	for range 3 {
		rec := call("/api/health")
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
			t.Fatalf("health: %d %s", rec.Code, rec.Body.String())
		}
	}
	if builds != 1 {
		t.Errorf("expected one build per instance, got %d", builds)
	}
}

func TestHandlerRetriesFailedBuild(t *testing.T) {
	builds := 0
	reset(t, func() (http.Handler, error) {
		builds++
		if builds == 1 {
			return nil, errors.New("database is waking up")
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}), nil
	})

	if rec := call("/api/health"); rec.Code != http.StatusInternalServerError || strings.Contains(rec.Body.String(), "waking") {
		t.Errorf("failed build: expected a generic 500, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := call("/api/health"); rec.Code != http.StatusOK {
		t.Errorf("second request should rebuild, got %d", rec.Code)
	}
}

func TestHandlerProductionWithoutEnvFails(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("JWT_SECRET", "")
	reset(t, server.FromEnv)

	if rec := call("/api/health"); rec.Code != http.StatusInternalServerError {
		t.Errorf("production without env must not serve mocks, got %d", rec.Code)
	}
}
