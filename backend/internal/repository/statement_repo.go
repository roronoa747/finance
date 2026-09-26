package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"finance-backend/internal/models"
)

// UploadInput is a new statement upload record.
type UploadInput struct {
	Bank       string
	PeriodFrom string // YYYY-MM-DD
	PeriodTo   string
	OpsCount   int
}

// StatementRepository stores statement uploads (family-visible) and personal
// operations (owner-only, Р-21).
type StatementRepository interface {
	CreateUpload(ctx context.Context, householdID, userID string, in UploadInput) (*models.StatementUpload, error)
	// ListUploads returns the household's uploads, newest first, with the
	// uploader's slot.
	ListUploads(ctx context.Context, householdID string, limit int) ([]models.StatementUpload, error)
	// UpsertOperations writes the user's operations in one transaction: a known
	// id updates every mutable field, updated_at moves forward. An upload_id not
	// owned by the user is stored as NULL.
	UpsertOperations(ctx context.Context, userID, householdID string, ops []models.Operation) (int, error)
	// ListOperations returns the user's operations with updated_at > since in
	// (updated_at, id) order. A page never ends inside one updated_at: rows of
	// one batch share it (one transaction), so a cursor cut there would skip the
	// rest. The page may therefore exceed limit by up to one batch.
	ListOperations(ctx context.Context, userID string, since time.Time, limit int) ([]models.Operation, error)
}

type sqlStatementRepository struct {
	db *sql.DB
}

func NewSQLStatementRepository(db *sql.DB) StatementRepository {
	return &sqlStatementRepository{db: db}
}

func (r *sqlStatementRepository) CreateUpload(ctx context.Context, householdID, userID string, in UploadInput) (*models.StatementUpload, error) {
	query := `
		WITH ins AS (
			INSERT INTO app.statement_uploads (household_id, user_id, bank, period_from, period_to, ops_count)
			VALUES ($1, $2, $3, $4::date, $5::date, $6)
			RETURNING id, household_id, user_id, bank, period_from, period_to, ops_count, created_at
		)
		SELECT ins.id, COALESCE(m.slot, ''), ins.bank, ins.period_from::text, ins.period_to::text, ins.ops_count, ins.created_at
		FROM ins
		LEFT JOIN app.household_members m ON m.household_id = ins.household_id AND m.user_id = ins.user_id;`

	u := &models.StatementUpload{}
	err := r.db.QueryRowContext(ctx, query, householdID, userID, in.Bank, in.PeriodFrom, in.PeriodTo, in.OpsCount).
		Scan(&u.ID, &u.Slot, &u.Bank, &u.PeriodFrom, &u.PeriodTo, &u.OpsCount, &u.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("failed to create statement upload: %w", err)
	}
	return u, nil
}

func (r *sqlStatementRepository) ListUploads(ctx context.Context, householdID string, limit int) ([]models.StatementUpload, error) {
	query := `
		SELECT u.id, COALESCE(m.slot, ''), u.bank, u.period_from::text, u.period_to::text, u.ops_count, u.created_at
		FROM app.statement_uploads u
		LEFT JOIN app.household_members m ON m.household_id = u.household_id AND m.user_id = u.user_id
		WHERE u.household_id = $1
		ORDER BY u.created_at DESC, u.id
		LIMIT $2;`

	rows, err := r.db.QueryContext(ctx, query, householdID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list statement uploads: %w", err)
	}
	defer rows.Close()

	uploads := []models.StatementUpload{}
	for rows.Next() {
		var u models.StatementUpload
		if err := rows.Scan(&u.ID, &u.Slot, &u.Bank, &u.PeriodFrom, &u.PeriodTo, &u.OpsCount, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan statement upload: %w", err)
		}
		uploads = append(uploads, u)
	}
	return uploads, rows.Err()
}

// upsertChunk keeps one INSERT well under PostgreSQL's 65535 parameters.
const upsertChunk = 500

const operationColumns = 11

func (r *sqlStatementRepository) UpsertOperations(ctx context.Context, userID, householdID string, ops []models.Operation) (int, error) {
	ops = lastByID(ops)
	if len(ops) == 0 {
		return 0, nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()

	total := 0
	for start := 0; start < len(ops); start += upsertChunk {
		chunk := ops[start:min(start+upsertChunk, len(ops))]
		values := make([]string, 0, len(chunk))
		args := make([]any, 0, 2+len(chunk)*operationColumns)
		args = append(args, userID, householdID)
		for _, op := range chunk {
			n := len(args)
			p := func(i int) string { return fmt.Sprintf("$%d", n+i) }
			// The upload counts only if it is the user's own; otherwise NULL.
			values = append(values, fmt.Sprintf(
				"($1, %s, $2, (SELECT u.id FROM app.statement_uploads u WHERE u.id = %s::uuid AND u.user_id = $1), %s, %s::date, %s, %s, %s, %s, %s, %s, %s)",
				p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), p(10), p(11)))
			args = append(args, op.ID, op.UploadID, op.Bank, op.Date, op.Amount, op.Kind, op.Merchant,
				op.Counterparty, op.Note, op.CategoryID, op.Internal)
		}
		query := `
			INSERT INTO app.operations
				(user_id, id, household_id, upload_id, bank, op_date, amount, kind, merchant, counterparty, note, category_id, internal)
			VALUES ` + strings.Join(values, ",\n") + `
			ON CONFLICT (user_id, id) DO UPDATE SET
				household_id = EXCLUDED.household_id,
				upload_id = COALESCE(EXCLUDED.upload_id, app.operations.upload_id),
				bank = EXCLUDED.bank,
				op_date = EXCLUDED.op_date,
				amount = EXCLUDED.amount,
				kind = EXCLUDED.kind,
				merchant = EXCLUDED.merchant,
				counterparty = EXCLUDED.counterparty,
				note = EXCLUDED.note,
				category_id = EXCLUDED.category_id,
				internal = EXCLUDED.internal,
				updated_at = now();`
		res, err := tx.ExecContext(ctx, query, args...)
		if err != nil {
			return 0, fmt.Errorf("failed to upsert operations: %w", err)
		}
		n, err := res.RowsAffected()
		if err != nil {
			return 0, fmt.Errorf("failed to count upserted operations: %w", err)
		}
		total += int(n)
	}

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("failed to commit operations: %w", err)
	}
	return total, nil
}

const operationSelect = `
	SELECT id, bank, op_date::text, amount, kind, merchant, counterparty, note, category_id, internal,
	       upload_id::text, updated_at
	FROM app.operations`

func (r *sqlStatementRepository) ListOperations(ctx context.Context, userID string, since time.Time, limit int) ([]models.Operation, error) {
	page, err := r.queryOperations(ctx, operationSelect+`
		WHERE user_id = $1 AND updated_at > $2
		ORDER BY updated_at, id
		LIMIT $3;`, userID, since, limit)
	if err != nil || len(page) < limit {
		return page, err
	}
	last := page[len(page)-1]
	rest, err := r.queryOperations(ctx, operationSelect+`
		WHERE user_id = $1 AND updated_at = $2 AND id > $3
		ORDER BY id;`, userID, last.UpdatedAt, last.ID)
	if err != nil {
		return nil, err
	}
	return append(page, rest...), nil
}

func (r *sqlStatementRepository) queryOperations(ctx context.Context, query string, args ...any) ([]models.Operation, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list operations: %w", err)
	}
	defer rows.Close()

	ops := []models.Operation{}
	for rows.Next() {
		var op models.Operation
		if err := rows.Scan(&op.ID, &op.Bank, &op.Date, &op.Amount, &op.Kind, &op.Merchant, &op.Counterparty,
			&op.Note, &op.CategoryID, &op.Internal, &op.UploadID, &op.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan operation: %w", err)
		}
		ops = append(ops, op)
	}
	return ops, rows.Err()
}

// lastByID drops earlier duplicates: one INSERT ... ON CONFLICT cannot touch a
// row twice, and the later line of a batch is the newer one.
func lastByID(ops []models.Operation) []models.Operation {
	index := make(map[string]int, len(ops))
	out := make([]models.Operation, 0, len(ops))
	for _, op := range ops {
		if i, ok := index[op.ID]; ok {
			out[i] = op
			continue
		}
		index[op.ID] = len(out)
		out = append(out, op)
	}
	return out
}
