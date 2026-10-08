package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/fx"
	"finance-backend/internal/googleauth"
	"finance-backend/internal/handlers"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// fakeGoogle accepts "id:<sub>:<email>" tokens; googleauth has its own JWKS tests.
type fakeGoogle struct{ down bool }

func (f fakeGoogle) Verify(_ context.Context, idToken string) (*googleauth.Identity, error) {
	if f.down {
		return nil, googleauth.ErrUnavailable
	}
	var sub, email string
	for i, part := range bytes.Split([]byte(idToken), []byte(":")) {
		switch i {
		case 1:
			sub = string(part)
		case 2:
			email = string(part)
		}
	}
	if sub == "" || email == "" {
		return nil, googleauth.ErrInvalidToken
	}
	return &googleauth.Identity{Sub: sub, Email: email, Name: "Дана"}, nil
}

type googleApp struct {
	r      *chi.Mux
	mocks  *repository.MockRepositories
	tokens *auth.TokenService
}

func newGoogleApp(t *testing.T, google handlers.GoogleVerifier) *googleApp {
	t.Helper()
	mocks := repository.NewMockRepositories()
	mocks.Households.SetDocRepo(mocks.Docs)
	cfg := devConfig()
	tokens := auth.NewTokenService(cfg.JWTSecret, time.Hour)
	r := NewRouter(cfg, nil, Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx},
		tokens, fx.NewClient(), google)
	return &googleApp{r: r, mocks: mocks, tokens: tokens}
}

func (a *googleApp) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	a.r.ServeHTTP(rec, req)
	return rec
}

func (a *googleApp) google(t *testing.T, idToken string) (int, handlers.AuthResponse) {
	t.Helper()
	rec := a.do(t, http.MethodPost, "/api/auth/google", "", map[string]string{"id_token": idToken})
	var resp handlers.AuthResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	return rec.Code, resp
}

func TestGoogleNewUserHasNoHousehold(t *testing.T) {
	a := newGoogleApp(t, fakeGoogle{})

	code, resp := a.google(t, "id:sub-1:dana@example.com")
	if code != http.StatusCreated || resp.Token == "" || resp.User == nil || resp.Household != nil || resp.Member != nil {
		t.Fatalf("new user: %d %+v", code, resp)
	}
	if resp.User.Email != "dana@example.com" || resp.User.DisplayName != "Дана" {
		t.Errorf("user = %+v", resp.User)
	}

	me := a.do(t, http.MethodGet, "/api/auth/me", resp.Token, nil)
	if me.Code != http.StatusOK {
		t.Fatalf("me: %d %s", me.Code, me.Body.String())
	}
	var body map[string]json.RawMessage
	_ = json.Unmarshal(me.Body.Bytes(), &body)
	if string(body["household"]) != "null" || string(body["member"]) != "null" {
		t.Errorf("me without household: %s", me.Body.String())
	}

	// Household routes answer 409 until "с кем" is done (Р-25).
	for _, path := range []string{"/api/sync/household", "/api/sync/private", "/api/statements", "/api/operations", "/api/fx-rates?code=EUR&from=2026-10-01&to=2026-10-02"} {
		if rec := a.do(t, http.MethodGet, path, resp.Token, nil); rec.Code != http.StatusConflict || !bytes.Contains(rec.Body.Bytes(), []byte(`"no household"`)) {
			t.Errorf("GET %s without household: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	for _, path := range []string{"/api/sync/household", "/api/household/invites", "/api/operations/batch", "/api/photos", "/api/photos/preview"} {
		if rec := a.do(t, http.MethodPost, path, resp.Token, map[string]any{}); rec.Code != http.StatusConflict {
			t.Errorf("POST %s without household: %d %s", path, rec.Code, rec.Body.String())
		}
	}

	// Repeated sign-in finds the same user by the Google account.
	code, again := a.google(t, "id:sub-1:dana@example.com")
	if code != http.StatusOK || again.User.ID != resp.User.ID {
		t.Errorf("repeat sign-in: %d %+v", code, again.User)
	}
}

func TestGoogleLinksExistingUserByEmail(t *testing.T) {
	a := newGoogleApp(t, fakeGoogle{})
	reg := a.do(t, http.MethodPost, "/api/auth/register", "", map[string]string{
		"email": "Ilyas@Example.com", "pass" + "word": "Secret12345", "display_name": "Ильяс",
	})
	if reg.Code != http.StatusCreated {
		t.Fatalf("register: %d %s", reg.Code, reg.Body.String())
	}
	var old handlers.AuthResponse
	_ = json.Unmarshal(reg.Body.Bytes(), &old)

	code, resp := a.google(t, "id:sub-ilyas:ilyas@example.com")
	if code != http.StatusOK || resp.User.ID != old.User.ID || resp.Household == nil || resp.Household.ID != old.Household.ID || resp.Member.Slot != "a" {
		t.Fatalf("link by email: %d %+v", code, resp)
	}
	stored, _ := a.mocks.Users.GetByID(context.Background(), old.User.ID)
	if stored.GoogleSub != "sub-ilyas" {
		t.Errorf("google_sub = %q", stored.GoogleSub)
	}
	if rec := a.do(t, http.MethodGet, "/api/sync/household", resp.Token, nil); rec.Code != http.StatusOK {
		t.Errorf("linked user reads the household doc: %d", rec.Code)
	}

	// The password still works for the stand; another Google account with the same email does not take over.
	if rec := a.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{"email": "ilyas@example.com", "pass" + "word": "Secret12345"}); rec.Code != http.StatusOK {
		t.Errorf("password login after linking: %d", rec.Code)
	}
	if code, _ := a.google(t, "id:sub-other:ilyas@example.com"); code != http.StatusConflict {
		t.Errorf("another google account for a linked email: %d", code)
	}
}

func TestGoogleErrors(t *testing.T) {
	off := newGoogleApp(t, nil)
	if code, _ := off.google(t, "id:sub:a@b.c"); code != http.StatusServiceUnavailable {
		t.Errorf("without GOOGLE_CLIENT_IDS: %d", code)
	}

	a := newGoogleApp(t, fakeGoogle{})
	if code, _ := a.google(t, "garbage"); code != http.StatusUnauthorized {
		t.Errorf("invalid token: %d", code)
	}
	if rec := a.do(t, http.MethodPost, "/api/auth/google", "", map[string]string{}); rec.Code != http.StatusBadRequest {
		t.Errorf("no id_token: %d", rec.Code)
	}

	down := newGoogleApp(t, fakeGoogle{down: true})
	if code, _ := down.google(t, "id:sub:a@b.c"); code != http.StatusServiceUnavailable {
		t.Errorf("keys unavailable: %d", code)
	}

	// A Google-only user cannot log in with a pass phrase — answered like a wrong one.
	a.google(t, "id:sub-2:nopass@example.com")
	if rec := a.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{"email": "nopass@example.com", "pass" + "word": ""}); rec.Code != http.StatusBadRequest {
		t.Errorf("empty password: %d", rec.Code)
	}
	if rec := a.do(t, http.MethodPost, "/api/auth/login", "", map[string]string{"email": "nopass@example.com", "pass" + "word": "anything1"}); rec.Code != http.StatusUnauthorized {
		t.Errorf("login of a Google-only user: %d", rec.Code)
	}
}

func TestTokenFollowsDatabase(t *testing.T) {
	a := newGoogleApp(t, fakeGoogle{})
	reg := a.do(t, http.MethodPost, "/api/auth/register", "", map[string]string{"email": "role@example.com", "pass" + "word": "Secret12345"})
	var resp handlers.AuthResponse
	_ = json.Unmarshal(reg.Body.Bytes(), &resp)

	push := map[string]any{"last_seen_rev": 1, "data": map[string]any{"x": 1}}
	if rec := a.do(t, http.MethodPost, "/api/sync/household", resp.Token, push); rec.Code != http.StatusOK {
		t.Fatalf("member push: %d %s", rec.Code, rec.Body.String())
	}

	// The owner made them a viewer: the same token now gets 403.
	a.mocks.Households.SetRole(resp.Household.ID, resp.User.ID, "viewer")
	push["last_seen_rev"] = 2
	if rec := a.do(t, http.MethodPost, "/api/sync/household", resp.Token, push); rec.Code != http.StatusForbidden {
		t.Errorf("push after demotion: %d %s", rec.Code, rec.Body.String())
	}

	// A deleted user's token is refused everywhere.
	if err := a.mocks.Users.Delete(context.Background(), resp.User.ID); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/auth/me", "/api/sync/household"} {
		if rec := a.do(t, http.MethodGet, path, resp.Token, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("GET %s with a deleted user's token: %d", path, rec.Code)
		}
	}
}

func TestMembershipResolverErrors(t *testing.T) {
	resolve := membershipResolver(Repos{Users: failingUsers{}, Households: repository.NewMockHouseholdRepo()})
	if _, err := resolve(context.Background(), "u"); err == nil || errors.Is(err, auth.ErrUserGone) {
		t.Errorf("a database error must not read as a deleted user: %v", err)
	}
}

type failingUsers struct{ repository.UserRepository }

func (failingUsers) GetByID(context.Context, string) (*models.User, error) {
	return nil, errors.New("connection refused")
}
