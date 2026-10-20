package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/lib/pq"
)

// AIRepository holds the family AI flag and the monthly counters (бэклог «ИИ», Р-7, Р-8).
type AIRepository interface {
	// Enabled is the family's flag; an unknown family is off.
	Enabled(ctx context.Context, householdID string) (bool, error)
	// SetEnabled flips the flag; an unknown family is ErrHouseholdNotFound.
	SetEnabled(ctx context.Context, householdID string, on bool) error
	// Spent is the family's AI cost in month ('YYYY-MM', ai.MonthKey) in micro-dollars —
	// successes and billed failures alike (the limit is money, Р-11); no row is 0.
	Spent(ctx context.Context, householdID, month string) (int64, error)
	// AddUsage adds a call's spend to the month's counters: requests (1 on success, 0 on a
	// billed failure — Блок 2 «ИИ»), tokens and cost.
	AddUsage(ctx context.Context, householdID, month string, requests int, in, out, costMicros int64) error
	// Families is every family for the admin page with month's requests and cost and the
	// members' last app_open: AI on first, then the freshest activity, then newest first.
	Families(ctx context.Context, month string) ([]AIFamily, error)
}

// AIFamily is one row of the admin list (AI-03).
type AIFamily struct {
	ID         string    `json:"id"`
	CreatedAt  time.Time `json:"created_at"`
	Emails     []string  `json:"emails"` // members by slot
	AI         bool      `json:"ai"`
	Month      string    `json:"month"`
	Requests   int       `json:"requests"`
	CostMicros int64     `json:"cost_micros"`
	// LastActiveAt is the latest app_open of any current member — the event the admin's
	// "active over 7 days" counts (Metrics.Active7); nil: nobody opened the app yet.
	LastActiveAt *time.Time `json:"last_active_at"`
}

type sqlAIRepository struct{ db *sql.DB }

func NewSQLAIRepository(db *sql.DB) AIRepository { return &sqlAIRepository{db: db} }

func (r *sqlAIRepository) Families(ctx context.Context, month string) ([]AIFamily, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT h.id, h.created_at, h.ai_enabled,
			COALESCE((SELECT array_agg(u.email ORDER BY m.slot) FROM app.household_members m
				JOIN app.users u ON u.id = m.user_id WHERE m.household_id = h.id), '{}'),
			COALESCE(a.requests, 0), COALESCE(a.cost_micros, 0),
			(SELECT max(e.at) FROM app.events e JOIN app.household_members m ON m.user_id = e.user_id
				WHERE m.household_id = h.id AND e.kind = 'app_open') AS last_active
		FROM app.households h
		LEFT JOIN app.ai_usage a ON a.household_id = h.id AND a.month = $1
		ORDER BY h.ai_enabled DESC, last_active DESC NULLS LAST, h.created_at DESC;`, month)
	if err != nil {
		return nil, fmt.Errorf("failed to list families: %w", err)
	}
	defer rows.Close()
	families := []AIFamily{}
	for rows.Next() {
		f := AIFamily{Month: month}
		var last sql.NullTime
		if err := rows.Scan(&f.ID, &f.CreatedAt, &f.AI, pq.Array(&f.Emails), &f.Requests, &f.CostMicros, &last); err != nil {
			return nil, fmt.Errorf("failed to scan family: %w", err)
		}
		if last.Valid {
			f.LastActiveAt = &last.Time
		}
		families = append(families, f)
	}
	return families, rows.Err()
}

func (r *sqlAIRepository) Enabled(ctx context.Context, householdID string) (bool, error) {
	var on bool
	err := r.db.QueryRowContext(ctx, `SELECT ai_enabled FROM app.households WHERE id = $1`, householdID).Scan(&on)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to read ai flag: %w", err)
	}
	return on, nil
}

func (r *sqlAIRepository) SetEnabled(ctx context.Context, householdID string, on bool) error {
	res, err := r.db.ExecContext(ctx, `UPDATE app.households SET ai_enabled = $2 WHERE id = $1`, householdID, on)
	if err != nil {
		return fmt.Errorf("failed to set ai flag: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrHouseholdNotFound
	}
	return nil
}

func (r *sqlAIRepository) Spent(ctx context.Context, householdID, month string) (int64, error) {
	var n int64
	err := r.db.QueryRowContext(ctx, `SELECT cost_micros FROM app.ai_usage WHERE household_id = $1 AND month = $2`, householdID, month).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to read ai usage: %w", err)
	}
	return n, nil
}

func (r *sqlAIRepository) AddUsage(ctx context.Context, householdID, month string, requests int, in, out, costMicros int64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO app.ai_usage (household_id, month, requests, input_tokens, output_tokens, cost_micros)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (household_id, month) DO UPDATE SET
			requests = app.ai_usage.requests + EXCLUDED.requests,
			input_tokens = app.ai_usage.input_tokens + EXCLUDED.input_tokens,
			output_tokens = app.ai_usage.output_tokens + EXCLUDED.output_tokens,
			cost_micros = app.ai_usage.cost_micros + EXCLUDED.cost_micros;`,
		householdID, month, requests, in, out, costMicros)
	if err != nil {
		return fmt.Errorf("failed to add ai usage: %w", err)
	}
	return nil
}

// MockAIUsage is one family's month in MockAIRepo.
type MockAIUsage struct {
	Requests                  int
	InputTokens, OutputTokens int64
	CostMicros                int64
}

// MockAIRepo keeps the flags and counters in memory over the mock households and users, like
// the SQL over app.households.
type MockAIRepo struct {
	mu         sync.Mutex
	households *MockHouseholdRepo
	users      *MockUserRepo
	Flags      map[string]bool                   // household id → ai_enabled
	Usage      map[string]map[string]MockAIUsage // household id → month → counters
	Events     *MockEventRepo                    // app_open for LastActiveAt; nil — nobody active
}

func NewMockAIRepo(households *MockHouseholdRepo, users *MockUserRepo) *MockAIRepo {
	return &MockAIRepo{households: households, users: users, Flags: map[string]bool{}, Usage: map[string]map[string]MockAIUsage{}}
}

func (m *MockAIRepo) known(householdID string) bool {
	_, err := m.households.GetHousehold(context.Background(), householdID)
	return err == nil
}

func (m *MockAIRepo) Enabled(ctx context.Context, householdID string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Flags[householdID], nil
}

func (m *MockAIRepo) SetEnabled(ctx context.Context, householdID string, on bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.known(householdID) {
		return ErrHouseholdNotFound
	}
	m.Flags[householdID] = on
	return nil
}

func (m *MockAIRepo) Spent(ctx context.Context, householdID, month string) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.Usage[householdID][month].CostMicros, nil
}

func (m *MockAIRepo) AddUsage(ctx context.Context, householdID, month string, requests int, in, out, costMicros int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Usage[householdID] == nil {
		m.Usage[householdID] = map[string]MockAIUsage{}
	}
	u := m.Usage[householdID][month]
	u.Requests += requests
	u.InputTokens += in
	u.OutputTokens += out
	u.CostMicros += costMicros
	m.Usage[householdID][month] = u
	return nil
}

// Families lists the mock households like the SQL does.
func (m *MockAIRepo) Families(ctx context.Context, month string) ([]AIFamily, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.households.mu.RLock()
	families := make([]AIFamily, 0, len(m.households.households))
	for id, h := range m.households.households {
		u := m.Usage[id][month]
		f := AIFamily{ID: id, CreatedAt: h.CreatedAt, Emails: []string{}, AI: m.Flags[id], Month: month, Requests: u.Requests, CostMicros: u.CostMicros}
		members := slices.Clone(m.households.members[id])
		sort.Slice(members, func(i, j int) bool { return members[i].Slot < members[j].Slot })
		for _, mem := range members {
			if u, err := m.users.GetByID(ctx, mem.UserID); err == nil {
				f.Emails = append(f.Emails, u.Email)
			}
			if at := m.Events.lastOpen(mem.UserID); at != nil && (f.LastActiveAt == nil || at.After(*f.LastActiveAt)) {
				f.LastActiveAt = at
			}
		}
		families = append(families, f)
	}
	m.households.mu.RUnlock()
	sort.Slice(families, func(i, j int) bool {
		a, b := families[i], families[j]
		if a.AI != b.AI {
			return a.AI
		}
		if (a.LastActiveAt == nil) != (b.LastActiveAt == nil) {
			return a.LastActiveAt != nil
		}
		if a.LastActiveAt != nil && !a.LastActiveAt.Equal(*b.LastActiveAt) {
			return a.LastActiveAt.After(*b.LastActiveAt)
		}
		if !a.CreatedAt.Equal(b.CreatedAt) {
			return a.CreatedAt.After(b.CreatedAt)
		}
		return a.ID < b.ID
	})
	return families, nil
}
