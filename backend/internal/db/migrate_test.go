package db_test

import (
	"context"
	"sync"
	"testing"

	"finance-backend/internal/db"
	"finance-backend/internal/testdb"
	"finance-backend/migrations"
)

// Н-6: replicas starting at once must serialize migrations and release the
// advisory lock afterwards.
func TestPostgresConcurrentMigrationsReleaseLock(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()

	if _, err := database.ExecContext(ctx, `DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	const replicas = 4
	var wg sync.WaitGroup
	errs := make([]error, replicas)
	for i := range replicas {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = db.RunMigrations(ctx, database, migrations.FS)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("replica %d: migrations failed: %v", i, err)
		}
	}

	var applied int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM app.schema_migrations`).Scan(&applied); err != nil {
		t.Fatalf("count migrations: %v", err)
	}
	if applied != 1 {
		t.Errorf("expected 1 applied migration, got %d", applied)
	}

	var held int
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'`).Scan(&held); err != nil {
		t.Fatalf("count advisory locks: %v", err)
	}
	if held != 0 {
		t.Errorf("advisory lock leaked: %d still held after migrations", held)
	}
}

// Р-7: on the shared Supabase database "public" already holds React tables of
// the same names. Go migrations must leave them alone and build their own in "app".
func TestPostgresMigrationsLiveInAppSchema(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()

	if _, err := database.ExecContext(ctx, `
		DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;
		CREATE TABLE public.household_docs (foreign_id INT PRIMARY KEY, payload TEXT);
		INSERT INTO public.household_docs VALUES (7, 'react');`); err != nil {
		t.Fatalf("seed foreign table: %v", err)
	}

	if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
		t.Fatalf("migrations failed: %v", err)
	}

	var publicTables []string
	rows, err := database.QueryContext(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`)
	if err != nil {
		t.Fatalf("list public tables: %v", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		publicTables = append(publicTables, name)
	}
	rows.Close()
	if len(publicTables) != 1 || publicTables[0] != "household_docs" {
		t.Errorf("public must keep only the foreign table, got %v", publicTables)
	}

	var payload string
	if err := database.QueryRowContext(ctx, `SELECT payload FROM public.household_docs WHERE foreign_id = 7`).Scan(&payload); err != nil || payload != "react" {
		t.Errorf("foreign table changed: payload=%q err=%v", payload, err)
	}

	var appTables int
	if err := database.QueryRowContext(ctx, `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'app' AND table_name IN
		  ('users','households','household_members','household_docs','private_docs','household_invites','schema_migrations')`).Scan(&appTables); err != nil {
		t.Fatalf("count app tables: %v", err)
	}
	if appTables != 7 {
		t.Errorf("expected 7 tables in app, got %d", appTables)
	}

	var hasRev bool
	if err := database.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'app' AND table_name = 'household_docs' AND column_name = 'rev')`).Scan(&hasRev); err != nil || !hasRev {
		t.Errorf("app.household_docs must be the Go table (rev column): %v %v", hasRev, err)
	}
}
