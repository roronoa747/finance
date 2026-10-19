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

// MaxPhoneKeys is how many phones one person connects (Р-13): the sixth key drops the longest idle.
const MaxPhoneKeys = 5

// ErrPhoneKeyNotFound: no such key (never issued or revoked).
var ErrPhoneKeyNotFound = errors.New("phone key not found")

// PhoneKeyRepository stores Apple Pay phone keys as SHA-256 hashes only (Р-5, Р-13).
type PhoneKeyRepository interface {
	WalletDebugRepository
	// Add stores a new key; a person with MaxPhoneKeys keys loses the longest idle one (never used
	// first, then the least recently used) in the same transaction.
	Add(ctx context.Context, userID string, hash []byte) error
	// DeleteAll revokes every key of the person ("Отключить").
	DeleteAll(ctx context.Context, userID string) error
	// Status of the person's keys (владелец 2026-10-19: «Подключено» only by keys that paid).
	Status(ctx context.Context, userID string) (PhoneKeyStatus, error)
	// UserByHash finds the key's owner; it does not mark the key used.
	UserByHash(ctx context.Context, hash []byte) (string, error)
	// MarkUsed marks the key used by a command — source "tap" or "push": only a payment written
	// or recognised as a repeat (saved / duplicate) — not a skipped body, a limit or a refusal
	// (ревью backend Н-5).
	MarkUsed(ctx context.Context, hash []byte, source string) error
}

// PhoneKeyStatus: Paid — keys a payment came with, Issued — all keys, Tap / Push — a payment
// came by a tap / by a bank push with any of them (владелец 2026-10-19: the card names the
// commands, not the phones — one iPhone with both commands holds two keys), LastUsedAt — the
// last payment of any of them.
type PhoneKeyStatus struct {
	Paid, Issued int
	Tap, Push    bool
	LastUsedAt   *time.Time
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
	// The one to go is the longest idle: never-used keys first (copied in the connect sheet, no
	// payment came with it yet), then the least recently used — a working phone is not pushed out by
	// sheets opened and closed (критик Б1).
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM app.phone_keys WHERE key_hash IN (
			SELECT key_hash FROM app.phone_keys WHERE user_id = $1
			ORDER BY last_used_at DESC NULLS LAST, created_at DESC, key_hash OFFSET $2
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

func (r *sqlPhoneKeyRepository) Status(ctx context.Context, userID string) (PhoneKeyStatus, error) {
	var s PhoneKeyStatus
	var last sql.NullTime
	err := r.db.QueryRowContext(ctx, `
		SELECT count(last_used_at), count(*), coalesce(bool_or(tap_paid), false), coalesce(bool_or(push_paid), false), max(last_used_at)
		FROM app.phone_keys WHERE user_id = $1`, userID).
		Scan(&s.Paid, &s.Issued, &s.Tap, &s.Push, &last)
	if err != nil {
		return PhoneKeyStatus{}, fmt.Errorf("failed to read phone keys: %w", err)
	}
	if last.Valid {
		s.LastUsedAt = &last.Time
	}
	return s, nil
}

func (r *sqlPhoneKeyRepository) MarkUsed(ctx context.Context, hash []byte, source string) error {
	if _, err := r.db.ExecContext(ctx, `
		UPDATE app.phone_keys SET last_used_at = now(), tap_paid = tap_paid OR $2 = 'tap', push_paid = push_paid OR $2 = 'push'
		WHERE key_hash = $1`, hash, source); err != nil {
		return fmt.Errorf("failed to mark phone key: %w", err)
	}
	return nil
}

func (r *sqlPhoneKeyRepository) UserByHash(ctx context.Context, hash []byte) (string, error) {
	var userID string
	err := r.db.QueryRowContext(ctx, `SELECT user_id FROM app.phone_keys WHERE key_hash = $1`, hash).
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
	tap      bool
	push     bool
}

// MockPhoneKeyRepo keeps hashes in memory, oldest first.
type MockPhoneKeyRepo struct {
	mu    sync.Mutex
	keys  []mockPhoneKey
	debug map[string]WalletDebug
	Now   func() time.Time
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
		// As in SQL: never used (oldest first), then the least recently used.
		gone := mine[0]
		for _, i := range mine[1:] {
			k, g := m.keys[i], m.keys[gone]
			switch {
			case g.lastUsed == nil:
				// an older never-used key is already the one
			case k.lastUsed == nil || k.lastUsed.Before(*g.lastUsed):
				gone = i
			}
		}
		m.keys = append(m.keys[:gone], m.keys[gone+1:]...)
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

func (m *MockPhoneKeyRepo) Status(ctx context.Context, userID string) (PhoneKeyStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var s PhoneKeyStatus
	for _, k := range m.keys {
		if k.userID != userID {
			continue
		}
		s.Issued++
		s.Tap = s.Tap || k.tap
		s.Push = s.Push || k.push
		if k.lastUsed == nil {
			continue
		}
		s.Paid++
		if s.LastUsedAt == nil || k.lastUsed.After(*s.LastUsedAt) {
			t := *k.lastUsed
			s.LastUsedAt = &t
		}
	}
	return s, nil
}

func (m *MockPhoneKeyRepo) MarkUsed(ctx context.Context, hash []byte, source string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, k := range m.keys {
		if bytes.Equal(k.hash, hash) {
			now := m.Now()
			m.keys[i].lastUsed = &now
			m.keys[i].tap = k.tap || source == "tap"
			m.keys[i].push = k.push || source == "push"
		}
	}
	return nil
}

func (m *MockPhoneKeyRepo) UserByHash(ctx context.Context, hash []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range m.keys {
		if bytes.Equal(k.hash, hash) {
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

// WalletDebug is the last tap body the server searched for the amount, or could not read the
// amount of — admins only (Р-13а).
type WalletDebug struct {
	Body string    `json:"body"`
	At   time.Time `json:"at"`
}

// walletDebugTTL: the body lives a day, then any new write drops it.
const walletDebugTTL = 24 * time.Hour

// WalletDebugRepository keeps one body per admin (overwritten) for tuning the tap parser.
type WalletDebugRepository interface {
	// SaveDebug overwrites the person's row and drops every row older than a day.
	SaveDebug(ctx context.Context, userID, body string) error
	// LastDebug is the person's body of the last day, nil when there is none.
	LastDebug(ctx context.Context, userID string) (*WalletDebug, error)
}

func (r *sqlPhoneKeyRepository) SaveDebug(ctx context.Context, userID, body string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM app.wallet_debug WHERE at < now() - interval '24 hours'`); err != nil {
		return fmt.Errorf("failed to drop old wallet debug: %w", err)
	}
	if _, err := r.db.ExecContext(ctx, `
		INSERT INTO app.wallet_debug (user_id, body) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET body = EXCLUDED.body, at = now()`, userID, body); err != nil {
		return fmt.Errorf("failed to save wallet debug: %w", err)
	}
	return nil
}

func (r *sqlPhoneKeyRepository) LastDebug(ctx context.Context, userID string) (*WalletDebug, error) {
	d := &WalletDebug{}
	err := r.db.QueryRowContext(ctx, `SELECT body, at FROM app.wallet_debug WHERE user_id = $1 AND at >= now() - interval '24 hours'`,
		userID).Scan(&d.Body, &d.At)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read wallet debug: %w", err)
	}
	return d, nil
}

func (m *MockPhoneKeyRepo) SaveDebug(ctx context.Context, userID, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.Now()
	if m.debug == nil {
		m.debug = map[string]WalletDebug{}
	}
	for id, d := range m.debug {
		if now.Sub(d.At) > walletDebugTTL {
			delete(m.debug, id)
		}
	}
	m.debug[userID] = WalletDebug{Body: body, At: now}
	return nil
}

func (m *MockPhoneKeyRepo) LastDebug(ctx context.Context, userID string) (*WalletDebug, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.debug[userID]
	if !ok || m.Now().Sub(d.At) > walletDebugTTL {
		return nil, nil
	}
	return &d, nil
}

// DebugRows is how many debug bodies the mock keeps (tests: nobody but admins gets one).
func (m *MockPhoneKeyRepo) DebugRows() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.debug)
}
