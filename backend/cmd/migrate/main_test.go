package main

import (
	"context"
	"io/fs"
	"os"
	"testing"

	"finance-backend/internal/testdb"
	"finance-backend/migrations"
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
	// 000001: 6 таблиц + schema_migrations; 000002 (выписки): statement_uploads, operations.
	files, _ := fs.Glob(migrations.FS, "*.sql")
	if applied != len(files) || tables != 9 {
		t.Errorf("expected %d migrations and 9 tables, got %d and %d", len(files), applied, tables)
	}
}
