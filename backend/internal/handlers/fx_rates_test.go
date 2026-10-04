package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

// История курсов (B2C-76): роли, проверки, догрузка не больше лимита, ошибки банка.

// fxRatesApp is the protected route over a stub bank that answers every date with
// EUR = 500.5 + day of month, except the dates in down (500) and empty (no items).
type fxRatesApp struct {
	r      http.Handler
	tokens *auth.TokenService
	store  *repository.MockFxRepo
	client *fx.Client
	calls  *atomic.Int32
	down   map[string]bool
	empty  map[string]bool
}

// fxNow is 03.10.2026 10:00 in Almaty.
var fxNow = time.Date(2026, 10, 3, 5, 0, 0, 0, time.UTC)

func setupFxRatesApp(t *testing.T) *fxRatesApp {
	t.Helper()
	app := &fxRatesApp{
		tokens: auth.NewTokenService("fx-test-signing-key", time.Hour),
		store:  repository.NewMockFxRepo(),
		calls:  &atomic.Int32{},
		down:   map[string]bool{},
		empty:  map[string]bool{},
	}
	c := fxClientFor(t, func(w http.ResponseWriter, r *http.Request) {
		app.calls.Add(1)
		fdate := r.URL.Query().Get("fdate")
		if app.down[fdate] {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		if app.empty[fdate] {
			_, _ = w.Write([]byte(`<rates></rates>`))
			return
		}
		day, _ := time.Parse("02.01.2006", fdate)
		fmt.Fprintf(w, `<rates><item><title>EUR</title><description>%d.5</description></item><item><title>USD</title><description>450</description></item></rates>`, 500+day.Day())
	})
	c.Now = func() time.Time { return fxNow }
	app.client = c
	app.serveWith(app.store)
	return app
}

// serveWith routes the handler over store (the mock itself, or a wrapper that fails).
func (a *fxRatesApp) serveWith(store repository.FxRepository) {
	r := chi.NewRouter()
	r.Group(func(protected chi.Router) {
		protected.Use(auth.Middleware(a.tokens))
		protected.Get("/api/fx-rates", FxRatesHandler(a.client, store))
	})
	a.r = r
}

func (a *fxRatesApp) get(t *testing.T, role, household, query string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/fx-rates?"+query, nil)
	if role != "" {
		tok, err := a.tokens.GenerateToken("user-1", household, role, "a")
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	a.r.ServeHTTP(rec, req)
	return rec
}

func decodeFxRates(t *testing.T, rec *httptest.ResponseRecorder) fxRatesResponse {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body fxRatesResponse
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func TestFxRatesValidation(t *testing.T) {
	app := setupFxRatesApp(t)
	for _, q := range []string{
		"code=GBP&from=2026-09-01&to=2026-09-30",
		"code=eur&from=2026-09-01&to=2026-09-30",
		"code=EUR&from=01.09.2026&to=2026-09-30",
		"code=EUR&from=2026-09-01",
		"code=EUR&from=2026-09-30&to=2026-09-01",
		"code=EUR&from=2026-10-01&to=2026-10-04", // tomorrow in Almaty
		"code=EUR&from=2025-08-28&to=2026-10-02", // 401 days
	} {
		if rec := app.get(t, "member", "h1", q); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d", q, rec.Code)
		}
	}
	if app.calls.Load() != 0 {
		t.Error("a rejected request must not reach the bank")
	}
	// Exactly 400 days is fine — and partial: only fxFetchLimit days are fetched.
	body := decodeFxRates(t, app.get(t, "member", "h1", "code=EUR&from=2025-08-29&to=2026-10-02"))
	if !body.Partial || len(body.Rates) != fxFetchLimit || int(app.calls.Load()) != fxFetchLimit {
		t.Errorf("400 days: partial %v, %d rates, %d calls", body.Partial, len(body.Rates), app.calls.Load())
	}
}

func TestFxRatesAccess(t *testing.T) {
	app := setupFxRatesApp(t)
	q := "code=EUR&from=2026-09-28&to=2026-10-02"
	if rec := app.get(t, "", "", q); rec.Code != http.StatusUnauthorized {
		t.Errorf("no token: expected 401, got %d", rec.Code)
	}
	if rec := app.get(t, "member", "", q); rec.Code != http.StatusConflict {
		t.Errorf("no household: expected 409, got %d", rec.Code)
	}
	if rec := app.get(t, "guest", "h1", q); rec.Code != http.StatusForbidden {
		t.Errorf("unknown role: expected 403, got %d", rec.Code)
	}
	body := decodeFxRates(t, app.get(t, "viewer", "h1", q))
	if body.Code != "EUR" || body.Partial || len(body.Rates) != 5 || body.Rates["2026-10-02"] != 502.5 || body.Source == "" {
		t.Errorf("viewer: %+v", body)
	}
}

func TestFxRatesServesStoredDaysWithoutBank(t *testing.T) {
	app := setupFxRatesApp(t)
	for d := 1; d <= 30; d++ {
		rates := map[string]float64{"EUR": 600 + float64(d)}
		if d == 6 { // stored as "nothing published"
			rates = nil
		}
		_ = app.store.Save(context.Background(), day(2026, 9, d), rates)
	}
	body := decodeFxRates(t, app.get(t, "member", "h1", "code=EUR&from=2026-09-01&to=2026-09-30"))
	if app.calls.Load() != 0 {
		t.Errorf("stored days must not reach the bank, got %d calls", app.calls.Load())
	}
	if body.Partial || len(body.Rates) != 29 || body.Rates["2026-09-15"] != 615 {
		t.Errorf("stored: partial %v, %d rates, 15th %v", body.Partial, len(body.Rates), body.Rates["2026-09-15"])
	}
	if _, ok := body.Rates["2026-09-06"]; ok {
		t.Error("an unpublished day must not be in rates")
	}
	usd := decodeFxRates(t, app.get(t, "member", "h1", "code=USD&from=2026-09-01&to=2026-09-30"))
	if len(usd.Rates) != 0 || usd.Partial {
		t.Errorf("another code is not invented: %+v", usd)
	}
}

func TestFxRatesFetchesAtMostLimitNewestFirst(t *testing.T) {
	app := setupFxRatesApp(t)
	q := "code=EUR&from=2026-09-01&to=2026-10-03" // 33 days, none stored
	first := decodeFxRates(t, app.get(t, "member", "h1", q))
	if n := int(app.calls.Load()); n != fxFetchLimit {
		t.Fatalf("expected %d bank calls, got %d", fxFetchLimit, n)
	}
	if !first.Partial || len(first.Rates) != fxFetchLimit {
		t.Errorf("first: partial %v, %d rates", first.Partial, len(first.Rates))
	}
	if first.Rates["2026-10-03"] != 503.5 || first.Rates["2026-09-14"] != 514.5 {
		t.Errorf("newest days come first: %v", first.Rates)
	}
	if _, ok := first.Rates["2026-09-13"]; ok {
		t.Error("the 21st newest day is beyond the limit")
	}

	second := decodeFxRates(t, app.get(t, "member", "h1", q))
	if second.Partial || len(second.Rates) != 33 || app.calls.Load() != 33 {
		t.Errorf("second: partial %v, %d rates, %d calls", second.Partial, len(second.Rates), app.calls.Load())
	}
	// Everything is stored: a third request does not reach the bank.
	decodeFxRates(t, app.get(t, "member", "h1", q))
	if app.calls.Load() != 33 {
		t.Errorf("third request reached the bank: %d calls", app.calls.Load())
	}
}

func TestFxRatesBankErrorAnswersWhatThereIs(t *testing.T) {
	app := setupFxRatesApp(t)
	app.down["30.09.2026"] = true
	app.empty["27.09.2026"] = true // past and empty: "nothing published"
	app.empty["03.10.2026"] = true // today and empty: may still come
	q := "code=EUR&from=2026-09-26&to=2026-10-03"
	body := decodeFxRates(t, app.get(t, "member", "h1", q))
	if !body.Partial || len(body.Rates) != 5 {
		t.Errorf("bank error: partial %v, %d rates %v", body.Partial, len(body.Rates), body.Rates)
	}
	checked, _ := app.store.Checked(context.Background(), day(2026, 9, 26), day(2026, 10, 3))
	if published, ok := checked["2026-09-27"]; !ok || published {
		t.Errorf("empty past day must be stored unpublished: %v %v", published, ok)
	}
	if _, ok := checked["2026-10-03"]; ok {
		t.Error("an empty today must not be stored")
	}
	if _, ok := checked["2026-09-30"]; ok {
		t.Error("a failed day must not be stored")
	}

	// The bank is back: only the failed day and today are asked again.
	delete(app.down, "30.09.2026")
	delete(app.empty, "03.10.2026")
	before := app.calls.Load()
	again := decodeFxRates(t, app.get(t, "member", "h1", q))
	if again.Partial || len(again.Rates) != 7 || app.calls.Load()-before != 2 {
		t.Errorf("retry: partial %v, %d rates, %d calls", again.Partial, len(again.Rates), app.calls.Load()-before)
	}
}

func TestFxRateHandlerSavesItsDay(t *testing.T) {
	c := fxClientFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<rates><item><title>EUR</title><description>513.46</description></item></rates>`))
	})
	c.Now = func() time.Time { return fxNow }
	store := repository.NewMockFxRepo()

	h := FxRateHandler(c, store)
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/fx-rate", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	got, _ := store.Rates(context.Background(), "EUR", day(2026, 10, 3), day(2026, 10, 3))
	if got["2026-10-03"] != 513.46 || store.Saves() != 1 {
		t.Errorf("saved: %v (%d saves)", got, store.Saves())
	}

	// The same day again (client cache): answered, not written a second time.
	again := httptest.NewRecorder()
	h(again, httptest.NewRequest(http.MethodGet, "/api/fx-rate?x=1", nil))
	if again.Code != http.StatusOK || store.Saves() != 1 {
		t.Errorf("repeat hit: %d, %d saves", again.Code, store.Saves())
	}
}

// failingFxStore fails every write: /api/fx-rate still answers.
type failingFxStore struct{ repository.FxRepository }

func (failingFxStore) Save(context.Context, time.Time, map[string]float64) error {
	return errors.New("db down")
}

func TestFxRateHandlerSaveErrorKeepsAnswer(t *testing.T) {
	c := fxClientFor(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<rates><item><title>EUR</title><description>513.46</description></item></rates>`))
	})
	rec := httptest.NewRecorder()
	FxRateHandler(c, failingFxStore{repository.NewMockFxRepo()})(rec, httptest.NewRequest(http.MethodGet, "/api/fx-rate", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"EUR":513.46`) {
		t.Errorf("save error changed the answer: %d %s", rec.Code, rec.Body.String())
	}
}

// brokenFxStore wraps the mock and fails reads or writes on demand (review backend Н-6).
type brokenFxStore struct {
	*repository.MockFxRepo
	failRead, failSave bool
}

func (b brokenFxStore) Checked(ctx context.Context, from, to time.Time) (map[string]bool, error) {
	if b.failRead {
		return nil, errors.New("db down")
	}
	return b.MockFxRepo.Checked(ctx, from, to)
}

func (b brokenFxStore) Save(ctx context.Context, day time.Time, rates map[string]float64) error {
	if b.failSave {
		return errors.New("db down")
	}
	return b.MockFxRepo.Save(ctx, day, rates)
}

func TestFxRatesSaveErrorAnswersPartial(t *testing.T) {
	app := setupFxRatesApp(t)
	app.serveWith(brokenFxStore{MockFxRepo: app.store, failSave: true})
	body := decodeFxRates(t, app.get(t, "member", "h1", "code=EUR&from=2026-10-01&to=2026-10-03"))
	if !body.Partial {
		t.Error("a failed write must answer partial: true")
	}
	checked, _ := app.store.Checked(context.Background(), day(2026, 10, 1), day(2026, 10, 3))
	if len(checked) != 0 {
		t.Errorf("no day may be marked asked after a failed write: %v", checked)
	}
}

func TestFxRatesReadErrorIs500WithoutBank(t *testing.T) {
	app := setupFxRatesApp(t)
	app.serveWith(brokenFxStore{MockFxRepo: app.store, failRead: true})
	rec := app.get(t, "member", "h1", "code=EUR&from=2026-10-01&to=2026-10-03")
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
	if n := app.calls.Load(); n != 0 {
		t.Errorf("a failed read must not reach the bank, got %d calls", n)
	}
}
