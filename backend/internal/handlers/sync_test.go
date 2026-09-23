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
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

func setupSyncTestApp() (*chi.Mux, *repository.MockRepositories, *auth.TokenService) {
	repos := repository.NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	tokens := auth.NewTokenService("sync-test-signing-key", 2*time.Hour)

	syncHandler := NewSyncHandler(repos.Docs)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokens))

			protected.Get("/sync/household", syncHandler.GetHouseholdDoc)
			protected.Post("/sync/household", syncHandler.PushHouseholdDoc)
			protected.Get("/sync/private", syncHandler.GetPrivateDoc)
			protected.Post("/sync/private", syncHandler.PushPrivateDoc)
		})
	})

	return r, repos, tokens
}

func TestSyncEndpointsAndOptimisticLock(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	// Setup: Create Household with Alice (member, slot a)
	u1, _ := repos.Users.Create(ctx, "alice@sync.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Family Budget", u1.ID, "Alice")
	aliceToken, _ := tokens.GenerateToken(u1.ID, hh.ID, "member", "a")

	// Add Bob (member, slot b)
	u2, _ := repos.Users.Create(ctx, "bob@sync.test", "hash2")
	inv, _ := repos.Households.CreateInvite(ctx, hh.ID, u1.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, u2.ID, "Bob")
	bobToken, _ := tokens.GenerateToken(u2.ID, hh.ID, "member", "b")

	// Add Charlie (viewer, slot c)
	u3, _ := repos.Users.Create(ctx, "charlie@sync.test", "hash3")
	charlieToken, _ := tokens.GenerateToken(u3.ID, hh.ID, "viewer", "c")

	// 1. Alice reads initial household doc (rev: 1)
	getReq := httptest.NewRequest(http.MethodGet, "/api/sync/household", nil)
	getReq.Header.Set("Authorization", "Bearer "+aliceToken)
	getRec := httptest.NewRecorder()
	router.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", getRec.Code, getRec.Body.String())
	}
	var doc models.HouseholdDoc
	if err := json.NewDecoder(getRec.Body).Decode(&doc); err != nil {
		t.Fatalf("failed to decode household doc: %v", err)
	}
	if doc.Rev != 1 {
		t.Errorf("expected initial rev 1, got %d", doc.Rev)
	}

	// 2. Alice pushes update with last_seen_rev: 1 -> Success, rev becomes 2
	pushBody1 := `{"last_seen_rev": 1, "data": {"budget": {"incomes": [1000]}}}`
	pushReq1 := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(pushBody1))
	pushReq1.Header.Set("Authorization", "Bearer "+aliceToken)
	pushReq1.Header.Set("Content-Type", "application/json")
	pushRec1 := httptest.NewRecorder()
	router.ServeHTTP(pushRec1, pushReq1)

	if pushRec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Alice push, got %d: %s", pushRec1.Code, pushRec1.Body.String())
	}
	var updatedDoc models.HouseholdDoc
	_ = json.NewDecoder(pushRec1.Body).Decode(&updatedDoc)
	if updatedDoc.Rev != 2 {
		t.Errorf("expected rev 2 after Alice push, got %d", updatedDoc.Rev)
	}

	// 3. Bob attempts to push with stale last_seen_rev: 1 -> 409 Conflict
	pushBodyBobStale := `{"last_seen_rev": 1, "data": {"budget": {"expenses": [500]}}}`
	pushReqBob := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(pushBodyBobStale))
	pushReqBob.Header.Set("Authorization", "Bearer "+bobToken)
	pushReqBob.Header.Set("Content-Type", "application/json")
	pushRecBob := httptest.NewRecorder()
	router.ServeHTTP(pushRecBob, pushReqBob)

	if pushRecBob.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for Bob stale push, got %d: %s", pushRecBob.Code, pushRecBob.Body.String())
	}

	var conflictResp ConflictResponse
	if err := json.NewDecoder(pushRecBob.Body).Decode(&conflictResp); err != nil {
		t.Fatalf("failed to decode conflict response: %v", err)
	}
	if conflictResp.Error != "conflict" {
		t.Errorf("expected error 'conflict', got %s", conflictResp.Error)
	}

	// 4. Charlie (viewer) tries to write -> 403 Forbidden
	pushReqCharlie := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(`{"last_seen_rev": 2, "data": {}}`))
	pushReqCharlie.Header.Set("Authorization", "Bearer "+charlieToken)
	pushReqCharlie.Header.Set("Content-Type", "application/json")
	pushRecCharlie := httptest.NewRecorder()
	router.ServeHTTP(pushRecCharlie, pushReqCharlie)

	if pushRecCharlie.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for viewer role, got %d", pushRecCharlie.Code)
	}

	// 5. Charlie (viewer) can read household budget -> 200 OK
	getReqCharlie := httptest.NewRequest(http.MethodGet, "/api/sync/household", nil)
	getReqCharlie.Header.Set("Authorization", "Bearer "+charlieToken)
	getRecCharlie := httptest.NewRecorder()
	router.ServeHTTP(getRecCharlie, getReqCharlie)

	if getRecCharlie.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for viewer read, got %d", getRecCharlie.Code)
	}
}

func TestPrivateDocIsolationAndOptimisticLock(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	// Create Household with Alice and Bob
	u1, _ := repos.Users.Create(ctx, "alice@private.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Private Test HH", u1.ID, "Alice")
	aliceToken, _ := tokens.GenerateToken(u1.ID, hh.ID, "member", "a")

	u2, _ := repos.Users.Create(ctx, "bob@private.test", "hash2")
	inv, _ := repos.Households.CreateInvite(ctx, hh.ID, u1.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, u2.ID, "Bob")
	bobToken, _ := tokens.GenerateToken(u2.ID, hh.ID, "member", "b")

	// 1. Alice writes secret data to her private doc
	aliceSecretPayload := `{"last_seen_rev": 1, "data": {"gift_for_bob": "Secret Watch"}}`
	alicePushReq := httptest.NewRequest(http.MethodPost, "/api/sync/private", bytes.NewBufferString(aliceSecretPayload))
	alicePushReq.Header.Set("Authorization", "Bearer "+aliceToken)
	alicePushReq.Header.Set("Content-Type", "application/json")
	alicePushRec := httptest.NewRecorder()
	router.ServeHTTP(alicePushRec, alicePushReq)

	if alicePushRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Alice private push, got %d", alicePushRec.Code)
	}

	// 2. Bob reads his private doc -> must NOT see Alice's secret!
	bobGetReq := httptest.NewRequest(http.MethodGet, "/api/sync/private", nil)
	bobGetReq.Header.Set("Authorization", "Bearer "+bobToken)
	bobGetRec := httptest.NewRecorder()
	router.ServeHTTP(bobGetRec, bobGetReq)

	if bobGetRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Bob private get, got %d", bobGetRec.Code)
	}

	var bobDoc models.PrivateDoc
	if err := json.NewDecoder(bobGetRec.Body).Decode(&bobDoc); err != nil {
		t.Fatalf("failed to decode Bob's private doc: %v", err)
	}

	// Verify Bob's doc is his own and empty
	if bobDoc.UserID != u2.ID {
		t.Errorf("expected doc user ID %s, got %s", u2.ID, bobDoc.UserID)
	}
	if bytes.Contains(bobDoc.Data, []byte("Secret Watch")) {
		t.Fatal("SECURITY VIOLATION: Bob can see Alice's private data!")
	}

	// 3. Bob pushes his private doc with last_seen_rev: 1 -> 200 OK
	bobPayload := `{"last_seen_rev": 1, "data": {"my_secret": "Guitar Fund"}}`
	bobPushReq := httptest.NewRequest(http.MethodPost, "/api/sync/private", bytes.NewBufferString(bobPayload))
	bobPushReq.Header.Set("Authorization", "Bearer "+bobToken)
	bobPushReq.Header.Set("Content-Type", "application/json")
	bobPushRec := httptest.NewRecorder()
	router.ServeHTTP(bobPushRec, bobPushReq)

	if bobPushRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for Bob private push, got %d", bobPushRec.Code)
	}

	// 4. Bob pushes again with stale rev 1 -> 409 Conflict
	bobStaleReq := httptest.NewRequest(http.MethodPost, "/api/sync/private", bytes.NewBufferString(bobPayload))
	bobStaleReq.Header.Set("Authorization", "Bearer "+bobToken)
	bobStaleReq.Header.Set("Content-Type", "application/json")
	bobStaleRec := httptest.NewRecorder()
	router.ServeHTTP(bobStaleRec, bobStaleReq)

	if bobStaleRec.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for Bob stale private push, got %d", bobStaleRec.Code)
	}
}
