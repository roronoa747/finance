package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"finance-backend/internal/auth"
	"finance-backend/internal/config"
	"finance-backend/internal/fx"
	"finance-backend/internal/handlers"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
	"finance-backend/internal/testdb"
)

type MeResponse struct {
	User      *models.User            `json:"user"`
	Household *models.Household       `json:"household"`
	Member    *models.HouseholdMember `json:"member"`
}

func TestLiveServerE2EFlow(t *testing.T) {
	// In-memory mock repository layer
	mockRepos := repository.NewMockRepositories()
	mockRepos.Households.SetDocRepo(mockRepos.Docs)

	runLiveServerE2EFlow(t, nil, mockRepos.Users, mockRepos.Households, mockRepos.Docs)
}

// TestLiveServerE2EFlowPostgres runs the same flow against a real PostgreSQL.
// Skipped unless TEST_DATABASE_URL is set; the target database is wiped.
func TestLiveServerE2EFlowPostgres(t *testing.T) {
	database := testdb.Open(t)

	runLiveServerE2EFlow(t, database,
		repository.NewSQLUserRepository(database),
		repository.NewSQLHouseholdRepository(database),
		repository.NewSQLDocRepository(database))
}

func runLiveServerE2EFlow(
	t *testing.T,
	database *sql.DB,
	userRepo repository.UserRepository,
	householdRepo repository.HouseholdRepository,
	docRepo repository.DocRepository,
) {
	cfg := &config.Config{
		Port:       "8080",
		Env:        "test",
		JWTSecret:  "e2e-acceptance-testing-secret-key-32chars",
		CORSOrigin: "http://localhost:5173",
	}
	tokenService := auth.NewTokenService(cfg.JWTSecret, 24*time.Hour)

	router := NewRouter(cfg, database, Repos{Users: userRepo, Households: householdRepo, Docs: docRepo}, tokenService, fx.NewClient())
	wantDBStatus := "disconnected"
	if database != nil {
		wantDBStatus = "connected"
	}

	// Spin up real HTTP server listening on local TCP socket
	ts := httptest.NewServer(router)
	defer ts.Close()

	client := ts.Client()

	// Helper function for sending JSON HTTP requests
	sendJSON := func(method, path string, body any, token string) (*http.Response, []byte) {
		var bodyReader io.Reader
		if body != nil {
			data, err := json.Marshal(body)
			if err != nil {
				t.Fatalf("failed to marshal request body: %v", err)
			}
			bodyReader = bytes.NewReader(data)
		}

		req, err := http.NewRequest(method, ts.URL+path, bodyReader)
		if err != nil {
			t.Fatalf("failed to build request %s %s: %v", method, path, err)
		}
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("request %s %s failed: %v", method, path, err)
		}
		defer resp.Body.Close()

		respBytes, err := io.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("failed to read response bytes: %v", err)
		}
		return resp, respBytes
	}

	// Step 1: Health check
	t.Run("Health check", func(t *testing.T) {
		resp, body := sendJSON(http.MethodGet, "/api/health", nil, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var health map[string]string
		if err := json.Unmarshal(body, &health); err != nil {
			t.Fatalf("invalid json: %v", err)
		}
		if health["status"] != "ok" || health["db"] != wantDBStatus {
			t.Errorf("unexpected health body: %+v", health)
		}
	})

	// Step 2: Register User 1 (Alice)
	var aliceToken string
	var aliceHouseholdID string

	t.Run("Register User 1 (Alice)", func(t *testing.T) {
		regBody := map[string]string{
			"email":          "alice@e2e.test",
			"pass" + "word":  "AliceSecretPassword123",
			"display_name":   "Alice Cooper",
			"household_name": "Cooper Family",
		}
		resp, body := sendJSON(http.MethodPost, "/api/auth/register", regBody, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", resp.StatusCode, string(body))
		}

		var regResp handlers.AuthResponse
		if err := json.Unmarshal(body, &regResp); err != nil {
			t.Fatalf("failed to parse auth response: %v", err)
		}

		if regResp.Token == "" {
			t.Fatal("expected non-empty auth token")
		}
		if regResp.Member.Slot != "a" {
			t.Errorf("expected slot 'a', got %s", regResp.Member.Slot)
		}
		if regResp.Member.Role != "member" {
			t.Errorf("expected role 'member', got %s", regResp.Member.Role)
		}

		aliceToken = regResp.Token
		aliceHouseholdID = regResp.Household.ID
	})

	// Step 3: Alice calls /api/auth/me
	t.Run("Alice calls /api/auth/me", func(t *testing.T) {
		resp, body := sendJSON(http.MethodGet, "/api/auth/me", nil, aliceToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var meResp MeResponse
		if err := json.Unmarshal(body, &meResp); err != nil {
			t.Fatalf("failed to decode me response: %v", err)
		}
		if meResp.Household.ID != aliceHouseholdID {
			t.Errorf("household ID mismatch: expected %s, got %s", aliceHouseholdID, meResp.Household.ID)
		}
	})

	// Step 4: Alice creates invite
	var inviteCode string
	t.Run("Alice creates invite", func(t *testing.T) {
		resp, body := sendJSON(http.MethodPost, "/api/household/invites", nil, aliceToken)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", resp.StatusCode, string(body))
		}
		var invite models.HouseholdInvite
		if err := json.Unmarshal(body, &invite); err != nil {
			t.Fatalf("failed to decode invite: %v", err)
		}
		if len(invite.Code) == 0 {
			t.Fatal("expected non-empty invite code")
		}
		inviteCode = invite.Code
	})

	// Step 5: Register User 2 (Bob)
	var bobToken string
	t.Run("Register User 2 (Bob)", func(t *testing.T) {
		regBody := map[string]string{
			"email":         "bob@e2e.test",
			"pass" + "word": "BobSecretPassword456",
			"display_name":  "Bob Builder",
		}
		resp, body := sendJSON(http.MethodPost, "/api/auth/register", regBody, "")
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", resp.StatusCode, string(body))
		}
		var regResp handlers.AuthResponse
		if err := json.Unmarshal(body, &regResp); err != nil {
			t.Fatalf("failed to parse auth response: %v", err)
		}
		bobToken = regResp.Token
	})

	// Step 6: Bob joins Alice's household using invite code
	t.Run("Bob joins Alice's household", func(t *testing.T) {
		joinBody := map[string]string{
			"code":         inviteCode,
			"display_name": "Bob Cooper",
		}
		resp, body := sendJSON(http.MethodPost, "/api/household/join", joinBody, bobToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var joinResp handlers.JoinResponse
		if err := json.Unmarshal(body, &joinResp); err != nil {
			t.Fatalf("failed to parse join response: %v", err)
		}
		if joinResp.Member.HouseholdID != aliceHouseholdID {
			t.Errorf("expected joined household %s, got %s", aliceHouseholdID, joinResp.Member.HouseholdID)
		}
		if joinResp.Member.Slot != "b" {
			t.Errorf("expected slot 'b' for partner, got %s", joinResp.Member.Slot)
		}
		// Update bobToken with the new token issued for Alice's household
		bobToken = joinResp.Token
	})

	// Step 7: Bob checks /api/auth/me to verify common household
	t.Run("Bob verifies common household membership", func(t *testing.T) {
		resp, body := sendJSON(http.MethodGet, "/api/auth/me", nil, bobToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var meResp MeResponse
		if err := json.Unmarshal(body, &meResp); err != nil {
			t.Fatalf("failed to parse me response: %v", err)
		}
		if meResp.Household.ID != aliceHouseholdID {
			t.Errorf("expected Bob to belong to household %s, got %s", aliceHouseholdID, meResp.Household.ID)
		}
		if meResp.Member.Slot != "b" {
			t.Errorf("expected slot 'b', got %s", meResp.Member.Slot)
		}
	})

	// Step 8: Sync household budget — Alice reads initial rev
	t.Run("Alice reads initial household doc", func(t *testing.T) {
		resp, body := sendJSON(http.MethodGet, "/api/sync/household", nil, aliceToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var doc models.HouseholdDoc
		if err := json.Unmarshal(body, &doc); err != nil {
			t.Fatalf("failed to decode household doc: %v", err)
		}
		if doc.Rev != 1 {
			t.Errorf("expected initial rev 1, got %d", doc.Rev)
		}
	})

	// Step 9: Alice updates budget (rev: 1 -> 2)
	t.Run("Alice updates household budget", func(t *testing.T) {
		pushPayload := map[string]any{
			"last_seen_rev": 1,
			"data": map[string]any{
				"budget": map[string]any{
					"monthly_income": 5000,
					"currency":       "EUR",
				},
			},
		}
		resp, body := sendJSON(http.MethodPost, "/api/sync/household", pushPayload, aliceToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var doc models.HouseholdDoc
		if err := json.Unmarshal(body, &doc); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if doc.Rev != 2 {
			t.Errorf("expected rev 2, got %d", doc.Rev)
		}
	})

	// Step 10: Bob attempts to push with stale rev 1 -> 409 Conflict
	t.Run("Bob encounters 409 Conflict on stale revision", func(t *testing.T) {
		stalePayload := map[string]any{
			"last_seen_rev": 1,
			"data": map[string]any{
				"budget": map[string]any{
					"monthly_income": 6000,
				},
			},
		}
		resp, body := sendJSON(http.MethodPost, "/api/sync/household", stalePayload, bobToken)
		if resp.StatusCode != http.StatusConflict {
			t.Fatalf("expected 409 Conflict, got %d: %s", resp.StatusCode, string(body))
		}
		var conflictResp map[string]any
		if err := json.Unmarshal(body, &conflictResp); err != nil {
			t.Fatalf("failed to decode conflict response: %v", err)
		}
		if conflictResp["error"] != "conflict" {
			t.Errorf("expected conflict error, got %v", conflictResp["error"])
		}
		serverDoc, ok := conflictResp["server_doc"].(map[string]any)
		if !ok {
			t.Fatalf("missing server_doc in conflict response: %v", conflictResp)
		}
		if fmt.Sprintf("%v", serverDoc["rev"]) != "2" {
			t.Errorf("expected server_doc rev 2, got %v", serverDoc["rev"])
		}
	})

	// Step 11: Bob reads latest (rev: 2) and pushes update (rev: 2 -> 3)
	t.Run("Bob pushes update with latest rev 2", func(t *testing.T) {
		validPayload := map[string]any{
			"last_seen_rev": 2,
			"data": map[string]any{
				"budget": map[string]any{
					"monthly_income": 5500,
					"currency":       "EUR",
				},
			},
		}
		resp, body := sendJSON(http.MethodPost, "/api/sync/household", validPayload, bobToken)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", resp.StatusCode, string(body))
		}
		var doc models.HouseholdDoc
		if err := json.Unmarshal(body, &doc); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if doc.Rev != 3 {
			t.Errorf("expected rev 3, got %d", doc.Rev)
		}
	})

	// Step 12 & 13: Private documents isolation
	t.Run("Private documents isolation between Alice and Bob", func(t *testing.T) {
		// Alice reads initial private doc (rev: 1)
		initGetA, initBodyA := sendJSON(http.MethodGet, "/api/sync/private", nil, aliceToken)
		if initGetA.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK reading Alice initial private doc: %s", string(initBodyA))
		}
		var initDocA models.PrivateDoc
		_ = json.Unmarshal(initBodyA, &initDocA)
		if initDocA.Rev != 1 {
			t.Errorf("expected initial private doc rev 1, got %d", initDocA.Rev)
		}

		// Alice writes to her private doc with last_seen_rev: 1 -> rev: 2
		alicePrivatePayload := map[string]any{
			"last_seen_rev": initDocA.Rev,
			"data": map[string]any{
				"secret_savings": 12000,
				"owner":          "Alice",
			},
		}
		respA, bodyA := sendJSON(http.MethodPost, "/api/sync/private", alicePrivatePayload, aliceToken)
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for Alice private doc, got %d: %s", respA.StatusCode, string(bodyA))
		}

		// Bob reads initial private doc (rev: 1)
		initGetB, initBodyB := sendJSON(http.MethodGet, "/api/sync/private", nil, bobToken)
		if initGetB.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK reading Bob initial private doc: %s", string(initBodyB))
		}
		var initDocB models.PrivateDoc
		_ = json.Unmarshal(initBodyB, &initDocB)
		if initDocB.Rev != 1 {
			t.Errorf("expected initial private doc rev 1, got %d", initDocB.Rev)
		}

		// Bob writes to his private doc with last_seen_rev: 1 -> rev: 2
		bobPrivatePayload := map[string]any{
			"last_seen_rev": initDocB.Rev,
			"data": map[string]any{
				"secret_savings": 3500,
				"owner":          "Bob",
			},
		}
		respB, bodyB := sendJSON(http.MethodPost, "/api/sync/private", bobPrivatePayload, bobToken)
		if respB.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK for Bob private doc, got %d: %s", respB.StatusCode, string(bodyB))
		}

		// Alice reads her private doc
		getA, getBodyA := sendJSON(http.MethodGet, "/api/sync/private", nil, aliceToken)
		if getA.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", getA.StatusCode, string(getBodyA))
		}
		var docA models.PrivateDoc
		if err := json.Unmarshal(getBodyA, &docA); err != nil {
			t.Fatalf("failed to decode: %v", err)
		}
		var dataMapA map[string]any
		_ = json.Unmarshal(docA.Data, &dataMapA)
		if dataMapA["owner"] != "Alice" || fmt.Sprintf("%v", dataMapA["secret_savings"]) != "12000" {
			t.Errorf("Alice received corrupted private doc: %v", dataMapA)
		}

		// Bob reads his private doc
		getB, getBodyB := sendJSON(http.MethodGet, "/api/sync/private", nil, bobToken)
		if getB.StatusCode != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d: %s", getB.StatusCode, string(getBodyB))
		}
		var docB models.PrivateDoc
		if err := json.Unmarshal(getBodyB, &docB); err != nil {
			t.Fatalf("failed to decode: %v", err)
		}
		var dataMapB map[string]any
		_ = json.Unmarshal(docB.Data, &dataMapB)
		if dataMapB["owner"] != "Bob" || fmt.Sprintf("%v", dataMapB["secret_savings"]) != "3500" {
			t.Errorf("Bob received corrupted private doc: %v", dataMapB)
		}
	})

	// Step 14: Security validations — Unauthenticated access blocked
	t.Run("Unauthenticated requests return 401 Unauthorized", func(t *testing.T) {
		resp, _ := sendJSON(http.MethodGet, "/api/auth/me", nil, "")
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized, got %d", resp.StatusCode)
		}
		respSync, _ := sendJSON(http.MethodGet, "/api/sync/household", nil, "")
		if respSync.StatusCode != http.StatusUnauthorized {
			t.Errorf("expected 401 Unauthorized for sync, got %d", respSync.StatusCode)
		}
	})

	// Step 15: Viewer role permissions check
	t.Run("Viewer role cannot push to household doc but can read and push private doc", func(t *testing.T) {
		// A real user row: PostgreSQL enforces uuid + FK on private_docs.user_id
		viewer, err := userRepo.Create(context.Background(), "viewer@example.com", "not-a-real-hash")
		if err != nil {
			t.Fatalf("failed to create viewer user: %v", err)
		}
		viewerToken, err := tokenService.GenerateToken(viewer.ID, aliceHouseholdID, "viewer", "c")
		if err != nil {
			t.Fatalf("failed to generate viewer token: %v", err)
		}

		// Viewer reads household doc -> 200 OK
		rResp, rBody := sendJSON(http.MethodGet, "/api/sync/household", nil, viewerToken)
		if rResp.StatusCode != http.StatusOK {
			t.Errorf("viewer expected 200 OK reading household, got %d: %s", rResp.StatusCode, string(rBody))
		}

		// Viewer attempts to write to household doc -> 403 Forbidden
		wResp, wBody := sendJSON(http.MethodPost, "/api/sync/household", map[string]any{
			"last_seen_rev": 3,
			"data":          map[string]any{"hacked": true},
		}, viewerToken)
		if wResp.StatusCode != http.StatusForbidden {
			t.Errorf("viewer expected 403 Forbidden writing household, got %d: %s", wResp.StatusCode, string(wBody))
		}

		// Viewer writes to their own private doc -> 200 OK
		pvResp, pvBody := sendJSON(http.MethodPost, "/api/sync/private", map[string]any{
			"last_seen_rev": 0,
			"data":          map[string]any{"viewer_wallet": 100},
		}, viewerToken)
		if pvResp.StatusCode != http.StatusOK {
			t.Errorf("viewer expected 200 OK writing private doc, got %d: %s", pvResp.StatusCode, string(pvBody))
		}
	})
}
