package fx

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"
)

// Real bank answer for 23.09.2026, trimmed to a few items.
func fixture(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("testdata/rates-2026-09-23.xml")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestParseRatesRealFormat(t *testing.T) {
	got := ParseRates(fixture(t))
	want := map[string]float64{"USD": 447.85, "EUR": 513.46, "CNY": 66.86, "RUB": 5.31, "AUD": 318.65, "AMD": 1.241}
	for code, v := range want {
		if diff := got[code] - v; diff > 1e-9 || diff < -1e-9 {
			t.Errorf("%s: want %v, got %v", code, v, got[code])
		}
	}
}

// bank serves the fixture for the dates in `published` and an empty feed otherwise.
func bank(t *testing.T, published map[string]bool, calls *atomic.Int32) *httptest.Server {
	t.Helper()
	body := fixture(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if published[r.URL.Query().Get("fdate")] {
			_, _ = w.Write(body)
			return
		}
		_, _ = w.Write([]byte(`<?xml version="1.0"?><rates></rates>`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testClient(url string, now time.Time) *Client {
	c := NewClient()
	c.BaseURL = url
	c.Now = func() time.Time { return now }
	return c
}

func TestRatesStepsBackOverWeekendAndCaches(t *testing.T) {
	var calls atomic.Int32
	srv := bank(t, map[string]bool{"25.09.2026": true}, &calls) // Friday
	// Sunday 27.09 02:00 in Almaty is still Saturday in UTC; the bank's date wins.
	now := time.Date(2026, 9, 26, 21, 0, 0, 0, time.UTC)
	c := testClient(srv.URL, now)

	got, err := c.Rates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if got.Date != "2026-09-25" || got.Source != Source {
		t.Errorf("unexpected meta: %+v", got)
	}
	if len(got.Rates) != len(Supported) || got.Rates["USD"] != 447.85 {
		t.Errorf("unexpected rates: %v", got.Rates)
	}
	if _, ok := got.Rates["AUD"]; ok {
		t.Error("unsupported currencies must be dropped")
	}
	if n := calls.Load(); n != 3 { // 27, 26, 25
		t.Errorf("expected 3 bank calls, got %d", n)
	}

	c.Now = func() time.Time { return now.Add(59 * time.Minute) }
	if _, err := c.Rates(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 3 {
		t.Errorf("a call within TTL must not reach the bank, got %d calls", n)
	}

	c.Now = func() time.Time { return now.Add(61 * time.Minute) }
	if _, err := c.Rates(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 6 {
		t.Errorf("an expired cache must refetch, got %d calls", n)
	}
}

func TestRatesBankErrorAndEmptyWeek(t *testing.T) {
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer failing.Close()

	c := testClient(failing.URL, time.Now())
	if _, err := c.Rates(context.Background()); !errors.Is(err, ErrNoRates) {
		t.Errorf("bank errors all week: want ErrNoRates, got %v", err)
	}

	var calls atomic.Int32
	empty := bank(t, nil, &calls)
	c = testClient(empty.URL, time.Now())
	if _, err := c.Rates(context.Background()); !errors.Is(err, ErrNoRates) {
		t.Errorf("empty week: want ErrNoRates, got %v", err)
	}
	if n := calls.Load(); n != lookbackDays {
		t.Errorf("expected %d lookback calls, got %d", lookbackDays, n)
	}
}

func TestRatesTimeoutStopsLookback(t *testing.T) {
	var calls atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		<-r.Context().Done()
	}))
	defer slow.Close()

	c := testClient(slow.URL, time.Now())
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	start := time.Now()
	if _, err := c.Rates(ctx); err == nil {
		t.Fatal("expected an error on timeout")
	}
	if time.Since(start) > 2*time.Second {
		t.Error("timeout must abort the lookback promptly")
	}
	if n := calls.Load(); n != 1 {
		t.Errorf("after the deadline no more days are tried, got %d calls", n)
	}
}
