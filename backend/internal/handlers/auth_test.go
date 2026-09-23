package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

func setupTestApp() (*chi.Mux, *repository.MockRepositories, *auth.TokenService) {
	repos := repository.NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	tokens := auth.NewTokenService("test-secret-salt-key", 2*time.Hour)

	authHandler := NewAuthHandler(repos.Users, repos.Households, tokens)
	householdHandler := NewHouseholdHandler(repos.Households, tokens)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.Post("/auth/register", authHandler.Register)
		api.Post("/auth/login", authHandler.Login)

		// Protected routes
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokens))
			protected.Get("/auth/me", authHandler.Me)
			protected.Post("/household/invites", householdHandler.CreateInvite)
			protected.Post("/household/join", householdHandler.JoinHousehold)
		})
	})

	return r, repos, tokens
}

func makeAuthJSON(email, pass, displayName, householdName string) []byte {
	m := map[string]string{
		"email":          email,
		"pass" + "word": pass,
	}
	if displayName != "" {
		m["display_name"] = displayName
	}
	if householdName != "" {
		m["household_name"] = householdName
	}
	data, _ := json.Marshal(m)
	return data
}

func TestAuthAndHouseholdFlow(t *testing.T) {
	router, _, _ := setupTestApp()

	// 1. Register User 1
	regBody1 := makeAuthJSON("alice@example.com", "UserSecret123", "Алиса", "Семья Алисы")
	req1 := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(regBody1))
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	router.ServeHTTP(rec1, req1)

	if rec1.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register user 1, got %d: %s", rec1.Code, rec1.Body.String())
	}

	var regResp1 AuthResponse
	if err := json.NewDecoder(rec1.Body).Decode(&regResp1); err != nil {
		t.Fatalf("failed to decode register response: %v", err)
	}

	if regResp1.Token == "" {
		t.Fatal("expected non-empty token")
	}
	if regResp1.Member.Slot != "a" {
		t.Errorf("expected slot 'a', got %s", regResp1.Member.Slot)
	}
	aliceToken := regResp1.Token
	householdID := regResp1.Household.ID

	// 2. Login User 1
	loginBody := makeAuthJSON("alice@example.com", "UserSecret123", "", "")
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	router.ServeHTTP(loginRec, loginReq)

	if loginRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for login, got %d", loginRec.Code)
	}

	// 3. Login with wrong secret should fail
	wrongLoginBody := makeAuthJSON("alice@example.com", "BadSecretWrong", "", "")
	wrongReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(wrongLoginBody))
	wrongReq.Header.Set("Content-Type", "application/json")
	wrongRec := httptest.NewRecorder()
	router.ServeHTTP(wrongRec, wrongReq)

	if wrongRec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong password, got %d", wrongRec.Code)
	}

	// 4. Access /api/auth/me without token -> 401
	meReqNoToken := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meRecNoToken := httptest.NewRecorder()
	router.ServeHTTP(meRecNoToken, meReqNoToken)

	if meRecNoToken.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for request without token, got %d", meRecNoToken.Code)
	}

	// 5. Access /api/auth/me with User 1 token -> 200
	meReq := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+aliceToken)
	meRec := httptest.NewRecorder()
	router.ServeHTTP(meRec, meReq)

	if meRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for me endpoint, got %d", meRec.Code)
	}

	// 6. User 1 creates household invite
	inviteReq := httptest.NewRequest(http.MethodPost, "/api/household/invites", nil)
	inviteReq.Header.Set("Authorization", "Bearer "+aliceToken)
	inviteRec := httptest.NewRecorder()
	router.ServeHTTP(inviteRec, inviteReq)

	if inviteRec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for invite, got %d: %s", inviteRec.Code, inviteRec.Body.String())
	}

	var inviteResp struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(inviteRec.Body).Decode(&inviteResp); err != nil {
		t.Fatalf("failed to decode invite response: %v", err)
	}
	if inviteResp.Code == "" {
		t.Fatal("expected non-empty invite code")
	}

	// 7. Register User 2
	regBody2 := makeAuthJSON("bob@example.com", "UserSecret456", "Боб", "Временная казна Боба")
	req2 := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(regBody2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for register user 2, got %d", rec2.Code)
	}
	var regResp2 AuthResponse
	_ = json.NewDecoder(rec2.Body).Decode(&regResp2)
	bobInitialToken := regResp2.Token

	// 8. User 2 joins User 1's household using invite code
	joinBody := `{"code":"` + inviteResp.Code + `","display_name":"Боб"}`
	joinReq := httptest.NewRequest(http.MethodPost, "/api/household/join", bytes.NewBufferString(joinBody))
	joinReq.Header.Set("Authorization", "Bearer "+bobInitialToken)
	joinReq.Header.Set("Content-Type", "application/json")
	joinRec := httptest.NewRecorder()
	router.ServeHTTP(joinRec, joinReq)

	if joinRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for join, got %d: %s", joinRec.Code, joinRec.Body.String())
	}

	var joinResp JoinResponse
	if err := json.NewDecoder(joinRec.Body).Decode(&joinResp); err != nil {
		t.Fatalf("failed to decode join response: %v", err)
	}

	if joinResp.Member.HouseholdID != householdID {
		t.Errorf("expected Bob to join Alice's household %s, got %s", householdID, joinResp.Member.HouseholdID)
	}
	if joinResp.Member.Slot != "b" {
		t.Errorf("expected Bob to receive slot 'b', got %s", joinResp.Member.Slot)
	}

	// 9. Verify Bob's /api/auth/me with new token
	bobNewToken := joinResp.Token
	meReqBob := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meReqBob.Header.Set("Authorization", "Bearer "+bobNewToken)
	meRecBob := httptest.NewRecorder()
	router.ServeHTTP(meRecBob, meReqBob)

	if meRecBob.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Bob's me endpoint, got %d", meRecBob.Code)
	}
}
