package config

import (
	"errors"
	"log"
	"os"
	"strconv"
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
	// GoogleClientIDs are the OAuth clients whose ID tokens sign in (web, Android, iOS —
	// GOOGLE_CLIENT_IDS, comma-separated). Optional: without them Google sign-in answers 503.
	GoogleClientIDs []string
	// AdminEmails see the owner's numbers page /admin (ADMIN_EMAILS, comma-separated, B2C-28).
	// Optional: without it /api/admin/metrics is 404 for everyone.
	AdminEmails []string

	// AnthropicAPIKey turns the AI helper on (ANTHROPIC_API_KEY, the value lives in
	// memory/secrets/anthropic.md). Optional: without it AI is off everywhere and production
	// is still valid, so ValidateProduction does not ask for it.
	AnthropicAPIKey string
	// AIModelReview, AIModelSellers and AIModelWish pick the model per feature
	// (AI_MODEL_REVIEW, AI_MODEL_SELLERS, AI_MODEL_WISH).
	AIModelReview  string
	AIModelSellers string
	AIModelWish    string
	// AIMonthlyLimitMicros is the money a family may spend on AI per Almaty month, in
	// micro-dollars (AI_MONTHLY_LIMIT_USD — whole dollars, one value for every family). Zero,
	// negative or not a number falls back to the default: "no limit" is not a setting. The old
	// AI_MONTHLY_LIMIT (requests) is no longer read.
	AIMonthlyLimitMicros int64
	// Apple Pay shortcut links (бэклог «Apple Pay», Р-17): iOS 27 with the trigger inside
	// (APPLEPAY_SHORTCUT_URL) and iOS 17–26 without it (APPLEPAY_SHORTCUT_URL_LEGACY). Optional:
	// without a link that phone path has no Apple Pay card. Only iCloud shortcut links count.
	// Блок 2: the bank pushes command (APPLEPAY_PUSH_SHORTCUT_URL, iOS 27) — without it the sheet
	// has no bank pushes step.
	ApplePayShortcutURL       string
	ApplePayShortcutURLLegacy string
	ApplePayPushShortcutURL   string
}

// shortcutPrefix is the only kind of link the phone may open for the Apple Pay command.
const shortcutPrefix = "https://www.icloud.com/shortcuts/"

// shortcutURL reads an Apple Pay link: anything but an iCloud shortcut link counts as unset.
func shortcutURL(key string) string {
	v := strings.TrimSpace(getEnv(key, ""))
	if v == "" {
		return ""
	}
	if !strings.HasPrefix(v, shortcutPrefix) {
		log.Printf("config: %s is not an iCloud shortcut link (%s…) — ignored", key, shortcutPrefix)
		return ""
	}
	return v
}

// Defaults for the AI settings above.
const (
	DefaultAIModelReview     = "claude-opus-5-5"
	DefaultAIModelSellers    = "claude-haiku-5-5"
	DefaultAIModelWish       = "claude-opus-5-5"
	DefaultAIMonthlyLimitUSD = 2
)

// microsPerUSD turns whole dollars into the micro-dollars app.ai_usage.cost_micros keeps.
const microsPerUSD = 1_000_000

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

		GoogleClientIDs: splitList(getEnv("GOOGLE_CLIENT_IDS", "")),
		AdminEmails:     splitList(strings.ToLower(getEnv("ADMIN_EMAILS", ""))),

		AnthropicAPIKey:           strings.TrimSpace(getEnv("ANTHROPIC_API_KEY", "")),
		AIModelReview:             strings.TrimSpace(getEnv("AI_MODEL_REVIEW", DefaultAIModelReview)),
		AIModelSellers:            strings.TrimSpace(getEnv("AI_MODEL_SELLERS", DefaultAIModelSellers)),
		AIModelWish:               strings.TrimSpace(getEnv("AI_MODEL_WISH", DefaultAIModelWish)),
		AIMonthlyLimitMicros:      int64(positiveInt(getEnv("AI_MONTHLY_LIMIT_USD", ""), DefaultAIMonthlyLimitUSD)) * microsPerUSD,
		ApplePayShortcutURL:       shortcutURL("APPLEPAY_SHORTCUT_URL"),
		ApplePayShortcutURLLegacy: shortcutURL("APPLEPAY_SHORTCUT_URL_LEGACY"),
		ApplePayPushShortcutURL:   shortcutURL("APPLEPAY_PUSH_SHORTCUT_URL"),
	}
	if cfg.IsProduction() {
		if err := cfg.ValidateProduction(); err != nil {
			return nil, err
		}
	}
	return cfg, nil
}

// IsProduction reports whether APP_ENV is "production", ignoring case and
// surrounding spaces: a mistyped value must not silently switch the checks off.
func (c *Config) IsProduction() bool {
	return strings.EqualFold(strings.TrimSpace(c.Env), "production")
}

// ValidateProduction reports what production would refuse: no database, or a
// default, blank or short JWT secret.
func (c *Config) ValidateProduction() error {
	var errs []error
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required in production"))
	}
	if c.JWTSecret == DefaultJWTSecret || len(strings.TrimSpace(c.JWTSecret)) < minProdJWTSecretLen {
		errs = append(errs, errors.New("JWT_SECRET must be set to a non-default value of at least 32 characters in production"))
	}
	return errors.Join(errs...)
}

// AllowedOrigins parses comma-separated CORS origins into a slice.
func (c *Config) AllowedOrigins() []string {
	origins := splitList(c.CORSOrigin)
	if len(origins) == 0 {
		return []string{"http://localhost:5173", "http://127.0.0.1:5173"}
	}
	return origins
}

// splitList parses a comma-separated variable, dropping blanks.
func splitList(v string) []string {
	var out []string
	for _, item := range strings.Split(v, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// positiveInt parses v, falling back to def for blanks, typos and values below 1.
func positiveInt(v string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < 1 {
		return def
	}
	return n
}

func getEnv(key, defaultVal string) string {
	if val, exists := os.LookupEnv(key); exists && val != "" {
		return val
	}
	return defaultVal
}
