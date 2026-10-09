package repository

import (
	"context"
	"errors"
	"testing"

	"finance-backend/internal/testdb"
)

// B2C-22: a Google user has no password; google_sub is unique; an old user is linked by email.
func TestPostgresGoogleUsers(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)

	dana, err := users.CreateGoogle(ctx, "Dana@Example.com", "sub-dana", "Дана")
	if err != nil {
		t.Fatalf("create google user: %v", err)
	}
	if dana.Email != "dana@example.com" || dana.PasswordHash != "" || dana.GoogleSub != "sub-dana" || dana.DisplayName != "Дана" {
		t.Errorf("google user = %+v", dana)
	}
	var hashIsNull bool
	if err := database.QueryRowContext(ctx, `SELECT password_hash IS NULL FROM app.users WHERE id = $1`, dana.ID).Scan(&hashIsNull); err != nil || !hashIsNull {
		t.Errorf("password_hash NULL = %v (%v)", hashIsNull, err)
	}
	found, err := users.GetByGoogleSub(ctx, "sub-dana")
	if err != nil || found.ID != dana.ID {
		t.Errorf("by sub: %+v %v", found, err)
	}
	if _, err := users.GetByGoogleSub(ctx, "nobody"); !errors.Is(err, ErrUserNotFound) {
		t.Errorf("unknown sub: %v", err)
	}

	// A user without a password can create a household (B2C-23).
	if _, _, err := NewSQLHouseholdRepository(database).CreateHousehold(ctx, "", dana.ID, "Дана"); err != nil {
		t.Errorf("household of a passwordless user: %v", err)
	}

	// Link: an old password user, the name fills only an empty one.
	old, err := users.Create(ctx, "ilyas@example.com", "hash")
	if err != nil {
		t.Fatal(err)
	}
	linked, err := users.LinkGoogle(ctx, old.ID, "sub-ilyas", "Ильяс")
	if err != nil || linked.GoogleSub != "sub-ilyas" || linked.DisplayName != "Ильяс" || linked.PasswordHash != "hash" {
		t.Fatalf("link: %+v %v", linked, err)
	}
	if again, _ := users.LinkGoogle(ctx, old.ID, "sub-ilyas", "Другое"); again.DisplayName != "Ильяс" {
		t.Errorf("link must not overwrite the name: %q", again.DisplayName)
	}

	// google_sub is unique: neither a new user nor a link may reuse it.
	if _, err := users.CreateGoogle(ctx, "other@example.com", "sub-dana", ""); !errors.Is(err, ErrUserAlreadyExists) {
		t.Errorf("duplicate sub on create: %v", err)
	}
	if _, err := users.LinkGoogle(ctx, old.ID, "sub-dana", ""); !errors.Is(err, ErrUserAlreadyExists) {
		t.Errorf("duplicate sub on link: %v", err)
	}
	if _, err := users.CreateGoogle(ctx, "ILYAS@example.com", "sub-x", ""); !errors.Is(err, ErrUserAlreadyExists) {
		t.Errorf("duplicate email on google create: %v", err)
	}
	if _, err := users.LinkGoogle(ctx, "00000000-0000-0000-0000-000000000000", "sub-y", ""); !errors.Is(err, ErrUserNotFound) {
		t.Errorf("link of a missing user: %v", err)
	}
}

// B2C-23: one household per user — creating a second one or joining another by code fails,
// and two concurrent "Создать семью" make one household.
func TestPostgresOneHouseholdPerUser(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)

	u, _ := users.CreateGoogle(ctx, "one@example.com", "sub-one", "")
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, _, err := households.CreateHousehold(ctx, "", u.ID, "Один")
			results <- err
		}()
	}
	var ok, already int
	for range 2 {
		switch err := <-results; {
		case err == nil:
			ok++
		case errors.Is(err, ErrAlreadyInHousehold):
			already++
		default:
			t.Fatalf("concurrent create: %v", err)
		}
	}
	if ok != 1 || already != 1 {
		t.Errorf("concurrent creates: %d ok, %d already", ok, already)
	}
	var count int
	_ = database.QueryRowContext(ctx, `SELECT count(*) FROM app.household_members WHERE user_id = $1`, u.ID).Scan(&count)
	if count != 1 {
		t.Errorf("memberships = %d", count)
	}

	owner, _ := users.CreateGoogle(ctx, "owner@example.com", "sub-owner", "")
	h, _, err := households.CreateHousehold(ctx, "", owner.ID, "Владелец")
	if err != nil {
		t.Fatal(err)
	}
	inv, _ := households.CreateInvite(ctx, h.ID, owner.ID)
	if _, err := households.JoinHousehold(ctx, inv.Code, u.ID, "Один"); !errors.Is(err, ErrAlreadyInHousehold) {
		t.Errorf("join from a household: %v", err)
	}
	// The code is still unused after the refusal.
	free, _ := users.CreateGoogle(ctx, "free@example.com", "sub-free", "")
	if m, err := households.JoinHousehold(ctx, inv.Code, free.ID, "Партнёр"); err != nil || m.Slot != "b" {
		t.Errorf("join without a household: %+v %v", m, err)
	}
	// Joining your own household again stays idempotent.
	if m, err := households.JoinHousehold(ctx, inv.Code, free.ID, "Партнёр"); err != nil && !errors.Is(err, ErrInviteAlreadyUsed) {
		t.Errorf("rejoin: %+v %v", m, err)
	}
}
