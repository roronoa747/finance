package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"

	"finance-backend/internal/linkpreview"
)

// PreviewHandler serves a wish photo by link (B2C-65, Р-60, Р-69): the server
// opens the product page and gives back its picture and title. Nothing is
// stored — the phone compresses the picture and uploads it as its own photo.
type PreviewHandler struct {
	fetch func(ctx context.Context, rawURL string) (linkpreview.Preview, error)
}

func NewPreviewHandler(fetch func(ctx context.Context, rawURL string) (linkpreview.Preview, error)) *PreviewHandler {
	return &PreviewHandler{fetch: fetch}
}

// maxPreviewBody bounds the request: one link.
const maxPreviewBody = 4 << 10

type previewRequest struct {
	URL string `json:"url"`
}

// Preview — POST /api/photos/preview (member): {url} → {title, imageType, image (base64)}.
// A bad or blocked link is 400; no picture, too large, unavailable or timeout is
// 422 with the reason as the error code.
func (h *PreviewHandler) Preview(w http.ResponseWriter, r *http.Request) {
	if _, _, ok := member(w, r); !ok {
		return
	}
	var req previewRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxPreviewBody)).Decode(&req); err != nil || req.URL == "" {
		errorJSON(w, http.StatusBadRequest, "body must be {\"url\": \"https://…\"}")
		return
	}
	p, err := h.fetch(r.Context(), req.URL)
	if err != nil {
		status, code := previewError(err)
		// The domain only: the full link may carry personal parameters.
		log.Printf("photos preview: %s: %s", domain(req.URL), code)
		errorJSON(w, status, code)
		return
	}
	// []byte is encoded as base64 by encoding/json.
	respondJSON(w, http.StatusOK, map[string]any{"title": p.Title, "imageType": p.ImageType, "image": p.Image})
}

func previewError(err error) (int, string) {
	var netErr net.Error
	switch {
	case errors.Is(err, linkpreview.ErrBadURL):
		return http.StatusBadRequest, "bad url"
	case errors.Is(err, linkpreview.ErrBlocked):
		return http.StatusBadRequest, "blocked"
	case errors.Is(err, linkpreview.ErrNoImage):
		return http.StatusUnprocessableEntity, "no image"
	case errors.Is(err, linkpreview.ErrTooLarge):
		return http.StatusUnprocessableEntity, "too large"
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &netErr) && netErr.Timeout():
		return http.StatusUnprocessableEntity, "timeout"
	default:
		return http.StatusUnprocessableEntity, "unavailable"
	}
}

func domain(raw string) string {
	if u, err := url.Parse(raw); err == nil && u.Hostname() != "" {
		return u.Hostname()
	}
	return "-"
}
