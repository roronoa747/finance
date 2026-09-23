package models

import "time"

// Household represents a family finance unit.
type Household struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

// HouseholdMember represents a user's participation in a household.
type HouseholdMember struct {
	HouseholdID string    `json:"household_id"`
	UserID      string    `json:"user_id"`
	Slot        string    `json:"slot"` // 'a', 'b', or 'c'
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"` // 'member' or 'viewer'
	JoinedAt    time.Time `json:"joined_at"`
}

// HouseholdInvite represents an invitation code to join a household.
type HouseholdInvite struct {
	Code        string     `json:"code"`
	HouseholdID string     `json:"household_id"`
	CreatedBy   string     `json:"created_by"`
	CreatedAt   time.Time  `json:"created_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
	UsedBy      *string    `json:"used_by,omitempty"`
	UsedAt      *time.Time `json:"used_at,omitempty"`
}

// MembershipInfo contains joined household and member data for UI.
type MembershipInfo struct {
	HouseholdID   string `json:"household_id"`
	HouseholdName string `json:"household_name"`
	UserID        string `json:"user_id"`
	Slot          string `json:"slot"`
	DisplayName   string `json:"display_name"`
	Role          string `json:"role"`
}
