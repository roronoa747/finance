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
}

type sqlUserRepository struct {
	db *sql.DB
}

func NewSQLUserRepository(db *sql.DB) UserRepository {
	return &sqlUserRepository{db: db}
}

func (r *sqlUserRepository) Create(ctx context.Context, email, passwordHash string) (*models.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	query := `
		INSERT INTO users (email, password_hash)
		VALUES ($1, $2)
		RETURNING id, email, password_hash, created_at;`

	user := &models.User{}
	err := r.db.QueryRowContext(ctx, query, cleanEmail, passwordHash).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "UNIQUE constraint") || strings.Contains(err.Error(), "23505") {
			return nil, ErrUserAlreadyExists
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	return user, nil
}

func (r *sqlUserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	cleanEmail := strings.ToLower(strings.TrimSpace(email))
	query := `
		SELECT id, email, password_hash, created_at
		FROM users
		WHERE LOWER(email) = $1;`

	user := &models.User{}
	err := r.db.QueryRowContext(ctx, query, cleanEmail).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user by email: %w", err)
	}

	return user, nil
}

func (r *sqlUserRepository) GetByID(ctx context.Context, id string) (*models.User, error) {
	query := `
		SELECT id, email, password_hash, created_at
		FROM users
		WHERE id = $1;`

	user := &models.User{}
	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to query user by id: %w", err)
	}

	return user, nil
}

func (r *sqlUserRepository) Delete(ctx context.Context, id string) error {
	query := `DELETE FROM users WHERE id = $1;`
	if _, err := r.db.ExecContext(ctx, query, id); err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}
	return nil
}

