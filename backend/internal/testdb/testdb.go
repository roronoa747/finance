// Package testdb gives integration tests a migrated real PostgreSQL.
package testdb

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"finance-backend/internal/db"
	"finance-backend/migrations"
)

// EnvVar names the connection string of a disposable test database.
const EnvVar = "TEST_DATABASE_URL"

// Open skips the test unless TEST_DATABASE_URL is set. Otherwise it wipes the
// app and public schemas, applies all migrations and returns the connection pool.
func Open(t *testing.T) *sql.DB {
	t.Helper()

	url := os.Getenv(EnvVar)
	if url == "" {
		t.Skipf("%s is not set: skipping PostgreSQL integration test", EnvVar)
	}
	// The reset below drops public: on the live Supabase project that is the
	// React production data. Its connection strings sit next to the test ones.
	if strings.Contains(strings.ToLower(url), "supabase") {
		t.Fatalf("%s points at Supabase: integration tests wipe the database, use a disposable one", EnvVar)
	}

	database, err := db.Connect(url, db.ServerPool)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := database.ExecContext(ctx, `DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("failed to reset test schema: %v", err)
	}
	if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	return database
}
