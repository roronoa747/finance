package config

import (
	"os"
	"testing"
)

func TestLoadDefaults(t *testing.T) {
	// Clean env vars to test defaults
	os.Unsetenv("PORT")
	os.Unsetenv("DATABASE_URL")
	os.Unsetenv("JWT_SECRET")
	os.Unsetenv("CORS_ORIGIN")
	os.Unsetenv("APP_ENV")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Port != "8080" {
		t.Errorf("expected port 8080, got %s", cfg.Port)
	}
	if cfg.DatabaseURL != "" {
		t.Errorf("expected empty database URL, got %s", cfg.DatabaseURL)
	}
	if cfg.JWTSecret != "dev-secret-change-in-production" {
		t.Errorf("expected default secret, got %s", cfg.JWTSecret)
	}
	if cfg.CORSOrigin != "*" {
		t.Errorf("expected default CORS origin '*', got %s", cfg.CORSOrigin)
	}
	if cfg.Env != "development" {
		t.Errorf("expected default env 'development', got %s", cfg.Env)
	}
}

func TestLoadFromEnv(t *testing.T) {
	os.Setenv("PORT", "9090")
	os.Setenv("DATABASE_URL", "postgres://localhost:5432/finance_test?sslmode=disable")
	os.Setenv("JWT_SECRET", "custom-jwt-signing-key")
	os.Setenv("CORS_ORIGIN", "http://localhost:5173")
	os.Setenv("APP_ENV", "production")

	defer func() {
		os.Unsetenv("PORT")
		os.Unsetenv("DATABASE_URL")
		os.Unsetenv("JWT_SECRET")
		os.Unsetenv("CORS_ORIGIN")
		os.Unsetenv("APP_ENV")
	}()

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Port != "9090" {
		t.Errorf("expected port 9090, got %s", cfg.Port)
	}
	if cfg.DatabaseURL != "postgres://localhost:5432/finance_test?sslmode=disable" {
		t.Errorf("expected database URL, got %s", cfg.DatabaseURL)
	}
	if cfg.JWTSecret != "custom-jwt-signing-key" {
		t.Errorf("expected JWT secret, got %s", cfg.JWTSecret)
	}
	if cfg.CORSOrigin != "http://localhost:5173" {
		t.Errorf("expected CORS origin, got %s", cfg.CORSOrigin)
	}
	if cfg.Env != "production" {
		t.Errorf("expected env 'production', got %s", cfg.Env)
	}
}
