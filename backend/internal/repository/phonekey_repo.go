package repository

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// MaxPhoneKeys is how many phones one person connects (Р-13): the sixth key drops the oldest.
const MaxPhoneKeys = 5

// ErrPhoneKeyNotFound: no such key (never issued or revoked).
var ErrPhoneKeyNotFound = errors.New("phone key not found")

// PhoneKeyRepository stores Apple Pay phone keys as SHA-256 hashes only (Р-5, Р-13).
type PhoneKeyRepository interface {
	// Add stores a new key; a person with MaxPhoneKeys keys loses the oldest in the same transaction.
	Add(ctx context.Context, userID string, hash []byte) error
	// DeleteAll revokes every key of the person ("Отключить").
	DeleteAll(ctx context.Context, userID string) error
	// Status is how many phones are connected and when a phone last called.
	Status(ctx context.Context, userID string) (phones int, lastUsedAt *time.Time, err error)
	// UserByHash finds the key's owner and marks the key used, in one statement.
	UserByHash(ctx context.Context, hash []byte) (string, error)
}

type sqlPhoneKeyRepository struct{ db *sql.DB }

func NewSQLPhoneKeyRepository(db *sql.DB) PhoneKeyRepository { return &sqlPhoneKeyRepository{db: db} }

func (r *sqlPhoneKeyRepository) Add(ctx context.Context, userID string, hash []byte) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()
	// The user row lock serialises two "Подключить" of one person: the limit holds.
	if _, err := tx.ExecContext(ctx, `SELECT 1 FROM app.users WHERE id = $1 FOR UPDATE`, userID); err != nil {
		return fmt.Errorf("failed to lock user: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM app.phone_keys WHERE key_hash IN (
			SELECT key_hash FROM app.phone_keys WHERE user_id = $1
			ORDER BY created_at DESC, key_hash OFFSET $2
		)`, userID, MaxPhoneKeys-1); err != nil {
		return fmt.Errorf("failed to drop old phone keys: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO app.phone_keys (key_hash, user_id) VALUES ($1, $2)`, hash, userID); err != nil {
		return fmt.Errorf("failed to add phone key: %w", err)
	}
	return tx.Commit()
}

func (r *sqlPhoneKeyRepository) DeleteAll(ctx context.Context, userID string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM app.phone_keys WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("failed to delete phone keys: %w", err)
	}
	return nil
}

func (r *sqlPhoneKeyRepository) Status(ctx context.Context, userID string) (int, *time.Time, error) {
	var phones int
	var last sql.NullTime
	err := r.db.QueryRowContext(ctx, `SELECT count(*), max(last_used_at) FROM app.phone_keys WHERE user_id = $1`, userID).
		Scan(&phones, &last)
	if err != nil {
		return 0, nil, fmt.Errorf("failed to read phone keys: %w", err)
	}
	if !last.Valid {
		return phones, nil, nil
	}
	return phones, &last.Time, nil
}

func (r *sqlPhoneKeyRepository) UserByHash(ctx context.Context, hash []byte) (string, error) {
	var userID string
	err := r.db.QueryRowContext(ctx, `UPDATE app.phone_keys SET last_used_at = now() WHERE key_hash = $1 RETURNING user_id`, hash).
		Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrPhoneKeyNotFound
	}
	if err != nil {
		return "", fmt.Errorf("failed to find phone key: %w", err)
	}
	return userID, nil
}

// --- MockPhoneKeyRepo ---

type mockPhoneKey struct {
	hash     []byte
	userID   string
	created  time.Time
	lastUsed *time.Time
}

// MockPhoneKeyRepo keeps hashes in memory, oldest first.
type MockPhoneKeyRepo struct {
	mu   sync.Mutex
	keys []mockPhoneKey
	Now  func() time.Time
}

func NewMockPhoneKeyRepo() *MockPhoneKeyRepo { return &MockPhoneKeyRepo{Now: time.Now} }

func (m *MockPhoneKeyRepo) Add(ctx context.Context, userID string, hash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	var mine []int
	for i, k := range m.keys {
		if k.userID == userID {
			mine = append(mine, i)
		}
	}
	if len(mine) >= MaxPhoneKeys {
		m.keys = append(m.keys[:mine[0]], m.keys[mine[0]+1:]...)
	}
	m.keys = append(m.keys, mockPhoneKey{hash: bytes.Clone(hash), userID: userID, created: m.Now()})
	return nil
}

func (m *MockPhoneKeyRepo) DeleteAll(ctx context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.keys[:0]
	for _, k := range m.keys {
		if k.userID != userID {
			kept = append(kept, k)
		}
	}
	m.keys = kept
	return nil
}

func (m *MockPhoneKeyRepo) Status(ctx context.Context, userID string) (int, *time.Time, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	phones := 0
	var last *time.Time
	for _, k := range m.keys {
		if k.userID != userID {
			continue
		}
		phones++
		if k.lastUsed != nil && (last == nil || k.lastUsed.After(*last)) {
			t := *k.lastUsed
			last = &t
		}
	}
	return phones, last, nil
}

func (m *MockPhoneKeyRepo) UserByHash(ctx context.Context, hash []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, k := range m.keys {
		if bytes.Equal(k.hash, hash) {
			now := m.Now()
			m.keys[i].lastUsed = &now
			return k.userID, nil
		}
	}
	return "", ErrPhoneKeyNotFound
}

// Hashes lists the stored hashes (tests check that no plain key is kept).
func (m *MockPhoneKeyRepo) Hashes() [][]byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([][]byte, 0, len(m.keys))
	for _, k := range m.keys {
		out = append(out, bytes.Clone(k.hash))
	}
	return out
}
