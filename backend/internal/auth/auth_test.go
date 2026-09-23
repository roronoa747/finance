package auth

import (
	"testing"
	"time"
)

func TestPasswords(t *testing.T) {
	raw := "SecureP@ss123"

	// 1. Password hashing
	hash, err := HashPassword(raw)
	if err != nil {
		t.Fatalf("failed to hash password: %v", err)
	}

	// 2. Password verification
	if !CheckPassword(hash, raw) {
		t.Fatal("expected password check to succeed")
	}

	if CheckPassword(hash, "WrongPassword") {
		t.Fatal("expected password check to fail on wrong input")
	}

	// 3. Short password validation
	_, err = HashPassword("123")
	if err == nil {
		t.Fatal("expected error on password shorter than 6 characters")
	}
}

func TestJWTTokenService(t *testing.T) {
	signingSecret := "testing-jwt-secret-salt"
	service := NewTokenService(signingSecret, 2*time.Hour)

	// 1. Generate token
	tokenStr, err := service.GenerateToken("user-1", "hh-1", "member", "a")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	// 2. Validate token
	claims, err := service.ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("failed to validate token: %v", err)
	}

	if claims.UserID != "user-1" {
		t.Errorf("expected user_id 'user-1', got %s", claims.UserID)
	}
	if claims.HouseholdID != "hh-1" {
		t.Errorf("expected household_id 'hh-1', got %s", claims.HouseholdID)
	}
	if claims.Role != "member" {
		t.Errorf("expected role 'member', got %s", claims.Role)
	}
	if claims.Slot != "a" {
		t.Errorf("expected slot 'a', got %s", claims.Slot)
	}

	// 3. Tampered token should fail
	tampered := tokenStr + "invalid"
	_, err = service.ValidateToken(tampered)
	if err == nil {
		t.Fatal("expected error on tampered token")
	}

	// 4. Token signed with different secret should fail
	otherService := NewTokenService("another-secret-key", 2*time.Hour)
	_, err = otherService.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("expected error when validating with different secret")
	}

	// 5. Expired token should fail
	expiredService := NewTokenService(signingSecret, -1*time.Minute)
	expiredToken, err := expiredService.GenerateToken("user-1", "hh-1", "member", "a")
	if err != nil {
		t.Fatalf("failed to generate expired token: %v", err)
	}
	_, err = service.ValidateToken(expiredToken)
	if err == nil {
		t.Fatal("expected error on expired token")
	}
}
