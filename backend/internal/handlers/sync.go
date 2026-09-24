package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

type SyncHandler struct {
	docRepo repository.DocRepository
}

func NewSyncHandler(docRepo repository.DocRepository) *SyncHandler {
	return &SyncHandler{docRepo: docRepo}
}

// maxDocBodyBytes caps a pushed document; larger bodies get 413.
const maxDocBodyBytes = 10 << 20

type PushDocRequest struct {
	LastSeenRev int64           `json:"last_seen_rev"`
	Data        json.RawMessage `json:"data"`
}

type ConflictResponse struct {
	Error     string      `json:"error"`
	ServerDoc interface{} `json:"server_doc"`
}

func (h *SyncHandler) GetHouseholdDoc(w http.ResponseWriter, r *http.Request) {
	householdID, ok := auth.GetHouseholdID(r.Context())
	if !ok || strings.TrimSpace(householdID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	doc, err := h.docRepo.GetHouseholdDoc(r.Context(), householdID)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]string{"error": "household document not found"})
		return
	}

	respondJSON(w, http.StatusOK, doc)
}

func (h *SyncHandler) PushHouseholdDoc(w http.ResponseWriter, r *http.Request) {
	role, ok := auth.GetRole(r.Context())
	if !ok || role != "member" {
		respondJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden: only members can modify household budget"})
		return
	}

	householdID, ok := auth.GetHouseholdID(r.Context())
	if !ok || strings.TrimSpace(householdID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req PushDocRequest
	if !decodeJSONBody(w, r, maxDocBodyBytes, &req) {
		return
	}

	if len(req.Data) == 0 {
		req.Data = json.RawMessage("{}")
	}
	// RawMessage keeps the bytes verbatim; PostgreSQL would reject invalid
	// UTF-8 in jsonb and surface it as a 500.
	if !utf8.Valid(req.Data) {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "data must be valid UTF-8"})
		return
	}

	updatedDoc, conflict, err := h.docRepo.PushHouseholdDoc(r.Context(), householdID, req.LastSeenRev, req.Data, userID)
	if err != nil {
		if errors.Is(err, repository.ErrDocNotFound) {
			respondJSON(w, http.StatusNotFound, map[string]string{"error": "household document not found"})
			return
		}
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update household document"})
		return
	}

	if conflict {
		respondJSON(w, http.StatusConflict, ConflictResponse{
			Error:     "conflict",
			ServerDoc: updatedDoc,
		})
		return
	}

	respondJSON(w, http.StatusOK, updatedDoc)
}

func (h *SyncHandler) GetPrivateDoc(w http.ResponseWriter, r *http.Request) {
	householdID, ok := auth.GetHouseholdID(r.Context())
	if !ok || strings.TrimSpace(householdID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	doc, err := h.docRepo.GetPrivateDoc(r.Context(), householdID, userID)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to get private document"})
		return
	}

	respondJSON(w, http.StatusOK, doc)
}

func (h *SyncHandler) PushPrivateDoc(w http.ResponseWriter, r *http.Request) {
	householdID, ok := auth.GetHouseholdID(r.Context())
	if !ok || strings.TrimSpace(householdID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	userID, ok := auth.GetUserID(r.Context())
	if !ok || strings.TrimSpace(userID) == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req PushDocRequest
	if !decodeJSONBody(w, r, maxDocBodyBytes, &req) {
		return
	}

	if len(req.Data) == 0 {
		req.Data = json.RawMessage("{}")
	}
	// RawMessage keeps the bytes verbatim; PostgreSQL would reject invalid
	// UTF-8 in jsonb and surface it as a 500.
	if !utf8.Valid(req.Data) {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "data must be valid UTF-8"})
		return
	}

	updatedDoc, conflict, err := h.docRepo.PushPrivateDoc(r.Context(), householdID, userID, req.LastSeenRev, req.Data)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update private document"})
		return
	}

	if conflict {
		respondJSON(w, http.StatusConflict, ConflictResponse{
			Error:     "conflict",
			ServerDoc: updatedDoc,
		})
		return
	}

	respondJSON(w, http.StatusOK, updatedDoc)
}
