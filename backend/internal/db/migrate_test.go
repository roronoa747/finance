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

	if _, err := database.ExecContext(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
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
	if err := database.QueryRowContext(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&applied); err != nil {
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
