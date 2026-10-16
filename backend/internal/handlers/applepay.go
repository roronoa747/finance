package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"finance-backend/internal/applepay"
	"finance-backend/internal/auth"
	"finance-backend/internal/repository"
)

// WalletHandler serves Apple Pay (бэклог «Apple Pay»): settings connect, show and revoke the
// person's phone keys (JWT, members); the phone endpoints take a phone key instead of a JWT.
// Keys and request bodies are never logged.
type WalletHandler struct {
	keys       repository.PhoneKeyRepository
	households repository.HouseholdRepository
	ops        repository.PhoneOperationRepository
	users      repository.UserRepository
	admins     []string
	// Shortcut links from the environment (Р-17); empty — no Apple Pay card for that path.
	shortcutURL, shortcutURLLegacy string
	now                            func() time.Time
}

func NewWalletHandler(keys repository.PhoneKeyRepository, households repository.HouseholdRepository, ops repository.PhoneOperationRepository,
	users repository.UserRepository, admins []string, shortcutURL, shortcutURLLegacy string) *WalletHandler {
	return &WalletHandler{keys: keys, households: households, ops: ops, users: users, admins: admins,
		shortcutURL: shortcutURL, shortcutURLLegacy: shortcutURLLegacy, now: time.Now}
}

const (
	// maxTapBody: a transaction is a few short strings (§6 of the backlog: ≤ 4 KB).
	maxTapBody = 4 << 10
	// maxDebugBody: the admin's unparsed body is kept up to 2 KB (Р-13а).
	maxDebugBody = 2 << 10
	// tapRepeat: the trigger fires twice for one payment — the same money within it is one (Р-9).
	tapRepeat = 2 * time.Minute
	// maxPhoneOpsPerDay protects the family from a looping automation (Р-13).
	maxPhoneOpsPerDay = 200
	// tapPast / tapFuture bound the command's optional "at"; outside — the server's time.
	tapPast   = 48 * time.Hour
	tapFuture = 5 * time.Minute
)

// almaty is Kazakhstan's single time zone (UTC+5): the day of a phone operation and of the limit.
var almaty = time.FixedZone("Asia/Almaty", 5*60*60)

type walletStatus struct {
	Connected         bool       `json:"connected"`
	Phones            int        `json:"phones"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	ShortcutURL       string     `json:"shortcut_url"`
	ShortcutURLLegacy string     `json:"shortcut_url_legacy"`
}

// Status — GET /api/wallet (member): connected phones and the shortcut links.
func (h *WalletHandler) Status(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	phones, last, err := h.keys.Status(r.Context(), userID)
	if err != nil {
		log.Printf("wallet: status: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read wallet status")
		return
	}
	respondJSON(w, http.StatusOK, walletStatus{
		Connected: phones > 0, Phones: phones, LastUsedAt: last,
		ShortcutURL: h.shortcutURL, ShortcutURLLegacy: h.shortcutURLLegacy,
	})
}

// Connect — POST /api/wallet/connect (member): a new key for one more phone. The only time a
// key leaves the server; it is not stored, only its hash.
func (h *WalletHandler) Connect(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	plain, hash, err := applepay.NewKey()
	if err == nil {
		err = h.keys.Add(r.Context(), userID, hash)
	}
	if err != nil {
		log.Printf("wallet: connect: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to connect")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	respondJSON(w, http.StatusCreated, map[string]string{"key": plain})
}

// Disconnect — DELETE /api/wallet (member): revokes all the person's phone keys. 204, also
// when there were none.
func (h *WalletHandler) Disconnect(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	if err := h.keys.DeleteAll(r.Context(), userID); err != nil {
		log.Printf("wallet: disconnect: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to disconnect")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// KeyAuth guards the phone endpoints: a live phone key (401 otherwise, no details), then the
// household and role from the database on every request — a viewer or a person without a
// household gets 403. The caller lands in the context like a JWT caller.
func (h *WalletHandler) KeyAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		plain, ok := applepay.ParseBearer(r.Header.Get("Authorization"))
		if !ok {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		userID, err := h.keys.UserByHash(r.Context(), applepay.HashKey(plain))
		if errors.Is(err, repository.ErrPhoneKeyNotFound) {
			errorJSON(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if err != nil {
			log.Printf("wallet: key: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to check key")
			return
		}
		m, _, err := h.households.GetMembership(r.Context(), userID)
		if errors.Is(err, repository.ErrMembershipNotFound) {
			errorJSON(w, http.StatusForbidden, "forbidden")
			return
		}
		if err != nil {
			log.Printf("wallet: membership: %v", err)
			errorJSON(w, http.StatusInternalServerError, "failed to check key")
			return
		}
		if m.Role != "member" {
			errorJSON(w, http.StatusForbidden, "forbidden")
			return
		}
		ctx := auth.WithMembership(r.Context(), userID, auth.Membership{HouseholdID: m.HouseholdID, Role: m.Role, Slot: m.Slot})
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// tapField reads one field of the tap body as text: a string as is, a number as written; an
// object or array (a Shortcuts variable sent whole) as its JSON — FindAmount looks into it.
func tapField(body map[string]json.RawMessage, key string) string {
	raw, ok := body[key]
	if !ok {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	if t := strings.TrimSpace(string(raw)); t != "null" {
		return t
	}
	return ""
}

// tapResult is the whole answer of a tap: never the operation itself.
func tapResult(w http.ResponseWriter, status, reason string) {
	out := map[string]any{"ok": status != "skipped", "status": status}
	if reason != "" {
		out["reason"] = reason
	}
	respondJSON(w, http.StatusOK, out)
}

// Tap — POST /api/wallet/tap (phone key): a purchase from the Shortcuts "Transaction" trigger
// (Р-7, Р-9, Р-13, Р-13а, Р-14, Р-15). Body {merchant?, amount?, card?, name?, at?, raw?} —
// all strings, unknown fields ignored. The owner's command sends the whole transaction as
// text in "merchant": without "amount" the money is looked for in the text. The server only
// reads the amount string: tenge go to amount (tiyn dropped), USD/EUR/RUB/CNY stay in fx_*
// with amount 0 until the phone converts them. The body is never logged; for an admin the
// body the server had to search through is kept a day for tuning the parser.
func (h *WalletHandler) Tap(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxTapBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errorJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(raw, &body); err != nil || body == nil {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	now := h.now()
	at := now
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(tapField(body, "at"))); err == nil && t.After(now.Add(-tapPast)) && t.Before(now.Add(tapFuture)) {
		at = t
	}

	merchantText, amountText := tapField(body, "merchant"), tapField(body, "amount")
	card, name, rawText := tapField(body, "card"), tapField(body, "name"), tapField(body, "raw")
	var (
		currency, merchant, reason string
		minor                      int64
		parsed, searched           bool
	)
	if strings.TrimSpace(amountText) != "" {
		currency, minor, parsed = applepay.ParseAmount(amountText)
		if !parsed {
			reason = applepay.SkipReason(amountText)
		}
		text := merchantText
		if strings.TrimSpace(text) == "" {
			text = name
		}
		merchant = applepay.CleanMerchant(text)
	} else {
		// Р-13а: the whole transaction as text.
		searched = true
		reason = "amount"
		for _, text := range []string{merchantText, rawText, name} {
			c, m, rest, found := applepay.FindAmount(text)
			if c == applepay.Unsupported {
				reason = "currency"
			}
			if !found {
				continue
			}
			currency, minor, parsed, reason = c, m, true, ""
			if text == merchantText || strings.TrimSpace(merchantText) == "" {
				merchant = applepay.MerchantFrom(rest, card)
			} else {
				merchant = applepay.MerchantFrom(merchantText, card)
			}
			break
		}
	}
	if searched {
		h.keepForAdmin(r, userID, raw)
	}
	// Less than a tenge would be written as a 0 ₸ purchase (tiyn are dropped): not money.
	if parsed && currency == "KZT" && minor < 100 {
		parsed, reason = false, "amount"
	}
	if !parsed {
		tapResult(w, "skipped", reason)
		return
	}

	bank := applepay.BankOfCard(card)
	if strings.TrimSpace(card) == "" {
		bank = applepay.BankOfCard(merchantText + "\n" + rawText + "\n" + name)
	}
	op := repository.PhoneOperation{
		Bank: bank, Date: at.In(almaty).Format(time.DateOnly), Merchant: merchant, Source: "tap", OccurredAt: at,
	}
	if currency == "KZT" {
		op.Amount = -(minor / 100) // the only arithmetic of the server: reading the string, as a statement does
	} else {
		op.FxCurrency, op.FxAmount = &currency, &minor
	}

	nowAlmaty := now.In(almaty)
	dayStart := time.Date(nowAlmaty.Year(), nowAlmaty.Month(), nowAlmaty.Day(), 0, 0, 0, 0, almaty)
	n, err := h.ops.CountPhoneOperationsSince(r.Context(), userID, dayStart)
	if err != nil {
		log.Printf("wallet: tap count: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	if n >= maxPhoneOpsPerDay {
		errorJSON(w, http.StatusTooManyRequests, "limit")
		return
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		log.Printf("wallet: tap id: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	op.ID = hex.EncodeToString(id)
	saved, err := h.ops.InsertPhoneOperation(r.Context(), userID, householdID, op, tapRepeat)
	if err != nil {
		log.Printf("wallet: tap save: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	if !saved {
		tapResult(w, "duplicate", "")
		return
	}
	tapResult(w, "saved", "")
}

// keepForAdmin stores the body the server had to search through — only for a person in
// ADMIN_EMAILS (Р-13а), at most 2 KB. Everyone else's body is kept nowhere.
func (h *WalletHandler) keepForAdmin(r *http.Request, userID string, raw []byte) {
	if len(h.admins) == 0 {
		return
	}
	user, err := h.users.GetByID(r.Context(), userID)
	if err != nil || !isAdmin(h.admins, user.Email) {
		return
	}
	body := strings.ReplaceAll(string(raw), "\x00", "")
	if len(body) > maxDebugBody {
		body = body[:maxDebugBody] // a rune cut in half is dropped below
	}
	body = strings.ToValidUTF8(body, "")
	if err := h.keys.SaveDebug(r.Context(), userID, body); err != nil {
		log.Printf("wallet: debug: %v", err)
	}
}

// AdminDebug — GET /api/admin/wallet-debug: the admin's own last searched tap body of the day
// ({} when none); everyone else, and everyone without ADMIN_EMAILS, gets 404.
func (h *WalletHandler) AdminDebug(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.GetUserID(r.Context())
	user, err := h.users.GetByID(r.Context(), userID)
	if err != nil || !isAdmin(h.admins, user.Email) {
		errorJSON(w, http.StatusNotFound, "not found")
		return
	}
	d, err := h.keys.LastDebug(r.Context(), userID)
	if err != nil {
		log.Printf("wallet: debug: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read")
		return
	}
	if d == nil {
		respondJSON(w, http.StatusOK, map[string]any{})
		return
	}
	respondJSON(w, http.StatusOK, d)
}
