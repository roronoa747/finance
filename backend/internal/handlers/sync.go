package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

type SyncHandler struct {
	docRepo repository.DocRepository
}

func NewSyncHandler(docRepo repository.DocRepository) *SyncHandler {
	return &SyncHandler{docRepo: docRepo}
}

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

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req PushDocRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if len(req.Data) == 0 {
		req.Data = json.RawMessage("{}")
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

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20)
	var req PushDocRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	if len(req.Data) == 0 {
		req.Data = json.RawMessage("{}")
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
