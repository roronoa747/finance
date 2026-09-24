package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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

func TestSyncConcurrentOptimisticLock(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	u1, _ := repos.Users.Create(ctx, "concurrent@sync.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Concurrent HH", u1.ID, "User1")
	token, _ := tokens.GenerateToken(u1.ID, hh.ID, "member", "a")

	// Initial rev is 1. 5 concurrent goroutines try to push with last_seen_rev: 1.
	const workers = 5
	var wg sync.WaitGroup
	var successCount int
	var conflictCount int
	var mu sync.Mutex

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			payload := `{"last_seen_rev": 1, "data": {"updated_by_worker": ` + jsonNumber(workerID) + `}}`
			req := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(payload))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			mu.Lock()
			defer mu.Unlock()
			if rec.Code == http.StatusOK {
				successCount++
			} else if rec.Code == http.StatusConflict {
				conflictCount++
			}
		}(i)
	}

	wg.Wait()

	if successCount != 1 {
		t.Errorf("expected exactly 1 successful write, got %d", successCount)
	}
	if conflictCount != workers-1 {
		t.Errorf("expected %d conflicts, got %d", workers-1, conflictCount)
	}
}

func jsonNumber(n int) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func TestSyncViewerCanWritePrivateDoc(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	u1, _ := repos.Users.Create(ctx, "viewer-write@sync.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Viewer Test HH", u1.ID, "Admin")

	u2, _ := repos.Users.Create(ctx, "viewer-user@sync.test", "hash2")
	inv, _ := repos.Households.CreateInvite(ctx, hh.ID, u1.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, u2.ID, "Viewer")
	viewerToken, _ := tokens.GenerateToken(u2.ID, hh.ID, "viewer", "b")

	// 1. Viewer writes to their own private doc -> 200 OK
	privPayload := `{"last_seen_rev": 1, "data": {"my_notes": "viewer notes"}}`
	privReq := httptest.NewRequest(http.MethodPost, "/api/sync/private", bytes.NewBufferString(privPayload))
	privReq.Header.Set("Authorization", "Bearer "+viewerToken)
	privReq.Header.Set("Content-Type", "application/json")
	privRec := httptest.NewRecorder()
	router.ServeHTTP(privRec, privReq)

	if privRec.Code != http.StatusOK {
		t.Errorf("expected viewer to be able to write private doc (200), got %d: %s", privRec.Code, privRec.Body.String())
	}

	// 2. Viewer cannot write to household doc -> 403 Forbidden
	hhPayload := `{"last_seen_rev": 1, "data": {"budget": {}}}`
	hhReq := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(hhPayload))
	hhReq.Header.Set("Authorization", "Bearer "+viewerToken)
	hhReq.Header.Set("Content-Type", "application/json")
	hhRec := httptest.NewRecorder()
	router.ServeHTTP(hhRec, hhReq)

	if hhRec.Code != http.StatusForbidden {
		t.Errorf("expected 403 Forbidden for viewer writing household doc, got %d", hhRec.Code)
	}
}

func TestSyncMalformedPayload(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	u1, _ := repos.Users.Create(ctx, "malformed@sync.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Malformed Test HH", u1.ID, "User")
	token, _ := tokens.GenerateToken(u1.ID, hh.ID, "member", "a")

	badReq := httptest.NewRequest(http.MethodPost, "/api/sync/household", bytes.NewBufferString(`{bad json`))
	badReq.Header.Set("Authorization", "Bearer "+token)
	badReq.Header.Set("Content-Type", "application/json")
	badRec := httptest.NewRecorder()
	router.ServeHTTP(badRec, badReq)

	if badRec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for malformed JSON, got %d", badRec.Code)
	}
}

func TestSyncOversizedBodyReturns413(t *testing.T) {
	router, repos, tokens := setupSyncTestApp()
	ctx := t.Context()

	u1, _ := repos.Users.Create(ctx, "big@sync.test", "hash1")
	hh, _, _ := repos.Households.CreateHousehold(ctx, "Big HH", u1.ID, "User")
	token, _ := tokens.GenerateToken(u1.ID, hh.ID, "member", "a")

	body := `{"last_seen_rev": 1, "data": {"blob": "` + strings.Repeat("x", maxDocBodyBytes) + `"}}`
	for _, path := range []string{"/api/sync/household", "/api/sync/private"} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("%s: expected 413 for body over the limit, got %d", path, rec.Code)
		}
	}
}

// docRepoSpy fails the test if a push reaches the repository.
type docRepoSpy struct {
	repository.DocRepository
	t *testing.T
}

func (s docRepoSpy) PushHouseholdDoc(ctx context.Context, householdID string, expectedRev int64, data json.RawMessage, updatedBy string) (*models.HouseholdDoc, bool, error) {
	s.t.Error("invalid UTF-8 must be rejected before the repository")
	return nil, false, errors.New("unexpected")
}

func (s docRepoSpy) PushPrivateDoc(ctx context.Context, householdID, userID string, expectedRev int64, data json.RawMessage) (*models.PrivateDoc, bool, error) {
	s.t.Error("invalid UTF-8 must be rejected before the repository")
	return nil, false, errors.New("unexpected")
}

func TestSyncInvalidUTF8Returns400(t *testing.T) {
	tokens := auth.NewTokenService("sync-test-signing-key", 2*time.Hour)
	syncHandler := NewSyncHandler(docRepoSpy{t: t})
	r := chi.NewRouter()
	r.With(auth.Middleware(tokens)).Post("/api/sync/household", syncHandler.PushHouseholdDoc)
	r.With(auth.Middleware(tokens)).Post("/api/sync/private", syncHandler.PushPrivateDoc)

	token, _ := tokens.GenerateToken("user-1", "hh-1", "member", "a")
	body := []byte("{\"last_seen_rev\": 1, \"data\": {\"name\": \"\xff\xfe\"}}")
	for _, path := range []string{"/api/sync/household", "/api/sync/private"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400 for invalid UTF-8, got %d: %s", path, rec.Code, rec.Body.String())
		}
	}
}
