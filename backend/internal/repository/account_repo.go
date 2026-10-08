package repository

import (
	"context"
	"database/sql"
	"fmt"
)

// AccountRepository deletes a user together with their data (B2C-24, Р-14).
type AccountRepository interface {
	// DeleteAccount removes the user's photos, operations, uploads, private documents and
	// memberships, then the user. The last member takes the household along (documents,
	// invites, its photos and uploads); otherwise the household stays with the others and
	// households.created_by moves to the earliest remaining member. A missing user is not
	// an error.
	DeleteAccount(ctx context.Context, userID string) error
}

type sqlAccountRepository struct {
	db *sql.DB
}

func NewSQLAccountRepository(db *sql.DB) AccountRepository {
	return &sqlAccountRepository{db: db}
}

func (r *sqlAccountRepository) DeleteAccount(ctx context.Context, userID string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback()

	// Households the user is in or created. Locked like JoinHousehold locks them, so a
	// concurrent join or a partner's own deletion sees the result of this one.
	rows, err := tx.QueryContext(ctx, `
		SELECT id FROM app.households
		WHERE created_by = $1 OR id IN (SELECT household_id FROM app.household_members WHERE user_id = $1)
		ORDER BY id
		FOR UPDATE;`, userID)
	if err != nil {
		return fmt.Errorf("failed to lock households: %w", err)
	}
	var householdIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan household: %w", err)
		}
		householdIDs = append(householdIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("failed to list households: %w", err)
	}

	for _, householdID := range householdIDs {
		var heir sql.NullString
		if err := tx.QueryRowContext(ctx, `
			SELECT user_id FROM app.household_members
			WHERE household_id = $1 AND user_id <> $2
			ORDER BY joined_at, slot
			LIMIT 1;`, householdID, userID).Scan(&heir); err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("failed to find remaining member: %w", err)
		}
		if !heir.Valid {
			// The last member: the household goes with everything in it (cascades).
			if _, err := tx.ExecContext(ctx, `DELETE FROM app.households WHERE id = $1;`, householdID); err != nil {
				return fmt.Errorf("failed to delete household: %w", err)
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE app.households SET created_by = $2 WHERE id = $1 AND created_by = $3;`,
			householdID, heir.String, userID); err != nil {
			return fmt.Errorf("failed to hand the household over: %w", err)
		}
	}

	// The user's own data in households that stay, then the user (the cascades repeat
	// these; the explicit order keeps the transaction readable and safe from FK changes).
	for _, q := range []string{
		`DELETE FROM app.photos WHERE user_id = $1;`,
		`DELETE FROM app.operations WHERE user_id = $1;`,
		`DELETE FROM app.statement_uploads WHERE user_id = $1;`,
		`DELETE FROM app.private_docs WHERE user_id = $1;`,
		`DELETE FROM app.household_invites WHERE created_by = $1;`,
		`DELETE FROM app.household_members WHERE user_id = $1;`,
		`DELETE FROM app.users WHERE id = $1;`,
	} {
		if _, err := tx.ExecContext(ctx, q, userID); err != nil {
			return fmt.Errorf("failed to delete account data: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit account deletion: %w", err)
	}
	return nil
}
