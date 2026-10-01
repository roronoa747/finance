package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"finance-backend/internal/models"
)

// ErrPhotoNotFound is returned for an unknown photo id. The handler answers 404
// for it and for photos of other families or hidden ones of other users alike.
var ErrPhotoNotFound = errors.New("photo not found")

// PhotoInput is a new photo: author, family, visibility and the picture itself.
type PhotoInput struct {
	Hidden      bool
	ContentType string
	Data        []byte
}

// PhotoRepository stores goal and wish photos (B2C-16). Access rules (family,
// hidden) are the handler's: the repository returns what it holds.
type PhotoRepository interface {
	Create(ctx context.Context, householdID, userID string, in PhotoInput) (*models.Photo, error)
	// Get returns the record and its bytes; ErrPhotoNotFound for an unknown id.
	Get(ctx context.Context, id string) (*models.Photo, []byte, error)
	// Delete removes the photo; ErrPhotoNotFound when there is nothing to remove.
	Delete(ctx context.Context, id string) error
}

type sqlPhotoRepository struct {
	db *sql.DB
}

func NewSQLPhotoRepository(db *sql.DB) PhotoRepository {
	return &sqlPhotoRepository{db: db}
}

func (r *sqlPhotoRepository) Create(ctx context.Context, householdID, userID string, in PhotoInput) (*models.Photo, error) {
	// Bytes go as a []byte parameter: bytea accepts both the text (hex) and the
	// binary form, so the pooler's binary_parameters=yes is fine here (unlike jsonb).
	query := `
		INSERT INTO app.photos (household_id, user_id, hidden, content_type, bytes, size)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at;`
	p := &models.Photo{HouseholdID: householdID, UserID: userID, Hidden: in.Hidden, ContentType: in.ContentType, Size: len(in.Data)}
	if err := r.db.QueryRowContext(ctx, query, householdID, userID, in.Hidden, in.ContentType, in.Data, len(in.Data)).
		Scan(&p.ID, &p.CreatedAt); err != nil {
		return nil, fmt.Errorf("failed to create photo: %w", err)
	}
	return p, nil
}

func (r *sqlPhotoRepository) Get(ctx context.Context, id string) (*models.Photo, []byte, error) {
	query := `
		SELECT id, household_id, user_id, hidden, content_type, bytes, size, created_at
		FROM app.photos
		WHERE id = $1;`
	p := &models.Photo{}
	var data []byte
	err := r.db.QueryRowContext(ctx, query, id).
		Scan(&p.ID, &p.HouseholdID, &p.UserID, &p.Hidden, &p.ContentType, &data, &p.Size, &p.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrPhotoNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get photo: %w", err)
	}
	return p, data, nil
}

func (r *sqlPhotoRepository) Delete(ctx context.Context, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM app.photos WHERE id = $1;`, id)
	if err != nil {
		return fmt.Errorf("failed to delete photo: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to count deleted photos: %w", err)
	}
	if n == 0 {
		return ErrPhotoNotFound
	}
	return nil
}
