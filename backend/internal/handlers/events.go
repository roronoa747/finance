package handlers

import (
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// maxEventBody: an event is a kind and a time — anything bigger is not ours.
const maxEventBody = 1 << 10

// eventPast: a queued event may arrive late (the phone was offline); older times are taken as now.
const eventPast = 30 * 24 * time.Hour

// EventsHandler records retention events (B2C-28, Р-16) and serves the owner's numbers.
type EventsHandler struct {
	events  repository.EventRepository
	metrics repository.MetricsRepository
	users   repository.UserRepository
	admins  []string
	now     func() time.Time
}

func NewEventsHandler(events repository.EventRepository, metrics repository.MetricsRepository, users repository.UserRepository, admins []string) *EventsHandler {
	return &EventsHandler{events: events, metrics: metrics, users: users, admins: admins, now: time.Now}
}

type eventRequest struct {
	Kind string `json:"kind"`
	At   string `json:"at"`
}

// Record is POST /api/events {kind, at?} — any signed-in user, a household may be absent.
// Only the kind and the time are accepted; app_open counts once a day (the repository drops
// repeats). 204.
func (h *EventsHandler) Record(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.GetUserID(r.Context())
	householdID, _ := auth.GetHouseholdID(r.Context())

	var req eventRequest
	if !decodeStrictJSONBody(w, r, maxEventBody, &req) {
		return
	}
	if !slices.Contains(repository.EventKinds, req.Kind) {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown event kind"})
		return
	}
	now := h.now()
	at := now
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(req.At)); err == nil && !t.After(now.Add(5*time.Minute)) && t.After(now.Add(-eventPast)) {
		at = t
	}
	if err := h.events.Record(r.Context(), userID, householdID, req.Kind, at); err != nil {
		log.Printf("event: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to record event"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// isAdmin reports whether the signed-in user's email is in ADMIN_EMAILS.
func isAdmin(admins []string, email string) bool {
	return len(admins) > 0 && slices.Contains(admins, strings.ToLower(strings.TrimSpace(email)))
}

// adminOnly lets ADMIN_EMAILS through; everyone else, and everyone without the variable,
// gets 404 (the admin pages do not exist for them).
func adminOnly(w http.ResponseWriter, r *http.Request, users repository.UserRepository, admins []string) bool {
	userID, _ := auth.GetUserID(r.Context())
	user, err := users.GetByID(r.Context(), userID)
	if err != nil || !isAdmin(admins, user.Email) {
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return false
	}
	return true
}

// Metrics is GET /api/admin/metrics — only for ADMIN_EMAILS (adminOnly).
func (h *EventsHandler) Metrics(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(w, r, h.users, h.admins) {
		return
	}
	m, err := h.metrics.Metrics(r.Context(), h.now())
	if err != nil {
		log.Printf("metrics: %v", err)
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to compute metrics"})
		return
	}
	respondJSON(w, http.StatusOK, m)
}
