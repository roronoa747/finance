package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"log"
	"sort"
)

// RunMigrations applies pending SQL migrations from the given filesystem.
func RunMigrations(ctx context.Context, database *sql.DB, migrationsFS fs.FS) error {
	if database == nil {
		return fmt.Errorf("database connection is nil")
	}

	// Acquire advisory lock to prevent race conditions during migrations across multiple replicas.
	// The lock belongs to a session, so lock and unlock must share one pinned connection:
	// through the pool they could land on different sessions and leak the lock.
	lockConn, err := database.Conn(ctx)
	if err != nil {
		return fmt.Errorf("failed to get connection for migration lock: %w", err)
	}
	defer lockConn.Close()

	if _, err := lockConn.ExecContext(ctx, `SELECT pg_advisory_lock(hashtext('migrations'));`); err != nil {
		return fmt.Errorf("failed to acquire migration advisory lock: %w", err)
	}
	defer func() {
		_, _ = lockConn.ExecContext(context.Background(), `SELECT pg_advisory_unlock(hashtext('migrations'));`)
	}()

	// Ensure the app schema and its migration ledger exist
	createTableSQL := `
	CREATE SCHEMA IF NOT EXISTS app;
	CREATE TABLE IF NOT EXISTS app.schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	);`
	if _, err := database.ExecContext(ctx, createTableSQL); err != nil {
		return fmt.Errorf("failed to create schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrationsFS, ".")
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	var filenames []string
	for _, entry := range entries {
		if !entry.IsDir() && len(entry.Name()) > 4 && entry.Name()[len(entry.Name())-4:] == ".sql" {
			filenames = append(filenames, entry.Name())
		}
	}
	sort.Strings(filenames)

	for _, filename := range filenames {
		var exists bool
		checkSQL := `SELECT EXISTS (SELECT 1 FROM app.schema_migrations WHERE version = $1);`
		if err := database.QueryRowContext(ctx, checkSQL, filename).Scan(&exists); err != nil {
			return fmt.Errorf("failed to check migration status for %s: %w", filename, err)
		}

		if exists {
			continue
		}

		content, err := fs.ReadFile(migrationsFS, filename)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", filename, err)
		}

		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("failed to start transaction for %s: %w", filename, err)
		}

		if _, err := tx.ExecContext(ctx, string(content)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to execute migration %s: %w", filename, err)
		}

		recordSQL := `INSERT INTO app.schema_migrations (version) VALUES ($1);`
		if _, err := tx.ExecContext(ctx, recordSQL, filename); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("failed to record migration %s: %w", filename, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", filename, err)
		}

		log.Printf("applied migration: %s", filename)
	}

	return nil
}
