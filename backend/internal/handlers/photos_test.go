package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// Фото целей и желаний (B2C-16): роли, семья, скрытое, лимиты, заголовки — на моках.

func webpBytes(n int) []byte {
	b := make([]byte, n)
	copy(b, "RIFF\x00\x00\x00\x00WEBPVP8 ")
	for i := 12; i < n; i++ {
		b[i] = byte(i % 251)
	}
	return b
}

func jpegBytes(n int) []byte {
	b := make([]byte, n)
	copy(b, []byte{0xFF, 0xD8, 0xFF, 0xE0})
	return b
}

type photosApp struct {
	statementsApp
	repo    *repository.MockPhotoRepo
	lookups *photoLookups
}

// photoLookups counts reads of the repository: an id the database would reject
// must be answered before it gets there.
type photoLookups struct {
	repository.PhotoRepository
	n int
}

func (p *photoLookups) Get(ctx context.Context, id string) (*models.Photo, []byte, error) {
	p.n++
	return p.PhotoRepository.Get(ctx, id)
}

func setupPhotosApp(t *testing.T) photosApp {
	t.Helper()
	repos := repository.NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	tokens := auth.NewTokenService("photos-test-signing-key", 2*time.Hour)
	lookups := &photoLookups{PhotoRepository: repos.Photos}
	h := NewPhotoHandler(lookups)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokens))
			protected.Post("/photos", h.Upload)
			protected.Get("/photos/{id}", h.Get)
			protected.Delete("/photos/{id}", h.Delete)
		})
	})

	ctx := t.Context()
	a, _ := repos.Users.Create(ctx, "alice@ph.test", "h")
	family, _, _ := repos.Households.CreateHousehold(ctx, "Семья", a.ID, "Алия")
	b, _ := repos.Users.Create(ctx, "bob@ph.test", "h")
	inv, _ := repos.Households.CreateInvite(ctx, family.ID, a.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, b.ID, "Бекзат")
	v, _ := repos.Users.Create(ctx, "viewer@ph.test", "h")
	s, _ := repos.Users.Create(ctx, "stranger@ph.test", "h")
	other, _, _ := repos.Households.CreateHousehold(ctx, "Чужие", s.ID, "Чужой")

	token := func(userID, householdID, role, slot string) string {
		tok, err := tokens.GenerateToken(userID, householdID, role, slot)
		if err != nil {
			t.Fatalf("token: %v", err)
		}
		return tok
	}
	return photosApp{
		statementsApp: statementsApp{
			router:   r,
			alice:    token(a.ID, family.ID, "member", "a"),
			bob:      token(b.ID, family.ID, "member", "b"),
			viewer:   token(v.ID, family.ID, "viewer", "c"),
			stranger: token(s.ID, other.ID, "member", "a"),
		},
		repo:    repos.Photos,
		lookups: lookups,
	}
}

func (app photosApp) upload(t *testing.T, token, contentType string, body []byte, hidden bool) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/photos"
	if hidden {
		path += "?hidden=1"
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	app.router.ServeHTTP(rec, req)
	return rec
}

func TestPhotosUploadRolesAndValidation(t *testing.T) {
	app := setupPhotosApp(t)
	pic := webpBytes(2000)

	rec := app.upload(t, app.alice, "image/webp", pic, false)
	if rec.Code != http.StatusCreated {
		t.Fatalf("member upload: want 201, got %d %s", rec.Code, rec.Body.String())
	}
	created := decode[struct {
		ID     string `json:"id"`
		Hidden bool   `json:"hidden"`
		Size   int    `json:"size"`
	}](t, rec)
	if created.ID == "" || created.Hidden || created.Size != 2000 {
		t.Fatalf("unexpected upload: %+v", created)
	}

	if rec := app.upload(t, app.viewer, "image/webp", pic, false); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer upload: want 403, got %d", rec.Code)
	}
	if rec := app.upload(t, app.alice, "image/png", pic, false); rec.Code != http.StatusBadRequest {
		t.Fatalf("png: want 400, got %d", rec.Code)
	}
	// Подмена: заголовок webp, тело jpeg — и наоборот; пустое тело.
	if rec := app.upload(t, app.alice, "image/webp", jpegBytes(100), false); rec.Code != http.StatusBadRequest {
		t.Fatalf("webp header with jpeg body: want 400, got %d", rec.Code)
	}
	if rec := app.upload(t, app.alice, "image/jpeg", pic, false); rec.Code != http.StatusBadRequest {
		t.Fatalf("jpeg header with webp body: want 400, got %d", rec.Code)
	}
	if rec := app.upload(t, app.alice, "image/jpeg", nil, false); rec.Code != http.StatusBadRequest {
		t.Fatalf("empty: want 400, got %d", rec.Code)
	}
	if rec := app.upload(t, app.alice, "image/jpeg", jpegBytes(300), false); rec.Code != http.StatusCreated {
		t.Fatalf("jpeg: want 201, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.upload(t, app.alice, "image/webp", webpBytes(maxPhotoBytes+1), false); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("too large: want 413, got %d", rec.Code)
	}
	if rec := app.upload(t, app.alice, "image/webp", webpBytes(maxPhotoBytes), false); rec.Code != http.StatusCreated {
		t.Fatalf("exactly 512 KB: want 201, got %d", rec.Code)
	}
	if rec := app.upload(t, "", "image/webp", pic, false); rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: want 401, got %d", rec.Code)
	}
}

func TestPhotosGetFamilyHiddenAndHeaders(t *testing.T) {
	app := setupPhotosApp(t)
	pic := webpBytes(1500)
	shared := decode[struct{ ID string }](t, app.upload(t, app.alice, "image/webp", pic, false)).ID
	gift := decode[struct{ ID string }](t, app.upload(t, app.alice, "image/webp", pic, true)).ID

	// Своя семья — байт в байт, участник, партнёр и viewer; заголовки кэша и nosniff.
	for name, token := range map[string]string{"author": app.alice, "partner": app.bob, "viewer": app.viewer} {
		rec := app.do(t, http.MethodGet, "/api/photos/"+shared, token, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s get: want 200, got %d %s", name, rec.Code, rec.Body.String())
		}
		if !bytes.Equal(rec.Body.Bytes(), pic) {
			t.Fatalf("%s: bytes differ", name)
		}
		h := rec.Header()
		if h.Get("Content-Type") != "image/webp" || h.Get("Cache-Control") != "private, max-age=31536000, immutable" ||
			h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Length") != "1500" {
			t.Fatalf("%s headers: %v", name, h)
		}
	}

	// Чужая семья — 404, не 403 (существование не раскрывается).
	if rec := app.do(t, http.MethodGet, "/api/photos/"+shared, app.stranger, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger: want 404, got %d", rec.Code)
	}
	// Скрытое: автору 200, партнёру и viewer — 404.
	if rec := app.do(t, http.MethodGet, "/api/photos/"+gift, app.alice, nil); rec.Code != http.StatusOK {
		t.Fatalf("author hidden: want 200, got %d", rec.Code)
	}
	for name, token := range map[string]string{"partner": app.bob, "viewer": app.viewer, "stranger": app.stranger} {
		if rec := app.do(t, http.MethodGet, "/api/photos/"+gift, token, nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s hidden: want 404, got %d", name, rec.Code)
		}
	}
	// Неизвестный и невалидный id — 404.
	for _, id := range []string{"00000000-0000-4000-8000-000000000000", "not-a-uuid", "../x"} {
		if rec := app.do(t, http.MethodGet, "/api/photos/"+id, app.alice, nil); rec.Code != http.StatusNotFound {
			t.Fatalf("id %q: want 404, got %d", id, rec.Code)
		}
	}
	// Другая запись того же uuid (urn:uuid:, скобки, без дефисов) — 404 до запроса в базу:
	// uuid.Validate её принимает, а Postgres на urn:uuid: отвечал ошибкой (500).
	before := app.lookups.n
	for _, id := range []string{"urn:uuid:" + shared, "{" + shared + "}", strings.ReplaceAll(shared, "-", "")} {
		for _, method := range []string{http.MethodGet, http.MethodDelete} {
			if rec := app.do(t, method, "/api/photos/"+id, app.alice, nil); rec.Code != http.StatusNotFound {
				t.Fatalf("%s %q: want 404, got %d", method, id, rec.Code)
			}
		}
	}
	if app.lookups.n != before {
		t.Fatalf("non-canonical ids reached the repository %d times", app.lookups.n-before)
	}
}

func TestPhotosDeleteRules(t *testing.T) {
	app := setupPhotosApp(t)
	pic := webpBytes(600)
	upload := func(hidden bool) string {
		return decode[struct{ ID string }](t, app.upload(t, app.alice, "image/webp", pic, hidden)).ID
	}

	// Не-скрытое удаляет любой участник семьи; viewer — 403; чужая семья — 404.
	shared := upload(false)
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+shared, app.viewer, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer delete: want 403, got %d", rec.Code)
	}
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+shared, app.stranger, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("stranger delete: want 404, got %d", rec.Code)
	}
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+shared, app.bob, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("partner delete shared: want 204, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.do(t, http.MethodGet, "/api/photos/"+shared, app.alice, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("after delete: want 404, got %d", rec.Code)
	}
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+shared, app.alice, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("delete twice: want 404, got %d", rec.Code)
	}

	// Скрытое удаляет только автор; партнёру — 404.
	gift := upload(true)
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+gift, app.bob, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("partner delete hidden: want 404, got %d", rec.Code)
	}
	if rec := app.do(t, http.MethodDelete, "/api/photos/"+gift, app.alice, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("author delete hidden: want 204, got %d", rec.Code)
	}
	if app.repo.Count() != 0 {
		t.Fatalf("photos left: %d", app.repo.Count())
	}
}
