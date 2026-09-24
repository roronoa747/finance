package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"finance-backend/internal/fx"
)

func fxClientFor(t *testing.T, h http.HandlerFunc) *fx.Client {
	t.Helper()
	bank := httptest.NewServer(h)
	t.Cleanup(bank.Close)
	c := fx.NewClient()
	c.BaseURL = bank.URL
	return c
}

func TestFxRateHandlerServesRatesWithCDNCache(t *testing.T) {
	c := fxClientFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<rates><item><title>USD</title><description>447.85</description><quant>1</quant></item></rates>`))
	})

	rec := httptest.NewRecorder()
	FxRateHandler(c)(rec, httptest.NewRequest(http.MethodGet, "/api/fx-rate", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, s-maxage=3600" {
		t.Errorf("unexpected Cache-Control %q", got)
	}
	var body fx.Rates
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Rates["USD"] != 447.85 || body.Date == "" || body.Source == "" {
		t.Errorf("unexpected body %+v", body)
	}
}

func TestFxRateHandlerBankDownIs502(t *testing.T) {
	c := fxClientFor(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusInternalServerError)
	})

	rec := httptest.NewRecorder()
	FxRateHandler(c)(rec, httptest.NewRequest(http.MethodGet, "/api/fx-rate", nil))

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
	if rec.Header().Get("Cache-Control") != "" {
		t.Error("an error must not be cached by the CDN")
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body["error"] == "" {
		t.Errorf("expected {\"error\": ...}, got %v (%v)", body, err)
	}
}
