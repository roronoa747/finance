package repository

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"finance-backend/internal/db"
	"finance-backend/internal/models"
	"finance-backend/internal/testdb"
	"finance-backend/migrations"
)

type statementFixture struct {
	db          *sql.DB
	repo        StatementRepository
	users       UserRepository
	householdID string
	aliceID     string
	bobID       string
}

func newStatementFixture(t *testing.T) statementFixture {
	t.Helper()
	database := testdb.Open(t)
	ctx := context.Background()
	users := NewSQLUserRepository(database)
	households := NewSQLHouseholdRepository(database)
	alice, err := users.Create(ctx, "alice@st.pg", "hash")
	if err != nil {
		t.Fatalf("create alice: %v", err)
	}
	h, _, err := households.CreateHousehold(ctx, "Семья", alice.ID, "Алия")
	if err != nil {
		t.Fatalf("create household: %v", err)
	}
	bob, _ := users.Create(ctx, "bob@st.pg", "hash")
	inv, _ := households.CreateInvite(ctx, h.ID, alice.ID)
	if _, err := households.JoinHousehold(ctx, inv.Code, bob.ID, "Бекзат"); err != nil {
		t.Fatalf("join: %v", err)
	}
	return statementFixture{database, NewSQLStatementRepository(database), users, h.ID, alice.ID, bob.ID}
}

func strp(s string) *string { return &s }

func pgOp(id string, amount int64) models.Operation {
	return models.Operation{ID: id, Bank: "kaspi", Date: "2026-09-21", Amount: amount, Kind: "purchase",
		Merchant: "Magnum", CategoryID: strp("sc_food")}
}

func TestPostgresStatementsMigrationRerun(t *testing.T) {
	f := newStatementFixture(t)
	// Уже мигрированная база: повторный прогон ничего не ломает и не трогает данные.
	if _, err := f.repo.UpsertOperations(context.Background(), f.aliceID, f.householdID, []models.Operation{pgOp("aaaa0001", -1)}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := db.RunMigrations(context.Background(), f.db, migrations.FS); err != nil {
		t.Fatalf("rerun migrations: %v", err)
	}
	var n int
	if err := f.db.QueryRow(`SELECT count(*) FROM app.operations`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("rows after rerun: %d, %v", n, err)
	}
	var tables int
	_ = f.db.QueryRow(`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`).Scan(&tables)
	if tables != 0 {
		t.Fatalf("migration created %d tables in public", tables)
	}
}

func TestPostgresStatementsUploadsAndOperations(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()

	up, err := f.repo.CreateUpload(ctx, f.householdID, f.aliceID, UploadInput{Bank: "kaspi", PeriodFrom: "2026-06-26", PeriodTo: "2026-09-26", OpsCount: 2})
	if err != nil {
		t.Fatalf("create upload: %v", err)
	}
	if up.Slot != "a" || up.PeriodFrom != "2026-06-26" || up.PeriodTo != "2026-09-26" {
		t.Fatalf("upload: %+v", up)
	}
	list, err := f.repo.ListUploads(ctx, f.householdID, 200)
	if err != nil || len(list) != 1 || list[0].ID != up.ID || list[0].Slot != "a" {
		t.Fatalf("list uploads: %+v %v", list, err)
	}

	// Идемпотентный upsert: те же id — те же строки, поля обновляются; чужая загрузка не цепляется.
	first := []models.Operation{pgOp("aaaa0001", -1200), pgOp("aaaa0002", -800)}
	first[0].UploadID = &up.ID
	if n, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, first); err != nil || n != 2 {
		t.Fatalf("upsert: %d %v", n, err)
	}
	page, _ := f.repo.ListOperations(ctx, f.aliceID, time.Time{}, 2000)
	if len(page) != 2 || page[0].UploadID == nil || *page[0].UploadID != up.ID || page[0].Date != "2026-09-21" {
		t.Fatalf("first page: %+v", page)
	}
	cursor := page[len(page)-1].UpdatedAt

	again := pgOp("aaaa0001", -1200)
	again.CategoryID = strp("sc_home")
	again.Counterparty = strp("Дана К.")
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{again, again}); err != nil {
		t.Fatalf("re-upsert with duplicate in batch: %v", err)
	}
	changed, _ := f.repo.ListOperations(ctx, f.aliceID, cursor, 2000)
	if len(changed) != 1 || changed[0].ID != "aaaa0001" || *changed[0].CategoryID != "sc_home" || *changed[0].Counterparty != "Дана К." {
		t.Fatalf("cursor after upsert: %+v", changed)
	}
	if changed[0].UploadID == nil || *changed[0].UploadID != up.ID {
		t.Fatalf("upload link lost on re-upsert: %+v", changed[0].UploadID)
	}
	all, _ := f.repo.ListOperations(ctx, f.aliceID, time.Time{}, 2000)
	if len(all) != 2 {
		t.Fatalf("upsert duplicated rows: %d", len(all))
	}

	// Партнёр — ни одной строки Алии; ссылка на чужую загрузку — NULL.
	bobOp := pgOp("bbbb0001", -5)
	bobOp.UploadID = &up.ID
	if _, err := f.repo.UpsertOperations(ctx, f.bobID, f.householdID, []models.Operation{bobOp}); err != nil {
		t.Fatalf("bob upsert: %v", err)
	}
	bobs, _ := f.repo.ListOperations(ctx, f.bobID, time.Time{}, 2000)
	if len(bobs) != 1 || bobs[0].ID != "bbbb0001" || bobs[0].UploadID != nil {
		t.Fatalf("bob sees: %+v", bobs)
	}
}

func TestPostgresStatementsCursorNeverSplitsABatch(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	batch := make([]models.Operation, 0, 5)
	for _, id := range []string{"cccc0001", "cccc0002", "cccc0003", "cccc0004", "cccc0005"} {
		batch = append(batch, pgOp(id, -1))
	}
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, batch); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{pgOp("cccc0006", -1)}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	first, _ := f.repo.ListOperations(ctx, f.aliceID, time.Time{}, 2)
	if len(first) != 5 {
		t.Fatalf("page cut inside a batch: %d rows", len(first))
	}
	rest, _ := f.repo.ListOperations(ctx, f.aliceID, first[len(first)-1].UpdatedAt, 2)
	if len(rest) != 1 || rest[0].ID != "cccc0006" {
		t.Fatalf("second page: %+v", rest)
	}
}

func TestPostgresStatementsCascadesAndGuards(t *testing.T) {
	f := newStatementFixture(t)
	ctx := context.Background()
	up, _ := f.repo.CreateUpload(ctx, f.householdID, f.aliceID, UploadInput{Bank: "kaspi", PeriodFrom: "2026-09-01", PeriodTo: "2026-09-30", OpsCount: 1})
	o := pgOp("dddd0001", -1)
	o.UploadID = &up.ID
	if _, err := f.repo.UpsertOperations(ctx, f.aliceID, f.householdID, []models.Operation{o}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Удаление загрузки не трогает операции — ссылка становится NULL.
	if _, err := f.db.Exec(`DELETE FROM app.statement_uploads WHERE id = $1`, up.ID); err != nil {
		t.Fatalf("delete upload: %v", err)
	}
	ops, _ := f.repo.ListOperations(ctx, f.aliceID, time.Time{}, 10)
	if len(ops) != 1 || ops[0].UploadID != nil {
		t.Fatalf("after upload delete: %+v", ops)
	}

	// Последняя линия (Р-23): база сама не принимает длинные цифры и чужой вид.
	for name, q := range map[string]string{
		"digits in merchant": `INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant) VALUES ($1, 'eeee0001', $2, 'kaspi', '2026-09-01', -1, 'purchase', 'POS 1234567')`,
		"unknown kind":       `INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant) VALUES ($1, 'eeee0002', $2, 'kaspi', '2026-09-01', -1, 'salary', 'x')`,
		"bad id":             `INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant) VALUES ($1, 'NOT-HEX', $2, 'kaspi', '2026-09-01', -1, 'purchase', 'x')`,
	} {
		if _, err := f.db.Exec(q, f.aliceID, f.householdID); err == nil {
			t.Errorf("%s: the database accepted it", name)
		}
	}

	// Удаление пользователя каскадом удаляет его операции и загрузки.
	_, _ = f.repo.CreateUpload(ctx, f.householdID, f.bobID, UploadInput{Bank: "freedom", PeriodFrom: "2026-09-01", PeriodTo: "2026-09-30", OpsCount: 0})
	if _, err := f.repo.UpsertOperations(ctx, f.bobID, f.householdID, []models.Operation{pgOp("ffff0001", -1)}); err != nil {
		t.Fatalf("bob upsert: %v", err)
	}
	if err := f.users.Delete(ctx, f.bobID); err != nil {
		t.Fatalf("delete bob: %v", err)
	}
	var ops2, uploads int
	_ = f.db.QueryRow(`SELECT count(*) FROM app.operations WHERE user_id = $1`, f.bobID).Scan(&ops2)
	_ = f.db.QueryRow(`SELECT count(*) FROM app.statement_uploads WHERE user_id = $1`, f.bobID).Scan(&uploads)
	if ops2 != 0 || uploads != 0 {
		t.Fatalf("after user delete: %d operations, %d uploads", ops2, uploads)
	}
}
