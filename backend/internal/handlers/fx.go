package handlers

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/fx"
	"finance-backend/internal/repository"
)

// fxTimeout bounds the whole lookback so a slow bank cannot hold the function.
const fxTimeout = 8 * time.Second

// fxSaveTimeout bounds writing the day /api/fx-rate has just fetched.
const fxSaveTimeout = 2 * time.Second

// FxRateHandler serves official exchange rates. It is public: the demo mode
// has no token but still converts currencies. On Vercel the CDN caches the
// answer for an hour; the client's own cache covers local runs.
//
// With a store (production) the fetched day also goes into the rate history
// (B2C-76); a failed write is only logged, the answer is the same.
func FxRateHandler(client *fx.Client, store repository.FxRepository) http.HandlerFunc {
	// The day this instance has already written: a public endpoint answered from the
	// client's cache must not turn every hit into a database transaction (critic, B2C-76).
	var savedMu sync.Mutex
	saved := ""
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), fxTimeout)
		defer cancel()

		rates, err := client.Rates(ctx)
		if err != nil {
			log.Printf("fx-rate: %v", err)
			respondJSON(w, http.StatusBadGateway, map[string]string{"error": "курс Нацбанка недоступен"})
			return
		}

		if store != nil {
			savedMu.Lock()
			fresh := saved != rates.Date
			savedMu.Unlock()
			if day, err := time.Parse(time.DateOnly, rates.Date); fresh && err == nil && len(rates.Rates) > 0 {
				saveCtx, cancelSave := context.WithTimeout(r.Context(), fxSaveTimeout)
				if err := store.Save(saveCtx, day, rates.Rates); err != nil {
					log.Printf("fx-rate: save day: %v", err)
				} else {
					savedMu.Lock()
					saved = rates.Date
					savedMu.Unlock()
				}
				cancelSave()
			}
		}

		w.Header().Set("Cache-Control", "public, s-maxage=3600")
		respondJSON(w, http.StatusOK, rates)
	}
}

// Limits of GET /api/fx-rates: one request cannot make the function walk the bank
// for a whole year — it fills at most fxFetchLimit missing days and says partial.
const (
	fxRatesMaxDays  = 400
	fxFetchLimit    = 20
	fxFetchParallel = 4
	fxFetchTimeout  = 6 * time.Second // under the function's limit, with room for the database
)

type fxRatesResponse struct {
	Code    string             `json:"code"`
	Rates   map[string]float64 `json:"rates"`
	Partial bool               `json:"partial"`
	Source  string             `json:"source"`
}

// FxRatesHandler — GET /api/fx-rates?code=EUR&from=YYYY-MM-DD&to=YYYY-MM-DD (member
// and viewer; 409 without a family): one currency's published rates over a period
// of at most fxRatesMaxDays (Р-71). Days never asked are fetched from the bank —
// newest first, at most fxFetchLimit — and stored; the rest, or a bank failure,
// answers partial: true with what there is, and the client asks again later.
func FxRatesHandler(client *fx.Client, store repository.FxRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := auth.GetUserID(r.Context())
		if strings.TrimSpace(userID) == "" {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if role, _ := auth.GetRole(r.Context()); role != "member" && role != "viewer" {
			errorJSON(w, http.StatusForbidden, "forbidden")
			return
		}
		if householdID, _ := auth.GetHouseholdID(r.Context()); strings.TrimSpace(householdID) == "" {
			errorJSON(w, http.StatusConflict, "no household")
			return
		}

		q := r.URL.Query()
		code := q.Get("code")
		if !fx.IsSupported(code) {
			errorJSON(w, http.StatusBadRequest, "code must be one of "+strings.Join(fx.Supported, ", "))
			return
		}
		from, errFrom := time.Parse(time.DateOnly, q.Get("from"))
		to, errTo := time.Parse(time.DateOnly, q.Get("to"))
		if errFrom != nil || errTo != nil {
			errorJSON(w, http.StatusBadRequest, "from and to must be YYYY-MM-DD")
			return
		}
		today := client.Today()
		if from.After(to) || to.After(today) {
			errorJSON(w, http.StatusBadRequest, "need from <= to <= today")
			return
		}
		if int(to.Sub(from).Hours()/24)+1 > fxRatesMaxDays {
			errorJSON(w, http.StatusBadRequest, "period longer than 400 days")
			return
		}

		checked, err := store.Checked(r.Context(), from, to)
		if err != nil {
			log.Printf("fx-rates: checked days: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to read rates")
			return
		}
		missing := repository.MissingDays(checked, from, to)
		partial := false
		if len(missing) > fxFetchLimit {
			missing, partial = missing[:fxFetchLimit], true
		}
		if len(missing) > 0 && !fillDays(r.Context(), client, store, missing, today) {
			partial = true
		}

		rates, err := store.Rates(r.Context(), code, from, to)
		if err != nil {
			log.Printf("fx-rates: list: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to read rates")
			return
		}
		respondJSON(w, http.StatusOK, fxRatesResponse{Code: code, Rates: rates, Partial: partial, Source: fx.Source})
	}
}

// fillDays asks the bank for days, fxFetchParallel at a time within fxFetchTimeout,
// and stores the answers. It reports whether every day was settled. An empty answer
// is stored as "nothing published" only for a past day: today's may still come.
func fillDays(parent context.Context, client *fx.Client, store repository.FxRepository, days []time.Time, today time.Time) bool {
	ctx, cancel := context.WithTimeout(parent, fxFetchTimeout)
	defer cancel()

	var (
		wg     sync.WaitGroup
		mu     sync.Mutex
		failed bool
		slots  = make(chan struct{}, fxFetchParallel)
	)
	fail := func() {
		mu.Lock()
		failed = true
		mu.Unlock()
	}
	for _, day := range days {
		wg.Add(1)
		go func(day time.Time) {
			defer wg.Done()
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				fail()
				return
			}
			defer func() { <-slots }()

			rates, err := client.Day(ctx, day)
			if err != nil {
				log.Printf("fx-rates: bank: %v", err)
				fail()
				return
			}
			if _, err := repository.SaveAsked(parent, store, day, today, rates); err != nil {
				log.Printf("fx-rates: save day: %v", err)
				fail()
			}
		}(day)
	}
	wg.Wait()
	return !failed
}
