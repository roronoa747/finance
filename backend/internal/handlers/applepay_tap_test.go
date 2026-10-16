package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"finance-backend/internal/applepay"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// tapClock pins the handler's clock; the mock keys share it for the 24-hour debug rule.
type tapClock struct{ t time.Time }

func (c *tapClock) now() time.Time { return c.t }

func (app walletApp) tap(t *testing.T, key string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, ok := body.([]byte)
	if !ok {
		data, _ = json.Marshal(body)
	}
	return app.call(t, http.MethodPost, "/api/wallet/tap", "Bearer "+key, data)
}

func tapStatus(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("tap: %d %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return out
}

func (app walletApp) aliceOps(t *testing.T) []models.Operation {
	t.Helper()
	ops, _ := app.repos.Statements.ListOperations(t.Context(), app.aliceID, time.Time{}, 1000)
	return ops
}

func setupTap(t *testing.T) (walletApp, *tapClock, string) {
	t.Helper()
	app := setupWalletApp(t)
	// 20:00 UTC is 01:00 of the next day in Almaty.
	clock := &tapClock{t: time.Date(2026, 10, 15, 20, 0, 0, 0, time.UTC)}
	app.handler.now = clock.now
	app.keys.Now = clock.now
	return app, clock, app.connect(t)
}

func TestTapSavesTengeAndForeignCurrency(t *testing.T) {
	app, clock, key := setupTap(t)
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(os.Stderr)

	out := tapStatus(t, app.tap(t, key, map[string]any{"merchant": "Magnum", "amount": "1 234,50 ₸", "card": "Kaspi Gold", "name": "Kaspi Gold", "extra": 1}))
	if out["status"] != "saved" || out["ok"] != true || len(out) != 2 {
		t.Fatalf("tenge: %v", out)
	}
	ops := app.aliceOps(t)
	if len(ops) != 1 {
		t.Fatalf("ops: %+v", ops)
	}
	op := ops[0]
	if op.Amount != -1234 || op.Date != "2026-10-16" || op.CategoryID != nil || op.Source != "tap" || op.Bank != "kaspi" ||
		op.Kind != "purchase" || op.Merchant != "Magnum" || op.FxCurrency != nil || op.OccurredAt == nil || !op.OccurredAt.Equal(clock.t) ||
		len(op.ID) != 16 {
		t.Fatalf("tenge op: %+v", op)
	}

	clock.t = clock.t.Add(5 * time.Minute)
	tapStatus(t, app.tap(t, key, map[string]any{"merchant": "Apple Store", "amount": "$6.22", "card": "Visa"}))
	dollars := false
	for _, op := range app.aliceOps(t) {
		if op.Merchant == "Apple Store" {
			dollars = op.Amount == 0 && op.FxCurrency != nil && *op.FxCurrency == "USD" && *op.FxAmount == 622 && op.Bank == "card"
		}
	}
	if !dollars {
		t.Fatalf("dollar op: %+v", app.aliceOps(t))
	}

	// The command's own time, if sane, sets the day.
	tapStatus(t, app.tap(t, key, map[string]any{"merchant": "Small", "amount": "500 ₸", "at": "2026-10-15T10:00:00+05:00"}))
	day := ""
	for _, op := range app.aliceOps(t) {
		if op.Merchant == "Small" {
			day = op.Date
		}
	}
	if day != "2026-10-15" {
		t.Fatalf("tap with at: day %q", day)
	}

	if strings.Contains(logs.String(), "Magnum") || strings.Contains(logs.String(), "1 234") || strings.Contains(logs.String(), key) {
		t.Fatalf("the body or key reached the log: %s", logs.String())
	}
}

func TestTapRepeatLimitAndRefusals(t *testing.T) {
	app, clock, key := setupTap(t)
	body := map[string]any{"merchant": "Magnum", "amount": "5 000 ₸", "card": "Kaspi Gold"}

	tapStatus(t, app.tap(t, key, body))
	clock.t = clock.t.Add(90 * time.Second)
	if out := tapStatus(t, app.tap(t, key, body)); out["status"] != "duplicate" || out["ok"] != true {
		t.Fatalf("repeat in 90 s: %v", out)
	}
	clock.t = clock.t.Add(3 * time.Minute)
	if out := tapStatus(t, app.tap(t, key, body)); out["status"] != "saved" {
		t.Fatalf("repeat in 3 min: %v", out)
	}
	if len(app.aliceOps(t)) != 2 {
		t.Fatalf("ops after repeats: %d", len(app.aliceOps(t)))
	}

	// "0,50 ₸" is less than a tenge: tiyn are dropped, a 0 ₸ purchase is not written (критик Б1).
	for in, reason := range map[string]string{"6.22": "currency", "£3": "currency", "-$5": "amount", "$0.00": "amount", "0,50 ₸": "amount"} {
		out := tapStatus(t, app.tap(t, key, map[string]any{"merchant": "X", "amount": in}))
		if out["status"] != "skipped" || out["reason"] != reason || out["ok"] != false {
			t.Errorf("amount %q: %v", in, out)
		}
	}

	// 200 a day, then 429 (Almaty day).
	ctx := t.Context()
	for i := range 198 {
		_, _ = app.repos.Statements.InsertPhoneOperation(ctx, app.aliceID, app.familyID, repository.PhoneOperation{
			ID: fmt.Sprintf("%016x", i+1), Bank: "kaspi", Date: "2026-10-16", Amount: -int64(i + 1), Merchant: "Loop",
			Source: "tap", OccurredAt: clock.t,
		}, tapRepeat)
	}
	if rec := app.tap(t, key, map[string]any{"merchant": "One more", "amount": "7 ₸"}); rec.Code != http.StatusTooManyRequests ||
		strings.TrimSpace(rec.Body.String()) != `{"error":"limit"}` {
		t.Fatalf("201st: %d %s", rec.Code, rec.Body.String())
	}

	if rec := app.call(t, http.MethodPost, "/api/wallet/tap", "", []byte(`{}`)); rec.Code != http.StatusUnauthorized {
		t.Errorf("no key: %d", rec.Code)
	}
	app.repos.Households.SetRole(app.familyID, app.aliceID, "viewer")
	if rec := app.tap(t, key, body); rec.Code != http.StatusForbidden {
		t.Errorf("viewer: %d", rec.Code)
	}
	app.repos.Households.SetRole(app.familyID, app.aliceID, "member")
	big := []byte(`{"merchant":"` + strings.Repeat("x", 5<<10) + `"}`)
	if rec := app.tap(t, key, big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("5 KB body: %d", rec.Code)
	}
	if rec := app.tap(t, key, []byte(`"text"`)); rec.Code != http.StatusBadRequest {
		t.Errorf("not an object: %d", rec.Code)
	}
}

// Р-13а: the owner's command sends the whole transaction as text in "merchant".
func TestTapWholeTransactionText(t *testing.T) {
	app, clock, key := setupTap(t)
	for _, text := range []string{"MAGNUM 5 000 ₸ Kaspi Gold", "5 000 ₸ · MAGNUM", "Kaspi Gold\nMAGNUM\n5 000,00 ₸"} {
		clock.t = clock.t.Add(3 * time.Minute) // not a repeat
		if out := tapStatus(t, app.tap(t, key, map[string]any{"merchant": text})); out["status"] != "saved" {
			t.Fatalf("%q: %v", text, out)
		}
	}
	ops := app.aliceOps(t)
	kaspi := 0
	for _, op := range ops {
		if op.Merchant != "MAGNUM" || op.Amount != -5000 {
			t.Errorf("op from text: %+v", op)
		}
		if op.Bank == "kaspi" {
			kaspi++
		}
	}
	// Bank from the text when there is no card field: two of the three name Kaspi.
	if len(ops) != 3 || kaspi != 2 {
		t.Errorf("ops %d, kaspi %d", len(ops), kaspi)
	}
	if out := tapStatus(t, app.tap(t, key, map[string]any{"merchant": "MAGNUM Kaspi Gold"})); out["status"] != "skipped" || out["reason"] != "amount" {
		t.Fatalf("text without money: %v", out)
	}
	// Not an admin: the body is kept nowhere.
	if app.keys.DebugRows() != 0 {
		t.Fatal("a non-admin body was stored")
	}
	if rec := app.call(t, http.MethodGet, "/api/admin/wallet-debug", "Bearer "+app.alice, nil); rec.Code != http.StatusNotFound {
		t.Errorf("non-admin debug: %d", rec.Code)
	}

	// An admin: the last searched body is kept (overwritten, ≤ 2 KB, whole runes) and shown to them.
	adminKey, hash, _ := applepay.NewKey()
	_ = app.keys.Add(t.Context(), app.adminID, hash)
	tapStatus(t, app.tap(t, adminKey, map[string]any{"merchant": "first"}))
	tapStatus(t, app.tap(t, adminKey, map[string]any{"merchant": "Транзакция без суммы " + strings.Repeat("я", 1500)}))
	rec := app.call(t, http.MethodGet, "/api/admin/wallet-debug", "Bearer "+app.admin, nil)
	var d repository.WalletDebug
	_ = json.Unmarshal(rec.Body.Bytes(), &d)
	if rec.Code != http.StatusOK || !strings.Contains(d.Body, "Транзакция без суммы") || len(d.Body) > 2048 || !utf8.ValidString(d.Body) || app.keys.DebugRows() != 1 {
		t.Fatalf("admin debug: %d, %d bytes, valid %v", rec.Code, len(d.Body), utf8.ValidString(d.Body))
	}
	// A day later it is gone.
	clock.t = clock.t.Add(25 * time.Hour)
	if rec := app.call(t, http.MethodGet, "/api/admin/wallet-debug", "Bearer "+app.admin, nil); strings.TrimSpace(rec.Body.String()) != "{}" {
		t.Fatalf("debug after a day: %s", rec.Body.String())
	}
	_ = app.keys.SaveDebug(t.Context(), app.aliceID, "x") // any write drops the old rows
	if app.keys.DebugRows() != 1 {
		t.Fatalf("old rows kept: %d", app.keys.DebugRows())
	}

	// An "amount" field the server could not read: the admin sees the body (AP-03 п. 5), others — no.
	_ = app.keys.SaveDebug(t.Context(), app.aliceID, "x") // the row the test wrote above, refreshed
	if out := tapStatus(t, app.tap(t, key, map[string]any{"merchant": "Magnum", "amount": "6.22"})); out["status"] != "skipped" {
		t.Fatalf("non-admin unparsed amount: %v", out)
	}
	if d, _ := app.keys.LastDebug(t.Context(), app.aliceID); d == nil || d.Body != "x" {
		t.Fatalf("a non-admin body was stored: %q", d.Body)
	}
	for body, reason := range map[string]string{"6.22": "currency", "0,50 ₸": "amount"} {
		out := tapStatus(t, app.tap(t, adminKey, map[string]any{"merchant": "Magnum", "amount": body}))
		rec := app.call(t, http.MethodGet, "/api/admin/wallet-debug", "Bearer "+app.admin, nil)
		var d repository.WalletDebug
		_ = json.Unmarshal(rec.Body.Bytes(), &d)
		if out["status"] != "skipped" || out["reason"] != reason || !strings.Contains(d.Body, body) {
			t.Errorf("admin unparsed amount %q: %v, debug %q", body, out, d.Body)
		}
	}
	// A read "amount" field keeps nothing new.
	clock.t = clock.t.Add(3 * time.Minute)
	tapStatus(t, app.tap(t, adminKey, map[string]any{"merchant": "Magnum", "amount": "7 000 ₸"}))
	rec = app.call(t, http.MethodGet, "/api/admin/wallet-debug", "Bearer "+app.admin, nil)
	if strings.Contains(rec.Body.String(), "7 000") {
		t.Errorf("a read amount kept the body: %s", rec.Body.String())
	}
}
