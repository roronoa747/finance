package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"finance-backend/internal/db"
	"finance-backend/internal/models"
	"finance-backend/internal/testdb"
	"finance-backend/migrations"
)

// repeatOnly: the 2-minute repeat of Блок 1, no tap-and-push merge, no transfer pairs.
var repeatOnly = PhoneWindows{Repeat: 2 * time.Minute}

// phoneWindows: the rules of Блок 2 (handlers: tapRepeat, phonePair).
var phoneWindows = PhoneWindows{Repeat: 2 * time.Minute, Pair: 10 * time.Minute}

func opsByID(t *testing.T, f statementFixture, userID string) map[string]models.Operation {
	t.Helper()
	ops, err := f.repo.ListOperations(context.Background(), userID, time.Time{}, 100)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]models.Operation{}
	for _, o := range ops {
		out[o.ID] = o
	}
	return out
}

// Р-21: a tap and a push of one purchase are one operation in any order; the push names the
// bank, the tap the merchant; the section is cleared when the merchant changes.
func TestPostgresPhoneMergeTapAndPush(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	insert := func(op PhoneOperation) PhoneInsert {
		t.Helper()
		done, err := f.repo.InsertPhoneOperation(ctx, f.aliceID, f.householdID, op, phoneWindows)
		if err != nil {
			t.Fatalf("insert %s: %v", op.ID, err)
		}
		return done
	}

	// Tap, then the push 3 minutes later.
	insert(PhoneOperation{ID: "a0000000000000a1", Bank: "card", Date: "2026-10-16", Amount: -2500, Merchant: "Small", Source: "tap", OccurredAt: now})
	if done := insert(PhoneOperation{ID: "a0000000000000a2", Bank: "kaspi", Date: "2026-10-16", Amount: -2500, Merchant: "SMALL 7",
		Kind: "purchase", Source: "push", OccurredAt: now.Add(3 * time.Minute)}); done != PhoneMerged {
		t.Fatalf("push after tap: %s", done)
	}
	ops := opsByID(t, f, f.aliceID)
	if len(ops) != 1 || ops["a0000000000000a1"].Bank != "kaspi" || ops["a0000000000000a1"].Merchant != "Small" || ops["a0000000000000a1"].Source != "tap" {
		t.Fatalf("merged: %+v", ops)
	}

	// Push, then a tap without a merchant: the push's merchant stays. The section the phone set
	// on the push stays too (the merchant did not change).
	insert(PhoneOperation{ID: "b0000000000000b1", Bank: "kaspi", Date: "2026-10-16", Amount: -900, Merchant: "COFFEE BOOM",
		Kind: "purchase", Source: "push", OccurredAt: now.Add(time.Hour)})
	if _, err := f.db.Exec(`UPDATE app.operations SET category_id = 'sc_food' WHERE id = 'b0000000000000b1'`); err != nil {
		t.Fatal(err)
	}
	if done := insert(PhoneOperation{ID: "b0000000000000b2", Bank: "card", Date: "2026-10-16", Amount: -900, Merchant: "Apple Pay",
		Source: "tap", OccurredAt: now.Add(time.Hour - time.Minute)}); done != PhoneMerged {
		t.Fatalf("tap before push (arrived later): %s", done)
	}
	if o := opsByID(t, f, f.aliceID)["b0000000000000b1"]; o.Merchant != "COFFEE BOOM" || o.CategoryID == nil || o.Bank != "kaspi" {
		t.Fatalf("push + empty tap: %+v", o)
	}
	// A tap with a merchant renames the push and clears its section (the phone files it again).
	insert(PhoneOperation{ID: "c0000000000000c1", Bank: "kaspi", Date: "2026-10-16", Amount: -1200, Merchant: "Покупка",
		Kind: "purchase", Source: "push", OccurredAt: now.Add(2 * time.Hour)})
	_, _ = f.db.Exec(`UPDATE app.operations SET category_id = 'sc_food' WHERE id = 'c0000000000000c1'`)
	insert(PhoneOperation{ID: "c0000000000000c2", Bank: "card", Date: "2026-10-16", Amount: -1200, Merchant: "Magnum", Source: "tap",
		OccurredAt: now.Add(2*time.Hour + time.Minute)})
	if o := opsByID(t, f, f.aliceID)["c0000000000000c1"]; o.Merchant != "Magnum" || o.CategoryID != nil {
		t.Fatalf("renamed push: %+v", o)
	}

	// 11 minutes apart, another amount, a tombstone, a transfer — no merge.
	for i, op := range []PhoneOperation{
		{Amount: -2500, Source: "push", Kind: "purchase", OccurredAt: now.Add(11 * time.Minute)},
		{Amount: -2501, Source: "push", Kind: "purchase", OccurredAt: now.Add(time.Minute)},
		{Amount: -2500, Source: "push", Kind: "transfer-out", OccurredAt: now.Add(4 * time.Minute)},
	} {
		op.ID, op.Bank, op.Date, op.Merchant = fmt.Sprintf("d00000000000000%d", i), "kaspi", "2026-10-16", "X"
		if done := insert(op); done != PhoneSaved {
			t.Errorf("no merge %d: %s", i, done)
		}
	}
	insert(PhoneOperation{ID: "e000000000000001", Bank: "card", Date: "2026-10-16", Amount: -3300, Merchant: "Magnum", Source: "tap",
		OccurredAt: now.Add(3 * time.Hour)})
	_, _ = f.db.Exec(`UPDATE app.operations SET deleted_at = now() WHERE id = 'e000000000000001'`)
	if done := insert(PhoneOperation{ID: "e000000000000002", Bank: "kaspi", Date: "2026-10-16", Amount: -3300, Merchant: "MAGNUM",
		Kind: "purchase", Source: "push", OccurredAt: now.Add(3*time.Hour + time.Minute)}); done != PhoneSaved {
		t.Errorf("merge into a tombstone: %s", done)
	}

	// A tap and a push of one purchase at the same moment (two instances): one operation.
	start := make(chan struct{})
	results := make(chan PhoneInsert, 2)
	for i, source := range []string{"tap", "push"} {
		go func() {
			<-start
			done, err := f.repo.InsertPhoneOperation(ctx, f.bobID, f.householdID, PhoneOperation{ID: fmt.Sprintf("f00000000000000%d", i),
				Bank: "kaspi", Date: "2026-10-16", Amount: -777, Merchant: "Twice", Kind: "purchase", Source: source, OccurredAt: now}, phoneWindows)
			if err != nil {
				t.Errorf("concurrent: %v", err)
			}
			results <- done
		}()
	}
	close(start)
	a, b := <-results, <-results
	if !(a == PhoneSaved && b == PhoneMerged || a == PhoneMerged && b == PhoneSaved) {
		t.Fatalf("tap and push at once: %s and %s", a, b)
	}
	if n := len(opsByID(t, f, f.bobID)); n != 1 {
		t.Fatalf("bob's operations: %d", n)
	}
}

// Р-8: a transfer out of one bank and the same tenge into another within 10 minutes — both internal.
func TestPostgresPhoneOwnTransferPair(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	n := 0
	insert := func(bank, kind string, amount int64, at time.Time) (string, PhoneInsert) {
		t.Helper()
		n++
		id := fmt.Sprintf("%016x", n)
		done, err := f.repo.InsertPhoneOperation(ctx, f.aliceID, f.householdID, PhoneOperation{ID: id, Bank: bank, Date: "2026-10-16",
			Amount: amount, Merchant: "Перевод", Kind: kind, Source: "push", OccurredAt: at}, phoneWindows)
		if err != nil {
			t.Fatal(err)
		}
		return id, done
	}
	out, _ := insert("kaspi", "transfer-out", -20000, now)
	in, done := insert("freedom", "transfer-in", 20000, now.Add(4*time.Minute))
	ops := opsByID(t, f, f.aliceID)
	if done != PhonePaired || !ops[out].Internal || !ops[in].Internal || !ops[out].UpdatedAt.Equal(ops[in].UpdatedAt) {
		t.Fatalf("pair: %s %+v", done, ops)
	}
	// Already paired halves are not taken twice; the same bank, 11 minutes, another sum — no pair.
	for _, c := range []struct {
		bank   string
		amount int64
		at     time.Time
	}{
		{"halyk", 20000, now.Add(5 * time.Minute)},
		{"kaspi", 30000, now.Add(time.Hour + 4*time.Minute)},
		{"freedom", 30000, now.Add(time.Hour + 11*time.Minute)},
		{"freedom", 30001, now.Add(time.Hour + time.Minute)},
	} {
		if c.amount == 30000 && c.bank == "kaspi" {
			insert("kaspi", "transfer-out", -30000, now.Add(time.Hour))
		}
		id, done := insert(c.bank, "transfer-in", c.amount, c.at)
		if done != PhoneSaved || opsByID(t, f, f.aliceID)[id].Internal {
			t.Errorf("%+v: %s", c, done)
		}
	}
}

func TestPostgresPushStatsAndMetrics(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	for _, c := range []struct{ day, bank, column string }{
		{"2026-10-16", "kaspi", PushParsed}, {"2026-10-16", "kaspi", PushParsed}, {"2026-10-16", "kaspi", PushUnknown},
		{"2026-10-12", "freedom", PushIgnored}, {"2026-09-30", "kaspi", PushParsed}, {"2026-09-01", "kaspi", PushParsed},
		{"2026-10-16", "unknown", PushUnknown},
	} {
		if err := f.repo.CountPush(ctx, c.day, c.bank, c.column); err != nil {
			t.Fatalf("count %+v: %v", c, err)
		}
	}
	if err := f.repo.CountPush(ctx, "2026-10-16", "tinkoff", PushParsed); err == nil {
		t.Fatal("a bank outside the list was counted")
	}
	var parsed, unknown int
	_ = f.db.QueryRow(`SELECT parsed, unknown FROM app.push_stats WHERE day = '2026-10-16' AND bank = 'kaspi'`).Scan(&parsed, &unknown)
	if parsed != 2 || unknown != 1 {
		t.Fatalf("upsert sums: %d %d", parsed, unknown)
	}
	// 2026-10-16 12:00 Almaty.
	m, err := NewSQLMetricsRepository(f.db).Metrics(ctx, time.Date(2026, 10, 16, 7, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]PushStats{}
	for _, s := range m.PushStats {
		got[s.Bank] = s
	}
	if k := got["kaspi"]; k.Days7 != (PushCounts{Parsed: 2, Unknown: 1}) || k.Days30 != (PushCounts{Parsed: 3, Unknown: 1}) {
		t.Errorf("kaspi: %+v", k)
	}
	if fr := got["freedom"]; fr.Days7 != (PushCounts{Ignored: 1}) || fr.Days30 != (PushCounts{Ignored: 1}) {
		t.Errorf("freedom: %+v", fr)
	}
	if len(m.PushStats) != 3 || got["unknown"].Days7.Unknown != 1 {
		t.Errorf("banks: %+v", m.PushStats)
	}
}

// 000009 after 000008 — with and without the AI migration 000007 before it.
func TestPostgresPushMigrationOrder(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	for _, skipAI := range []bool{false, true} {
		if _, err := database.ExecContext(ctx, `DROP SCHEMA app CASCADE`); err != nil {
			t.Fatalf("reset: %v", err)
		}
		before := migrationsBefore(t, "000009")
		if skipAI {
			delete(before, "000007_ai.sql")
		}
		if err := db.RunMigrations(ctx, database, before); err != nil {
			t.Fatalf("migrate to 000008 (without AI %v): %v", skipAI, err)
		}
		if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
			t.Fatalf("apply 000009 (without AI %v): %v", skipAI, err)
		}
		var tables int
		_ = database.QueryRow(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'push_stats'`).Scan(&tables)
		if tables != 1 {
			t.Fatalf("push_stats missing (without AI %v)", skipAI)
		}
	}
}
