package repository

import (
	"context"
	"testing"
	"time"

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

// A phone that did not pull sends its old copy with the base it last saw. The server's row is newer, so
// the server's category, note and "internal" stay, even when the old copy has another non-null category.
func TestPostgresBatchStaleBaseKeepsServerFields(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	op := pgOp("bbbb0002", -5000) // sc_food
	first, err := f.repo.UpsertOperationsChecked(ctx, f.aliceID, f.householdID, []models.Operation{op})
	if err != nil || len(first.Accepted) != 1 {
		t.Fatalf("first write: %+v %v", first, err)
	}
	base := first.At // what the phone saw

	// Another writer (the server side, another device) re-sorts the line later.
	time.Sleep(20 * time.Millisecond)
	later := op
	later.CategoryID = strp("sc_pets")
	later.Note = strp("корм")
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{later}); err != nil {
		t.Fatal(err)
	}

	// The phone sends its old non-null category with the old base.
	stale := op
	stale.CategoryID = strp("sc_cafe")
	stale.BaseUpdatedAt = &base
	res, err := f.repo.UpsertOperationsChecked(ctx, f.aliceID, f.householdID, []models.Operation{stale})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Accepted) != 0 {
		t.Fatalf("a stale line was reported accepted: %v", res.Accepted)
	}
	got := opsByID(t, f, f.aliceID)["bbbb0002"]
	if got.CategoryID == nil || *got.CategoryID != "sc_pets" || got.Note == nil || *got.Note != "корм" {
		t.Fatalf("a stale copy overwrote the server's category/note: %v %v", got.CategoryID, got.Note)
	}

	// With the current base (what the phone saw after a pull) its change goes through and is accepted.
	cur := got.UpdatedAt
	fresh := op
	fresh.CategoryID = strp("sc_home")
	fresh.BaseUpdatedAt = &cur
	res, err = f.repo.UpsertOperationsChecked(ctx, f.aliceID, f.householdID, []models.Operation{fresh})
	if err != nil || len(res.Accepted) != 1 {
		t.Fatalf("a current-base change was refused: %+v %v", res, err)
	}
	if got := opsByID(t, f, f.aliceID)["bbbb0002"]; got.CategoryID == nil || *got.CategoryID != "sc_home" {
		t.Fatalf("current-base change lost: %v", got.CategoryID)
	}

	// The time returned after a write is the new base: a second edit with it is not stale.
	again := op
	again.CategoryID = strp("sc_fun")
	again.BaseUpdatedAt = &res.At
	res2, err := f.repo.UpsertOperationsChecked(ctx, f.aliceID, f.householdID, []models.Operation{again})
	if err != nil || len(res2.Accepted) != 1 {
		t.Fatalf("an edit on the returned base was refused: %+v %v", res2, err)
	}

	// No base (old client, new line): as before, the batch wins.
	nobase := op
	nobase.CategoryID = strp("sc_travel")
	if r, err := f.repo.UpsertOperationsChecked(ctx, f.aliceID, f.householdID, []models.Operation{nobase}); err != nil || len(r.Accepted) != 1 {
		t.Fatalf("a batch without base was refused: %+v %v", r, err)
	}
}
