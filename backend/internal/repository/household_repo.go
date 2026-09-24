package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"finance-backend/internal/models"
)

var (
	ErrHouseholdNotFound  = errors.New("household not found")
	ErrMembershipNotFound = errors.New("user does not belong to any household")
	ErrInviteNotFound     = errors.New("invite not found")
	ErrInviteExpired      = errors.New("invite code has expired")
	ErrInviteAlreadyUsed  = errors.New("invite code has already been used")
	ErrHouseholdFull      = errors.New("household has reached maximum members")
)

type HouseholdRepository interface {
	CreateHousehold(ctx context.Context, name, creatorID, creatorDisplayName string) (*models.Household, *models.HouseholdMember, error)
	GetHousehold(ctx context.Context, householdID string) (*models.Household, error)
	GetMembership(ctx context.Context, userID string) (*models.HouseholdMember, *models.Household, error)
	GetMembers(ctx context.Context, householdID string) ([]models.HouseholdMember, error)
	CreateInvite(ctx context.Context, householdID, creatorID string) (*models.HouseholdInvite, error)
	GetInvite(ctx context.Context, code string) (*models.HouseholdInvite, error)
	JoinHousehold(ctx context.Context, code, userID, displayName string) (*models.HouseholdMember, error)
}

type sqlHouseholdRepository struct {
	db *sql.DB
}

func NewSQLHouseholdRepository(db *sql.DB) HouseholdRepository {
	return &sqlHouseholdRepository{db: db}
}

func (r *sqlHouseholdRepository) CreateHousehold(ctx context.Context, name, creatorID, creatorDisplayName string) (*models.Household, *models.HouseholdMember, error) {
	if strings.TrimSpace(name) == "" {
		name = "Наша казна"
	}
	if strings.TrimSpace(creatorDisplayName) == "" {
		creatorDisplayName = "Участник"
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback()

	// 1. Insert household
	h := &models.Household{}
	insertHHQuery := `
		INSERT INTO households (name, created_by)
		VALUES ($1, $2)
		RETURNING id, name, created_by, created_at;`
	if err := tx.QueryRowContext(ctx, insertHHQuery, name, creatorID).Scan(
		&h.ID, &h.Name, &h.CreatedBy, &h.CreatedAt,
	); err != nil {
		return nil, nil, fmt.Errorf("failed to insert household: %w", err)
	}

	// 2. Insert member (slot: 'a', role: 'member')
	m := &models.HouseholdMember{}
	insertMemberQuery := `
		INSERT INTO household_members (household_id, user_id, slot, display_name, role)
		VALUES ($1, $2, 'a', $3, 'member')
		RETURNING household_id, user_id, slot, display_name, role, joined_at;`
	if err := tx.QueryRowContext(ctx, insertMemberQuery, h.ID, creatorID, creatorDisplayName).Scan(
		&m.HouseholdID, &m.UserID, &m.Slot, &m.DisplayName, &m.Role, &m.JoinedAt,
	); err != nil {
		return nil, nil, fmt.Errorf("failed to insert member: %w", err)
	}

	// 3. Initialize household_docs
	insertDocQuery := `
		INSERT INTO household_docs (household_id, rev, data, updated_by)
		VALUES ($1, 1, '{}'::jsonb, $2);`
	if _, err := tx.ExecContext(ctx, insertDocQuery, h.ID, creatorID); err != nil {
		return nil, nil, fmt.Errorf("failed to initialize household_docs: %w", err)
	}

	// 4. Initialize private_docs for creator
	insertPrivDocQuery := `
		INSERT INTO private_docs (household_id, user_id, rev, data)
		VALUES ($1, $2, 1, '{}'::jsonb);`
	if _, err := tx.ExecContext(ctx, insertPrivDocQuery, h.ID, creatorID); err != nil {
		return nil, nil, fmt.Errorf("failed to initialize private_docs: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, fmt.Errorf("failed to commit household creation: %w", err)
	}

	return h, m, nil
}

func (r *sqlHouseholdRepository) GetHousehold(ctx context.Context, householdID string) (*models.Household, error) {
	query := `
		SELECT id, name, created_by, created_at
		FROM households
		WHERE id = $1;`

	h := &models.Household{}
	err := r.db.QueryRowContext(ctx, query, householdID).Scan(
		&h.ID, &h.Name, &h.CreatedBy, &h.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrHouseholdNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get household: %w", err)
	}
	return h, nil
}

func (r *sqlHouseholdRepository) GetMembership(ctx context.Context, userID string) (*models.HouseholdMember, *models.Household, error) {
	query := `
		SELECT m.household_id, m.user_id, m.slot, m.display_name, m.role, m.joined_at,
		       h.id, h.name, h.created_by, h.created_at
		FROM household_members m
		JOIN households h ON h.id = m.household_id
		WHERE m.user_id = $1
		ORDER BY m.joined_at DESC
		LIMIT 1;`

	m := &models.HouseholdMember{}
	h := &models.Household{}
	err := r.db.QueryRowContext(ctx, query, userID).Scan(
		&m.HouseholdID, &m.UserID, &m.Slot, &m.DisplayName, &m.Role, &m.JoinedAt,
		&h.ID, &h.Name, &h.CreatedBy, &h.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrMembershipNotFound
	}
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get membership: %w", err)
	}

	return m, h, nil
}

func (r *sqlHouseholdRepository) GetMembers(ctx context.Context, householdID string) ([]models.HouseholdMember, error) {
	query := `
		SELECT household_id, user_id, slot, display_name, role, joined_at
		FROM household_members
		WHERE household_id = $1
		ORDER BY slot ASC;`

	rows, err := r.db.QueryContext(ctx, query, householdID)
	if err != nil {
		return nil, fmt.Errorf("failed to list members: %w", err)
	}
	defer rows.Close()

	var members []models.HouseholdMember
	for rows.Next() {
		var m models.HouseholdMember
		if err := rows.Scan(&m.HouseholdID, &m.UserID, &m.Slot, &m.DisplayName, &m.Role, &m.JoinedAt); err != nil {
			return nil, fmt.Errorf("failed to scan member: %w", err)
		}
		members = append(members, m)
	}

	return members, rows.Err()
}

func (r *sqlHouseholdRepository) CreateInvite(ctx context.Context, householdID, creatorID string) (*models.HouseholdInvite, error) {
	codeBytes := make([]byte, 4)
	if _, err := rand.Read(codeBytes); err != nil {
		return nil, fmt.Errorf("failed to generate random invite code: %w", err)
	}
	code := strings.ToUpper(hex.EncodeToString(codeBytes))

	query := `
		INSERT INTO household_invites (code, household_id, created_by, expires_at)
		VALUES ($1, $2, $3, now() + INTERVAL '14 days')
		RETURNING code, household_id, created_by, created_at, expires_at;`

	inv := &models.HouseholdInvite{}
	err := r.db.QueryRowContext(ctx, query, code, householdID, creatorID).Scan(
		&inv.Code, &inv.HouseholdID, &inv.CreatedBy, &inv.CreatedAt, &inv.ExpiresAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create invite: %w", err)
	}

	return inv, nil
}

func (r *sqlHouseholdRepository) GetInvite(ctx context.Context, code string) (*models.HouseholdInvite, error) {
	query := `
		SELECT code, household_id, created_by, created_at, expires_at, used_by, used_at
		FROM household_invites
		WHERE code = $1;`

	inv := &models.HouseholdInvite{}
	err := r.db.QueryRowContext(ctx, query, strings.ToUpper(strings.TrimSpace(code))).Scan(
		&inv.Code, &inv.HouseholdID, &inv.CreatedBy, &inv.CreatedAt, &inv.ExpiresAt, &inv.UsedBy, &inv.UsedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get invite: %w", err)
	}

	return inv, nil
}

func (r *sqlHouseholdRepository) JoinHousehold(ctx context.Context, code, userID, displayName string) (*models.HouseholdMember, error) {
	cleanedCode := strings.ToUpper(strings.TrimSpace(code))
	if strings.TrimSpace(displayName) == "" {
		displayName = "Участник"
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback()

	// 1. Lock and check invite
	invQuery := `
		SELECT code, household_id, created_by, created_at, expires_at, used_by, used_at
		FROM household_invites
		WHERE code = $1
		FOR UPDATE;`
	inv := &models.HouseholdInvite{}
	err = tx.QueryRowContext(ctx, invQuery, cleanedCode).Scan(
		&inv.Code, &inv.HouseholdID, &inv.CreatedBy, &inv.CreatedAt, &inv.ExpiresAt, &inv.UsedBy, &inv.UsedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrInviteNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read invite: %w", err)
	}

	if inv.UsedAt != nil {
		return nil, ErrInviteAlreadyUsed
	}
	if time.Now().After(inv.ExpiresAt) {
		return nil, ErrInviteExpired
	}

	// 2. Lock parent household to strictly serialize concurrent joins and slot assignment
	var lockedHouseholdID string
	if err := tx.QueryRowContext(ctx, `SELECT id FROM households WHERE id = $1 FOR UPDATE;`, inv.HouseholdID).Scan(&lockedHouseholdID); err != nil {
		return nil, fmt.Errorf("failed to lock household: %w", err)
	}

	// 3. Check if user is already a member of this household
	var existingMember models.HouseholdMember
	checkMemberQuery := `
		SELECT household_id, user_id, slot, display_name, role, joined_at
		FROM household_members
		WHERE household_id = $1 AND user_id = $2;`
	err = tx.QueryRowContext(ctx, checkMemberQuery, inv.HouseholdID, userID).Scan(
		&existingMember.HouseholdID, &existingMember.UserID, &existingMember.Slot,
		&existingMember.DisplayName, &existingMember.Role, &existingMember.JoinedAt,
	)
	if err == nil {
		// Already a member
		return &existingMember, nil
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("failed to check existing membership: %w", err)
	}

	// 3. Find available slot ('a', 'b', 'c')
	usedSlotsRows, err := tx.QueryContext(ctx, `SELECT slot FROM household_members WHERE household_id = $1;`, inv.HouseholdID)
	if err != nil {
		return nil, fmt.Errorf("failed to query used slots: %w", err)
	}
	defer usedSlotsRows.Close()

	usedSlots := make(map[string]bool)
	for usedSlotsRows.Next() {
		var s string
		if err := usedSlotsRows.Scan(&s); err != nil {
			return nil, err
		}
		usedSlots[s] = true
	}
	if err := usedSlotsRows.Err(); err != nil {
		return nil, fmt.Errorf("failed during slots iteration: %w", err)
	}

	var assignedSlot string
	for _, candidate := range []string{"a", "b", "c"} {
		if !usedSlots[candidate] {
			assignedSlot = candidate
			break
		}
	}
	if assignedSlot == "" {
		return nil, ErrHouseholdFull
	}

	// 4. Insert new member
	m := &models.HouseholdMember{}
	insertMemberQuery := `
		INSERT INTO household_members (household_id, user_id, slot, display_name, role)
		VALUES ($1, $2, $3, $4, 'member')
		RETURNING household_id, user_id, slot, display_name, role, joined_at;`
	if err := tx.QueryRowContext(ctx, insertMemberQuery, inv.HouseholdID, userID, assignedSlot, displayName).Scan(
		&m.HouseholdID, &m.UserID, &m.Slot, &m.DisplayName, &m.Role, &m.JoinedAt,
	); err != nil {
		return nil, fmt.Errorf("failed to insert new member: %w", err)
	}

	// 5. Initialize private_docs for this user
	insertPrivDocQuery := `
		INSERT INTO private_docs (household_id, user_id, rev, data)
		VALUES ($1, $2, 1, '{}'::jsonb)
		ON CONFLICT DO NOTHING;`
	if _, err := tx.ExecContext(ctx, insertPrivDocQuery, inv.HouseholdID, userID); err != nil {
		return nil, fmt.Errorf("failed to initialize private doc: %w", err)
	}

	// 6. Mark invite as used
	updateInvQuery := `
		UPDATE household_invites
		SET used_by = $1, used_at = now()
		WHERE code = $2;`
	if _, err := tx.ExecContext(ctx, updateInvQuery, userID, inv.Code); err != nil {
		return nil, fmt.Errorf("failed to mark invite used: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit join household: %w", err)
	}

	return m, nil
}
