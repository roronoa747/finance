package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"finance-backend/internal/applepay"
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
	// Operations from a phone (Apple Pay, Р-14).
	PhoneOperationRepository
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

const operationColumns = 12

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
			// source, occurred_at and fx_* are the server's (Apple Pay): a batch never writes them,
			// a new row from a batch is a statement line (the column default).
			values = append(values, fmt.Sprintf(
				"($1, %s, $2, (SELECT u.id FROM app.statement_uploads u WHERE u.id = %s::uuid AND u.user_id = $1), %s, %s::date, %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s THEN now() END)",
				p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8), p(9), p(10), p(11), p(12)))
			args = append(args, op.ID, op.UploadID, op.Bank, op.Date, op.Amount, op.Kind, op.Merchant,
				op.Counterparty, op.Note, op.CategoryID, op.Internal, op.Deleted)
		}
		// The tombstone is one-way: a later batch without "deleted" (an old client) keeps it.
		query := `
			INSERT INTO app.operations
				(user_id, id, household_id, upload_id, bank, op_date, amount, kind, merchant, counterparty, note, category_id, internal, deleted_at)
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
				deleted_at = COALESCE(app.operations.deleted_at, EXCLUDED.deleted_at),
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
	       upload_id::text, updated_at, source, occurred_at, fx_currency, fx_amount, deleted_at IS NOT NULL
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
			&op.Note, &op.CategoryID, &op.Internal, &op.UploadID, &op.UpdatedAt,
			&op.Source, &op.OccurredAt, &op.FxCurrency, &op.FxAmount, &op.Deleted); err != nil {
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

// PhoneOperation is an operation the server writes from a phone (Р-14): an Apple Pay tap or a
// bank push (Блок 2), kept in app.operations with its source, the moment it arrived and, for a
// foreign currency, the amount in that currency (amount stays 0 until the phone converts it,
// Р-15).
type PhoneOperation struct {
	ID       string
	Bank     string
	Date     string // YYYY-MM-DD, Almaty
	Amount   int64
	Merchant string
	// Kind: purchase (empty — a tap) | transfer-out | transfer-in | income | cash.
	Kind string
	// Internal: the bank itself said the transfer is between the person's own accounts.
	Internal   bool
	Source     string // tap | push
	OccurredAt time.Time
	FxCurrency *string
	FxAmount   *int64
}

// PhoneWindows are the time rules of phone operations.
type PhoneWindows struct {
	// Repeat: the same source and money within it is one operation — the trigger fired twice (Р-9).
	Repeat time.Duration
	// Pair: a tap and a push of one purchase within it are one operation (Р-9, Р-21); a transfer out
	// of one bank and the same money into another within it are the person's own (Р-8).
	Pair time.Duration
}

// PhoneInsert is what InsertPhoneOperation did.
type PhoneInsert string

const (
	PhoneSaved  PhoneInsert = "saved"
	PhoneRepeat PhoneInsert = "repeat"
	// PhoneMerged: the tap or push of the same purchase was there — that operation took this one's
	// bank or merchant, nothing new written.
	PhoneMerged PhoneInsert = "merged"
	// PhonePaired: written, and it and its other half are a transfer between own banks (internal).
	PhonePaired PhoneInsert = "paired"
)

// PushCounted is the column of app.push_stats a push counts in.
const (
	PushParsed  = "parsed"
	PushIgnored = "ignored"
	PushUnknown = "unknown"
)

// PhoneOperationRepository writes and checks operations that come from a phone.
type PhoneOperationRepository interface {
	// InsertPhoneOperation writes the operation unless (1) the person already has one of the same
	// source and money within Repeat of its moment (tenge — amount; a foreign currency —
	// fx_currency and fx_amount; a push — also the same bank and kind) — a repeat; (2) it is a
	// purchase and the other source (a tap for a push, a push for a tap) has one with the same
	// money within Pair — merged into the nearest one: the bank of the push, the merchant of the
	// tap unless it is empty (Р-21), the section cleared when the merchant changes. (3) A
	// transfer in or out of one bank with a phone transfer the other way, of the same tenge, of
	// another bank within Pair, neither naming a person (the kind's word as the merchant, AP-10 —
	// "sent a friend 5 000, got 5 000 from someone" is a spend, as pairInternalTransfers of the
	// statements) — both become internal (Р-8). The checks and the write hold the person's lock,
	// so two firings at the same moment (two serverless instances) still make one operation, in
	// any order of arrival.
	InsertPhoneOperation(ctx context.Context, userID, householdID string, op PhoneOperation, w PhoneWindows) (PhoneInsert, error)
	// CountPhoneOperationsSince counts the person's phone operations since the moment (the daily limit).
	CountPhoneOperationsSince(ctx context.Context, userID string, since time.Time) (int, error)
	// CountPush adds one push to the day's counter of its bank (Р-10, Р-23): column is PushParsed,
	// PushIgnored or PushUnknown; bank kaspi, freedom, halyk or unknown. No person, no text.
	CountPush(ctx context.Context, day, bank, column string) error
}

// phoneKind: a tap is a purchase.
func phoneKind(op PhoneOperation) string {
	if op.Kind == "" {
		return "purchase"
	}
	return op.Kind
}

// mergedFields: the bank and merchant of a tap and a push of one purchase (Р-21): bank and
// merchant are the row already there, op the one arriving; the push names the bank (unless it
// named none), the tap names the merchant (unless Apple gave none).
func mergedFields(op PhoneOperation, bank, merchant string) (string, string) {
	if op.Source == "push" { // the row is the tap
		if op.Bank != "card" {
			bank = op.Bank
		}
		if merchant == applepay.FallbackMerchant {
			merchant = op.Merchant
		}
		return bank, merchant
	}
	if bank == "card" { // the row is the push
		bank = op.Bank
	}
	if op.Merchant != applepay.FallbackMerchant {
		merchant = op.Merchant
	}
	return bank, merchant
}

// otherSource: the source a purchase from this one merges with.
func otherSource(source string) string {
	if source == "push" {
		return "tap"
	}
	return "push"
}

// oppositeTransfer: the kind of the other half of a transfer between own banks; "" — not a
// transfer, or one that names a person ("Перевод Айгерим С." is a spend, AP-10 "без получателя").
func oppositeTransfer(op PhoneOperation) string {
	if op.Internal || op.FxCurrency != nil || op.Merchant != applepay.Placeholder(phoneKind(op)) {
		return ""
	}
	switch phoneKind(op) {
	case "transfer-out":
		return "transfer-in"
	case "transfer-in":
		return "transfer-out"
	}
	return ""
}

// moneyMatch: the same money as ($5 currency or NULL, $6 amount) — used by all three checks.
const moneyMatch = `CASE WHEN $5::text IS NULL THEN fx_currency IS NULL AND amount = $6
	                   ELSE fx_currency = $5::text AND fx_amount = $6 END`

func (r *sqlStatementRepository) InsertPhoneOperation(ctx context.Context, userID, householdID string, op PhoneOperation, w PhoneWindows) (PhoneInsert, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()
	// Transaction-scoped: holds through the transaction pooler, released at commit.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('phone-op:' || $1))`, userID); err != nil {
		return "", fmt.Errorf("failed to lock phone operations: %w", err)
	}
	money := op.Amount
	if op.FxCurrency != nil && op.FxAmount != nil {
		money = *op.FxAmount
	}
	kind := phoneKind(op)
	var repeated bool
	err = tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM app.operations
			WHERE user_id = $1 AND source = $2 AND source <> 'statement' AND occurred_at BETWEEN $3 AND $4
			  AND `+moneyMatch+`
			  -- A push names its bank and kind: the same money in another bank is another push.
			  AND ($2 = 'tap' OR bank = $7 AND kind = $8)
		)`, userID, op.Source, op.OccurredAt.Add(-w.Repeat), op.OccurredAt.Add(w.Repeat), op.FxCurrency, money, op.Bank, kind).Scan(&repeated)
	if err != nil {
		return "", fmt.Errorf("failed to find phone operation: %w", err)
	}
	if repeated {
		return PhoneRepeat, nil
	}

	if kind == "purchase" && w.Pair > 0 {
		var id, bank, merchant string
		err = tx.QueryRowContext(ctx, `
			SELECT id, bank, merchant FROM app.operations
			WHERE user_id = $1 AND source = $2 AND kind = 'purchase' AND deleted_at IS NULL
			  AND occurred_at BETWEEN $3 AND $4 AND `+moneyMatch+`
			  -- Two known banks that differ are two purchases (a Halyk card tap is not a Kaspi push).
			  AND (bank = 'card' OR $8 = 'card' OR bank = $8)
			ORDER BY abs(extract(epoch FROM occurred_at - $7::timestamptz)), id
			LIMIT 1`, userID, otherSource(op.Source), op.OccurredAt.Add(-w.Pair), op.OccurredAt.Add(w.Pair),
			op.FxCurrency, money, op.OccurredAt, op.Bank).Scan(&id, &bank, &merchant)
		switch {
		case err == nil:
			bank, merchant = mergedFields(op, bank, merchant)
			if _, err := tx.ExecContext(ctx, `
				UPDATE app.operations
				SET bank = $3, merchant = $4, category_id = CASE WHEN merchant = $4 THEN category_id END, updated_at = now()
				WHERE user_id = $1 AND id = $2`, userID, id, bank, merchant); err != nil {
				return "", fmt.Errorf("failed to merge phone operation: %w", err)
			}
			if err := tx.Commit(); err != nil {
				return "", fmt.Errorf("failed to commit phone operation: %w", err)
			}
			return PhoneMerged, nil
		case !errors.Is(err, sql.ErrNoRows):
			return "", fmt.Errorf("failed to find the other half of a purchase: %w", err)
		}
	}

	internal, result := op.Internal, PhoneSaved
	if opposite := oppositeTransfer(op); opposite != "" && w.Pair > 0 {
		var id string
		err = tx.QueryRowContext(ctx, `
			SELECT id FROM app.operations
			WHERE user_id = $1 AND source <> 'statement' AND kind = $2 AND NOT internal AND deleted_at IS NULL
			  AND bank <> $3 AND fx_currency IS NULL AND amount = $4 AND occurred_at BETWEEN $5 AND $6
			  AND merchant = $8 -- the other half names no person either
			ORDER BY abs(extract(epoch FROM occurred_at - $7::timestamptz)), id
			LIMIT 1`, userID, opposite, op.Bank, -op.Amount, op.OccurredAt.Add(-w.Pair), op.OccurredAt.Add(w.Pair),
			op.OccurredAt, applepay.Placeholder(opposite)).Scan(&id)
		switch {
		case err == nil:
			if _, err := tx.ExecContext(ctx, `
				UPDATE app.operations SET internal = true, category_id = NULL, updated_at = now()
				WHERE user_id = $1 AND id = $2`, userID, id); err != nil {
				return "", fmt.Errorf("failed to pair phone transfers: %w", err)
			}
			internal, result = true, PhonePaired
		case !errors.Is(err, sql.ErrNoRows):
			return "", fmt.Errorf("failed to find the other half of a transfer: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO app.operations (user_id, id, household_id, bank, op_date, amount, kind, merchant, internal, source, occurred_at, fx_currency, fx_amount)
		VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10, $11, $12, $13)`,
		userID, op.ID, householdID, op.Bank, op.Date, op.Amount, kind, op.Merchant, internal, op.Source, op.OccurredAt,
		op.FxCurrency, op.FxAmount); err != nil {
		return "", fmt.Errorf("failed to insert phone operation: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("failed to commit phone operation: %w", err)
	}
	return result, nil
}

func (r *sqlStatementRepository) CountPhoneOperationsSince(ctx context.Context, userID string, since time.Time) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `
		SELECT count(*) FROM app.operations WHERE user_id = $1 AND source <> 'statement' AND occurred_at >= $2`,
		userID, since).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("failed to count phone operations: %w", err)
	}
	return n, nil
}

func (r *sqlStatementRepository) CountPush(ctx context.Context, day, bank, column string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO app.push_stats (day, bank, parsed, ignored, unknown)
		VALUES ($1::date, $2, ($3 = 'parsed')::int, ($3 = 'ignored')::int, ($3 = 'unknown')::int)
		ON CONFLICT (day, bank) DO UPDATE SET
			parsed = app.push_stats.parsed + EXCLUDED.parsed,
			ignored = app.push_stats.ignored + EXCLUDED.ignored,
			unknown = app.push_stats.unknown + EXCLUDED.unknown`, day, bank, column)
	if err != nil {
		return fmt.Errorf("failed to count push: %w", err)
	}
	return nil
}
