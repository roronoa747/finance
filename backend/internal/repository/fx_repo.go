package repository

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// FxRepository stores the National Bank's rate history (B2C-76, Р-71). Days are
// calendar dates (YYYY-MM-DD, Almaty); a rate is tenge per one unit, as published.
type FxRepository interface {
	// Rates returns code's published rates for from..to inclusive, keyed by day.
	Rates(ctx context.Context, code string, from, to time.Time) (map[string]float64, error)
	// Checked returns the days of from..to already asked of the bank: true — published.
	Checked(ctx context.Context, from, to time.Time) (map[string]bool, error)
	// Save upserts one day's rates; an empty map marks the day "asked, nothing published"
	// (a published day never goes back to unpublished).
	Save(ctx context.Context, day time.Time, rates map[string]float64) error
}

// DayKey formats a date as the repository keys it.
func DayKey(day time.Time) string {
	return day.Format(time.DateOnly)
}

// MissingDays lists the days of from..to not in checked, newest first — the order the
// handler and cmd/fxbackfill ask the bank in.
func MissingDays(checked map[string]bool, from, to time.Time) []time.Time {
	var out []time.Time
	for d := to; !d.Before(from); d = d.AddDate(0, 0, -1) {
		if _, ok := checked[DayKey(d)]; !ok {
			out = append(out, d)
		}
	}
	return out
}

// SaveAsked stores one asked day's answer. An empty answer is stored as "nothing
// published" only for a past day: today's rate may still come, and storing it empty
// would make the hole permanent. saved reports whether anything was written.
func SaveAsked(ctx context.Context, s FxRepository, day, today time.Time, rates map[string]float64) (saved bool, err error) {
	if len(rates) == 0 && !day.Before(today) {
		return false, nil
	}
	if err := s.Save(ctx, day, rates); err != nil {
		return false, err
	}
	return true, nil
}

type sqlFxRepository struct {
	db *sql.DB
}

func NewSQLFxRepository(db *sql.DB) FxRepository {
	return &sqlFxRepository{db: db}
}

func (r *sqlFxRepository) Rates(ctx context.Context, code string, from, to time.Time) (map[string]float64, error) {
	// Dates go as text with a cast: the pooler's binary_parameters=yes touches []byte only.
	rows, err := r.db.QueryContext(ctx, `
		SELECT day, rate FROM app.fx_rates
		WHERE code = $1 AND day BETWEEN $2::date AND $3::date
		ORDER BY day;`, code, DayKey(from), DayKey(to))
	if err != nil {
		return nil, fmt.Errorf("failed to list fx rates: %w", err)
	}
	defer rows.Close()
	out := make(map[string]float64)
	for rows.Next() {
		var day time.Time
		var rate float64
		if err := rows.Scan(&day, &rate); err != nil {
			return nil, fmt.Errorf("failed to scan fx rate: %w", err)
		}
		out[DayKey(day)] = rate
	}
	return out, rows.Err()
}

func (r *sqlFxRepository) Checked(ctx context.Context, from, to time.Time) (map[string]bool, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT day, published FROM app.fx_days
		WHERE day BETWEEN $1::date AND $2::date;`, DayKey(from), DayKey(to))
	if err != nil {
		return nil, fmt.Errorf("failed to list fx days: %w", err)
	}
	defer rows.Close()
	out := make(map[string]bool)
	for rows.Next() {
		var day time.Time
		var published bool
		if err := rows.Scan(&day, &published); err != nil {
			return nil, fmt.Errorf("failed to scan fx day: %w", err)
		}
		out[DayKey(day)] = published
	}
	return out, rows.Err()
}

func (r *sqlFxRepository) Save(ctx context.Context, day time.Time, rates map[string]float64) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin fx save: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	key := DayKey(day)
	for code, rate := range rates {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO app.fx_rates (day, code, rate) VALUES ($1::date, $2, $3)
			ON CONFLICT (day, code) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = now();`,
			key, code, rate); err != nil {
			return fmt.Errorf("failed to save fx rate: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO app.fx_days (day, published) VALUES ($1::date, $2)
		ON CONFLICT (day) DO UPDATE SET published = app.fx_days.published OR EXCLUDED.published, checked_at = now();`,
		key, len(rates) > 0); err != nil {
		return fmt.Errorf("failed to save fx day: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit fx save: %w", err)
	}
	return nil
}
