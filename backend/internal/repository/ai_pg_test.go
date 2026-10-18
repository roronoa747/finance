package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"finance-backend/internal/testdb"
)

func TestPostgresAIFlagAndUsage(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)
	accounts := NewSQLAccountRepository(database)
	repo := NewSQLAIRepository(database)

	u, err := users.CreateGoogle(ctx, "ai@example.com", "sub-ai", "ai")
	if err != nil {
		t.Fatal(err)
	}
	h, _, err := households.CreateHousehold(ctx, "", u.ID, "ai")
	if err != nil {
		t.Fatal(err)
	}

	// Off by default; the flag round-trips.
	if on, err := repo.Enabled(ctx, h.ID); err != nil || on {
		t.Fatalf("default flag = %v, %v; want false", on, err)
	}
	if err := repo.SetEnabled(ctx, h.ID, true); err != nil {
		t.Fatal(err)
	}
	if on, _ := repo.Enabled(ctx, h.ID); !on {
		t.Fatal("flag not set")
	}
	if err := repo.SetEnabled(ctx, "00000000-0000-0000-0000-000000000000", true); !errors.Is(err, ErrHouseholdNotFound) {
		t.Fatalf("unknown family: %v", err)
	}
	if on, err := repo.Enabled(ctx, "00000000-0000-0000-0000-000000000000"); err != nil || on {
		t.Fatalf("unknown family flag = %v, %v", on, err)
	}

	// Counters add up within a month; another month is its own row.
	if n, err := repo.Spent(ctx, h.ID, "2026-10"); err != nil || n != 0 {
		t.Fatalf("no row = %d, %v", n, err)
	}
	for i := 0; i < 2; i++ {
		if err := repo.AddUsage(ctx, h.ID, "2026-10", 1, 100, 20, 800); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.AddUsage(ctx, h.ID, "2026-11", 1, 5, 5, 1); err != nil {
		t.Fatal(err)
	}
	var req int
	var in, out, cost int64
	if err := database.QueryRowContext(ctx,
		`SELECT requests, input_tokens, output_tokens, cost_micros FROM app.ai_usage WHERE household_id = $1 AND month = '2026-10'`,
		h.ID).Scan(&req, &in, &out, &cost); err != nil {
		t.Fatal(err)
	}
	if req != 2 || in != 200 || out != 40 || cost != 1600 {
		t.Errorf("2026-10 = %d/%d/%d/%d, want 2/200/40/1600", req, in, out, cost)
	}
	// Spent is the month's cost_micros — a billed failure (0 requests) counts too (Р-11).
	if n, _ := repo.Spent(ctx, h.ID, "2026-10"); n != 1600 {
		t.Errorf("2026-10 spent = %d, want 1600", n)
	}
	if err := repo.AddUsage(ctx, h.ID, "2026-11", 0, 5, 5, 4); err != nil {
		t.Fatal(err)
	}
	if n, _ := repo.Spent(ctx, h.ID, "2026-11"); n != 5 {
		t.Errorf("2026-11 spent = %d, want 5", n)
	}

	// Deleting the family (its only member leaves) takes the counters along.
	if err := accounts.DeleteAccount(ctx, u.ID); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM app.ai_usage WHERE household_id = $1`, h.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("ai_usage rows after deleting the family = %d", left)
	}
}

func TestPostgresAIFamilies(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)
	repo := NewSQLAIRepository(database)

	mk := func(email string) string {
		u, err := users.CreateGoogle(ctx, email, "sub-"+email, email)
		if err != nil {
			t.Fatal(err)
		}
		return u.ID
	}
	a1, a2, b1 := mk("aigul@example.com"), mk("ilyas@example.com"), mk("bota@example.com")
	hOld, _, err := households.CreateHousehold(ctx, "", a1, "a")
	if err != nil {
		t.Fatal(err)
	}
	inv, err := households.CreateInvite(ctx, hOld.ID, a1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := households.JoinHousehold(ctx, inv.Code, a2, "b"); err != nil {
		t.Fatal(err)
	}
	hNew, _, err := households.CreateHousehold(ctx, "", b1, "c")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `UPDATE app.households SET created_at = now() - interval '10 days' WHERE id = $1`, hOld.ID); err != nil {
		t.Fatal(err)
	}

	// Both off: newest first.
	fams, err := repo.Families(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	if len(fams) != 2 || fams[0].ID != hNew.ID || fams[1].ID != hOld.ID {
		t.Fatalf("off order = %+v", fams)
	}

	// The older one gets AI and spend: it moves up; another month's spend stays out.
	if err := repo.SetEnabled(ctx, hOld.ID, true); err != nil {
		t.Fatal(err)
	}
	_ = repo.AddUsage(ctx, hOld.ID, "2026-10", 2, 100, 10, 300)
	_ = repo.AddUsage(ctx, hOld.ID, "2026-10", 1, 50, 5, 120)
	_ = repo.AddUsage(ctx, hOld.ID, "2026-09", 7, 1, 1, 9999)
	fams, err = repo.Families(ctx, "2026-10")
	if err != nil {
		t.Fatal(err)
	}
	top, other := fams[0], fams[1]
	if top.ID != hOld.ID || !top.AI || top.Requests != 3 || top.CostMicros != 420 || top.Month != "2026-10" {
		t.Errorf("top = %+v", top)
	}
	if fmt.Sprint(top.Emails) != "[aigul@example.com ilyas@example.com]" {
		t.Errorf("emails by slot = %v", top.Emails)
	}
	if other.ID != hNew.ID || other.AI || other.Requests != 0 || other.CostMicros != 0 || fmt.Sprint(other.Emails) != "[bota@example.com]" {
		t.Errorf("other = %+v", other)
	}
}
