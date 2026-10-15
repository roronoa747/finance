package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// meAI answers /auth/me's "ai" for a user with (or without) a family whose flag is on,
// through a handler built with flags (nil = no key).
func meAI(t *testing.T, withFamily, flagOn, withKey bool) bool {
	t.Helper()
	ctx := context.Background()
	repos := repository.NewMockRepositories()
	tokens := auth.NewTokenService("test-secret-salt-key", time.Hour)
	aiRepo := repository.NewMockAIRepo(repos.Households)

	user, err := repos.Users.Create(ctx, "ai@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	if withFamily {
		h, _, err := repos.Households.CreateHousehold(ctx, "", user.ID, "Айгуль")
		if err != nil {
			t.Fatal(err)
		}
		if err := aiRepo.SetEnabled(ctx, h.ID, flagOn); err != nil {
			t.Fatal(err)
		}
	}
	var flags AIFlags
	if withKey {
		flags = aiRepo
	}
	h := NewAuthHandler(repos.Users, repos.Households, tokens, nil, nil, flags)
	token, err := tokens.GenerateToken(user.ID, "", "", "")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	auth.Middleware(tokens, nil)(http.HandlerFunc(h.Me)).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("me: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	on, ok := body["ai"].(bool)
	if !ok {
		t.Fatalf("ai must be a bool: %s", rec.Body.String())
	}
	return on
}

func TestMeAI(t *testing.T) {
	cases := []struct {
		name                      string
		family, flag, key, wantAI bool
	}{
		{"key and flag", true, true, true, true},
		{"no key, flag on", true, true, false, false},
		{"flag off", true, false, true, false},
		{"no family", false, false, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := meAI(t, tc.family, tc.flag, tc.key); got != tc.wantAI {
				t.Errorf("ai = %v, want %v", got, tc.wantAI)
			}
		})
	}
}
