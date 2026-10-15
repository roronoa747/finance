package repository

import (
	"context"
	"io/fs"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"finance-backend/internal/db"
	"finance-backend/internal/models"
	"finance-backend/internal/testdb"
	"finance-backend/migrations"
)

// migrationsBefore is the embedded set up to (not including) the named file — a database of an
// earlier release.
func migrationsBefore(t *testing.T, name string) fstest.MapFS {
	t.Helper()
	out := fstest.MapFS{}
	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		t.Fatalf("read migrations: %v", err)
	}
	for _, e := range entries {
		if e.Name() >= name || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		data, _ := fs.ReadFile(migrations.FS, e.Name())
		out[e.Name()] = &fstest.MapFile{Data: data}
	}
	return out
}

func TestPostgresApplePayMigrationOverExistingData(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	// testdb applied everything; start again from the release before 000008 with data in it.
	if _, err := database.ExecContext(ctx, `DROP SCHEMA app CASCADE`); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if err := db.RunMigrations(ctx, database, migrationsBefore(t, "000008")); err != nil {
		t.Fatalf("migrate to 000007: %v", err)
	}
	users := NewSQLUserRepository(database)
	alice, _ := users.Create(ctx, "alice@ap.pg", "hash")
	h, _, err := NewSQLHouseholdRepository(database).CreateHousehold(ctx, "Семья", alice.ID, "Алия")
	if err != nil {
		t.Fatalf("household: %v", err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant)
		VALUES ($1, 'aaaa0001', $2, 'kaspi', '2026-09-21', -1200, 'purchase', 'Magnum')`, alice.ID, h.ID); err != nil {
		t.Fatalf("old row: %v", err)
	}

	if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
		t.Fatalf("apply 000008: %v", err)
	}
	ops, err := NewSQLStatementRepository(database).ListOperations(ctx, alice.ID, time.Time{}, 10)
	if err != nil || len(ops) != 1 || ops[0].Source != "statement" || ops[0].Deleted || ops[0].OccurredAt != nil || ops[0].FxCurrency != nil {
		t.Fatalf("old row after 000008: %+v %v", ops, err)
	}
	for _, name := range []string{"operations_phone_idx", "phone_keys_user_idx"} {
		var found int
		if err := database.QueryRow(`SELECT count(*) FROM pg_indexes WHERE schemaname = 'app' AND indexname = $1`, name).Scan(&found); err != nil || found != 1 {
			t.Errorf("index %s: %d, %v", name, found, err)
		}
	}
}

func TestPostgresApplePayTombstoneAndServerFields(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()

	// A tap written by the server (AP-03 writes it the same way).
	if _, err := f.db.ExecContext(ctx, `INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, source, occurred_at, fx_currency, fx_amount)
		VALUES ($1, 'cccc0001', $2, 'card', '2026-09-21', 0, 'purchase', 'Apple Store', 'tap', now(), 'USD', 622)`, f.aliceID, f.householdID); err != nil {
		t.Fatalf("server row: %v", err)
	}
	// The phone files it and sends the amount in tenge back: the batch keeps source and fx_*.
	back := models.Operation{ID: "cccc0001", Bank: "card", Date: "2026-09-21", Amount: -2989, Kind: "purchase",
		Merchant: "Apple Store", CategoryID: strp("sc_fun"), Source: "statement"}
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{back}); err != nil {
		t.Fatalf("upsert back: %v", err)
	}
	ops, _ := f.repo.ListOperations(ctx, f.aliceID, time.Time{}, 10)
	if len(ops) != 1 || ops[0].Source != "tap" || ops[0].OccurredAt == nil || ops[0].FxCurrency == nil || *ops[0].FxCurrency != "USD" ||
		ops[0].FxAmount == nil || *ops[0].FxAmount != 622 || ops[0].Amount != -2989 || ops[0].Deleted {
		t.Fatalf("after batch: %+v", ops)
	}
	cursor := ops[0].UpdatedAt

	// A statement replaced it: the tombstone travels the cursor with a new updated_at.
	gone := back
	gone.Deleted = true
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{gone, pgOp("aaaa0001", -1)}); err != nil {
		t.Fatalf("tombstone: %v", err)
	}
	changed, _ := f.repo.ListOperations(ctx, f.aliceID, cursor, 10)
	if len(changed) != 2 || changed[1].ID != "cccc0001" && changed[0].ID != "cccc0001" {
		t.Fatalf("cursor after tombstone: %+v", changed)
	}
	for _, op := range changed {
		if op.ID == "cccc0001" && (!op.Deleted || !op.UpdatedAt.After(cursor)) {
			t.Fatalf("tombstone: %+v", op)
		}
		if op.ID == "aaaa0001" && (op.Deleted || op.Source != "statement") {
			t.Fatalf("new batch row: %+v", op)
		}
	}

	// An old client re-sends the operation without "deleted": the tombstone stays.
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{back}); err != nil {
		t.Fatalf("resend: %v", err)
	}
	var deleted bool
	if err := f.db.QueryRow(`SELECT deleted_at IS NOT NULL FROM app.operations WHERE id = 'cccc0001'`).Scan(&deleted); err != nil || !deleted {
		t.Fatalf("tombstone resurrected: %v %v", deleted, err)
	}

	// fx_currency and fx_amount come in pairs.
	for _, q := range []string{
		`INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, fx_currency) VALUES ($1, 'dddd0001', $2, 'card', '2026-09-21', 0, 'purchase', 'X', 'USD')`,
		`INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, fx_amount) VALUES ($1, 'dddd0002', $2, 'card', '2026-09-21', 0, 'purchase', 'X', 100)`,
		`INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, fx_currency, fx_amount) VALUES ($1, 'dddd0003', $2, 'card', '2026-09-21', 0, 'purchase', 'X', 'GBP', 100)`,
		`INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, source) VALUES ($1, 'dddd0004', $2, 'card', '2026-09-21', 0, 'purchase', 'X', 'sms')`,
	} {
		if _, err := f.db.ExecContext(ctx, q, f.aliceID, f.householdID); err == nil {
			t.Errorf("CHECK let through: %s", q)
		}
	}
}

func TestPostgresApplePayKeysCascade(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	if _, err := f.db.ExecContext(ctx, `INSERT INTO app.phone_keys (key_hash, user_id) VALUES ('\x01'::bytea, $1)`, f.bobID); err != nil {
		t.Fatalf("key: %v", err)
	}
	if _, err := f.db.ExecContext(ctx, `INSERT INTO app.wallet_debug (user_id, body) VALUES ($1, 'x')`, f.bobID); err != nil {
		t.Fatalf("debug: %v", err)
	}
	if _, err := f.db.ExecContext(ctx, `INSERT INTO app.wallet_debug (user_id, body) VALUES ($1, $2)`, f.aliceID, strings.Repeat("я", 2049)); err == nil {
		t.Errorf("wallet_debug took a body over 2 KB")
	}
	if err := f.users.Delete(ctx, f.bobID); err != nil {
		t.Fatalf("delete bob: %v", err)
	}
	var keys, debug int
	_ = f.db.QueryRow(`SELECT count(*) FROM app.phone_keys`).Scan(&keys)
	_ = f.db.QueryRow(`SELECT count(*) FROM app.wallet_debug`).Scan(&debug)
	if keys != 0 || debug != 0 {
		t.Fatalf("after deleting the user: %d keys, %d debug rows", keys, debug)
	}
}

func TestPostgresPhoneKeys(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	keys := NewSQLPhoneKeyRepository(f.db)
	hash := func(b byte) []byte { return []byte{b, 0xAA} }

	if phones, last, err := keys.Status(ctx, f.aliceID); err != nil || phones != 0 || last != nil {
		t.Fatalf("empty status: %d %v %v", phones, last, err)
	}
	if _, err := keys.UserByHash(ctx, hash(1)); err != ErrPhoneKeyNotFound {
		t.Fatalf("unknown key: %v", err)
	}
	for i := byte(1); i <= 6; i++ {
		if err := keys.Add(ctx, f.aliceID, hash(i)); err != nil {
			t.Fatalf("add %d: %v", i, err)
		}
		time.Sleep(2 * time.Millisecond) // distinct created_at: "the oldest" is well defined
	}
	if err := keys.Add(ctx, f.bobID, hash(9)); err != nil {
		t.Fatalf("bob: %v", err)
	}
	// The sixth key pushed out the first; Bob's keys do not count against Alice.
	if _, err := keys.UserByHash(ctx, hash(1)); err != ErrPhoneKeyNotFound {
		t.Fatalf("oldest key survived: %v", err)
	}
	user, err := keys.UserByHash(ctx, hash(2))
	if err != nil || user != f.aliceID {
		t.Fatalf("second key: %q %v", user, err)
	}
	phones, last, err := keys.Status(ctx, f.aliceID)
	if err != nil || phones != 5 || last == nil || time.Since(*last) > time.Minute {
		t.Fatalf("status after use: %d %v %v", phones, last, err)
	}
	if err := keys.DeleteAll(ctx, f.aliceID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if phones, _, _ := keys.Status(ctx, f.aliceID); phones != 0 {
		t.Fatalf("after delete: %d", phones)
	}
	if user, err := keys.UserByHash(ctx, hash(9)); err != nil || user != f.bobID {
		t.Fatalf("Bob's key after Alice disconnected: %q %v", user, err)
	}
}
