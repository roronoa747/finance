package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"finance-backend/internal/config"
	"finance-backend/internal/testdb"
	"finance-backend/server"
)

const (
	aliceID = "11111111-1111-1111-1111-111111111111"
	bobID   = "22222222-2222-2222-2222-222222222222"
	ghostID = "33333333-3333-3333-3333-333333333333" // signed up by magic link: no password
	goneID  = "44444444-4444-4444-4444-444444444444" // deleted in Supabase: not copied
	homeID  = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

	aliceOldLogin = "alice-old-supabase-" + "login"
)

func TestParseArgs(t *testing.T) {
	for _, tc := range []struct {
		args []string
		ok   bool
		want options
	}{
		{[]string{"forward"}, true, options{direction: "forward"}},
		{[]string{"forward", "-replace", "-dry-run"}, true, options{direction: "forward", replace: true, dryRun: true}},
		{[]string{"back", "-force"}, true, options{direction: "back", force: true}},
		{[]string{"back", "-replace"}, false, options{}},
		{[]string{"sideways"}, false, options{}},
		{nil, false, options{}},
		{[]string{"forward", "extra"}, false, options{}},
	} {
		got, err := parseArgs(tc.args)
		if (err == nil) != tc.ok || (tc.ok && got != tc.want) {
			t.Errorf("parseArgs(%v) = %+v, %v", tc.args, got, err)
		}
	}
}

// setup gives a database shaped like the live one: auth.users and the React
// tables in public with one family, plus the empty Go schema app.
func setup(t *testing.T) (*sql.DB, string) {
	t.Helper()
	database := testdb.Open(t)
	ctx := context.Background()

	fixture, err := os.ReadFile("testdata/supabase_public.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, string(fixture)); err != nil {
		t.Fatalf("fixture: %v", err)
	}

	// Supabase stores bcrypt $2a$ hashes, the variant x/crypto produces.
	hash, err := bcrypt.GenerateFromPassword([]byte(aliceOldLogin), bcrypt.MinCost)
	if err != nil || !strings.HasPrefix(string(hash), "$2a$") {
		t.Fatalf("hash: %s %v", hash, err)
	}

	doc := `{"people":[{"id":"a","name":"Ильяс","salary":700000,"onboardedAt":"2026-09-07T10:00:00Z"},
		{"id":"b","name":"Аруна","salary":500000,"onboardedAt":"2026-09-08T10:00:00Z"}],
		"goals":[{"id":"g1"}],"obligations":[{"id":"o1"},{"id":"o2"}],"credits":[{"name":"Ипотека"}]}`
	seed := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO auth.users (id, email, encrypted_password) VALUES
		  ($1, 'Alice@Test.KZ', $3), ($2, 'bob@test.kz', $3), ($4, 'ghost@test.kz', NULL)`,
			[]any{aliceID, bobID, string(hash), ghostID}},
		{`INSERT INTO auth.users (id, email, encrypted_password, deleted_at) VALUES ($1, 'gone@test.kz', $2, now())`,
			[]any{goneID, string(hash)}},
		{`INSERT INTO public.households (id, name, created_by) VALUES ($1, 'Наша казна', $2)`, []any{homeID, aliceID}},
		{`INSERT INTO public.household_members (household_id, user_id, slot, display_name, role) VALUES
		  ($1, $2, 'a', 'Ильяс', 'member'), ($1, $3, 'b', 'Аруна', 'member')`, []any{homeID, aliceID, bobID}},
		{`INSERT INTO public.household_docs (household_id, rev, data, updated_by) VALUES ($1, 632, $2::jsonb, $3)`,
			[]any{homeID, doc, bobID}},
		{`INSERT INTO public.private_docs (household_id, user_id, rev, data) VALUES
		  ($1, $2, 17, '{"gift":"сюрприз"}'), ($1, $3, 3, '{}')`, []any{homeID, aliceID, bobID}},
		{`INSERT INTO public.household_invites (code, household_id, created_by, used_by, used_at) VALUES
		  ('ABCD1234', $1, $2, $3, now())`, []any{homeID, aliceID, bobID}},
	}
	for _, st := range seed {
		if _, err := database.ExecContext(ctx, st.query, st.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return database, os.Getenv(testdb.EnvVar)
}

func runCmd(t *testing.T, url string, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	code := run(context.Background(), args, url, &out)
	report := out.String()
	if strings.Contains(report, "@") || strings.Contains(report, "сюрприз") {
		t.Errorf("report leaks an email or a document body:\n%s", report)
	}
	return code, report
}

func count(t *testing.T, database *sql.DB, query string) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

// snapshot fingerprints both schemas to prove a run changed nothing.
func snapshot(t *testing.T, database *sql.DB) string {
	t.Helper()
	var s string
	err := database.QueryRow(`SELECT concat_ws('|',
		(SELECT count(*) FROM app.users), (SELECT count(*) FROM app.households),
		(SELECT count(*) FROM app.household_docs), (SELECT count(*) FROM app.private_docs),
		(SELECT string_agg(rev || md5(data::text), ',' ORDER BY household_id) FROM public.household_docs),
		(SELECT string_agg(rev || md5(data::text), ',' ORDER BY user_id) FROM public.private_docs),
		(SELECT string_agg(rev || md5(data::text), ',' ORDER BY household_id) FROM app.household_docs),
		(SELECT string_agg(rev || md5(data::text), ',' ORDER BY user_id) FROM app.private_docs))`).Scan(&s)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestPostgresTransferForwardAndLoginWithOldPassword(t *testing.T) {
	database, url := setup(t)

	code, report := runCmd(t, url, "forward")
	if code != 0 {
		t.Fatalf("forward failed (%d):\n%s", code, report)
	}
	for _, want := range []string{
		"users: skipped " + ghostID, "users: copied 2", "household_docs: copied 1",
		"rev 632", `names ["Ильяс", "Аруна"]`, "public rev 17 = app rev 17", "result: OK — committed",
	} {
		if !strings.Contains(report, want) {
			t.Errorf("report misses %q:\n%s", want, report)
		}
	}

	if n := count(t, database, `SELECT count(*) FROM app.users WHERE email = 'alice@test.kz'`); n != 1 {
		t.Error("email must be lower-cased")
	}
	if n := count(t, database, `SELECT count(*) FROM app.household_docs WHERE household_id = '`+homeID+`' AND rev = 632`); n != 1 {
		t.Error("household doc rev must be preserved")
	}

	// The member logs in to the Go API with the password she had in Supabase.
	h, err := server.NewHandler(&config.Config{Env: "test", JWTSecret: strings.Repeat("k", 32)}, database)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"email": "alice@test.kz", "pass" + "word": aliceOldLogin})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body)))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"token"`) || !strings.Contains(rec.Body.String(), homeID) {
		t.Fatalf("login with old password: %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostgresTransferRepeatNeedsReplace(t *testing.T) {
	database, url := setup(t)
	if code, report := runCmd(t, url, "forward"); code != 0 {
		t.Fatalf("first forward:\n%s", report)
	}
	before := snapshot(t, database)

	code, report := runCmd(t, url, "forward")
	if code == 0 || !strings.Contains(report, "-replace") {
		t.Fatalf("repeat without -replace must refuse:\n%s", report)
	}
	if snapshot(t, database) != before {
		t.Error("refused run changed data")
	}

	// A rehearsal edit in app is overwritten by the next copy.
	if _, err := database.Exec(`UPDATE app.household_docs SET rev = rev + 5, data = '{"stale":true}'`); err != nil {
		t.Fatal(err)
	}
	if code, report := runCmd(t, url, "forward", "-replace"); code != 0 || !strings.Contains(report, "app: cleared") {
		t.Fatalf("forward -replace:\n%s", report)
	}
	if after := snapshot(t, database); after != before {
		t.Errorf("-replace must reproduce the first copy:\n%s\n%s", before, after)
	}
}

func TestPostgresTransferBackReturnsGoEdits(t *testing.T) {
	database, url := setup(t)
	if code, report := runCmd(t, url, "forward"); code != 0 {
		t.Fatalf("forward:\n%s", report)
	}
	if _, err := database.Exec(`
		UPDATE app.household_docs SET data = data || '{"editedInGo":1}', rev = rev + 1, updated_at = now();
		UPDATE app.private_docs SET data = '{"gift":"другой"}', rev = rev + 1 WHERE user_id = '` + aliceID + `'`); err != nil {
		t.Fatal(err)
	}
	membersBefore := count(t, database, `SELECT count(*) FROM public.household_members`)

	code, report := runCmd(t, url, "back")
	if code != 0 || !strings.Contains(report, "household_docs: returned 1") {
		t.Fatalf("back failed (%d):\n%s", code, report)
	}
	if n := count(t, database, `SELECT count(*) FROM public.household_docs WHERE rev = 633 AND data ? 'editedInGo'`); n != 1 {
		t.Error("public must receive the Go edit and its rev")
	}
	if n := count(t, database, `SELECT count(*) FROM public.private_docs WHERE user_id = '`+aliceID+`' AND rev = 18 AND data->>'gift' = 'другой'`); n != 1 {
		t.Error("public private doc must receive the Go edit")
	}
	if count(t, database, `SELECT count(*) FROM public.household_members`) != membersBefore {
		t.Error("back must write documents only")
	}
}

func TestPostgresTransferBackRefusesDocsMissingInPublic(t *testing.T) {
	database, url := setup(t)
	if code, report := runCmd(t, url, "forward"); code != 0 {
		t.Fatalf("forward:\n%s", report)
	}
	// A family registered in Go after the cutover has no React row to return to.
	if _, err := database.Exec(`
		INSERT INTO app.households (id, created_by) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '` + bobID + `');
		INSERT INTO app.household_docs (household_id) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
		UPDATE app.household_docs SET rev = rev + 1 WHERE household_id = '` + homeID + `'`); err != nil {
		t.Fatal(err)
	}
	before := snapshot(t, database)

	code, report := runCmd(t, url, "back")
	if code == 0 || !strings.Contains(report, "-force") {
		t.Fatalf("back must refuse without -force:\n%s", report)
	}
	if snapshot(t, database) != before {
		t.Error("refused back changed data")
	}

	if code, report := runCmd(t, url, "back", "-force"); code != 0 {
		t.Fatalf("back -force:\n%s", report)
	}
	if n := count(t, database, `SELECT count(*) FROM public.household_docs WHERE rev = 633`); n != 1 {
		t.Error("-force must still return the known family")
	}
	if n := count(t, database, `SELECT count(*) FROM public.households`); n != 1 {
		t.Error("back must not create families in public")
	}
}

func TestPostgresTransferDryRunChangesNothing(t *testing.T) {
	database, url := setup(t)
	before := snapshot(t, database)

	code, report := runCmd(t, url, "forward", "-dry-run")
	if code != 0 || !strings.Contains(report, "dry-run, rolled back") {
		t.Fatalf("forward -dry-run (%d):\n%s", code, report)
	}
	if snapshot(t, database) != before {
		t.Error("forward -dry-run left changes")
	}

	if code, report := runCmd(t, url, "forward"); code != 0 {
		t.Fatalf("forward:\n%s", report)
	}
	if _, err := database.Exec(`UPDATE app.household_docs SET rev = rev + 1`); err != nil {
		t.Fatal(err)
	}
	before = snapshot(t, database)
	if code, report := runCmd(t, url, "back", "-dry-run"); code != 0 {
		t.Fatalf("back -dry-run:\n%s", report)
	}
	if snapshot(t, database) != before {
		t.Error("back -dry-run left changes")
	}
}

func TestPostgresTransferMismatchRollsBack(t *testing.T) {
	database, url := setup(t)
	before := snapshot(t, database)

	tamper = func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE app.private_docs SET rev = rev + 1 WHERE user_id = '`+bobID+`'`)
		return err
	}
	t.Cleanup(func() { tamper = nil })

	code, report := runCmd(t, url, "forward")
	if code == 0 || !strings.Contains(report, "MISMATCH") || !strings.Contains(report, "public rev 3 ≠ app rev 4") {
		t.Fatalf("divergence must fail the run (%d):\n%s", code, report)
	}
	if snapshot(t, database) != before {
		t.Error("failed reconciliation must leave nothing behind")
	}
}
