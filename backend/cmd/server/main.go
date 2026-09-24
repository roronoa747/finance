// Command server runs the API as a long-lived process for local development.
// Unlike the Vercel function it applies migrations on start.
package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"finance-backend/internal/config"
	"finance-backend/internal/db"
	"finance-backend/migrations"
	"finance-backend/server"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load configuration: %v", err)
	}

	var database *sql.DB
	if cfg.DatabaseURL != "" {
		database, err = db.Connect(cfg.DatabaseURL, db.ServerPool)
		if err != nil {
			log.Fatalf("fatal: unable to connect to database: %v", err)
		}
		defer database.Close()
		log.Println("connected to PostgreSQL successfully")

		// Run auto-migrations
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
			log.Fatalf("fatal: migration runner encountered an error: %v", err)
		}
	}

	handler, err := server.NewHandler(cfg, database)
	if err != nil {
		log.Fatalf("fatal: %v", err)
	}

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("server starting on port %s (env: %s)", cfg.Port, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	log.Println("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("forced server shutdown: %v", err)
	}

	log.Println("server stopped gracefully")
}
