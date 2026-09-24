package main

import (
	"context"
	"os"
	"testing"

	"finance-backend/internal/testdb"
)

func TestRunRequiresDatabaseURL(t *testing.T) {
	if err := run(context.Background(), ""); err == nil {
		t.Fatal("expected an error without DATABASE_URL")
	}
}

func TestPostgresMigrateTwiceIsIdempotent(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `DROP SCHEMA app CASCADE`); err != nil {
		t.Fatal(err)
	}

	url := os.Getenv(testdb.EnvVar)
	for i := 1; i <= 2; i++ {
		if err := run(ctx, url); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
	}

	var applied, tables int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM app.schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app'`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if applied != 1 || tables != 7 {
		t.Errorf("expected 1 migration and 7 tables, got %d and %d", applied, tables)
	}
}
