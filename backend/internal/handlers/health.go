package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"time"
)

// HealthResponse represents the health check status.
type HealthResponse struct {
	Status string `json:"status"`
	DB     string `json:"db"`
}

// HealthHandler returns a handler that reports server and database health.
func HealthHandler(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "connected"
		if db == nil {
			dbStatus = "disconnected"
		} else {
			ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
			defer cancel()
			if err := db.PingContext(ctx); err != nil {
				dbStatus = "disconnected"
			}
		}

		resp := HealthResponse{
			Status: "ok",
			DB:     dbStatus,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}
}
