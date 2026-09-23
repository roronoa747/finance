package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken = errors.New("invalid or expired token")
)

// Claims represents JWT claims containing user and household context.
type Claims struct {
	UserID      string `json:"user_id"`
	HouseholdID string `json:"household_id"`
	Role        string `json:"role"`
	Slot        string `json:"slot"`
	jwt.RegisteredClaims
}

// TokenService manages issuing and verifying JWT tokens.
type TokenService struct {
	secretKey []byte
	ttl       time.Duration
}

func NewTokenService(signingKey string, ttl time.Duration) *TokenService {
	if ttl == 0 {
		ttl = 30 * 24 * time.Hour // 30 days default
	}
	return &TokenService{
		secretKey: []byte(signingKey),
		ttl:       ttl,
	}
}

func (s *TokenService) GenerateToken(userID, householdID, role, slot string) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:      userID,
		HouseholdID: householdID,
		Role:        role,
		Slot:        slot,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(s.secretKey)
	if err != nil {
		return "", fmt.Errorf("failed to sign token: %w", err)
	}

	return tokenString, nil
}

func (s *TokenService) ValidateToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.secretKey, nil
	})

	if err != nil {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}
