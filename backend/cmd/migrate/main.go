// Command migrate applies the SQL migrations to DATABASE_URL and exits.
//
// Production runs it by hand before a deploy: the Vercel function never
// migrates. Use a session or direct connection (port 5432) — the migration
// lock is a session advisory lock, which the transaction pooler (6543) breaks.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"finance-backend/internal/db"
	"finance-backend/migrations"
)

func main() {
	if err := run(context.Background(), os.Getenv("DATABASE_URL")); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("migrate: schema app is up to date")
}

func run(ctx context.Context, databaseURL string) error {
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}
	database, err := db.Connect(databaseURL, db.Pool{MaxOpen: 2, MaxIdle: 1})
	if err != nil {
		return err
	}
	defer database.Close()

	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	return db.RunMigrations(ctx, database, migrations.FS)
}
