// Package server assembles the HTTP API. It lives outside internal/ so the
// Vercel function in the repository root (api/index.go, another module) can
// import it; cmd/server wraps the same handler in a long-running http.Server.
package server

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"finance-backend/internal/auth"
	"finance-backend/internal/config"
	"finance-backend/internal/db"
	"finance-backend/internal/fx"
	"finance-backend/internal/handlers"
	"finance-backend/internal/repository"
)

// tokenTTL is how long a login stays valid.
const tokenTTL = 30 * 24 * time.Hour

// Repos are the storage the handlers work with.
type Repos struct {
	Users      repository.UserRepository
	Households repository.HouseholdRepository
	Docs       repository.DocRepository
}

// NewHandler builds the API over database. A nil database means in-memory
// mocks for local development; production refuses them.
func NewHandler(cfg *config.Config, database *sql.DB) (http.Handler, error) {
	var repos Repos
	if database != nil {
		repos = Repos{
			Users:      repository.NewSQLUserRepository(database),
			Households: repository.NewSQLHouseholdRepository(database),
			Docs:       repository.NewSQLDocRepository(database),
		}
	} else {
		if cfg.IsProduction() {
			return nil, errors.New("production requires a database")
		}
		log.Println("using in-memory mock repositories (development mode)")
		mocks := repository.NewMockRepositories()
		mocks.Households.SetDocRepo(mocks.Docs)
		repos = Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs}
	}

	tokens := auth.NewTokenService(cfg.JWTSecret, tokenTTL)
	return NewRouter(cfg, database, repos, tokens, fx.NewClient()), nil
}

// FromEnv builds the handler for a serverless function: configuration from the
// environment and a small pool. It never runs migrations — cmd/migrate does,
// over a session connection (the advisory lock needs one).
//
// The function only runs on Vercel (Preview and Production), so it applies the
// production checks whatever APP_ENV says: a forgotten variable must not start
// it on in-memory mocks or with the default JWT secret.
func FromEnv() (http.Handler, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, fmt.Errorf("load configuration: %w", err)
	}
	if err := cfg.ValidateProduction(); err != nil {
		return nil, fmt.Errorf("load configuration: %w", err)
	}

	database, err := db.Connect(cfg.DatabaseURL, db.ServerlessPool)
	if err != nil {
		return nil, fmt.Errorf("connect to database: %w", err)
	}
	return NewHandler(cfg, database)
}

// NewRouter wires the routes over explicit dependencies.
func NewRouter(
	cfg *config.Config,
	database *sql.DB,
	repos Repos,
	tokenService *auth.TokenService,
	fxClient *fx.Client,
) *chi.Mux {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.AllowedOrigins(),
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	authHandler := handlers.NewAuthHandler(repos.Users, repos.Households, tokenService)
	householdHandler := handlers.NewHouseholdHandler(repos.Households, tokenService)
	syncHandler := handlers.NewSyncHandler(repos.Docs)

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handlers.HealthHandler(database))
		api.Get("/fx-rate", handlers.FxRateHandler(fxClient))

		api.Post("/auth/register", authHandler.Register)
		api.Post("/auth/login", authHandler.Login)

		// Protected endpoints
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokenService))
			protected.Get("/auth/me", authHandler.Me)

			protected.Post("/household/invites", householdHandler.CreateInvite)
			protected.Post("/household/join", householdHandler.JoinHousehold)

			protected.Get("/sync/household", syncHandler.GetHouseholdDoc)
			protected.Post("/sync/household", syncHandler.PushHouseholdDoc)
			protected.Get("/sync/private", syncHandler.GetPrivateDoc)
			protected.Post("/sync/private", syncHandler.PushPrivateDoc)
		})
	})

	return r
}
