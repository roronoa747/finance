package models

import (
	"encoding/json"
	"time"
)

// HouseholdDoc represents the shared family budget JSON document.
type HouseholdDoc struct {
	HouseholdID string          `json:"household_id"`
	Rev         int64           `json:"rev"`
	Data        json.RawMessage `json:"data"`
	UpdatedAt   time.Time       `json:"updated_at"`
	UpdatedBy   *string         `json:"updated_by,omitempty"`
}

// PrivateDoc represents a user's isolated private wallet JSON document.
type PrivateDoc struct {
	HouseholdID string          `json:"household_id"`
	UserID      string          `json:"user_id"`
	Rev         int64           `json:"rev"`
	Data        json.RawMessage `json:"data"`
	UpdatedAt   time.Time       `json:"updated_at"`
}
