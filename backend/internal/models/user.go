package models

import "time"

// User represents an authenticated user account.
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // empty for a Google-only user
	GoogleSub    string    `json:"-"` // empty until the first Google sign-in
	DisplayName  string    `json:"display_name,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
