package models

import "time"

// Photo is the record of one goal or wish picture (B2C-16, Р-9): who uploaded it,
// for which family, whether it is a hidden surprise. The bytes travel separately.
type Photo struct {
	ID          string    `json:"id"`
	HouseholdID string    `json:"-"`
	UserID      string    `json:"-"`
	Hidden      bool      `json:"hidden"`
	ContentType string    `json:"content_type"`
	Size        int       `json:"size"`
	CreatedAt   time.Time `json:"created_at"`
}
