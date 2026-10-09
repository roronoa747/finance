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

// Production has no password sign-up (critic of Block 4): an account taken in advance under
// someone else's address would get that person's Google sign-in. Login stays — old users.
func TestProductionHasNoPasswordSignUp(t *testing.T) {
	mocks := repository.NewMockRepositories()
	cfg := &config.Config{Env: "production", JWTSecret: strings.Repeat("s", 32)}
	r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx},
		auth.NewTokenService(cfg.JWTSecret, time.Hour), fx.NewClient(), nil)

	post := func(path string) int {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, strings.NewReader(`{"email":"x@example.com"}`)))
		return rec.Code
	}
	if code := post("/api/auth/register"); code != http.StatusNotFound && code != http.StatusMethodNotAllowed {
		t.Errorf("register in production: expected no route, got %d", code)
	}
	if code := post("/api/auth/login"); code == http.StatusNotFound || code == http.StatusMethodNotAllowed {
		t.Errorf("login in production must stay, got %d", code)
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
	r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx},
		auth.NewTokenService(cfg.JWTSecret, time.Hour), fxClient, nil)

	rec := get(t, r, "/api/fx-rate") // public: no token
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"EUR":513.46`) {
		t.Errorf("fx-rate: %d %s", rec.Code, rec.Body.String())
	}
}
