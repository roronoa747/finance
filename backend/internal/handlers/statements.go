package handlers

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"finance-backend/internal/auth"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// StatementHandler serves bank statements (B2C-06, Р-21): the family sees who
// uploaded what and when, the operations belong to their owner only. Operation
// bodies are never logged.
type StatementHandler struct {
	repo repository.StatementRepository
}

func NewStatementHandler(repo repository.StatementRepository) *StatementHandler {
	return &StatementHandler{repo: repo}
}

const (
	maxBatchBodyBytes = 2 << 20
	maxBatchRows      = 2000
	maxListUploads    = 200
	maxOpsPage        = 2000
	maxTextRunes      = 200
	maxCategoryRunes  = 64
	maxUploadOps      = 100_000
)

var (
	knownBanks = map[string]bool{"kaspi": true, "freedom": true}
	opKinds    = map[string]bool{
		"purchase": true, "transfer-out": true, "transfer-in": true, "income": true,
		"cash": true, "fee": true, "other": true,
	}
	opIDPattern = regexp.MustCompile(`^[0-9a-f]{8,32}$`)
	// Card, account and ID numbers (Р-23): the client strips them, this is the
	// second line.
	longDigits = regexp.MustCompile(`[0-9]{6,}`)
)

type uploadRequest struct {
	Bank       string `json:"bank"`
	PeriodFrom string `json:"period_from"`
	PeriodTo   string `json:"period_to"`
	OpsCount   int    `json:"ops_count"`
}

type batchRequest struct {
	Operations []models.Operation `json:"operations"`
}

type operationsPage struct {
	Operations []models.Operation `json:"operations"`
	Next       *time.Time         `json:"next"`
}

func errorJSON(w http.ResponseWriter, status int, msg string) {
	respondJSON(w, status, map[string]string{"error": msg})
}

// member returns the caller's household and user for writes: members only (403).
func member(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	householdID, userID, ok := caller(w, r)
	if !ok {
		return "", "", false
	}
	if role, _ := auth.GetRole(r.Context()); role != "member" {
		errorJSON(w, http.StatusForbidden, "forbidden: only members can use statements")
		return "", "", false
	}
	return householdID, userID, true
}

func caller(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	householdID, ok := auth.GetHouseholdID(r.Context())
	userID, ok2 := auth.GetUserID(r.Context())
	if !ok || !ok2 || strings.TrimSpace(householdID) == "" || strings.TrimSpace(userID) == "" {
		errorJSON(w, http.StatusUnauthorized, "unauthorized")
		return "", "", false
	}
	return householdID, userID, true
}

func validDate(s string) bool {
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
}

// CreateUpload — POST /api/statements (member).
func (h *StatementHandler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	var req uploadRequest
	if !decodeJSONBody(w, r, 1<<16, &req) {
		return
	}
	switch {
	case !knownBanks[req.Bank]:
		errorJSON(w, http.StatusBadRequest, "unknown bank")
		return
	case !validDate(req.PeriodFrom) || !validDate(req.PeriodTo) || req.PeriodFrom > req.PeriodTo:
		errorJSON(w, http.StatusBadRequest, "invalid period")
		return
	case req.OpsCount < 0 || req.OpsCount > maxUploadOps:
		errorJSON(w, http.StatusBadRequest, "invalid ops_count")
		return
	}
	upload, err := h.repo.CreateUpload(r.Context(), householdID, userID, repository.UploadInput{
		Bank: req.Bank, PeriodFrom: req.PeriodFrom, PeriodTo: req.PeriodTo, OpsCount: req.OpsCount,
	})
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "failed to save statement upload")
		return
	}
	respondJSON(w, http.StatusCreated, upload)
}

// ListUploads — GET /api/statements (member and viewer): the family's uploads.
func (h *StatementHandler) ListUploads(w http.ResponseWriter, r *http.Request) {
	householdID, _, ok := caller(w, r)
	if !ok {
		return
	}
	uploads, err := h.repo.ListUploads(r.Context(), householdID, maxListUploads)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "failed to list statement uploads")
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{"uploads": uploads})
}

// validateOperation checks one operation of a batch (400 with a short reason,
// never echoing the text itself).
func validateOperation(op models.Operation) string {
	text := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	switch {
	case !opIDPattern.MatchString(op.ID):
		return "invalid operation id"
	case !knownBanks[op.Bank]:
		return "unknown bank"
	case !validDate(op.Date):
		return "invalid operation date"
	case !opKinds[op.Kind]:
		return "invalid operation kind"
	case op.Kind == "purchase" && strings.TrimSpace(op.Merchant) == "":
		return "purchase without merchant"
	case op.CategoryID != nil && utf8.RuneCountInString(*op.CategoryID) > maxCategoryRunes:
		return "category_id too long"
	case op.UploadID != nil && uuid.Validate(*op.UploadID) != nil:
		return "invalid upload_id"
	}
	for _, s := range []string{op.Merchant, text(op.Counterparty), text(op.Note)} {
		if utf8.RuneCountInString(s) > maxTextRunes {
			return "text field too long"
		}
		if longDigits.MatchString(s) {
			return "text field contains a long number"
		}
		if !utf8.ValidString(s) {
			return "text field must be valid UTF-8"
		}
	}
	return ""
}

// UpsertOperations — POST /api/operations/batch (member): the caller's own
// operations; the same id updates the row.
func (h *StatementHandler) UpsertOperations(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	var req batchRequest
	if !decodeJSONBody(w, r, maxBatchBodyBytes, &req) {
		return
	}
	if len(req.Operations) > maxBatchRows {
		errorJSON(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("at most %d operations per batch", maxBatchRows))
		return
	}
	for i, op := range req.Operations {
		if msg := validateOperation(op); msg != "" {
			errorJSON(w, http.StatusBadRequest, fmt.Sprintf("operation %d: %s", i, msg))
			return
		}
	}
	n, err := h.repo.UpsertOperations(r.Context(), userID, householdID, req.Operations)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "failed to save operations")
		return
	}
	respondJSON(w, http.StatusOK, map[string]int{"upserted": n})
}

// ListOperations — GET /api/operations?since=<RFC3339>&limit=<≤2000> (member):
// the caller's operations changed after since, oldest first; next is the
// updated_at of the last one (null when the page is empty).
func (h *StatementHandler) ListOperations(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	var since time.Time
	if raw := r.URL.Query().Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			errorJSON(w, http.StatusBadRequest, "since must be RFC3339")
			return
		}
		since = t
	}
	limit := maxOpsPage
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxOpsPage {
			errorJSON(w, http.StatusBadRequest, fmt.Sprintf("limit must be 1..%d", maxOpsPage))
			return
		}
		limit = n
	}
	ops, err := h.repo.ListOperations(r.Context(), userID, since, limit)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "failed to list operations")
		return
	}
	page := operationsPage{Operations: ops}
	if len(ops) > 0 {
		page.Next = &ops[len(ops)-1].UpdatedAt
	}
	respondJSON(w, http.StatusOK, page)
}
