package repository

import (
	"context"
	"testing"

	"finance-backend/internal/models"
)

// A batch from a phone that missed a pull carries no category for a line the server already
// sorted: the sorted category stays. Moving the line to "internal" still clears it.
func TestPostgresBatchKeepsServerCategoryAgainstStaleNull(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	op := pgOp("bbbb0001", -5000) // sc_food
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{op}); err != nil {
		t.Fatal(err)
	}
	stale := op
	stale.CategoryID = nil
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{stale}); err != nil {
		t.Fatal(err)
	}
	got := opsByID(t, f, f.aliceID)["bbbb0001"]
	if got.CategoryID == nil || *got.CategoryID != "sc_food" {
		t.Fatalf("a stale batch wiped the category: %v", got.CategoryID)
	}
	// A real change of category still goes through.
	changed := op
	changed.CategoryID = strp("sc_home")
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{changed}); err != nil {
		t.Fatal(err)
	}
	if got := opsByID(t, f, f.aliceID)["bbbb0001"]; got.CategoryID == nil || *got.CategoryID != "sc_home" {
		t.Fatalf("category change lost: %v", got.CategoryID)
	}
	// Moving to internal clears it on purpose.
	internal := op
	internal.CategoryID = nil
	internal.Internal = true
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{internal}); err != nil {
		t.Fatal(err)
	}
	if got := opsByID(t, f, f.aliceID)["bbbb0001"]; got.CategoryID != nil || !got.Internal {
		t.Fatalf("internal move did not clear the category: %v internal=%v", got.CategoryID, got.Internal)
	}
}
