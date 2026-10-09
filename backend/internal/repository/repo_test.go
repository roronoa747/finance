package repository

import (
	"context"
	"encoding/json"
	"testing"
)

func TestUserRepository(t *testing.T) {
	ctx := context.Background()
	repo := NewMockUserRepo()

	// 1. Create user
	user, err := repo.Create(ctx, "test@example.com", "hashed_password")
	if err != nil {
		t.Fatalf("failed to create user: %v", err)
	}
	if user.ID == "" {
		t.Fatal("expected non-empty user ID")
	}
	if user.Email != "test@example.com" {
		t.Errorf("expected email 'test@example.com', got %s", user.Email)
	}

	// 2. Duplicate email should fail
	_, err = repo.Create(ctx, "test@example.com", "other_hash")
	if err == nil {
		t.Fatal("expected error on duplicate email, got nil")
	}

	// 3. Find by email
	foundByEmail, err := repo.GetByEmail(ctx, "TEST@example.com")
	if err != nil {
		t.Fatalf("failed to find user by email: %v", err)
	}
	if foundByEmail.ID != user.ID {
		t.Errorf("expected ID %s, got %s", user.ID, foundByEmail.ID)
	}

	// 4. Find by ID
	foundByID, err := repo.GetByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("failed to find user by ID: %v", err)
	}
	if foundByID.Email != user.Email {
		t.Errorf("expected email %s, got %s", user.Email, foundByID.Email)
	}

	// 5. Non-existent user
	_, err = repo.GetByID(ctx, "non-existent")
	if err == nil {
		t.Fatal("expected error for non-existent user, got nil")
	}

	// 6. Delete user
	if err := repo.Delete(ctx, user.ID); err != nil {
		t.Fatalf("failed to delete user: %v", err)
	}
	_, err = repo.GetByID(ctx, user.ID)
	if err == nil {
		t.Fatal("expected user to be deleted, but was found")
	}
}

func TestHouseholdRepository(t *testing.T) {
	ctx := context.Background()
	docRepo := NewMockDocRepo()
	hRepo := NewMockHouseholdRepo()
	hRepo.SetDocRepo(docRepo)

	creatorID := "user-1"
	h, member, err := hRepo.CreateHousehold(ctx, "Семья Ивановых", creatorID, "Алиса")
	if err != nil {
		t.Fatalf("failed to create household: %v", err)
	}

	if h.ID == "" {
		t.Fatal("expected non-empty household ID")
	}
	if member.Slot != "a" {
		t.Errorf("expected creator slot 'a', got %s", member.Slot)
	}
	if member.Role != "member" {
		t.Errorf("expected creator role 'member', got %s", member.Role)
	}

	// Check membership
	m, hh, err := hRepo.GetMembership(ctx, creatorID)
	if err != nil {
		t.Fatalf("failed to get membership: %v", err)
	}
	if hh.ID != h.ID || m.Slot != "a" {
		t.Errorf("membership mismatch: hh=%s, slot=%s", hh.ID, m.Slot)
	}

	// Create invite
	inv, err := hRepo.CreateInvite(ctx, h.ID, creatorID)
	if err != nil {
		t.Fatalf("failed to create invite: %v", err)
	}
	if len(inv.Code) != 8 {
		t.Errorf("expected 8-char code, got %s", inv.Code)
	}

	// Partner joins via invite
	partnerID := "user-2"
	partnerMember, err := hRepo.JoinHousehold(ctx, inv.Code, partnerID, "Боб")
	if err != nil {
		t.Fatalf("partner failed to join: %v", err)
	}
	if partnerMember.Slot != "b" {
		t.Errorf("expected partner slot 'b', got %s", partnerMember.Slot)
	}

	// Invite cannot be used twice
	_, err = hRepo.JoinHousehold(ctx, inv.Code, "user-3", "Чарли")
	if err == nil {
		t.Fatal("expected error on reusing invite, got nil")
	}

	// A second code does not let in a third full member (review backend Block 4, Н-3).
	inv2, err := hRepo.CreateInvite(ctx, h.ID, creatorID)
	if err != nil {
		t.Fatalf("failed to create second invite: %v", err)
	}
	_, err = hRepo.JoinHousehold(ctx, inv2.Code, "user-3", "Чарли")
	if err != ErrHouseholdFull {
		t.Fatalf("third member: expected ErrHouseholdFull, got %v", err)
	}
}

// В-1: a member who deleted their account leaves their person in the shared document;
// a newcomer by code gets a fresh slot instead of the leaver's record.
func TestJoinSkipsLeaverSlot(t *testing.T) {
	ctx := context.Background()
	repos := NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	accounts := NewMockAccountRepo(repos)

	h, _, _ := repos.Households.CreateHousehold(ctx, "Семья", "dana", "Дана")
	inv, _ := repos.Households.CreateInvite(ctx, h.ID, "dana")
	if m, err := repos.Households.JoinHousehold(ctx, inv.Code, "aru", "Ару"); err != nil || m.Slot != "b" {
		t.Fatalf("partner: %+v %v", m, err)
	}
	// Junk around the people is ignored; only objects with an id hold a slot.
	people := `{"people":[{"id":"a","name":"Дана","onboardedAt":"2026-10-01T00:00:00Z"},{"id":"b","name":"Ару"},"x",{"name":"без id"}]}`
	if _, _, err := repos.Docs.PushHouseholdDoc(ctx, h.ID, 1, []byte(people), "dana"); err != nil {
		t.Fatalf("push: %v", err)
	}
	if err := accounts.DeleteAccount(ctx, "dana"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	inv2, _ := repos.Households.CreateInvite(ctx, h.ID, "aru")
	m, err := repos.Households.JoinHousehold(ctx, inv2.Code, "bek", "Бек")
	if err != nil || m.Slot != "c" {
		t.Fatalf("newcomer after the leaver: %+v %v, want slot c", m, err)
	}
	// Two members again: the family is full.
	inv3, _ := repos.Households.CreateInvite(ctx, h.ID, "aru")
	if _, err := repos.Households.JoinHousehold(ctx, inv3.Code, "dan", "Дан"); err != ErrHouseholdFull {
		t.Fatalf("fourth: %v, want ErrHouseholdFull", err)
	}
}

// A tombstoned person (deletedAt) still holds the slot: in mergeDocs the tombstone beats any
// later edit, so a newcomer on that slot would lose their own person on the next sync.
func TestJoinTombstonedPersonHoldsSlot(t *testing.T) {
	ctx := context.Background()
	repos := NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)

	h, _, _ := repos.Households.CreateHousehold(ctx, "Семья", "dana", "Дана")
	people := `{"people":[{"id":"a","name":"Дана"},{"id":"b","name":"Ару","deletedAt":"2026-10-01T00:00:00Z"}]}`
	if _, _, err := repos.Docs.PushHouseholdDoc(ctx, h.ID, 1, []byte(people), "dana"); err != nil {
		t.Fatalf("push: %v", err)
	}
	inv, _ := repos.Households.CreateInvite(ctx, h.ID, "dana")
	if m, err := repos.Households.JoinHousehold(ctx, inv.Code, "bek", "Бек"); err != nil || m.Slot != "c" {
		t.Fatalf("newcomer next to a tombstone: %+v %v, want slot c", m, err)
	}
}

func TestDocRepositoryOptimisticLock(t *testing.T) {
	ctx := context.Background()
	docRepo := NewMockDocRepo()
	hID := "hh-100"
	u1 := "u-1"

	// Initialize docs
	err := docRepo.InitDocs(hID, u1)
	if err != nil {
		t.Fatalf("failed to init docs: %v", err)
	}

	// 1. Get initial doc (rev = 1)
	doc, err := docRepo.GetHouseholdDoc(ctx, hID)
	if err != nil {
		t.Fatalf("failed to get household doc: %v", err)
	}
	if doc.Rev != 1 {
		t.Errorf("expected rev 1, got %d", doc.Rev)
	}

	// 2. Push update with matching rev 1 -> should succeed, rev becomes 2
	payload1 := json.RawMessage(`{"accounts":[{"id":"a1","name":"Main","balance":50000}]}`)
	updatedDoc, conflict, err := docRepo.PushHouseholdDoc(ctx, hID, 1, payload1, u1)
	if err != nil || conflict {
		t.Fatalf("expected push to succeed, conflict=%v, err=%v", conflict, err)
	}
	if updatedDoc.Rev != 2 {
		t.Errorf("expected rev 2, got %d", updatedDoc.Rev)
	}

	// 3. Stale push with rev 1 -> should trigger CONFLICT, returning current server state
	payloadStale := json.RawMessage(`{"accounts":[]}`)
	conflictDoc, conflict, err := docRepo.PushHouseholdDoc(ctx, hID, 1, payloadStale, "u-2")
	if err != nil {
		t.Fatalf("unexpected error on conflict: %v", err)
	}
	if !conflict {
		t.Fatal("expected conflict=true, got false")
	}
	if conflictDoc.Rev != 2 {
		t.Errorf("expected conflict doc rev 2, got %d", conflictDoc.Rev)
	}

	// 4. Private doc push and optimistic locking
	privDoc, err := docRepo.GetPrivateDoc(ctx, hID, u1)
	if err != nil {
		t.Fatalf("failed to get private doc: %v", err)
	}
	if privDoc.Rev != 1 {
		t.Errorf("expected private doc rev 1, got %d", privDoc.Rev)
	}

	privPayload := json.RawMessage(`{"secret_gift":"Ring"}`)
	updatedPriv, conflict, err := docRepo.PushPrivateDoc(ctx, hID, u1, 1, privPayload)
	if err != nil || conflict {
		t.Fatalf("failed to push private doc: %v", err)
	}
	if updatedPriv.Rev != 2 {
		t.Errorf("expected rev 2, got %d", updatedPriv.Rev)
	}
}

func TestJSONBSerialization(t *testing.T) {
	type BudgetDocData struct {
		Month    string `json:"month"`
		Incomes  []int  `json:"incomes"`
		Expenses []int  `json:"expenses"`
	}

	sample := BudgetDocData{
		Month:    "2026-09",
		Incomes:  []int{500000, 350000},
		Expenses: []int{150000, 80000},
	}

	rawBytes, err := json.Marshal(sample)
	if err != nil {
		t.Fatalf("failed to marshal JSON: %v", err)
	}

	var parsed BudgetDocData
	if err := json.Unmarshal(rawBytes, &parsed); err != nil {
		t.Fatalf("failed to unmarshal JSON: %v", err)
	}

	if parsed.Month != "2026-09" || len(parsed.Incomes) != 2 || parsed.Incomes[0] != 500000 {
		t.Errorf("parsed JSON data mismatch: %+v", parsed)
	}
}
