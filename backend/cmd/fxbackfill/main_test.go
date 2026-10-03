package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

// backfill over a stub bank: 28.09 is empty, 30.09 fails; today is 02.10.2026 (Almaty).
func TestRunFillsSkipsAndRetries(t *testing.T) {
	var calls atomic.Int32
	down := true
	bank := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		switch r.URL.Query().Get("fdate") {
		case "28.09.2026":
			_, _ = w.Write([]byte(`<rates></rates>`))
		case "30.09.2026":
			if down {
				http.Error(w, "down", http.StatusBadGateway)
				return
			}
			fallthrough
		default:
			_, _ = w.Write([]byte(`<rates><item><title>EUR</title><description>510.5</description></item></rates>`))
		}
	}))
	defer bank.Close()

	client := fx.NewClient()
	client.BaseURL = bank.URL
	client.Now = func() time.Time { return time.Date(2026, 10, 2, 6, 0, 0, 0, time.UTC) }
	store := repository.NewMockFxRepo()

	res, err := run(context.Background(), client, store, 7, 0) // 26.09…02.10
	if err != nil {
		t.Fatal(err)
	}
	if res.filled != 6 || res.published != 5 || res.failed != 1 || calls.Load() != 7 {
		t.Errorf("first run: %+v, %d calls", res, calls.Load())
	}
	if got := res.String(); got != "filled 6 days, 5 published, 1 failed (run again to retry)" {
		t.Errorf("output: %q", got)
	}

	// Second run asks only the failed day.
	down = false
	res, err = run(context.Background(), client, store, 7, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.filled != 1 || res.published != 1 || res.failed != 0 || calls.Load() != 8 {
		t.Errorf("second run: %+v, %d calls", res, calls.Load())
	}
	if res.String() != "filled 1 days, 1 published" {
		t.Errorf("output: %q", res.String())
	}

	// Third run: everything is settled, the bank is not asked.
	res, _ = run(context.Background(), client, store, 7, 0)
	if res.filled != 0 || calls.Load() != 8 {
		t.Errorf("third run: %+v, %d calls", res, calls.Load())
	}

	from := time.Date(2026, 9, 26, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	rates, _ := store.Rates(context.Background(), "EUR", from, to)
	if len(rates) != 6 || rates["2026-09-30"] != 510.5 {
		t.Errorf("stored: %v", rates)
	}

	if _, err := run(context.Background(), client, store, 0, 0); err == nil {
		t.Error("-days 0 must be refused")
	}
}
