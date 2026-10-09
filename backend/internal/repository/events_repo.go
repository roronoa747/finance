package repository

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// EventKinds are the events the app records (B2C-28, Р-27); the table's CHECK holds the same.
var EventKinds = []string{"app_open", "week_done", "first_run_goal", "first_run_done", "push_open"}

// almaty is Kazakhstan's single time zone (UTC+5), as in internal/fx: days and weeks of the metrics.
var almaty = time.FixedZone("Asia/Almaty", 5*60*60)

// EventRepository records retention events. app_open counts once per user and Almaty day:
// a repeat is silently dropped.
type EventRepository interface {
	Record(ctx context.Context, userID, householdID, kind string, at time.Time) error
}

// Metrics is the owner's numbers page (B2C-28, Р-16).
type Metrics struct {
	Users                int `json:"users"`
	Households           int `json:"households"`
	HouseholdsWithUpload int `json:"households_with_upload"`
	// SecondUpload: households whose first upload is older than 14 days (Eligible) and those
	// of them with another upload within 14 days of the first (Retained).
	SecondUpload struct {
		Eligible int `json:"eligible"`
		Retained int `json:"retained"`
	} `json:"second_upload_14d"`
	Active7  int `json:"active_7d"`
	Active28 int `json:"active_28d"`
	// Funnel28: households created in the last 28 days, then how many of them uploaded, chose
	// a goal and finished the first run.
	Funnel28 struct {
		Created  int `json:"created"`
		Uploaded int `json:"uploaded"`
		Goal     int `json:"goal"`
		Done     int `json:"done"`
	} `json:"funnel_28d"`
	Weeks []MetricsWeek `json:"weeks"`
}

// MetricsWeek is one Almaty week (Monday) of the last eight.
type MetricsWeek struct {
	Week          string `json:"week"`
	NewHouseholds int    `json:"new_households"`
	Uploads       int    `json:"uploads"`
	WeekDone      int    `json:"week_done"`
}

// MetricsRepository computes Metrics as of now.
type MetricsRepository interface {
	Metrics(ctx context.Context, now time.Time) (*Metrics, error)
}

type sqlEventRepository struct{ db *sql.DB }

func NewSQLEventRepository(db *sql.DB) EventRepository { return &sqlEventRepository{db: db} }

func nullable(s string) sql.NullString { return sql.NullString{String: s, Valid: s != ""} }

func (r *sqlEventRepository) Record(ctx context.Context, userID, householdID, kind string, at time.Time) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO app.events (user_id, household_id, kind, at, day)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, day) WHERE kind = 'app_open' DO NOTHING;`,
		nullable(userID), nullable(householdID), kind, at, at.In(almaty).Format("2006-01-02"))
	if err != nil {
		return fmt.Errorf("failed to record event: %w", err)
	}
	return nil
}

type sqlMetricsRepository struct{ db *sql.DB }

func NewSQLMetricsRepository(db *sql.DB) MetricsRepository { return &sqlMetricsRepository{db: db} }

// almatySQL turns a timestamptz into Almaty wall-clock time (fixed UTC+5, independent of the
// server's tzdata).
const almatySQL = `((%s AT TIME ZONE 'UTC') + interval '5 hours')`

func (r *sqlMetricsRepository) Metrics(ctx context.Context, now time.Time) (*Metrics, error) {
	m := &Metrics{}
	err := r.db.QueryRowContext(ctx, `
		WITH firsts AS (
			SELECT household_id, min(created_at) AS f FROM app.statement_uploads GROUP BY household_id
		), recent AS (
			SELECT id FROM app.households WHERE created_at > $1::timestamptz - interval '28 days'
		)
		SELECT
			(SELECT count(*) FROM app.users),
			(SELECT count(*) FROM app.households),
			(SELECT count(*) FROM firsts),
			(SELECT count(*) FROM firsts WHERE f <= $1::timestamptz - interval '14 days'),
			(SELECT count(*) FROM firsts WHERE f <= $1::timestamptz - interval '14 days' AND EXISTS (
				SELECT 1 FROM app.statement_uploads u
				WHERE u.household_id = firsts.household_id AND u.created_at > firsts.f AND u.created_at <= firsts.f + interval '14 days')),
			(SELECT count(DISTINCT user_id) FROM app.events WHERE kind = 'app_open' AND at > $1::timestamptz - interval '7 days'),
			(SELECT count(DISTINCT user_id) FROM app.events WHERE kind = 'app_open' AND at > $1::timestamptz - interval '28 days'),
			(SELECT count(*) FROM recent),
			(SELECT count(*) FROM recent WHERE EXISTS (SELECT 1 FROM app.statement_uploads u WHERE u.household_id = recent.id)),
			(SELECT count(*) FROM recent WHERE EXISTS (SELECT 1 FROM app.events e WHERE e.household_id = recent.id AND e.kind = 'first_run_goal')),
			(SELECT count(*) FROM recent WHERE EXISTS (SELECT 1 FROM app.events e WHERE e.household_id = recent.id AND e.kind = 'first_run_done'));`,
		now).Scan(&m.Users, &m.Households, &m.HouseholdsWithUpload, &m.SecondUpload.Eligible, &m.SecondUpload.Retained,
		&m.Active7, &m.Active28, &m.Funnel28.Created, &m.Funnel28.Uploaded, &m.Funnel28.Goal, &m.Funnel28.Done)
	if err != nil {
		return nil, fmt.Errorf("failed to compute metrics: %w", err)
	}

	local := func(col string) string { return fmt.Sprintf(almatySQL, col) }
	rows, err := r.db.QueryContext(ctx, `
		WITH weeks AS (
			SELECT w::timestamp AS w FROM generate_series(
				date_trunc('week', `+local("$1::timestamptz")+`) - interval '7 weeks',
				date_trunc('week', `+local("$1::timestamptz")+`),
				interval '1 week') AS w
		)
		SELECT to_char(w, 'YYYY-MM-DD'),
			(SELECT count(*) FROM app.households h WHERE `+local("h.created_at")+` >= w AND `+local("h.created_at")+` < w + interval '1 week'),
			(SELECT count(*) FROM app.statement_uploads u WHERE `+local("u.created_at")+` >= w AND `+local("u.created_at")+` < w + interval '1 week'),
			(SELECT count(*) FROM app.events e WHERE e.kind = 'week_done' AND `+local("e.at")+` >= w AND `+local("e.at")+` < w + interval '1 week')
		FROM weeks ORDER BY w;`, now)
	if err != nil {
		return nil, fmt.Errorf("failed to compute weeks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var wk MetricsWeek
		if err := rows.Scan(&wk.Week, &wk.NewHouseholds, &wk.Uploads, &wk.WeekDone); err != nil {
			return nil, fmt.Errorf("failed to scan week: %w", err)
		}
		m.Weeks = append(m.Weeks, wk)
	}
	return m, rows.Err()
}

// MockEventRepo keeps events in memory with the same daily app_open rule.
type MockEventRepo struct {
	mu     sync.Mutex
	Events []MockEvent
}

type MockEvent struct {
	UserID, HouseholdID, Kind string
	At                        time.Time
}

func (m *MockEventRepo) Record(ctx context.Context, userID, householdID, kind string, at time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if kind == "app_open" {
		day := at.In(almaty).Format("2006-01-02")
		for _, e := range m.Events {
			if e.Kind == "app_open" && e.UserID == userID && e.At.In(almaty).Format("2006-01-02") == day {
				return nil
			}
		}
	}
	m.Events = append(m.Events, MockEvent{userID, householdID, kind, at})
	return nil
}

// MockMetricsRepo answers fixed numbers (the SQL is tested on PostgreSQL).
type MockMetricsRepo struct{}

func (MockMetricsRepo) Metrics(ctx context.Context, now time.Time) (*Metrics, error) {
	m := &Metrics{Users: 2, Households: 1, HouseholdsWithUpload: 1, Active7: 1, Active28: 2}
	m.SecondUpload.Eligible, m.SecondUpload.Retained = 1, 1
	m.Funnel28.Created, m.Funnel28.Uploaded, m.Funnel28.Goal, m.Funnel28.Done = 1, 1, 1, 1
	for i := 7; i >= 0; i-- {
		m.Weeks = append(m.Weeks, MetricsWeek{Week: now.In(almaty).AddDate(0, 0, -7*i).Format("2006-01-02")})
	}
	return m, nil
}
