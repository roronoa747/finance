package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/applepay"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

const (
	testShortcut       = "https://www.icloud.com/shortcuts/stub-ios27"
	testShortcutLegacy = "https://www.icloud.com/shortcuts/stub-legacy"
	testPushShortcut   = "https://www.icloud.com/shortcuts/stub-push"
)

type walletApp struct {
	router   *chi.Mux
	repos    *repository.MockRepositories
	keys     *repository.MockPhoneKeyRepo
	handler  *WalletHandler
	familyID string
	aliceID  string
	viewerID string
	loneID   string
	alice    string // JWT
	viewer   string // JWT
	admin    string // JWT
	adminID  string
}

func setupWalletApp(t *testing.T) walletApp {
	t.Helper()
	repos := repository.NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	keys := repository.NewMockPhoneKeyRepo()
	tokens := auth.NewTokenService("wallet-test-signing-key", 2*time.Hour)
	h := NewWalletHandler(keys, repos.Households, repos.Statements, repos.Users, []string{"admin@wallet.test"}, testShortcut, testShortcutLegacy, testPushShortcut)

	ctx := t.Context()
	a, _ := repos.Users.Create(ctx, "alice@wallet.test", "h")
	family, _, _ := repos.Households.CreateHousehold(ctx, "Семья", a.ID, "Алия")
	v, _ := repos.Users.Create(ctx, "viewer@wallet.test", "h")
	inv, _ := repos.Households.CreateInvite(ctx, family.ID, a.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, v.ID, "Гость")
	repos.Households.SetRole(family.ID, v.ID, "viewer")
	lone, _ := repos.Users.Create(ctx, "lone@wallet.test", "h")
	admin, _ := repos.Users.Create(ctx, "admin@wallet.test", "h")
	_, _, _ = repos.Households.CreateHousehold(ctx, "Админ", admin.ID, "Админ")

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		// A phone endpoint stand-in: who the key resolved to.
		api.With(h.KeyAuth).Post("/wallet/tap", h.Tap)
		api.With(h.KeyAuth).Post("/wallet/push", h.Push)
		api.With(h.KeyAuth).Get("/wallet/whoami", func(w http.ResponseWriter, r *http.Request) {
			householdID, userID, ok := member(w, r)
			if ok {
				respondJSON(w, http.StatusOK, map[string]string{"user": userID, "household": householdID})
			}
		})
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokens, nil))
			protected.Get("/wallet", h.Status)
			protected.Post("/wallet/connect", h.Connect)
			protected.Delete("/wallet", h.Disconnect)
			protected.Get("/admin/wallet-debug", h.AdminDebug)
		})
	})

	token := func(userID, role string) string {
		tok, err := tokens.GenerateToken(userID, family.ID, role, "a")
		if err != nil {
			t.Fatalf("token: %v", err)
		}
		return tok
	}
	return walletApp{
		router: r, repos: repos, keys: keys, handler: h, familyID: family.ID,
		aliceID: a.ID, viewerID: v.ID, loneID: lone.ID, adminID: admin.ID,
		alice: token(a.ID, "member"), viewer: token(v.ID, "viewer"), admin: token(admin.ID, "member"),
	}
}

func (app walletApp) call(t *testing.T, method, path, authHeader string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	app.router.ServeHTTP(rec, req)
	return rec
}

func (app walletApp) connect(t *testing.T) string {
	t.Helper()
	rec := app.call(t, http.MethodPost, "/api/wallet/connect", "Bearer "+app.alice, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("connect: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("connect without Cache-Control: no-store")
	}
	var out struct{ Key string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !strings.HasPrefix(out.Key, applepay.KeyPrefix) {
		t.Fatalf("connect key: %q", out.Key)
	}
	return out.Key
}

func (app walletApp) status(t *testing.T) walletStatus {
	t.Helper()
	rec := app.call(t, http.MethodGet, "/api/wallet", "Bearer "+app.alice, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
	}
	var s walletStatus
	_ = json.Unmarshal(rec.Body.Bytes(), &s)
	return s
}

func (app walletApp) whoami(t *testing.T, key string) int {
	t.Helper()
	return app.call(t, http.MethodGet, "/api/wallet/whoami", "Bearer "+key, nil).Code
}

func TestWalletConnectStatusDisconnect(t *testing.T) {
	app := setupWalletApp(t)
	// Every key event a second apart: "the longest idle" is well defined.
	tick := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	app.keys.Now = func() time.Time { tick = tick.Add(time.Second); return tick }

	if s := app.status(t); s.Connected || s.Phones != 0 || s.ShortcutURL != testShortcut || s.ShortcutURLLegacy != testShortcutLegacy || s.PushShortcutURL != testPushShortcut || s.LastUsedAt != nil {
		t.Fatalf("fresh status: %+v", s)
	}

	first := app.connect(t)
	// Only the hash is stored: no stored value contains the key.
	for _, h := range app.keys.Hashes() {
		if bytes.Contains(h, []byte(first)) || bytes.Contains(h, []byte(first[len(applepay.KeyPrefix):])) {
			t.Fatal("the plain key is stored")
		}
	}
	if hs := app.keys.Hashes(); len(hs) != 1 || !bytes.Equal(hs[0], applepay.HashKey(first)) {
		t.Fatalf("stored: %x", hs)
	}

	// One key per phone: the second does not revoke the first.
	second := app.connect(t)
	if app.whoami(t, first) != http.StatusOK || app.whoami(t, second) != http.StatusOK {
		t.Fatal("two phones: both keys must work")
	}
	if s := app.status(t); !s.Connected || s.Phones != 2 || s.LastUsedAt == nil {
		t.Fatalf("two phones: %+v", s)
	}

	// The sixth key pushes out the longest idle: a never-used key (the connect sheet opened and
	// closed makes one), not a working phone (критик Б1).
	var more []string
	for range 4 {
		more = append(more, app.connect(t))
	}
	if app.whoami(t, more[0]) != http.StatusUnauthorized || app.whoami(t, first) != http.StatusOK || app.whoami(t, second) != http.StatusOK {
		t.Fatal("sixth key: the oldest never-used key must die, the working phones live")
	}
	if s := app.status(t); s.Phones != 5 {
		t.Fatalf("after six connects: %+v", s)
	}
	// All five used: the least recently used goes.
	for _, k := range append(more[1:], first) {
		if app.whoami(t, k) != http.StatusOK {
			t.Fatal("a live key failed")
		}
	}
	app.connect(t)
	if app.whoami(t, second) != http.StatusUnauthorized || app.whoami(t, first) != http.StatusOK {
		t.Fatal("seventh key: the least recently used must die")
	}

	// "Отключить" revokes every phone; twice is fine.
	for range 2 {
		if rec := app.call(t, http.MethodDelete, "/api/wallet", "Bearer "+app.alice, nil); rec.Code != http.StatusNoContent {
			t.Fatalf("disconnect: %d", rec.Code)
		}
	}
	if app.whoami(t, second) != http.StatusUnauthorized {
		t.Fatal("revoked key still works")
	}
	if s := app.status(t); s.Connected || s.Phones != 0 {
		t.Fatalf("after disconnect: %+v", s)
	}
}

func TestWalletViewerAndLinks(t *testing.T) {
	app := setupWalletApp(t)
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/api/wallet"}, {http.MethodPost, "/api/wallet/connect"}, {http.MethodDelete, "/api/wallet"},
	} {
		if rec := app.call(t, c.method, c.path, "Bearer "+app.viewer, nil); rec.Code != http.StatusForbidden {
			t.Errorf("viewer %s %s: want 403, got %d", c.method, c.path, rec.Code)
		}
	}
	// No links configured: the status says so (the app hides the card).
	app.handler.shortcutURL, app.handler.shortcutURLLegacy, app.handler.pushShortcutURL = "", "", ""
	if s := app.status(t); s.ShortcutURL != "" || s.ShortcutURLLegacy != "" || s.PushShortcutURL != "" {
		t.Fatalf("links without config: %+v", s)
	}
}

func TestWalletKeyAuth(t *testing.T) {
	app := setupWalletApp(t)
	ctx := t.Context()

	if code := app.whoami(t, applepay.KeyPrefix+strings.Repeat("Q", 43)); code != http.StatusUnauthorized {
		t.Errorf("unknown key: %d", code)
	}
	if rec := app.call(t, http.MethodGet, "/api/wallet/whoami", "Bearer "+app.alice, nil); rec.Code != http.StatusUnauthorized ||
		strings.TrimSpace(rec.Body.String()) != `{"error":"unauthorized"}` {
		t.Errorf("a JWT is not a phone key: %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.call(t, http.MethodGet, "/api/wallet/whoami", "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("no header: %d", rec.Code)
	}

	key := app.connect(t)
	rec := app.call(t, http.MethodGet, "/api/wallet/whoami", "Bearer "+key, nil)
	var who map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &who)
	if rec.Code != http.StatusOK || who["user"] != app.aliceID || who["household"] != app.familyID {
		t.Fatalf("own key: %d %v", rec.Code, who)
	}

	// The role comes from the database on every request: demoted to viewer — 403.
	app.repos.Households.SetRole(app.familyID, app.aliceID, "viewer")
	if code := app.whoami(t, key); code != http.StatusForbidden {
		t.Errorf("viewer's key: %d", code)
	}
	app.repos.Households.SetRole(app.familyID, app.aliceID, "member")

	// A person without a household.
	plain, hash, _ := applepay.NewKey()
	_ = app.keys.Add(ctx, app.loneID, hash)
	if code := app.whoami(t, plain); code != http.StatusForbidden {
		t.Errorf("key without household: %d", code)
	}
}
