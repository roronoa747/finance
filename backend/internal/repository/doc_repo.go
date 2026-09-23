package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"finance-backend/internal/models"
)

var (
	ErrDocNotFound = errors.New("document not found")
)

type DocRepository interface {
	GetHouseholdDoc(ctx context.Context, householdID string) (*models.HouseholdDoc, error)
	PushHouseholdDoc(ctx context.Context, householdID string, expectedRev int64, data json.RawMessage, updatedBy string) (*models.HouseholdDoc, bool, error)
	GetPrivateDoc(ctx context.Context, householdID, userID string) (*models.PrivateDoc, error)
	PushPrivateDoc(ctx context.Context, householdID, userID string, expectedRev int64, data json.RawMessage) (*models.PrivateDoc, bool, error)
}

type sqlDocRepository struct {
	db *sql.DB
}

func NewSQLDocRepository(db *sql.DB) DocRepository {
	return &sqlDocRepository{db: db}
}

func (r *sqlDocRepository) GetHouseholdDoc(ctx context.Context, householdID string) (*models.HouseholdDoc, error) {
	query := `
		SELECT household_id, rev, data, updated_at, updated_by
		FROM household_docs
		WHERE household_id = $1;`

	doc := &models.HouseholdDoc{}
	err := r.db.QueryRowContext(ctx, query, householdID).Scan(
		&doc.HouseholdID,
		&doc.Rev,
		&doc.Data,
		&doc.UpdatedAt,
		&doc.UpdatedBy,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrDocNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get household doc: %w", err)
	}

	return doc, nil
}

func (r *sqlDocRepository) PushHouseholdDoc(ctx context.Context, householdID string, expectedRev int64, data json.RawMessage, updatedBy string) (*models.HouseholdDoc, bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()

	// 1. Lock current row
	selectQuery := `
		SELECT household_id, rev, data, updated_at, updated_by
		FROM household_docs
		WHERE household_id = $1
		FOR UPDATE;`

	currentDoc := &models.HouseholdDoc{}
	err = tx.QueryRowContext(ctx, selectQuery, householdID).Scan(
		&currentDoc.HouseholdID,
		&currentDoc.Rev,
		&currentDoc.Data,
		&currentDoc.UpdatedAt,
		&currentDoc.UpdatedBy,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, ErrDocNotFound
	}
	if err != nil {
		return nil, false, fmt.Errorf("failed to lock household doc: %w", err)
	}

	// 2. Check optimistic lock revision
	if currentDoc.Rev != expectedRev {
		// Conflict! Return current server state
		return currentDoc, true, nil
	}

	// 3. Update doc
	updateQuery := `
		UPDATE household_docs
		SET data = $1, rev = rev + 1, updated_at = now(), updated_by = $2
		WHERE household_id = $3
		RETURNING household_id, rev, data, updated_at, updated_by;`

	newDoc := &models.HouseholdDoc{}
	err = tx.QueryRowContext(ctx, updateQuery, data, updatedBy, householdID).Scan(
		&newDoc.HouseholdID,
		&newDoc.Rev,
		&newDoc.Data,
		&newDoc.UpdatedAt,
		&newDoc.UpdatedBy,
	)
	if err != nil {
		return nil, false, fmt.Errorf("failed to update household doc: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("failed to commit household doc update: %w", err)
	}

	return newDoc, false, nil
}

func (r *sqlDocRepository) GetPrivateDoc(ctx context.Context, householdID, userID string) (*models.PrivateDoc, error) {
	query := `
		SELECT household_id, user_id, rev, data, updated_at
		FROM private_docs
		WHERE household_id = $1 AND user_id = $2;`

	doc := &models.PrivateDoc{}
	err := r.db.QueryRowContext(ctx, query, householdID, userID).Scan(
		&doc.HouseholdID,
		&doc.UserID,
		&doc.Rev,
		&doc.Data,
		&doc.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		// Return empty initial private document if not yet initialized
		return &models.PrivateDoc{
			HouseholdID: householdID,
			UserID:      userID,
			Rev:         1,
			Data:        json.RawMessage("{}"),
			UpdatedAt:   time.Now(),
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get private doc: %w", err)
	}

	return doc, nil
}

func (r *sqlDocRepository) PushPrivateDoc(ctx context.Context, householdID, userID string, expectedRev int64, data json.RawMessage) (*models.PrivateDoc, bool, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()

	selectQuery := `
		SELECT household_id, user_id, rev, data, updated_at
		FROM private_docs
		WHERE household_id = $1 AND user_id = $2
		FOR UPDATE;`

	currentDoc := &models.PrivateDoc{}
	err = tx.QueryRowContext(ctx, selectQuery, householdID, userID).Scan(
		&currentDoc.HouseholdID,
		&currentDoc.UserID,
		&currentDoc.Rev,
		&currentDoc.Data,
		&currentDoc.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		// Insert initial record
		insertQuery := `
			INSERT INTO private_docs (household_id, user_id, rev, data)
			VALUES ($1, $2, 1, $3)
			RETURNING household_id, user_id, rev, data, updated_at;`
		newDoc := &models.PrivateDoc{}
		if err := tx.QueryRowContext(ctx, insertQuery, householdID, userID, data).Scan(
			&newDoc.HouseholdID, &newDoc.UserID, &newDoc.Rev, &newDoc.Data, &newDoc.UpdatedAt,
		); err != nil {
			return nil, false, fmt.Errorf("failed to insert initial private doc: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return nil, false, err
		}
		return newDoc, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("failed to lock private doc: %w", err)
	}

	if currentDoc.Rev != expectedRev {
		return currentDoc, true, nil
	}

	updateQuery := `
		UPDATE private_docs
		SET data = $1, rev = rev + 1, updated_at = now()
		WHERE household_id = $2 AND user_id = $3
		RETURNING household_id, user_id, rev, data, updated_at;`

	newDoc := &models.PrivateDoc{}
	err = tx.QueryRowContext(ctx, updateQuery, data, householdID, userID).Scan(
		&newDoc.HouseholdID,
		&newDoc.UserID,
		&newDoc.Rev,
		&newDoc.Data,
		&newDoc.UpdatedAt,
	)
	if err != nil {
		return nil, false, fmt.Errorf("failed to update private doc: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, false, err
	}

	return newDoc, false, nil
}
