package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

type statementsApp struct {
	router                       *chi.Mux
	alice, bob, viewer, stranger string // tokens
}

func setupStatementsApp(t *testing.T) statementsApp {
	t.Helper()
	repos := repository.NewMockRepositories()
	repos.Households.SetDocRepo(repos.Docs)
	tokens := auth.NewTokenService("statements-test-signing-key", 2*time.Hour)
	h := NewStatementHandler(repos.Statements)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.Group(func(protected chi.Router) {
			protected.Use(auth.Middleware(tokens))
			protected.Post("/statements", h.CreateUpload)
			protected.Get("/statements", h.ListUploads)
			protected.Post("/operations/batch", h.UpsertOperations)
			protected.Get("/operations", h.ListOperations)
		})
	})

	ctx := t.Context()
	a, _ := repos.Users.Create(ctx, "alice@st.test", "h")
	family, _, _ := repos.Households.CreateHousehold(ctx, "Семья", a.ID, "Алия")
	b, _ := repos.Users.Create(ctx, "bob@st.test", "h")
	inv, _ := repos.Households.CreateInvite(ctx, family.ID, a.ID)
	_, _ = repos.Households.JoinHousehold(ctx, inv.Code, b.ID, "Бекзат")
	v, _ := repos.Users.Create(ctx, "viewer@st.test", "h")
	s, _ := repos.Users.Create(ctx, "stranger@st.test", "h")
	other, _, _ := repos.Households.CreateHousehold(ctx, "Чужие", s.ID, "Чужой")

	token := func(userID, householdID, role, slot string) string {
		tok, err := tokens.GenerateToken(userID, householdID, role, slot)
		if err != nil {
			t.Fatalf("token: %v", err)
		}
		return tok
	}
	return statementsApp{
		router:   r,
		alice:    token(a.ID, family.ID, "member", "a"),
		bob:      token(b.ID, family.ID, "member", "b"),
		viewer:   token(v.ID, family.ID, "viewer", "c"),
		stranger: token(s.ID, other.ID, "member", "a"),
	}
}

func (app statementsApp) do(t *testing.T, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	switch b := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case []byte:
		reader = bytes.NewReader(b)
	default:
		data, err := json.Marshal(b)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	app.router.ServeHTTP(rec, req)
	return rec
}

func op(id string, amount int64) map[string]any {
	return map[string]any{
		"id": id, "bank": "kaspi", "date": "2026-09-21", "amount": amount, "kind": "purchase",
		"merchant": "Magnum", "category_id": "sc_food", "internal": false,
	}
}

type opsPage struct {
	Operations []models.Operation `json:"operations"`
	Next       *time.Time         `json:"next"`
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return v
}

func TestStatementUploadsRolesAndFamily(t *testing.T) {
	app := setupStatementsApp(t)
	upload := map[string]any{"bank": "kaspi", "period_from": "2026-06-26", "period_to": "2026-09-26", "ops_count": 345}

	rec := app.do(t, http.MethodPost, "/api/statements", app.alice, upload)
	if rec.Code != http.StatusCreated {
		t.Fatalf("member upload: want 201, got %d %s", rec.Code, rec.Body.String())
	}
	created := decode[models.StatementUpload](t, rec)
	if created.Slot != "a" || created.Bank != "kaspi" || created.OpsCount != 345 || created.PeriodFrom != "2026-06-26" {
		t.Fatalf("unexpected upload: %+v", created)
	}

	if rec := app.do(t, http.MethodPost, "/api/statements", app.viewer, upload); rec.Code != http.StatusForbidden {
		t.Fatalf("viewer upload: want 403, got %d", rec.Code)
	}

	for name, token := range map[string]string{"partner": app.bob, "viewer": app.viewer} {
		rec := app.do(t, http.MethodGet, "/api/statements", token, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s list: want 200, got %d", name, rec.Code)
		}
		list := decode[struct{ Uploads []models.StatementUpload }](t, rec)
		if len(list.Uploads) != 1 || list.Uploads[0].ID != created.ID || list.Uploads[0].Slot != "a" {
			t.Fatalf("%s sees %+v", name, list.Uploads)
		}
	}

	rec = app.do(t, http.MethodGet, "/api/statements", app.stranger, nil)
	if list := decode[struct{ Uploads []models.StatementUpload }](t, rec); len(list.Uploads) != 0 {
		t.Fatalf("another family sees uploads: %+v", list.Uploads)
	}

	for _, bad := range []map[string]any{
		{"bank": "halyk", "period_from": "2026-06-01", "period_to": "2026-06-30", "ops_count": 1},
		{"bank": "kaspi", "period_from": "2026-06-31", "period_to": "2026-07-30", "ops_count": 1},
		{"bank": "kaspi", "period_from": "2026-07-30", "period_to": "2026-07-01", "ops_count": 1},
		{"bank": "kaspi", "period_from": "2026-07-01", "period_to": "2026-07-30", "ops_count": -1},
	} {
		if rec := app.do(t, http.MethodPost, "/api/statements", app.alice, bad); rec.Code != http.StatusBadRequest {
			t.Errorf("upload %v: want 400, got %d", bad, rec.Code)
		}
	}
}

func TestOperationsOwnerOnlyAndRoles(t *testing.T) {
	app := setupStatementsApp(t)
	batch := map[string]any{"operations": []any{op("aaaa0001", -1200), op("aaaa0002", -800)}}

	rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, batch)
	if rec.Code != http.StatusOK || decode[map[string]int](t, rec)["upserted"] != 2 {
		t.Fatalf("member batch: %d %s", rec.Code, rec.Body.String())
	}

	rec = app.do(t, http.MethodGet, "/api/operations", app.alice, nil)
	if page := decode[opsPage](t, rec); len(page.Operations) != 2 || page.Next == nil {
		t.Fatalf("owner reads: %+v", page)
	}
	// Партнёр и чужая семья не получают операций Алии ни одной ручкой.
	for name, token := range map[string]string{"partner": app.bob, "stranger": app.stranger} {
		rec := app.do(t, http.MethodGet, "/api/operations", token, nil)
		if page := decode[opsPage](t, rec); rec.Code != http.StatusOK || len(page.Operations) != 0 || page.Next != nil {
			t.Fatalf("%s reads: %d %s", name, rec.Code, rec.Body.String())
		}
	}
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/api/operations/batch"},
		{http.MethodGet, "/api/operations"},
	} {
		if rec := app.do(t, c.method, c.path, app.viewer, batch); rec.Code != http.StatusForbidden {
			t.Errorf("viewer %s %s: want 403, got %d", c.method, c.path, rec.Code)
		}
	}
	if rec := app.do(t, http.MethodGet, "/api/operations", "", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: want 401, got %d", rec.Code)
	}
}

func TestOperationsValidation(t *testing.T) {
	app := setupStatementsApp(t)
	with := func(key string, value any) map[string]any {
		o := op("bbbb0001", -500)
		o[key] = value
		return o
	}
	cases := map[string]map[string]any{
		"amount not integer":        with("amount", 12.5),
		"amount out of int64":       with("amount", 1e20),
		"bad date":                  with("date", "2026-13-01"),
		"unknown kind":              with("kind", "salary"),
		"purchase without merchant": with("merchant", "  "),
		"digits in merchant":        with("merchant", "POS 123456"),
		"digits in counterparty":    with("counterparty", "Карта 1234567890"),
		"digits in note":            with("note", "договор №0022412"),
		"note too long":             with("note", strings.Repeat("я", 201)),
		"merchant too long":         with("merchant", strings.Repeat("m", 201)),
		"id not hex":                with("id", "XYZ12345"),
		"id too short":              with("id", "abc"),
		"unknown bank":              with("bank", "halyk"),
		"upload_id not uuid":        with("upload_id", "not-a-uuid"),
	}
	for name, bad := range cases {
		rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, map[string]any{"operations": []any{bad}})
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "123456") || strings.Contains(rec.Body.String(), "0022412") {
			t.Errorf("%s: response echoes the text: %s", name, rec.Body.String())
		}
	}
	// Пять цифр подряд — можно (хвост карты, «555 MARKET»).
	ok := with("merchant", "Банк*01234 555 MARKET")
	if rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, map[string]any{"operations": []any{ok}}); rec.Code != http.StatusOK {
		t.Errorf("five digits: want 200, got %d %s", rec.Code, rec.Body.String())
	}
	if rec := app.do(t, http.MethodGet, "/api/operations?since=yesterday", app.alice, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("bad since: want 400, got %d", rec.Code)
	}
	for _, limit := range []string{"0", "2001", "x"} {
		if rec := app.do(t, http.MethodGet, "/api/operations?limit="+limit, app.alice, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("limit %s: want 400, got %d", limit, rec.Code)
		}
	}
}

func TestOperationsBatchLimits(t *testing.T) {
	app := setupStatementsApp(t)
	many := make([]any, maxBatchRows+1)
	for i := range many {
		many[i] = op(fmt.Sprintf("cccc%04x", i), -1)
	}
	if rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, map[string]any{"operations": many}); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("2001 rows: want 413, got %d", rec.Code)
	}
	huge := []byte(`{"operations":[` + strings.Repeat(" ", maxBatchBodyBytes) + `]}`)
	if rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, huge); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("body over 2 MB: want 413, got %d", rec.Code)
	}
}

func TestOperationsCursorAndUpsert(t *testing.T) {
	app := setupStatementsApp(t)
	post := func(ops ...map[string]any) {
		t.Helper()
		list := make([]any, len(ops))
		for i, o := range ops {
			list[i] = o
		}
		if rec := app.do(t, http.MethodPost, "/api/operations/batch", app.alice, map[string]any{"operations": list}); rec.Code != http.StatusOK {
			t.Fatalf("batch: %d %s", rec.Code, rec.Body.String())
		}
	}
	page := func(since *time.Time, limit int) opsPage {
		t.Helper()
		path := fmt.Sprintf("/api/operations?limit=%d", limit)
		if since != nil {
			path += "&since=" + since.Format(time.RFC3339Nano)
		}
		rec := app.do(t, http.MethodGet, path, app.alice, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("page: %d %s", rec.Code, rec.Body.String())
		}
		return decode[opsPage](t, rec)
	}

	post(op("dddd0001", -1), op("dddd0002", -2), op("dddd0003", -3))
	post(op("dddd0004", -4), op("dddd0005", -5), op("dddd0006", -6))

	// Две страницы без пропусков и дублей, третья пустая.
	seen := map[string]int{}
	var since *time.Time
	for i := 0; i < 3; i++ {
		p := page(since, 3)
		for _, o := range p.Operations {
			seen[o.ID]++
		}
		if i < 2 && len(p.Operations) != 3 {
			t.Fatalf("page %d: %d operations", i, len(p.Operations))
		}
		if i == 2 && (len(p.Operations) != 0 || p.Next != nil) {
			t.Fatalf("page 3 must be empty: %+v", p)
		}
		since = p.Next
		if since == nil {
			since = &time.Time{}
		}
	}
	if len(seen) != 6 {
		t.Fatalf("pages cover %d of 6 operations", len(seen))
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("%s seen %d times", id, n)
		}
	}

	// Лимит посреди одного батча: страница дочитывает его, иначе курсор потерял бы строки.
	if p := page(nil, 2); len(p.Operations) != 3 {
		t.Fatalf("page ending inside a batch: want 3 (whole batch), got %d", len(p.Operations))
	}

	// Повторная загрузка: та же строка — одна, раздел обновлён, строка снова видна по курсору.
	before := page(nil, 2000)
	cursor := before.Next
	changed := op("dddd0002", -2)
	changed["category_id"] = "sc_home"
	post(changed)
	after := page(cursor, 2000)
	if len(after.Operations) != 1 || after.Operations[0].ID != "dddd0002" || *after.Operations[0].CategoryID != "sc_home" {
		t.Fatalf("upsert: %+v", after.Operations)
	}
	if all := page(nil, 2000); len(all.Operations) != 6 {
		t.Fatalf("upsert must not duplicate: %d rows", len(all.Operations))
	}
}
