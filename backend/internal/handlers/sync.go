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

// docDataProblem explains why PostgreSQL would refuse data as jsonb — a 500 otherwise — or
// returns "". RawMessage keeps the bytes verbatim: invalid UTF-8, and inside valid JSON the
// escapes \u0000 and lone surrogates (\ud800 without its pair) that jsonb does not store
// (B2C-26). On 400 the client shows an error instead of retrying the same push forever.
func docDataProblem(data []byte) string {
	if !utf8.Valid(data) {
		return "data must be valid UTF-8"
	}
	if !json.Valid(data) {
		return "data must be valid JSON"
	}
	inString := false
	for i := 0; i < len(data); i++ {
		c := data[i]
		if !inString {
			inString = c == '"'
			continue
		}
		switch c {
		case '"':
			inString = false
		case '\\':
			if data[i+1] != 'u' {
				i++ // a one-letter escape; json.Valid vouched for it
				continue
			}
			r := hex4(data[i+2 : i+6])
			i += 5
			switch {
			case r == 0:
				return `data must not contain \u0000`
			case r >= 0xD800 && r <= 0xDBFF:
				// A high surrogate must be followed by \u and a low one.
				if i+6 >= len(data) || data[i+1] != '\\' || data[i+2] != 'u' {
					return "data must not contain lone surrogates"
				}
				if low := hex4(data[i+3 : i+7]); low < 0xDC00 || low > 0xDFFF {
					return "data must not contain lone surrogates"
				}
				i += 6
			case r >= 0xDC00 && r <= 0xDFFF:
				return "data must not contain lone surrogates"
			}
		}
	}
	return ""
}

// hex4 reads four hex digits json.Valid has already checked.
func hex4(b []byte) rune {
	var r rune
	for _, c := range b {
		r <<= 4
		switch {
		case c >= '0' && c <= '9':
			r |= rune(c - '0')
		case c >= 'a' && c <= 'f':
			r |= rune(c-'a') + 10
		case c >= 'A' && c <= 'F':
			r |= rune(c-'A') + 10
		}
	}
	return r
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

	var req PushDocRequest
	if !decodeJSONBody(w, r, maxDocBodyBytes, &req) {
		return
	}

	if len(req.Data) == 0 {
		req.Data = json.RawMessage("{}")
	}
	if msg := docDataProblem(req.Data); msg != "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
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
	if msg := docDataProblem(req.Data); msg != "" {
		respondJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
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
