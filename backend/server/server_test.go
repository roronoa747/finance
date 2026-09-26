package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/config"
	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

func devConfig() *config.Config {
	return &config.Config{Env: "development", JWTSecret: config.DefaultJWTSecret}
}

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestNewHandlerRoutesOnMocks(t *testing.T) {
	h, err := NewHandler(devConfig(), nil)
	if err != nil {
		t.Fatal(err)
	}

	if rec := get(t, h, "/api/health"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"db":"disconnected"`) {
		t.Errorf("health: %d %s", rec.Code, rec.Body.String())
	}
	for _, path := range []string{"/api/auth/me", "/api/sync/household", "/api/sync/private"} {
		if rec := get(t, h, path); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s without token: expected 401, got %d", path, rec.Code)
		}
	}
	if rec := get(t, h, "/api/nope"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown route: expected 404, got %d", rec.Code)
	}
}

func TestNewHandlerRefusesMocksInProduction(t *testing.T) {
	cfg := &config.Config{Env: "production", JWTSecret: strings.Repeat("s", 32)}
	if _, err := NewHandler(cfg, nil); err == nil {
		t.Fatal("production without a database must fail")
	}
}

func TestRouterServesFxRateFromStub(t *testing.T) {
	bank := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<rates><item><title>EUR</title><description>513.46</description></item></rates>`))
	}))
	defer bank.Close()
	fxClient := fx.NewClient()
	fxClient.BaseURL = bank.URL

	mocks := repository.NewMockRepositories()
	cfg := devConfig()
	r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements},
		auth.NewTokenService(cfg.JWTSecret, time.Hour), fxClient)

	rec := get(t, r, "/api/fx-rate") // public: no token
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"EUR":513.46`) {
		t.Errorf("fx-rate: %d %s", rec.Code, rec.Body.String())
	}
}
