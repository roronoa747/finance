package config

import (
	"errors"
	"os"
	"strings"
)

// DefaultJWTSecret is the development-only signing key; production refuses it.
const DefaultJWTSecret = "dev-secret-change-in-production"

// minProdJWTSecretLen is the shortest JWT_SECRET accepted in production.
const minProdJWTSecretLen = 32

// Config holds the application configuration
type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	CORSOrigin  string
	Env         string
}

// Load loads configuration from environment variables with fallback defaults.
// With APP_ENV=production it fails instead of falling back: without a database
// the server would silently serve in-memory mocks, and the default secret
// would let anyone forge tokens.
func Load() (*Config, error) {
	cfg := &Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", ""),
		JWTSecret:   getEnv("JWT_SECRET", DefaultJWTSecret),
		CORSOrigin:  getEnv("CORS_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"),
		Env:         getEnv("APP_ENV", "development"),
	}
	if cfg.IsProduction() {
		if err := cfg.validateProduction(); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// IsProduction reports whether APP_ENV is "production".
func (c *Config) IsProduction() bool {
	return c.Env == "production"
}

func (c *Config) validateProduction() error {
	var errs []error
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required in production"))
	}
	if c.JWTSecret == DefaultJWTSecret || len(c.JWTSecret) < minProdJWTSecretLen {
		errs = append(errs, errors.New("JWT_SECRET must be set to a non-default value of at least 32 characters in production"))
	}
	return errors.Join(errs...)
}

// AllowedOrigins parses comma-separated CORS origins into a slice.
func (c *Config) AllowedOrigins() []string {
	var origins []string
	for _, o := range strings.Split(c.CORSOrigin, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	if len(origins) == 0 {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	return origins
}

func getEnv(key, defaultVal string) string {
	if val, exists := os.LookupEnv(key); exists && val != "" {
		return val
	}
	return defaultVal
}
