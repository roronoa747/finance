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
