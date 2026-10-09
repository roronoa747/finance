package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"finance-backend/internal/models"
)

var (
	ErrUserNotFound      = errors.New("user not found")
	ErrUserAlreadyExists = errors.New("user with this email already exists")
)

type UserRepository interface {
	Create(ctx context.Context, email, passwordHash string) (*models.User, error)
	GetByEmail(ctx context.Context, email string) (*models.User, error)
	GetByID(ctx context.Context, id string) (*models.User, error)
	Delete(ctx context.Context, id string) error

	// Google sign-in (B2C-22): a Google user has no password; an existing user is linked by email.
	GetByGoogleSub(ctx context.Context, sub string) (*models.User, error)
	CreateGoogle(ctx context.Context, email, sub, name string) (*models.User, error)
	LinkGoogle(ctx context.Context, id, sub, name string) (*models.User, error)
}

type sqlUserRepository struct {
	db *sql.DB
}

func NewSQLUserRepository(db *sql.DB) UserRepository {
	return &sqlUserRepository{db: db}
}

// userColumns are read into scanUser; the nullable ones come back empty, not NULL.
const userColumns = `id, email, COALESCE(password_hash, ''), COALESCE(google_sub, ''), COALESCE(display_name, ''), created_at`

func scanUser(row *sql.Row) (*models.User, error) {
	user := &models.User{}
	err := row.Scan(&user.ID, &user.Email, &user.PasswordHash, &user.GoogleSub, &user.DisplayName, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

func isUniqueViolation(err error) bool {
	return strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "23505")
}

func (r *sqlUserRepository) Create(ctx context.Context, email, passwordHash string) (*models.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	query := `
		INSERT INTO app.users (email, password_hash)
		VALUES ($1, $2)
		RETURNING ` + userColumns + `;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, cleanEmail, passwordHash))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUserAlreadyExists
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return user, nil
}

func (r *sqlUserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	query := `SELECT ` + userColumns + ` FROM app.users WHERE LOWER(email) = $1;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, cleanEmail))
	if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, fmt.Errorf("failed to query user by email: %w", err)
	}
	return user, err
}

func (r *sqlUserRepository) GetByID(ctx context.Context, id string) (*models.User, error) {
	query := `SELECT ` + userColumns + ` FROM app.users WHERE id = $1;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, id))
	if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, fmt.Errorf("failed to query user by id: %w", err)
	}
	return user, err
}

func (r *sqlUserRepository) GetByGoogleSub(ctx context.Context, sub string) (*models.User, error) {
	query := `SELECT ` + userColumns + ` FROM app.users WHERE google_sub = $1;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, sub))
	if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, fmt.Errorf("failed to query user by google sub: %w", err)
	}
	return user, err
}

func (r *sqlUserRepository) CreateGoogle(ctx context.Context, email, sub, name string) (*models.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	query := `
		INSERT INTO app.users (email, google_sub, display_name)
		VALUES ($1, $2, NULLIF($3, ''))
		RETURNING ` + userColumns + `;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, cleanEmail, sub, name))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUserAlreadyExists
		}
		return nil, fmt.Errorf("failed to create google user: %w", err)
	}
	return user, nil
}

// LinkGoogle records the Google account of a user found by email. The name only fills an
// empty one: the person may have renamed themselves since.
func (r *sqlUserRepository) LinkGoogle(ctx context.Context, id, sub, name string) (*models.User, error) {
	query := `
		UPDATE app.users
		SET google_sub = $2, display_name = COALESCE(display_name, NULLIF($3, ''))
		WHERE id = $1
		RETURNING ` + userColumns + `;`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, id, sub, name))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUserAlreadyExists
		}
		if errors.Is(err, ErrUserNotFound) {
			return nil, err
		}
		return nil, fmt.Errorf("failed to link google account: %w", err)
	}
	return user, nil
}

func (r *sqlUserRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM app.users WHERE id = $1;`
	if _, err := r.db.ExecContext(ctx, query, id); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	return nil
}
