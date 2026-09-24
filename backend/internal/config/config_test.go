package config

import (
	"strings"
	"testing"
)

// clearEnv blanks every variable Load reads; getEnv treats "" as unset.
func clearEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"PORT", "DATABASE_URL", "JWT_SECRET", "CORS_ORIGIN", "APP_ENV"} {
		t.Setenv(key, "")
	}
}

const prodSecret = "0123456789abcdef0123456789abcdef" // exactly 32 characters

func TestLoadDefaults(t *testing.T) {
	clearEnv(t)

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
	if cfg.JWTSecret != DefaultJWTSecret {
		t.Errorf("expected default secret, got %s", cfg.JWTSecret)
	}
	if cfg.CORSOrigin != "http://localhost:5173,http://127.0.0.1:5173" {
		t.Errorf("expected default CORS origin, got %s", cfg.CORSOrigin)
	}
	origins := cfg.AllowedOrigins()
	if len(origins) != 2 || origins[0] != "http://localhost:5173" || origins[1] != "http://127.0.0.1:5173" {
		t.Errorf("unexpected allowed origins: %v", origins)
	}
	if cfg.Env != "development" {
		t.Errorf("expected default env 'development', got %s", cfg.Env)
	}
	if cfg.IsProduction() {
		t.Error("development config must not report production")
	}
}

func TestLoadFromEnv(t *testing.T) {
	clearEnv(t)
	t.Setenv("PORT", "9090")
	t.Setenv("DATABASE_URL", "postgres://localhost:5432/finance_test?sslmode=disable")
	t.Setenv("JWT_SECRET", prodSecret)
	t.Setenv("CORS_ORIGIN", "http://localhost:5173")
	t.Setenv("APP_ENV", "production")

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
	if cfg.JWTSecret != prodSecret {
		t.Errorf("expected JWT secret, got %s", cfg.JWTSecret)
	}
	if cfg.CORSOrigin != "http://localhost:5173" {
		t.Errorf("expected CORS origin, got %s", cfg.CORSOrigin)
	}
	if !cfg.IsProduction() {
		t.Error("expected production config")
	}
}

func TestLoadProductionFailsFast(t *testing.T) {
	cases := []struct {
		name    string
		dbURL   string
		secret  string
		wantErr string
	}{
		{"no database", "", prodSecret, "DATABASE_URL"},
		{"default secret", "postgres://db", "", "JWT_SECRET"}, // unset → default
		{"explicit default secret", "postgres://db", DefaultJWTSecret, "JWT_SECRET"},
		{"short secret", "postgres://db", prodSecret[:31], "JWT_SECRET"},
		{"nothing set", "", "", "DATABASE_URL"},
		{"blank secret", "postgres://db", strings.Repeat(" ", 40), "JWT_SECRET"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clearEnv(t)
			t.Setenv("APP_ENV", "production")
			t.Setenv("DATABASE_URL", tc.dbURL)
			t.Setenv("JWT_SECRET", tc.secret)

			cfg, err := Load()
			if err == nil {
				t.Fatalf("expected error, got config %+v", cfg)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("error %q should mention %s", err, tc.wantErr)
			}
		})
	}
}

// A mistyped APP_ENV must not switch the production checks off.
func TestLoadProductionIgnoresCaseAndSpaces(t *testing.T) {
	for _, env := range []string{"Production", " production ", "PRODUCTION"} {
		clearEnv(t)
		t.Setenv("APP_ENV", env)
		if _, err := Load(); err == nil {
			t.Errorf("APP_ENV=%q without DATABASE_URL must fail", env)
		}
	}
}
