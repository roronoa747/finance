package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/ai"
	"finance-backend/internal/repository"
)

// maxAIToggleBody: {"on": true} and nothing else.
const maxAIToggleBody = 64

// AdminAIHandler is the owner's AI section of /admin (бэклог «ИИ», AI-03): families with
// their flag and the month's spend, the switch, and a check that Claude answers.
type AdminAIHandler struct {
	ai         repository.AIRepository
	users      repository.UserRepository
	admins     []string
	client     *ai.Client // nil: no ANTHROPIC_API_KEY
	checkModel string     // the light model (AI_MODEL_SELLERS)
	limit      int
	now        func() time.Time
}

func NewAdminAIHandler(aiRepo repository.AIRepository, users repository.UserRepository, admins []string, client *ai.Client, checkModel string, limit int) *AdminAIHandler {
	return &AdminAIHandler{ai: aiRepo, users: users, admins: admins, client: client, checkModel: checkModel, limit: limit, now: time.Now}
}

// Families is GET /api/admin/families → {families, limit, key} for the current Almaty month.
func (h *AdminAIHandler) Families(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(w, r, h.users, h.admins) {
		return
	}
	families, err := h.ai.Families(r.Context(), ai.MonthKey(h.now()))
	if err != nil {
		log.Printf("admin families: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to list families")
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"families": families, "limit": h.limit, "key": h.client != nil})
}

// SetAI is PUT /api/admin/families/{id}/ai {on} → the updated row; an unknown family is 404.
func (h *AdminAIHandler) SetAI(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(w, r, h.users, h.admins) {
		return
	}
	id := chi.URLParam(r, "id")
	if !canonicalUUID(id) {
		errorJSON(w, http.StatusNotFound, "not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAIToggleBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req struct {
		On *bool `json:"on"`
	}
	if err := dec.Decode(&req); err != nil || req.On == nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errorJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.ai.SetEnabled(r.Context(), id, *req.On); err != nil {
		if errors.Is(err, repository.ErrHouseholdNotFound) {
			errorJSON(w, http.StatusNotFound, "not found")
			return
		}
		log.Printf("admin set ai: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to set ai")
		return
	}
	families, err := h.ai.Families(r.Context(), ai.MonthKey(h.now()))
	if err != nil {
		log.Printf("admin families: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to list families")
		return
	}
	for _, f := range families {
		if f.ID == id {
			respondJSON(w, http.StatusOK, f)
			return
		}
	}
	errorJSON(w, http.StatusNotFound, "not found")
}

// checkSchema is the whole answer of the connection check.
var checkSchema = map[string]any{
	"type":                 "object",
	"properties":           map[string]any{"ok": map[string]any{"type": "boolean"}},
	"required":             []string{"ok"},
	"additionalProperties": false,
}

// AICheck is POST /api/admin/ai-check: one tiny call to the light model. It is not counted in
// any family's limit or spend, and logs nothing.
func (h *AdminAIHandler) AICheck(w http.ResponseWriter, r *http.Request) {
	if !adminOnly(w, r, h.users, h.admins) {
		return
	}
	if h.client == nil {
		respondJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": "no_key"})
		return
	}
	start := time.Now()
	var out struct {
		OK bool `json:"ok"`
	}
	// max_tokens leaves room for the model's adaptive thinking; a one-word answer bills little.
	_, err := h.client.Call(r.Context(), ai.Request{
		Model:     h.checkModel,
		System:    "Это проверка связи. Ответь ok: true.",
		Text:      "Связь есть?",
		Schema:    checkSchema,
		Effort:    "low",
		MaxTokens: 1024,
	}, &out)
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": checkReason(err)})
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true, "model": h.checkModel, "ms": time.Since(start).Milliseconds()})
}

func checkReason(err error) string {
	switch {
	case errors.Is(err, ai.ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, ai.ErrRefused):
		return "refused"
	default:
		return "failed"
	}
}
