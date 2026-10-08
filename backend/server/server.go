// Package server assembles the HTTP API. It lives outside internal/ so the
// Vercel function in the repository root (api/index.go, another module) can
// import it; cmd/server wraps the same handler in a long-running http.Server.
package server

import (
	"context"
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
	"finance-backend/internal/googleauth"
	"finance-backend/internal/handlers"
	"finance-backend/internal/linkpreview"
	"finance-backend/internal/repository"
)

// tokenTTL is how long a login stays valid.
const tokenTTL = 30 * 24 * time.Hour

// Repos are the storage the handlers work with.
type Repos struct {
	Users      repository.UserRepository
	Households repository.HouseholdRepository
	Docs       repository.DocRepository
	Statements repository.StatementRepository
	Photos     repository.PhotoRepository
	Fx         repository.FxRepository
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
			Statements: repository.NewSQLStatementRepository(database),
			Photos:     repository.NewSQLPhotoRepository(database),
			Fx:         repository.NewSQLFxRepository(database),
		}
	} else {
		if cfg.IsProduction() {
			return nil, errors.New("production requires a database")
		}
		log.Println("using in-memory mock repositories (development mode)")
		mocks := repository.NewMockRepositories()
		mocks.Households.SetDocRepo(mocks.Docs)
		repos = Repos{Users: mocks.Users, Households: mocks.Households, Docs: mocks.Docs, Statements: mocks.Statements, Photos: mocks.Photos, Fx: mocks.Fx}
	}

	tokens := auth.NewTokenService(cfg.JWTSecret, tokenTTL)
	// A nil *Verifier must stay a nil interface: then Google sign-in answers 503.
	var google handlers.GoogleVerifier
	if v := googleauth.New(cfg.GoogleClientIDs); v != nil {
		google = v
	}
	return NewRouter(cfg, database, repos, tokens, fx.NewClient(), google), nil
}

// membershipResolver reads the household, role and slot from the database on every
// request (B2C-22): the token's own may be stale.
func membershipResolver(repos Repos) auth.Resolver {
	return func(ctx context.Context, userID string) (*auth.Membership, error) {
		if _, err := repos.Users.GetByID(ctx, userID); err != nil {
			if errors.Is(err, repository.ErrUserNotFound) {
				return nil, auth.ErrUserGone
			}
			return nil, err
		}
		member, _, err := repos.Households.GetMembership(ctx, userID)
		if errors.Is(err, repository.ErrMembershipNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &auth.Membership{HouseholdID: member.HouseholdID, Role: member.Role, Slot: member.Slot}, nil
	}
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
	google handlers.GoogleVerifier,
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

	authHandler := handlers.NewAuthHandler(repos.Users, repos.Households, tokenService, google)
	householdHandler := handlers.NewHouseholdHandler(repos.Households, tokenService)
	syncHandler := handlers.NewSyncHandler(repos.Docs)
	statementHandler := handlers.NewStatementHandler(repos.Statements)
	photoHandler := handlers.NewPhotoHandler(repos.Photos)
	previewHandler := handlers.NewPreviewHandler(linkpreview.New().Fetch)

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", handlers.HealthHandler(database))
		// The day the public rate fetched also goes into the history — with a database only.
		var fxStore repository.FxRepository
		if database != nil {
			fxStore = repos.Fx
		}
		api.Get("/fx-rate", handlers.FxRateHandler(fxClient, fxStore))

		api.Post("/auth/register", authHandler.Register)
		api.Post("/auth/login", authHandler.Login)
		api.Post("/auth/google", authHandler.GoogleLogin)

		// Protected endpoints: the household, role and slot come from the database (B2C-22).
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokenService, membershipResolver(repos)))

			// Without a household too (Р-25): who am I, "с кем".
			protected.Get("/auth/me", authHandler.Me)
			protected.Post("/household/join", householdHandler.JoinHousehold)

			// Household routes: 409 "no household" until "с кем" is done.
			protected.Group(func(family chi.Router) {
				family.Use(auth.RequireHousehold)

				family.Post("/household/invites", householdHandler.CreateInvite)

				family.Get("/sync/household", syncHandler.GetHouseholdDoc)
				family.Post("/sync/household", syncHandler.PushHouseholdDoc)
				family.Get("/sync/private", syncHandler.GetPrivateDoc)
				family.Post("/sync/private", syncHandler.PushPrivateDoc)

				// Выписки (B2C-06): записи загрузок — семье, операции — только владельцу.
				family.Post("/statements", statementHandler.CreateUpload)
				family.Get("/statements", statementHandler.ListUploads)
				family.Post("/operations/batch", statementHandler.UpsertOperations)
				family.Get("/operations", statementHandler.ListOperations)

				// Фото целей и желаний (B2C-16): байты в Postgres; скрытое — только автору (404).
				family.Post("/photos", photoHandler.Upload)
				// Фото желания по ссылке (B2C-65, Р-69): только member, в базу не пишет.
				family.Post("/photos/preview", previewHandler.Preview)
				family.Get("/photos/{id}", photoHandler.Get)
				family.Delete("/photos/{id}", photoHandler.Delete)

				// История курсов Нацбанка (B2C-76, Р-71): member и viewer.
				family.Get("/fx-rates", handlers.FxRatesHandler(fxClient, repos.Fx))
			})
		})
	})

	return r
}
