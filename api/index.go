// Package handler is the Vercel Go function serving the whole API. vercel.json
// rewrites every /api/* request here; chi routes by the original path.
package handler

import (
	"log"
	"net/http"
	"sync"

	"finance-backend/server"
)

var (
	mu  sync.Mutex
	api http.Handler
	// build is swapped in tests.
	build = server.FromEnv
)

// Handler is the function entry point. The API is built once per instance on
// the first request; a failed build is retried by the next request instead of
// pinning the instance to an error.
func Handler(w http.ResponseWriter, r *http.Request) {
	h, err := instance()
	if err != nil {
		log.Printf("api init: %v", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"server is not configured"}`))
		return
	}
	h.ServeHTTP(w, r)
}

func instance() (http.Handler, error) {
	mu.Lock()
	defer mu.Unlock()
	if api == nil {
		h, err := build()
		if err != nil {
			return nil, err
		}
		api = h
	}
	return api, nil
}
