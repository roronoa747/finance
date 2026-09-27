package handlers

import (
	"bytes"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// PhotoHandler serves goal and wish photos (B2C-16, Р-9). The picture is
// compressed on the phone; the API stores bytes and gives them back to the
// family. A hidden photo (surprise gift) exists for its author only: everyone
// else gets 404, not 403 — the gift must not be discoverable (§3).
type PhotoHandler struct {
	repo repository.PhotoRepository
}

func NewPhotoHandler(repo repository.PhotoRepository) *PhotoHandler {
	return &PhotoHandler{repo: repo}
}

// maxPhotoBytes bounds one upload: the phone compresses to ~100 KB (Р-9).
const maxPhotoBytes = 512 << 10

// photoTypes is the whitelist; the body must also start with the format's signature.
var photoTypes = map[string]func([]byte) bool{
	"image/webp": func(b []byte) bool {
		return len(b) >= 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP"))
	},
	"image/jpeg": func(b []byte) bool {
		return len(b) >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF
	},
}

// Upload — POST /api/photos?hidden=0|1 (member): the body is the picture.
func (h *PhotoHandler) Upload(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	contentType := r.Header.Get("Content-Type")
	signature, known := photoTypes[contentType]
	if !known {
		errorJSON(w, http.StatusBadRequest, "unsupported content type: image/webp or image/jpeg")
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxPhotoBytes))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errorJSON(w, http.StatusRequestEntityTooLarge, "photo larger than 512 KB")
			return
		}
		errorJSON(w, http.StatusBadRequest, "failed to read photo")
		return
	}
	if len(data) == 0 || !signature(data) {
		errorJSON(w, http.StatusBadRequest, "body is not a "+contentType+" image")
		return
	}
	hidden := r.URL.Query().Get("hidden") == "1"
	photo, err := h.repo.Create(r.Context(), householdID, userID, repository.PhotoInput{Hidden: hidden, ContentType: contentType, Data: data})
	if err != nil {
		log.Printf("photos: create: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to save photo")
		return
	}
	respondJSON(w, http.StatusCreated, map[string]any{"id": photo.ID, "hidden": photo.Hidden, "size": photo.Size})
}

// Get — GET /api/photos/{id} (member and viewer): own family only; a hidden
// photo — its author only; anything else is 404.
func (h *PhotoHandler) Get(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := caller(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if uuid.Validate(id) != nil {
		errorJSON(w, http.StatusNotFound, "photo not found")
		return
	}
	photo, data, err := h.repo.Get(r.Context(), id)
	if err != nil && !errors.Is(err, repository.ErrPhotoNotFound) {
		log.Printf("photos: get: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to load photo")
		return
	}
	if err != nil || photo.HouseholdID != householdID || (photo.Hidden && photo.UserID != userID) {
		errorJSON(w, http.StatusNotFound, "photo not found")
		return
	}
	// The id is immutable content: cache it for a year, privately, and never sniff it.
	w.Header().Set("Content-Type", photo.ContentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// Delete — DELETE /api/photos/{id}: the author always; a photo that is not
// hidden — any member of the family (a goal is shared, its picture too); a
// viewer never (403); a hidden photo of someone else — 404 like Get.
func (h *PhotoHandler) Delete(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := caller(w, r)
	if !ok {
		return
	}
	if role, _ := auth.GetRole(r.Context()); role != "member" {
		errorJSON(w, http.StatusForbidden, "forbidden: only members can delete photos")
		return
	}
	id := chi.URLParam(r, "id")
	if uuid.Validate(id) != nil {
		errorJSON(w, http.StatusNotFound, "photo not found")
		return
	}
	photo, _, err := h.repo.Get(r.Context(), id)
	if err != nil && !errors.Is(err, repository.ErrPhotoNotFound) {
		log.Printf("photos: get for delete: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to load photo")
		return
	}
	if err != nil || photo.HouseholdID != householdID || (photo.Hidden && photo.UserID != userID) {
		errorJSON(w, http.StatusNotFound, "photo not found")
		return
	}
	if err := h.repo.Delete(r.Context(), id); err != nil && !errors.Is(err, repository.ErrPhotoNotFound) {
		log.Printf("photos: delete: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to delete photo")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
