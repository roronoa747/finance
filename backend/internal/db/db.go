package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	_ "github.com/lib/pq"
)

// Pool sizes the connection pool.
type Pool struct {
	MaxOpen int
	MaxIdle int
}

// ServerPool suits the long-running server (cmd/server).
var ServerPool = Pool{MaxOpen: 25, MaxIdle: 10}

// ServerlessPool suits one Vercel function instance: it handles one request at
// a time, and the transaction pooler behind it multiplexes the free Supabase
// connection limit, so a couple of connections is plenty.
var ServerlessPool = Pool{MaxOpen: 2, MaxIdle: 2}

// Connect initializes and validates a PostgreSQL connection pool.
func Connect(databaseURL string, pool Pool) (*sql.DB, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database URL is empty")
	}

	database, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	database.SetMaxOpenConns(pool.MaxOpen)
	database.SetMaxIdleConns(pool.MaxIdle)
	database.SetConnMaxLifetime(15 * time.Minute)
	database.SetConnMaxIdleTime(5 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := database.PingContext(ctx); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return database, nil
}

// Ping checks if the database is accessible.
func Ping(ctx context.Context, database *sql.DB) error {
	if database == nil {
		return fmt.Errorf("database is not initialized")
	}
	return database.PingContext(ctx)
}
