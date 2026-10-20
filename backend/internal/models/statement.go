package models

import "time"

// StatementUpload is the record of one uploaded bank statement (Р-21): the
// family sees who uploaded which bank for which period — never the operations.
type StatementUpload struct {
	ID         string    `json:"id"`
	Slot       string    `json:"slot"`
	Bank       string    `json:"bank"`
	PeriodFrom string    `json:"period_from"` // YYYY-MM-DD
	PeriodTo   string    `json:"period_to"`
	OpsCount   int       `json:"ops_count"`
	CreatedAt  time.Time `json:"created_at"`
}

// Operation is one personal statement line (Р-5): visible to its owner only,
// without full names or account numbers (Р-23). ID is the client fingerprint,
// so re-uploading the same period updates rows instead of adding them.
type Operation struct {
	ID           string    `json:"id"`
	Bank         string    `json:"bank"`
	Date         string    `json:"date"` // YYYY-MM-DD
	Amount       int64     `json:"amount"`
	Kind         string    `json:"kind"`
	Merchant     string    `json:"merchant"`
	Counterparty *string   `json:"counterparty,omitempty"`
	Note         *string   `json:"note,omitempty"`
	CategoryID   *string   `json:"category_id"`
	Internal     bool      `json:"internal"`
	UploadID     *string   `json:"upload_id,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
	// Apple Pay (Р-14): the server writes source, occurred_at and fx_* itself — a batch never
	// changes them. A foreign-currency operation has amount 0 until the phone converts it.
	Source     string     `json:"source"` // statement | tap | push
	OccurredAt *time.Time `json:"occurred_at,omitempty"`
	FxCurrency *string    `json:"fx_currency,omitempty"`
	FxAmount   *int64     `json:"fx_amount,omitempty"` // minor units
	// Deleted is a tombstone: once set it stays (a statement replaced the operation, Р-16).
	Deleted bool `json:"deleted,omitempty"`
}
