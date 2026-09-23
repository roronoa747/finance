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

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"finance-backend/internal/auth"
	"finance-backend/internal/config"
	"finance-backend/internal/db"
	"finance-backend/internal/handlers"
	"finance-backend/internal/repository"
	"finance-backend/migrations"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load configuration: %v", err)
	}

	var (
		database      *sql.DB
		userRepo      repository.UserRepository
		householdRepo repository.HouseholdRepository
	)

	tokenService := auth.NewTokenService(cfg.JWTSecret, 30*24*time.Hour)

	if cfg.DatabaseURL != "" {
		database, err = db.Connect(cfg.DatabaseURL)
		if err != nil {
			log.Printf("warning: unable to connect to database: %v", err)
		} else {
			defer database.Close()
			log.Println("connected to PostgreSQL successfully")

			// Run auto-migrations
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := db.RunMigrations(ctx, database, migrations.FS); err != nil {
				log.Printf("warning: migration runner encountered an error: %v", err)
			}
		}
	}

	if database != nil {
		userRepo = repository.NewSQLUserRepository(database)
		householdRepo = repository.NewSQLHouseholdRepository(database)
	} else {
		log.Println("using in-memory mock repositories (development mode)")
		mockRepos := repository.NewMockRepositories()
		mockRepos.Households.SetDocRepo(mockRepos.Docs)
		userRepo = mockRepos.Users
		householdRepo = mockRepos.Households
	}

	r := setupRouter(cfg, database, userRepo, householdRepo, tokenService)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
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

func setupRouter(
	cfg *config.Config,
	database *sql.DB,
	userRepo repository.UserRepository,
	householdRepo repository.HouseholdRepository,
	tokenService *auth.TokenService,
) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.CORSOrigin},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	authHandler := handlers.NewAuthHandler(userRepo, householdRepo, tokenService)
	householdHandler := handlers.NewHouseholdHandler(householdRepo, tokenService)

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handlers.HealthHandler(database))

		api.Post("/auth/register", authHandler.Register)
		api.Post("/auth/login", authHandler.Login)

		// Protected endpoints
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokenService))
			protected.Get("/auth/me", authHandler.Me)

			protected.Post("/household/invites", householdHandler.CreateInvite)
			protected.Post("/household/join", householdHandler.JoinHousehold)
		})
	})

	return r
}
