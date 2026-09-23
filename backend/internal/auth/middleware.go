package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
)

type contextKey string

const (
	claimsKey contextKey = "auth_claims"
)

// Middleware creates an HTTP middleware that enforces JWT authentication.
func Middleware(tokenService *TokenService) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				respondUnauthorized(w, "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
				respondUnauthorized(w, "invalid authorization header format")
				return
			}

			tokenStr := strings.TrimSpace(parts[1])
			claims, err := tokenService.ValidateToken(tokenStr)
			if err != nil {
				respondUnauthorized(w, "invalid or expired token")
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func respondUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   "unauthorized",
		"message": msg,
	})
}

// GetClaims retrieves Claims from request context.
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*Claims)
	return claims, ok
}

// GetUserID retrieves user ID from context.
func GetUserID(ctx context.Context) (string, bool) {
	if claims, ok := GetClaims(ctx); ok {
		return claims.UserID, true
	}
	return "", false
}

// GetHouseholdID retrieves household ID from context.
func GetHouseholdID(ctx context.Context) (string, bool) {
	if claims, ok := GetClaims(ctx); ok {
		return claims.HouseholdID, true
	}
	return "", false
}

// GetRole retrieves user role from context.
func GetRole(ctx context.Context) (string, bool) {
	if claims, ok := GetClaims(ctx); ok {
		return claims.Role, true
	}
	return "", false
}

// GetSlot retrieves participant slot from context.
func GetSlot(ctx context.Context) (string, bool) {
	if claims, ok := GetClaims(ctx); ok {
		return claims.Slot, true
	}
	return "", false
}
