package config

import (
	"os"
	"strings"
)

// Config holds the application configuration
type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	CORSOrigin  string
	Env         string
}

// Load loads configuration from environment variables with fallback defaults.
func Load() (*Config, error) {
	return &Config{
		Port:        getEnv("PORT", "8080"),
		DatabaseURL: getEnv("DATABASE_URL", ""),
		JWTSecret:   getEnv("JWT_SECRET", "dev-secret-change-in-production"),
		CORSOrigin:  getEnv("CORS_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"),
		Env:         getEnv("APP_ENV", "development"),
	}, nil
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
