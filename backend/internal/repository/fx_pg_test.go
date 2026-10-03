package repository

import (
	"context"
	"testing"
	"time"

	"finance-backend/internal/db"
	"finance-backend/internal/testdb"
	"finance-backend/migrations"
)

// История курсов (B2C-76) на настоящем PostgreSQL: миграция 000004, upsert, «проверен без
// курса», выборка периода; numeric(12,4) отдаёт курс как опубликован.

func pgDay(m time.Month, d int) time.Time {
	return time.Date(2026, m, d, 0, 0, 0, 0, time.UTC)
}

func TestPostgresFxRates(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	fx := NewSQLFxRepository(database)

	if err := fx.Save(ctx, pgDay(9, 25), map[string]float64{"EUR": 513.46, "USD": 447.85, "RUB": 5.31}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := fx.Save(ctx, pgDay(9, 26), map[string]float64{"EUR": 514.1234}); err != nil {
		t.Fatalf("save: %v", err)
	}
	// Upsert: the same day again replaces the rate, no duplicate.
	if err := fx.Save(ctx, pgDay(9, 26), map[string]float64{"EUR": 514.2}); err != nil {
		t.Fatalf("resave: %v", err)
	}
	// Asked, nothing published.
	if err := fx.Save(ctx, pgDay(9, 27), nil); err != nil {
		t.Fatalf("save empty: %v", err)
	}
	// An empty answer never turns a published day back.
	if err := fx.Save(ctx, pgDay(9, 25), nil); err != nil {
		t.Fatalf("save empty over published: %v", err)
	}

	eur, err := fx.Rates(ctx, "EUR", pgDay(9, 1), pgDay(9, 30))
	if err != nil {
		t.Fatalf("rates: %v", err)
	}
	if len(eur) != 2 || eur["2026-09-25"] != 513.46 || eur["2026-09-26"] != 514.2 {
		t.Errorf("eur: %v", eur)
	}
	rub, _ := fx.Rates(ctx, "RUB", pgDay(9, 25), pgDay(9, 25))
	if rub["2026-09-25"] != 5.31 {
		t.Errorf("rub: %v", rub)
	}
	// The period bounds are inclusive and nothing outside leaks in.
	one, _ := fx.Rates(ctx, "EUR", pgDay(9, 26), pgDay(9, 27))
	if len(one) != 1 || one["2026-09-26"] != 514.2 {
		t.Errorf("period: %v", one)
	}

	checked, err := fx.Checked(ctx, pgDay(9, 24), pgDay(9, 30))
	if err != nil {
		t.Fatalf("checked: %v", err)
	}
	want := map[string]bool{"2026-09-25": true, "2026-09-26": true, "2026-09-27": false}
	if len(checked) != len(want) {
		t.Errorf("checked: %v", checked)
	}
	for d, published := range want {
		if got, ok := checked[d]; !ok || got != published {
			t.Errorf("checked %s: %v %v", d, got, ok)
		}
	}

	var rows int
	_ = database.QueryRow(`SELECT count(*) FROM app.fx_rates`).Scan(&rows)
	if rows != 4 {
		t.Errorf("fx_rates rows: %d", rows)
	}
	// The rate must be positive: the table refuses a broken parse.
	if err := fx.Save(ctx, pgDay(9, 28), map[string]float64{"EUR": 0}); err == nil {
		t.Error("zero rate must be refused")
	}
	if c, _ := fx.Checked(ctx, pgDay(9, 28), pgDay(9, 28)); len(c) != 0 {
		t.Error("a refused save must not mark the day")
	}

	// Rerunning migrations keeps the history.
	if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
		t.Fatalf("rerun migrations: %v", err)
	}
	if again, _ := fx.Rates(ctx, "EUR", pgDay(9, 1), pgDay(9, 30)); len(again) != 2 {
		t.Errorf("after rerun: %v", again)
	}
}
