package config

import (
	"os"
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
		CORSOrigin:  getEnv("CORS_ORIGIN", "*"),
		Env:         getEnv("APP_ENV", "development"),
	}, nil
}

func getEnv(key, defaultVal string) string {
	if val, exists := os.LookupEnv(key); exists && val != "" {
		return val
	}
	return defaultVal
}
