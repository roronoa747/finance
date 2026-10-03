package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/linkpreview"
)

// Фото по ссылке (B2C-65): роли, тело, коды ошибок, в логе — только домен.
// Сеть и SSRF — в пакете linkpreview; здесь превью подменено.

func setupPreviewApp(t *testing.T, fetch func(context.Context, string) (linkpreview.Preview, error)) photosApp {
	t.Helper()
	app := setupPhotosApp(t) // users and tokens; the router is the preview's own
	tokens := auth.NewTokenService("photos-test-signing-key", 2*time.Hour)
	r := chi.NewRouter()
	r.With(auth.Middleware(tokens)).Post("/api/photos/preview", NewPreviewHandler(fetch).Preview)
	app.router = r
	return app
}

func (app photosApp) preview(token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/photos/preview", strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	app.router.ServeHTTP(rec, req)
	return rec
}

func TestPreviewRolesAndBody(t *testing.T) {
	calls := 0
	pic := []byte{0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3}
	app := setupPreviewApp(t, func(_ context.Context, raw string) (linkpreview.Preview, error) {
		calls++
		return linkpreview.Preview{Title: "Dyson Airwrap", ImageType: "image/jpeg", Image: pic}, nil
	})

	rec := app.preview(app.alice, `{"url":"https://kaspi.kz/shop/p/dyson-1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("member: want 200, got %d %s", rec.Code, rec.Body.String())
	}
	got := decode[struct {
		Title     string `json:"title"`
		ImageType string `json:"imageType"`
		Image     string `json:"image"`
	}](t, rec)
	if got.Title != "Dyson Airwrap" || got.ImageType != "image/jpeg" || got.Image != base64.StdEncoding.EncodeToString(pic) {
		t.Fatalf("unexpected body: %+v", got)
	}

	if rec := app.preview(app.viewer, `{"url":"https://kaspi.kz/x"}`); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer: want 403, got %d", rec.Code)
	}
	if rec := app.preview("", `{"url":"https://kaspi.kz/x"}`); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token: want 401, got %d", rec.Code)
	}
	for _, body := range []string{``, `{`, `{"url":""}`, `["https://kaspi.kz"]`, `{"url":"https://kaspi.kz/` + strings.Repeat("a", 5000) + `"}`} {
		if rec := app.preview(app.alice, body); rec.Code != http.StatusBadRequest {
			t.Fatalf("body %.20q: want 400, got %d", body, rec.Code)
		}
	}
	if calls != 1 {
		t.Fatalf("only the member's valid request reaches the page, got %d calls", calls)
	}
}

func TestPreviewErrorCodesAndLog(t *testing.T) {
	var out bytes.Buffer
	prev := log.Writer()
	log.SetOutput(&out)
	t.Cleanup(func() { log.SetOutput(prev) })

	cases := []struct {
		err    error
		status int
		code   string
	}{
		{linkpreview.ErrBadURL, 400, "bad url"},
		{linkpreview.ErrBlocked, 400, "blocked"},
		{linkpreview.ErrNoImage, 422, "no image"},
		{linkpreview.ErrTooLarge, 422, "too large"},
		{fmt.Errorf("%w: %w", linkpreview.ErrUpstream, context.DeadlineExceeded), 422, "timeout"},
		{fmt.Errorf("%w: status 503", linkpreview.ErrUpstream), 422, "unavailable"},
	}
	for _, c := range cases {
		app := setupPreviewApp(t, func(context.Context, string) (linkpreview.Preview, error) { return linkpreview.Preview{}, c.err })
		rec := app.preview(app.alice, `{"url":"https://shop.kz/p/secret-token-123?user=alia"}`)
		if rec.Code != c.status {
			t.Fatalf("%v: want %d, got %d", c.err, c.status, rec.Code)
		}
		if body := decode[map[string]string](t, rec); body["error"] != c.code {
			t.Fatalf("%v: want code %q, got %q", c.err, c.code, body["error"])
		}
	}
	if !strings.Contains(out.String(), "shop.kz") || strings.Contains(out.String(), "secret-token") || strings.Contains(out.String(), "alia") {
		t.Fatalf("log must name the domain only: %s", out.String())
	}
}
