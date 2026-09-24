package handlers

import (
	"context"
	"log"
	"net/http"
	"time"

	"finance-backend/internal/fx"
)

// fxTimeout bounds the whole lookback so a slow bank cannot hold the function.
const fxTimeout = 8 * time.Second

// FxRateHandler serves official exchange rates. It is public: the demo mode
// has no token but still converts currencies. On Vercel the CDN caches the
// answer for an hour; the client's own cache covers local runs.
func FxRateHandler(client *fx.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), fxTimeout)
		defer cancel()

		rates, err := client.Rates(ctx)
		if err != nil {
			log.Printf("fx-rate: %v", err)
			respondJSON(w, http.StatusBadGateway, map[string]string{"error": "курс Нацбанка недоступен"})
			return
		}

		w.Header().Set("Cache-Control", "public, s-maxage=3600")
		respondJSON(w, http.StatusOK, rates)
	}
}
