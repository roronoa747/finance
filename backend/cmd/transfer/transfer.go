package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"strings"
)

// ErrMismatch means the reconciliation found a difference; nothing was committed.
var ErrMismatch = errors.New("reconciliation failed")

// options are the command-line flags of one run.
type options struct {
	direction string // "forward" or "back"
	replace   bool   // forward: wipe a non-empty app first
	force     bool   // back: go on although app has rows public lacks
	dryRun    bool   // roll back at the end
}

// tamper runs after the writes and before the reconciliation. Tests use it to
// fake a divergence; in production it is nil.
var tamper func(ctx context.Context, tx *sql.Tx) error

// transfer runs one direction in a single REPEATABLE READ transaction: the copy
// and its reconciliation see one snapshot. Any error or mismatch rolls back.
func transfer(ctx context.Context, database *sql.DB, opt options, out io.Writer) error {
	tx, err := database.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback()

	mode := ""
	if opt.dryRun {
		mode = " (dry-run)"
	}
	fmt.Fprintf(out, "transfer %s%s\n", opt.direction, mode)

	switch opt.direction {
	case "forward":
		err = forward(ctx, tx, opt, out)
	case "back":
		err = back(ctx, tx, opt, out)
	default:
		err = fmt.Errorf("unknown direction %q: want forward or back", opt.direction)
	}
	if err != nil {
		return err
	}

	if tamper != nil {
		if err := tamper(ctx, tx); err != nil {
			return err
		}
	}

	ok, err := reconcile(ctx, tx, opt.direction, out)
	if err != nil {
		return fmt.Errorf("reconcile: %w", err)
	}
	if !ok {
		fmt.Fprintln(out, "result: MISMATCH — rolled back, nothing changed")
		return ErrMismatch
	}

	if opt.dryRun {
		fmt.Fprintln(out, "result: OK — dry-run, rolled back, nothing changed")
		return nil // deferred Rollback
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	fmt.Fprintln(out, "result: OK — committed")
	return nil
}

// appTables lists the copied tables in foreign-key order.
var appTables = []string{"households", "household_members", "household_docs", "private_docs", "household_invites"}

// columns lists each table's columns; public and app share them (Р-14).
var columns = map[string]string{
	"households":        "id, name, created_by, created_at",
	"household_members": "household_id, user_id, slot, display_name, role, joined_at",
	"household_docs":    "household_id, rev, data, updated_at, updated_by",
	"private_docs":      "household_id, user_id, rev, data, updated_at",
	"household_invites": "code, household_id, created_by, created_at, expires_at, used_by, used_at",
}

// sourceUsers are the Supabase accounts that can log in: not deleted, with an
// email and a password. Emails are lower-cased as Go looks them up.
const sourceUsers = `
	SELECT id, lower(email) AS email, encrypted_password AS password_hash, created_at
	FROM auth.users
	WHERE deleted_at IS NULL AND email IS NOT NULL AND coalesce(encrypted_password, '') <> ''`

func forward(ctx context.Context, tx *sql.Tx, opt options, out io.Writer) error {
	var existing int
	if err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM app.users) + (SELECT count(*) FROM app.households)`).Scan(&existing); err != nil {
		return fmt.Errorf("check target: %w", err)
	}
	if existing > 0 {
		if !opt.replace {
			return errors.New("schema app is not empty: rerun with -replace to overwrite it")
		}
		if _, err := tx.ExecContext(ctx, `TRUNCATE app.users, app.households, app.household_members,
			app.household_docs, app.private_docs, app.household_invites`); err != nil {
			return fmt.Errorf("clear app: %w", err)
		}
		fmt.Fprintln(out, "app: cleared (-replace)")
	}

	skipped, err := queryStrings(ctx, tx, `
		SELECT id FROM auth.users
		WHERE deleted_at IS NULL AND (email IS NULL OR coalesce(encrypted_password, '') = '')
		ORDER BY id`)
	if err != nil {
		return fmt.Errorf("find users without password: %w", err)
	}
	for _, id := range skipped {
		fmt.Fprintf(out, "users: skipped %s — no email or password, cannot log in\n", id)
	}

	res, err := tx.ExecContext(ctx, `INSERT INTO app.users (id, email, password_hash, created_at) `+sourceUsers)
	if err != nil {
		return fmt.Errorf("copy users: %w", err)
	}
	n, _ := res.RowsAffected()
	fmt.Fprintf(out, "users: copied %d\n", n)

	for _, table := range appTables {
		cols := columns[table]
		res, err := tx.ExecContext(ctx, fmt.Sprintf(`INSERT INTO app.%s (%s) SELECT %s FROM public.%s`, table, cols, cols, table))
		if err != nil {
			return fmt.Errorf("copy %s: %w", table, err)
		}
		n, _ := res.RowsAffected()
		fmt.Fprintf(out, "%s: copied %d\n", table, n)
	}
	return nil
}

// back returns documents edited in Go to the React tables — the rollback path.
// It updates rows public already has and writes nothing else.
func back(ctx context.Context, tx *sql.Tx, opt options, out io.Writer) error {
	orphans, err := queryStrings(ctx, tx, `
		SELECT 'household_docs ' || a.household_id FROM app.household_docs a
		WHERE NOT EXISTS (SELECT 1 FROM public.household_docs p WHERE p.household_id = a.household_id)
		UNION ALL
		SELECT 'private_docs ' || a.household_id || '/' || a.user_id FROM app.private_docs a
		WHERE NOT EXISTS (SELECT 1 FROM public.private_docs p WHERE p.household_id = a.household_id AND p.user_id = a.user_id)
		ORDER BY 1`)
	if err != nil {
		return fmt.Errorf("find rows missing in public: %w", err)
	}
	for _, o := range orphans {
		fmt.Fprintf(out, "warning: %s exists only in app (created after cutover), not returned\n", o)
	}
	if len(orphans) > 0 && !opt.force {
		return fmt.Errorf("%d documents exist only in app: rerun with -force to return the rest", len(orphans))
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE public.household_docs p SET data = a.data, rev = a.rev, updated_at = a.updated_at
		FROM app.household_docs a WHERE p.household_id = a.household_id`)
	if err != nil {
		return fmt.Errorf("return household_docs: %w", err)
	}
	n, _ := res.RowsAffected()
	fmt.Fprintf(out, "household_docs: returned %d\n", n)

	res, err = tx.ExecContext(ctx, `
		UPDATE public.private_docs p SET data = a.data, rev = a.rev, updated_at = a.updated_at
		FROM app.private_docs a WHERE p.household_id = a.household_id AND p.user_id = a.user_id`)
	if err != nil {
		return fmt.Errorf("return private_docs: %w", err)
	}
	n, _ = res.RowsAffected()
	fmt.Fprintf(out, "private_docs: returned %d\n", n)
	return nil
}

// queryStrings returns the single text column of every row.
func queryStrings(ctx context.Context, tx *sql.Tx, query string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// reconcile compares both schemas inside the transaction and prints a report
// without emails or document bodies: ids, revs, counts and the fields of the
// "data intact" query.
func reconcile(ctx context.Context, tx *sql.Tx, direction string, out io.Writer) (bool, error) {
	ok := true
	fmt.Fprintln(out, "reconciliation:")

	// Every row must match exactly. Forward copies whole tables; back only
	// document contents of the rows both sides have.
	checks := map[string]string{}
	if direction == "forward" {
		checks["users"] = diffQuery(sourceUsers, `SELECT id, email, password_hash, created_at FROM app.users`)
		for _, table := range appTables {
			cols := columns[table]
			checks[table] = diffQuery(
				fmt.Sprintf(`SELECT %s FROM public.%s`, cols, table),
				fmt.Sprintf(`SELECT %s FROM app.%s`, cols, table))
		}
	} else {
		checks["household_docs"] = diffQuery(
			`SELECT p.household_id, p.rev, p.data, p.updated_at FROM public.household_docs p JOIN app.household_docs a USING (household_id)`,
			`SELECT household_id, rev, data, updated_at FROM app.household_docs WHERE household_id IN (SELECT household_id FROM public.household_docs)`)
		checks["private_docs"] = diffQuery(
			`SELECT p.household_id, p.user_id, p.rev, p.data, p.updated_at FROM public.private_docs p JOIN app.private_docs a USING (household_id, user_id)`,
			`SELECT a.household_id, a.user_id, a.rev, a.data, a.updated_at FROM app.private_docs a JOIN public.private_docs p USING (household_id, user_id)`)
	}

	for _, name := range append([]string{"users"}, appTables...) {
		query, has := checks[name]
		if !has {
			continue
		}
		var source, target, diff int
		if err := tx.QueryRowContext(ctx, query).Scan(&source, &target, &diff); err != nil {
			return false, fmt.Errorf("%s: %w", name, err)
		}
		status := "OK"
		if source != target || diff != 0 {
			status = "MISMATCH"
			ok = false
		}
		fmt.Fprintf(out, "  %-18s source %d, app %d, differing rows %d — %s\n", name, source, target, diff, status)
	}

	intact, err := dataIntact(ctx, tx, out)
	if err != nil {
		return false, err
	}
	return ok && intact, nil
}

// diffQuery counts rows on both sides and rows present on only one of them.
func diffQuery(source, target string) string {
	return fmt.Sprintf(`
		WITH s AS (%s), t AS (%s)
		SELECT (SELECT count(*) FROM s), (SELECT count(*) FROM t),
		       (SELECT count(*) FROM ((SELECT * FROM s EXCEPT ALL SELECT * FROM t)
		                         UNION ALL (SELECT * FROM t EXCEPT ALL SELECT * FROM s)) d)`, source, target)
}

// intactQuery is the "data intact" query from NEXT.md, per schema.
const intactQuery = `
	SELECT household_id::text, rev, updated_at::text,
	  coalesce(jsonb_path_query_array(data, '$.people[*].name')::text, ''),
	  coalesce(jsonb_path_query_array(data, '$.people[*].salary')::text, ''),
	  coalesce(jsonb_path_query_array(data, '$.people[*].onboardedAt')::text, ''),
	  coalesce(jsonb_array_length(data->'goals'), 0),
	  coalesce(jsonb_array_length(data->'obligations'), 0),
	  coalesce(jsonb_path_query_array(data, '$.credits[*].name')::text, '')
	FROM %s.household_docs ORDER BY household_id`

func dataIntact(ctx context.Context, tx *sql.Tx, out io.Writer) (bool, error) {
	read := func(schema string) (map[string]string, []string, error) {
		rows, err := tx.QueryContext(ctx, fmt.Sprintf(intactQuery, schema))
		if err != nil {
			return nil, nil, err
		}
		defer rows.Close()
		lines := map[string]string{}
		var ids []string
		for rows.Next() {
			var id, updated, names, salaries, onboarded, credits string
			var rev int64
			var goals, obligations int
			if err := rows.Scan(&id, &rev, &updated, &names, &salaries, &onboarded, &goals, &obligations, &credits); err != nil {
				return nil, nil, err
			}
			lines[id] = fmt.Sprintf("rev %d, updated %s, names %s, salaries %s, onboarded %s, goals %d, obligations %d, credits %s",
				rev, updated, names, salaries, onboarded, goals, obligations, credits)
			ids = append(ids, id)
		}
		return lines, ids, rows.Err()
	}

	public, ids, err := read("public")
	if err != nil {
		return false, fmt.Errorf("data intact (public): %w", err)
	}
	app, _, err := read("app")
	if err != nil {
		return false, fmt.Errorf("data intact (app): %w", err)
	}

	ok := true
	fmt.Fprintln(out, "data intact (household_docs):")
	for _, id := range ids {
		status := "= app"
		if app[id] != public[id] {
			status = "≠ app: " + app[id]
			ok = false
		}
		fmt.Fprintf(out, "  %s public %s %s\n", id, public[id], status)
	}

	var revs []string
	rows, err := tx.QueryContext(ctx, `
		SELECT p.household_id::text || '/' || p.user_id::text, p.rev, a.rev
		FROM public.private_docs p LEFT JOIN app.private_docs a USING (household_id, user_id)
		ORDER BY 1`)
	if err != nil {
		return false, fmt.Errorf("private revs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var pRev int64
		var aRev sql.NullInt64
		if err := rows.Scan(&key, &pRev, &aRev); err != nil {
			return false, err
		}
		status := "="
		if !aRev.Valid || aRev.Int64 != pRev {
			status = "≠"
			ok = false
		}
		revs = append(revs, fmt.Sprintf("  %s public rev %d %s app rev %s", key, pRev, status, nullRev(aRev)))
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	fmt.Fprintln(out, "private_docs revs:")
	fmt.Fprintln(out, strings.Join(revs, "\n"))
	return ok, nil
}

func nullRev(v sql.NullInt64) string {
	if !v.Valid {
		return "—"
	}
	return fmt.Sprint(v.Int64)
}
