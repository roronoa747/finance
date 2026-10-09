package repository

import (
	"context"
	"fmt"
	"testing"

	"finance-backend/internal/models"
)

// fillUser gives a member a photo, an upload with an operation and a private doc edit.
func fillUser(t *testing.T, f statementFixture, userID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := NewSQLPhotoRepository(f.db).Create(ctx, f.householdID, userID, PhotoInput{ContentType: "image/webp", Data: []byte("RIFF....WEBPVP8 ")}); err != nil {
		t.Fatalf("photo: %v", err)
	}
	up, err := f.repo.CreateUpload(ctx, f.householdID, userID, UploadInput{Bank: "kaspi", PeriodFrom: "2026-09-01", PeriodTo: "2026-09-30", OpsCount: 1})
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	op := pgOp(userID[:8], -1000) // ids are hex fingerprints
	op.UploadID = &up.ID
	if _, err := f.repo.UpsertOperations(ctx, userID, f.householdID, []models.Operation{op}); err != nil {
		t.Fatalf("operations: %v", err)
	}
}

func countRows(t *testing.T, f statementFixture, query string, arg string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(), query, arg).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// userTables are every place a user's own rows live (migrations 000001–000005).
var userTables = []string{
	`SELECT count(*) FROM app.users WHERE id = $1`,
	`SELECT count(*) FROM app.household_members WHERE user_id = $1`,
	`SELECT count(*) FROM app.private_docs WHERE user_id = $1`,
	`SELECT count(*) FROM app.operations WHERE user_id = $1`,
	`SELECT count(*) FROM app.statement_uploads WHERE user_id = $1`,
	`SELECT count(*) FROM app.photos WHERE user_id = $1`,
	`SELECT count(*) FROM app.household_invites WHERE created_by = $1 OR used_by = $1`,
	`SELECT count(*) FROM app.households WHERE created_by = $1`,
	`SELECT count(*) FROM app.household_docs WHERE updated_by = $1`,
}

func TestPostgresDeleteAccount(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	fillUser(t, f, f.aliceID)
	fillUser(t, f, f.bobID)
	if _, _, err := NewSQLDocRepository(f.db).PushHouseholdDoc(ctx, f.householdID, 1, []byte(`{"goals":[{"id":"g1"}]}`), f.aliceID); err != nil {
		t.Fatalf("push: %v", err)
	}
	accounts := NewSQLAccountRepository(f.db)

	// Alice created the household and leaves first: Bob keeps it and becomes its creator.
	if err := accounts.DeleteAccount(ctx, f.aliceID); err != nil {
		t.Fatalf("delete alice: %v", err)
	}
	for _, q := range userTables {
		if n := countRows(t, f, q, f.aliceID); n != 0 {
			t.Errorf("%s → %d after deletion", q, n)
		}
	}
	var createdBy string
	_ = f.db.QueryRowContext(ctx, `SELECT created_by FROM app.households WHERE id = $1`, f.householdID).Scan(&createdBy)
	if createdBy != f.bobID {
		t.Errorf("created_by = %s, want Bob", createdBy)
	}
	doc, err := NewSQLDocRepository(f.db).GetHouseholdDoc(ctx, f.householdID)
	if err != nil || doc.Rev != 2 || string(doc.Data) != `{"goals": [{"id": "g1"}]}` {
		t.Errorf("household doc after the partner left: %+v %v", doc, err)
	}
	if n := countRows(t, f, `SELECT count(*) FROM app.operations WHERE user_id = $1`, f.bobID); n != 1 {
		t.Errorf("Bob's operations: %d", n)
	}

	// Bob is the last: the household goes whole.
	if err := accounts.DeleteAccount(ctx, f.bobID); err != nil {
		t.Fatalf("delete bob: %v", err)
	}
	for _, table := range []string{"household_members", "household_docs", "private_docs", "household_invites", "statement_uploads", "operations", "photos"} {
		if n := countRows(t, f, `SELECT count(*) FROM app.`+table+` WHERE household_id = $1`, f.householdID); n != 0 {
			t.Errorf("app.%s of the deleted household: %d", table, n)
		}
	}
	if n := countRows(t, f, `SELECT count(*) FROM app.households WHERE id = $1`, f.householdID); n != 0 {
		t.Errorf("household survived its last member")
	}
	// Deleting a missing user is not an error.
	if err := accounts.DeleteAccount(ctx, f.bobID); err != nil {
		t.Errorf("repeated deletion: %v", err)
	}
}

// В-1: the leaver's person stays in the shared document, so a newcomer by code gets
// a fresh slot, not the leaver's record. A document without people does not hold slots.
func TestPostgresJoinSkipsLeaverSlot(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	households := NewSQLHouseholdRepository(f.db)
	docs := NewSQLDocRepository(f.db)
	people := `{"people":[{"id":"a","name":"Алия","onboardedAt":"2026-10-01T00:00:00Z"},{"id":"b","name":"Бекзат"},"x",{"name":"без id"}]}`
	if _, _, err := docs.PushHouseholdDoc(ctx, f.householdID, 1, []byte(people), f.aliceID); err != nil {
		t.Fatalf("push: %v", err)
	}
	if err := NewSQLAccountRepository(f.db).DeleteAccount(ctx, f.aliceID); err != nil {
		t.Fatalf("delete alice: %v", err)
	}

	carol, _ := f.users.Create(ctx, "carol@st.pg", "hash")
	inv, _ := households.CreateInvite(ctx, f.householdID, f.bobID)
	m, err := households.JoinHousehold(ctx, inv.Code, carol.ID, "Каршыга")
	if err != nil || m.Slot != "c" {
		t.Fatalf("newcomer after the leaver: %+v %v, want slot c", m, err)
	}
	dan, _ := f.users.Create(ctx, "dan@st.pg", "hash")
	inv2, _ := households.CreateInvite(ctx, f.householdID, f.bobID)
	if _, err := households.JoinHousehold(ctx, inv2.Code, dan.ID, "Дан"); err != ErrHouseholdFull {
		t.Fatalf("fourth: %v, want ErrHouseholdFull", err)
	}

	// A household whose document has no people (or a non-array) frees the leaver's slot as before.
	if _, _, err := docs.PushHouseholdDoc(ctx, f.householdID, 2, []byte(`{"people":{"a":1}}`), f.bobID); err != nil {
		t.Fatalf("push 2: %v", err)
	}
	inv3, _ := households.CreateInvite(ctx, f.householdID, f.bobID)
	if m, err := households.JoinHousehold(ctx, inv3.Code, dan.ID, "Дан"); err != nil || m.Slot != "a" {
		t.Fatalf("without people: %+v %v, want slot a", m, err)
	}
}

// Both partners delete at once: both succeed and nothing is left.
func TestPostgresDeleteAccountConcurrent(t *testing.T) {
	for round := range 5 {
		t.Run(fmt.Sprint(round), func(t *testing.T) {
			f := newStatementFixture(t)
			accounts := NewSQLAccountRepository(f.db)
			errs := make(chan error, 2)
			for _, id := range []string{f.aliceID, f.bobID} {
				go func() { errs <- accounts.DeleteAccount(context.Background(), id) }()
			}
			for range 2 {
				if err := <-errs; err != nil {
					t.Fatalf("concurrent deletion: %v", err)
				}
			}
			if n := countRows(t, f, `SELECT count(*) FROM app.households WHERE id = $1`, f.householdID); n != 0 {
				t.Errorf("household left after both deleted")
			}
		})
	}
}
