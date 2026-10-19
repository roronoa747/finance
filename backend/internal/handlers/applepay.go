package handlers

import (
	"context"
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
	// Shortcut links from the environment (Р-17); empty — no Apple Pay card for that path, no
	// bank pushes step in the sheet.
	shortcutURL, shortcutURLLegacy, pushShortcutURL string
	now                                             func() time.Time
}

func NewWalletHandler(keys repository.PhoneKeyRepository, households repository.HouseholdRepository, ops repository.PhoneOperationRepository,
	users repository.UserRepository, admins []string, shortcutURL, shortcutURLLegacy, pushShortcutURL string) *WalletHandler {
	return &WalletHandler{keys: keys, households: households, ops: ops, users: users, admins: admins,
		shortcutURL: shortcutURL, shortcutURLLegacy: shortcutURLLegacy, pushShortcutURL: pushShortcutURL, now: time.Now}
}

const (
	// maxTapBody: a transaction is a few short strings (§6 of the backlog: ≤ 4 KB).
	maxTapBody = 4 << 10
	// maxDebugBody: the admin's tap body (searched for the amount or not read) is kept up to 2 KB (Р-13а).
	maxDebugBody = 2 << 10
	// tapRepeat: the trigger fires twice for one payment — the same money within it is one (Р-9).
	tapRepeat = 2 * time.Minute
	// phonePair: a tap and a push of one purchase (Р-9, Р-21), a transfer out of one own bank and
	// into another (Р-8) — within it, in any order of arrival.
	phonePair = 10 * time.Minute
	// maxPhoneOpsPerDay protects the family from a looping automation (Р-13).
	maxPhoneOpsPerDay = 200
	// tapPast / tapFuture bound the command's optional "at"; outside — the server's time.
	tapPast   = 48 * time.Hour
	tapFuture = 5 * time.Minute
)

// almaty is Kazakhstan's single time zone (UTC+5): the day of a phone operation and of the limit.
var almaty = time.FixedZone("Asia/Almaty", 5*60*60)

// walletStatus: connected and phones count only the keys a payment came with (владелец
// 2026-10-19); waiting — a key was copied, no payment yet ("Ждём первую оплату").
type walletStatus struct {
	Connected         bool       `json:"connected"`
	Phones            int        `json:"phones"`
	Waiting           bool       `json:"waiting"`
	LastUsedAt        *time.Time `json:"last_used_at,omitempty"`
	ShortcutURL       string     `json:"shortcut_url"`
	ShortcutURLLegacy string     `json:"shortcut_url_legacy"`
	PushShortcutURL   string     `json:"push_shortcut_url"`
}

// Status — GET /api/wallet (member): connected phones and the shortcut links.
func (h *WalletHandler) Status(w http.ResponseWriter, r *http.Request) {
	_, userID, ok := member(w, r)
	if !ok {
		return
	}
	phones, issued, last, err := h.keys.Status(r.Context(), userID)
	if err != nil {
		log.Printf("wallet: status: %v", err)
		errorJSON(w, http.StatusInternalServerError, "failed to read wallet status")
		return
	}
	respondJSON(w, http.StatusOK, walletStatus{
		Connected: phones > 0, Phones: phones, Waiting: phones == 0 && issued > 0, LastUsedAt: last,
		ShortcutURL: h.shortcutURL, ShortcutURLLegacy: h.shortcutURLLegacy, PushShortcutURL: h.pushShortcutURL,
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

// phoneKeyCtx carries the caller's key hash from KeyAuth to save: the key is marked used only
// when a payment is written or recognised as a repeat.
type phoneKeyCtx struct{}

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
		hash := applepay.HashKey(plain)
		userID, err := h.keys.UserByHash(r.Context(), hash)
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
		ctx = context.WithValue(ctx, phoneKeyCtx{}, hash)
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
// body the server had to search through, or whose amount it could not read, is kept a day
// for tuning the parser.
func (h *WalletHandler) Tap(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	raw, ok := readPhoneBody(w, r)
	if !ok {
		return
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(raw, &body); err != nil || body == nil {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}

	now := h.now()
	at := commandTime(body, now)

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
	// Less than a tenge would be written as a 0 ₸ purchase (tiyn are dropped): not money.
	if parsed && currency == "KZT" && minor < 100 {
		parsed, reason = false, "amount"
	}
	if searched || !parsed {
		h.keepForAdmin(r, userID, raw)
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

	h.save(w, r, userID, householdID, op, now)
}

// save writes a phone operation of a tap or a push: the daily limit shared by both (Р-13), then
// one repository call that finds a repeat, the other half of the same purchase (a tap and a
// push, Р-21) or of a transfer between own banks (Р-8) under the person's lock. A repeat or a
// merge answers "duplicate". Saved or duplicate — the key paid: it is marked used (Н-5).
func (h *WalletHandler) save(w http.ResponseWriter, r *http.Request, userID, householdID string, op repository.PhoneOperation, now time.Time) {
	nowAlmaty := now.In(almaty)
	dayStart := time.Date(nowAlmaty.Year(), nowAlmaty.Month(), nowAlmaty.Day(), 0, 0, 0, 0, almaty)
	n, err := h.ops.CountPhoneOperationsSince(r.Context(), userID, dayStart)
	if err != nil {
		log.Printf("wallet: %s count: %v", op.Source, err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	if n >= maxPhoneOpsPerDay {
		errorJSON(w, http.StatusTooManyRequests, "limit")
		return
	}
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		log.Printf("wallet: %s id: %v", op.Source, err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	op.ID = hex.EncodeToString(id)
	done, err := h.ops.InsertPhoneOperation(r.Context(), userID, householdID, op, repository.PhoneWindows{Repeat: tapRepeat, Pair: phonePair})
	if err != nil {
		log.Printf("wallet: %s save: %v", op.Source, err)
		errorJSON(w, http.StatusInternalServerError, "failed to save")
		return
	}
	if hash, ok := r.Context().Value(phoneKeyCtx{}).([]byte); ok {
		if err := h.keys.MarkUsed(r.Context(), hash); err != nil {
			log.Printf("wallet: %s mark key: %v", op.Source, err) // the operation is written already
		}
	}
	if done == repository.PhoneRepeat || done == repository.PhoneMerged {
		tapResult(w, "duplicate", "")
		return
	}
	tapResult(w, "saved", "")
}

// readPhoneBody reads a phone endpoint's body (≤ 4 KB); false — answered 400 / 413.
func readPhoneBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxTapBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			errorJSON(w, http.StatusRequestEntityTooLarge, "request body too large")
			return nil, false
		}
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}
	return raw, true
}

// commandTime is the command's optional "at" when sane (−48 h … +5 min), otherwise now.
func commandTime(body map[string]json.RawMessage, now time.Time) time.Time {
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(tapField(body, "at"))); err == nil && t.After(now.Add(-tapPast)) && t.Before(now.Add(tapFuture)) {
		return t
	}
	return now
}

// pushFields reads the app, title and text of a push. The contract is {app, title, body} of
// strings; a command may send the trigger's notification whole (an object in a field, or the
// whole body as one string) — then every string in it, in its order, becomes the text and the
// parser finds the bank and the kind there.
func pushFields(raw []byte) (app, title, text string, ok bool) {
	var whole string
	if err := json.Unmarshal(raw, &whole); err == nil {
		return "", "", whole, true
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(raw, &body); err != nil || body == nil {
		return "", "", "", false
	}
	app, title, text = plainField(body, "app"), plainField(body, "title"), plainField(body, "body")
	if strings.TrimSpace(text) != "" && plainOrAbsent(body, "app") && plainOrAbsent(body, "title") {
		return app, title, text, true
	}
	// Not the plain contract: the strings of the whole body, "at" aside.
	var leaves []string
	collectStrings(raw, &leaves, 0)
	return app, "", strings.Join(leaves, "\n"), true
}

// plainField: the field when it is a string, "" otherwise.
func plainField(body map[string]json.RawMessage, key string) string {
	var s string
	if raw, ok := body[key]; ok && json.Unmarshal(raw, &s) == nil {
		return s
	}
	return ""
}

func plainOrAbsent(body map[string]json.RawMessage, key string) bool {
	raw, ok := body[key]
	var s string
	return !ok || string(raw) == "null" || json.Unmarshal(raw, &s) == nil
}

// collectStrings appends the strings of a JSON value in document order, the "at" field aside
// (depth-limited: the body is ≤ 4 KB anyway).
func collectStrings(raw []byte, out *[]string, depth int) {
	if depth > 4 {
		return
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	tok, err := dec.Token()
	if err != nil {
		return
	}
	switch t := tok.(type) {
	case string:
		if strings.TrimSpace(t) != "" {
			*out = append(*out, t)
		}
	case json.Delim:
		switch t {
		case '{':
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return
				}
				var v json.RawMessage
				if err := dec.Decode(&v); err != nil {
					return
				}
				if key, _ := keyTok.(string); key != "at" {
					collectStrings(v, out, depth+1)
				}
			}
		case '[':
			for dec.More() {
				var v json.RawMessage
				if err := dec.Decode(&v); err != nil {
					return
				}
				collectStrings(v, out, depth+1)
			}
		}
	}
}

// pushStatBank: the push counter's bank — a push that named no bank counts as unknown.
func pushStatBank(bank string) string {
	if bank == "card" {
		return "unknown"
	}
	return bank
}

// Push — POST /api/wallet/push (phone key): a bank push from the Shortcuts "Notification"
// trigger (iOS 27; Р-8, Р-10, Р-21, Р-23). Body {app, title, body, at?} — strings; the
// notification sent whole is read too. Every push counts in the day's counter of its bank
// (read / not an operation / not read); an operation is written like a tap — the daily limit,
// a repeat in 2 minutes, the tap of the same purchase or the other half of a transfer between
// own banks in 10. The text is never logged or kept — only for an admin, the last push the
// server could not read (Р-13а).
func (h *WalletHandler) Push(w http.ResponseWriter, r *http.Request) {
	householdID, userID, ok := member(w, r)
	if !ok {
		return
	}
	raw, ok := readPhoneBody(w, r)
	if !ok {
		return
	}
	app, title, text, ok := pushFields(raw)
	if !ok {
		errorJSON(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var body map[string]json.RawMessage
	_ = json.Unmarshal(raw, &body)
	now := h.now()
	at := commandTime(body, now)

	p, result := applepay.ParsePush(app, title, text)
	column := map[applepay.Result]string{
		applepay.ResultOp: repository.PushParsed, applepay.ResultIgnore: repository.PushIgnored, applepay.ResultUnknown: repository.PushUnknown,
	}[result]
	if err := h.ops.CountPush(r.Context(), now.In(almaty).Format(time.DateOnly), pushStatBank(p.Bank), column); err != nil {
		log.Printf("wallet: push count: %v", err) // the counter never stops the push
	}

	incoming := p.Sign > 0
	reason := ""
	switch {
	case result == applepay.ResultUnknown:
		reason = "format"
	case p.Currency == applepay.Unsupported, result == applepay.ResultOp && incoming && p.Currency != "KZT":
		reason = "currency" // a foreign income would need a rate the phone only applies to spending
	case result != applepay.ResultOp:
		reason = "format"
	case p.Currency == "KZT" && p.Minor < 100:
		reason = "amount"
	}
	if reason != "" {
		if reason != "format" || result == applepay.ResultUnknown {
			h.keepForAdmin(r, userID, raw)
		}
		tapResult(w, "skipped", reason)
		return
	}

	op := repository.PhoneOperation{
		Bank: p.Bank, Date: at.In(almaty).Format(time.DateOnly), Merchant: p.Merchant, Kind: p.Kind, Internal: p.Own,
		Source: "push", OccurredAt: at,
	}
	switch {
	case p.Currency != "KZT":
		op.FxCurrency, op.FxAmount = &p.Currency, &p.Minor
	case incoming:
		op.Amount = p.Minor / 100
	default:
		op.Amount = -(p.Minor / 100)
	}
	h.save(w, r, userID, householdID, op, now)
}

// keepForAdmin stores the body the server had to search through or could not read the amount
// of — only for a person in ADMIN_EMAILS (Р-13а), at most 2 KB. Everyone else's body is kept
// nowhere.
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
	if !adminOnly(w, r, h.users, h.admins) {
		return
	}
	userID, _ := auth.GetUserID(r.Context())
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
