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

	// Ensure schema_migrations table exists
	createTableSQL := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
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
		checkSQL := `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1);`
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

		recordSQL := `INSERT INTO schema_migrations (version) VALUES ($1);`
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
