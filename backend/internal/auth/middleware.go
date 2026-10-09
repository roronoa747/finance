package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type contextKey string

const (
	claimsKey contextKey = "auth_claims"
)

// ErrUserGone means the token's user no longer exists (deleted account): 401.
var ErrUserGone = errors.New("user no longer exists")

// Membership is the user's household as the database knows it at this request.
type Membership struct {
	HouseholdID string
	Role        string
	Slot        string
}

// Resolver looks the token's user up in the database (B2C-22): nil membership means a
// user without a household; ErrUserGone — a deleted user.
type Resolver func(ctx context.Context, userID string) (*Membership, error)

// Middleware enforces JWT authentication. With a resolver the household, role and slot
// come from the database on every request — a token outlives role changes and deleted
// accounts, so handlers never trust the household it was issued with. A nil resolver
// trusts the token (handler tests without a database).
func Middleware(tokenService *TokenService, resolve Resolver) func(http.Handler) http.Handler {
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

			if resolve != nil {
				m, err := resolve(r.Context(), claims.UserID)
				if errors.Is(err, ErrUserGone) {
					respondUnauthorized(w, "user no longer exists")
					return
				}
				if err != nil {
					respondJSONError(w, http.StatusInternalServerError, "failed to load membership")
					return
				}
				fresh := *claims
				fresh.HouseholdID, fresh.Role, fresh.Slot = "", "", ""
				if m != nil {
					fresh.HouseholdID, fresh.Role, fresh.Slot = m.HouseholdID, m.Role, m.Slot
				}
				claims = &fresh
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireHousehold answers 409 "no household" to a signed-in user without a household
// (Р-25): household routes go behind it, sign-in and "с кем" routes do not.
func RequireHousehold(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, _ := GetHouseholdID(r.Context()); strings.TrimSpace(id) == "" {
			respondJSONError(w, http.StatusConflict, "no household")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func respondUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":   "unauthorized",
		"message": msg,
	})
}

func respondJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
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
