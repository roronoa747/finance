package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"finance-backend/internal/testdb"
)

func TestPostgresEventsAndMetrics(t *testing.T) {
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)
	statements := NewSQLStatementRepository(database)
	events := NewSQLEventRepository(database)
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, almaty) // четверг

	// Три семьи: «да» — вторая выписка на 5-й день; «нет» — вторая на 20-й; «свежая» — первая 3 дня назад.
	type fam struct{ user, household string }
	mk := func(name string, created time.Time, uploadsAgo ...int) fam {
		u, err := users.CreateGoogle(ctx, name+"@example.com", "sub-"+name, name)
		if err != nil {
			t.Fatal(err)
		}
		h, _, err := households.CreateHousehold(ctx, "", u.ID, name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.ExecContext(ctx, `UPDATE app.households SET created_at = $2 WHERE id = $1`, h.ID, created); err != nil {
			t.Fatal(err)
		}
		for _, ago := range uploadsAgo {
			up, err := statements.CreateUpload(ctx, h.ID, u.ID, UploadInput{Bank: "kaspi", PeriodFrom: "2026-09-01", PeriodTo: "2026-09-30", OpsCount: 1})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := database.ExecContext(ctx, `UPDATE app.statement_uploads SET created_at = $2 WHERE id = $1`, up.ID, now.AddDate(0, 0, -ago)); err != nil {
				t.Fatal(err)
			}
		}
		return fam{u.ID, h.ID}
	}
	yes := mk("yes", now.AddDate(0, 0, -40), 30, 25)
	mk("no", now.AddDate(0, 0, -40), 30, 10)
	fresh := mk("fresh", now.AddDate(0, 0, -5), 3)

	// app_open: дважды в один день Алматы — одна строка; 23:30 и 00:30 по Алматы — два дня.
	for _, at := range []time.Time{now.Add(-2 * time.Hour), now.Add(-time.Hour)} {
		if err := events.Record(ctx, yes.user, yes.household, "app_open", at); err != nil {
			t.Fatal(err)
		}
	}
	late := time.Date(2026, 10, 6, 23, 30, 0, 0, almaty)
	for _, at := range []time.Time{late, late.Add(time.Hour)} {
		if err := events.Record(ctx, fresh.user, fresh.household, "app_open", at); err != nil {
			t.Fatal(err)
		}
	}
	var opens int
	_ = database.QueryRowContext(ctx, `SELECT count(*) FROM app.events WHERE kind = 'app_open'`).Scan(&opens)
	if opens != 3 {
		t.Errorf("app_open rows = %d, want 3", opens)
	}
	// Без семьи — тоже пишется; неизвестный kind отвергает CHECK.
	if err := events.Record(ctx, yes.user, "", "week_done", now.AddDate(0, 0, -8)); err != nil {
		t.Errorf("event without household: %v", err)
	}
	if err := events.Record(ctx, yes.user, "", "purchase", now); err == nil {
		t.Error("CHECK must refuse unknown kinds")
	}
	_ = events.Record(ctx, fresh.user, fresh.household, "first_run_goal", now.AddDate(0, 0, -4))
	_ = events.Record(ctx, fresh.user, fresh.household, "first_run_done", now.AddDate(0, 0, -4))

	m, err := NewSQLMetricsRepository(database).Metrics(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if m.Users != 3 || m.Households != 3 || m.HouseholdsWithUpload != 3 {
		t.Errorf("totals = %+v", m)
	}
	// Знаменатель — две семьи с первой выпиской старше 14 дней, «да» — одна: 50 %.
	if m.SecondUpload.Eligible != 2 || m.SecondUpload.Retained != 1 {
		t.Errorf("second upload = %+v", m.SecondUpload)
	}
	if m.Active7 != 2 || m.Active28 != 2 {
		t.Errorf("active = %d / %d", m.Active7, m.Active28)
	}
	if f := m.Funnel28; f.Created != 1 || f.Uploaded != 1 || f.Goal != 1 || f.Done != 1 {
		t.Errorf("funnel = %+v", f)
	}
	if len(m.Weeks) != 8 || m.Weeks[7].Week != "2026-10-05" || m.Weeks[0].Week != "2026-08-17" {
		t.Fatalf("weeks = %+v", m.Weeks)
	}
	got := fmt.Sprint(m.Weeks[7], m.Weeks[6])
	// Неделя 5 окт: свежая выписка (3 дня назад); неделя 28 сен: новая семья (5 дней назад — 3 окт) и week_done (8 дней назад — 30 сен).
	if m.Weeks[7].Uploads != 1 || m.Weeks[6].NewHouseholds != 1 || m.Weeks[6].WeekDone != 1 {
		t.Errorf("last weeks = %s", got)
	}

	// Удалённый пользователь: события остаются без него (SET NULL), семья — каскадом.
	if err := NewSQLAccountRepository(database).DeleteAccount(ctx, yes.user); err != nil {
		t.Fatal(err)
	}
	var left int
	_ = database.QueryRowContext(ctx, `SELECT count(*) FROM app.events WHERE user_id = $1`, yes.user).Scan(&left)
	if left != 0 {
		t.Errorf("events of the deleted user still linked: %d", left)
	}
}
