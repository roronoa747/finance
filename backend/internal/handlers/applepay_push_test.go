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

	"finance-backend/internal/applepay"
	"finance-backend/internal/models"
	"finance-backend/internal/repository"
)

// Bank pushes (AP-10). Sums and names are synthetic.

func (app walletApp) push(t *testing.T, key string, body any) *httptest.ResponseRecorder {
	t.Helper()
	data, ok := body.([]byte)
	if !ok {
		data, _ = json.Marshal(body)
	}
	return app.call(t, http.MethodPost, "/api/wallet/push", "Bearer "+key, data)
}

func kaspi(text string) map[string]any {
	return map[string]any{"app": "Kaspi.kz", "title": "Kaspi Gold", "body": text}
}

func freedom(title, text string) map[string]any {
	return map[string]any{"app": "Freedom SuperApp", "title": title, "body": text}
}

func pushStatus(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	out := tapStatus(t, rec)
	s, _ := out["status"].(string)
	if r, ok := out["reason"].(string); ok {
		s += "/" + r
	}
	return s
}

func (app walletApp) only(t *testing.T) models.Operation {
	t.Helper()
	ops := app.aliceOps(t)
	if len(ops) != 1 {
		t.Fatalf("want one operation, got %+v", ops)
	}
	return ops[0]
}

func TestPushPurchaseTransferIncome(t *testing.T) {
	app, clock, key := setupTap(t)
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(os.Stderr)

	if s := pushStatus(t, app.push(t, key, kaspi("Покупка: 5 000 ₸\nMAGNUM\nДоступно: 12 345,67 ₸"))); s != "saved" {
		t.Fatalf("purchase: %s", s)
	}
	op := app.only(t)
	if op.Source != "push" || op.Kind != "purchase" || op.Bank != "kaspi" || op.Amount != -5000 || op.Merchant != "MAGNUM" ||
		op.Date != "2026-10-16" || op.CategoryID != nil || op.Internal || op.Counterparty != nil {
		t.Fatalf("purchase op: %+v", op)
	}

	ops := func() map[string]models.Operation {
		out := map[string]models.Operation{}
		for _, o := range app.aliceOps(t) {
			out[o.Merchant] = o
		}
		return out
	}
	clock.t = clock.t.Add(time.Minute)
	pushStatus(t, app.push(t, key, kaspi("Перевод: 7 000 ₸\nСАПАРОВА АЙГЕРИМ БОЛАТОВНА\nДоступно: 1 ₸")))
	clock.t = clock.t.Add(time.Minute)
	pushStatus(t, app.push(t, key, freedom("Зачисление зарплаты", "+450 000 ₸\nДоступно 1 ₸")))
	clock.t = clock.t.Add(time.Minute)
	pushStatus(t, app.push(t, key, kaspi("Перевод: 3 000 ₸\nОт Айгерим С.\nДоступно: 1 ₸")))
	got := ops()
	if o := got["Перевод Айгерим С."]; o.Kind != "transfer-in" || o.Amount != 3000 {
		t.Errorf("incoming transfer: %+v", o)
	}
	if o := got["Зарплата"]; o.Kind != "income" || o.Amount != 450000 || o.Bank != "freedom" {
		t.Errorf("salary: %+v", o)
	}
	out := 0
	for _, o := range app.aliceOps(t) {
		if o.Kind == "transfer-out" {
			out++
			if o.Merchant != "Перевод Айгерим С." || o.Amount != -7000 || o.Counterparty != nil {
				t.Errorf("transfer to a person: %+v", o)
			}
		}
	}
	if out != 1 {
		t.Errorf("transfers out: %d", out)
	}
	for _, secret := range []string{"MAGNUM", "САПАРОВА", "12 345", "450 000", key} {
		if strings.Contains(logs.String(), secret) {
			t.Fatalf("%q reached the log: %s", secret, logs.String())
		}
	}
	// Counted per day and bank: 3 Kaspi, 1 Freedom read.
	if s := app.repos.Statements.PushStats("2026-10-16", "kaspi"); s.Parsed != 3 {
		t.Errorf("kaspi counter: %+v", s)
	}
	if s := app.repos.Statements.PushStats("2026-10-16", "freedom"); s.Parsed != 1 {
		t.Errorf("freedom counter: %+v", s)
	}
}

// Р-9, владелец 2026-10-19: two transfers of one sum to different people within 2 minutes are two
// spends; the same push fired twice is one.
func TestPushTransfersToDifferentPeopleAreTwo(t *testing.T) {
	app, clock, key := setupTap(t)
	if s := pushStatus(t, app.push(t, key, kaspi("Перевод: 5 090 ₸\nАйгерим С.\nДоступно: 1 ₸"))); s != "saved" {
		t.Fatalf("first: %s", s)
	}
	clock.t = clock.t.Add(40 * time.Second)
	if s := pushStatus(t, app.push(t, key, kaspi("Перевод: 5 090 ₸\nЕрлан Б.\nДоступно: 1 ₸"))); s != "saved" {
		t.Fatalf("another person: %s", s)
	}
	clock.t = clock.t.Add(40 * time.Second)
	if s := pushStatus(t, app.push(t, key, kaspi("Перевод: 5 090 ₸\nЕрлан Б.\nДоступно: 1 ₸"))); s != "duplicate" {
		t.Fatalf("the same push again: %s", s)
	}
	names := map[string]bool{}
	for _, o := range app.aliceOps(t) {
		if o.Kind != "transfer-out" || o.Amount != -5090 {
			t.Fatalf("op: %+v", o)
		}
		names[o.Merchant] = true
	}
	if len(app.aliceOps(t)) != 2 || !names["Перевод Айгерим С."] || !names["Перевод Ерлан Б."] {
		t.Fatalf("two people, one sum: %+v", app.aliceOps(t))
	}
}

// Р-9, Р-21: a tap and a push of one purchase are one operation, in any order, within 10 minutes.
func TestPushMergesWithTap(t *testing.T) {
	app, clock, key := setupTap(t)
	tapStatus(t, app.tap(t, key, map[string]any{"merchant": "Small Almaty", "amount": "2 500 ₸", "card": "Visa"}))
	clock.t = clock.t.Add(3 * time.Minute)
	if s := pushStatus(t, app.push(t, key, kaspi("Покупка: 2 500 ₸\nSMALL\nДоступно: 1 ₸"))); s != "duplicate" {
		t.Fatalf("push after tap: %s", s)
	}
	op := app.only(t)
	if op.Source != "tap" || op.Bank != "kaspi" || op.Merchant != "Small Almaty" || op.Kind != "purchase" {
		t.Fatalf("merged tap: %+v", op)
	}

	// Push first, then the tap: one, the tap's merchant.
	app2, clock2, key2 := setupTap(t)
	pushStatus(t, app2.push(t, key2, kaspi("Покупка: 4 000 ₸\nTOO SMALL 7\nДоступно: 1 ₸")))
	clock2.t = clock2.t.Add(2 * time.Minute)
	if s := pushStatus(t, app2.tap(t, key2, map[string]any{"merchant": "Small", "amount": "4 000 ₸"})); s != "duplicate" {
		t.Fatalf("tap after push: %s", s)
	}
	op = app2.only(t)
	if op.Source != "push" || op.Bank != "kaspi" || op.Merchant != "Small" {
		t.Fatalf("merged push: %+v", op)
	}
	// The tap without a merchant ("Apple Pay") keeps the push's.
	clock2.t = clock2.t.Add(20 * time.Minute)
	pushStatus(t, app2.tap(t, key2, map[string]any{"amount": "900 ₸"}))
	clock2.t = clock2.t.Add(time.Minute)
	pushStatus(t, app2.push(t, key2, kaspi("Покупка: 900 ₸\nCOFFEE BOOM\nДоступно: 1 ₸")))
	merchants := map[string]bool{}
	for _, o := range app2.aliceOps(t) {
		merchants[o.Merchant] = true
	}
	if len(app2.aliceOps(t)) != 2 || !merchants["COFFEE BOOM"] || merchants[applepay.FallbackMerchant] {
		t.Fatalf("tap without merchant + push: %+v", app2.aliceOps(t))
	}

	// 11 minutes apart: two purchases.
	app3, clock3, key3 := setupTap(t)
	tapStatus(t, app3.tap(t, key3, map[string]any{"merchant": "Magnum", "amount": "1 000 ₸"}))
	clock3.t = clock3.t.Add(11 * time.Minute)
	if s := pushStatus(t, app3.push(t, key3, kaspi("Покупка: 1 000 ₸\nMAGNUM\nДоступно: 1 ₸"))); s != "saved" {
		t.Fatalf("push 11 min after tap: %s", s)
	}
	if n := len(app3.aliceOps(t)); n != 2 {
		t.Fatalf("ops: %d", n)
	}
	// A repeat of the push within 2 minutes: one.
	clock3.t = clock3.t.Add(time.Minute)
	if s := pushStatus(t, app3.push(t, key3, kaspi("Покупка: 1 000 ₸\nMAGNUM\nДоступно: 1 ₸"))); s != "duplicate" {
		t.Fatalf("push repeat: %s", s)
	}

	// Критик Б2: a Halyk card tap and a Kaspi push of the same sum are two purchases, not one.
	clock3.t = clock3.t.Add(time.Hour)
	tapStatus(t, app3.tap(t, key3, map[string]any{"merchant": "Small", "amount": "3 300 ₸", "card": "Halyk Visa"}))
	clock3.t = clock3.t.Add(3 * time.Minute)
	if s := pushStatus(t, app3.push(t, key3, kaspi("Покупка: 3 300 ₸\nMAGNUM\nДоступно: 1 ₸"))); s != "saved" {
		t.Fatalf("Kaspi push after a Halyk tap: %s", s)
	}
}

// Р-8: money out of one own bank and the same money into another within 10 minutes — both internal.
func TestPushTransferBetweenOwnBanks(t *testing.T) {
	const anonymousOut = "Перевод: 20 000 ₸\nНа карту другого банка\nДоступно: 1 ₸"
	cases := []struct {
		name       string
		out        string
		inBank     func(string) map[string]any
		gap        time.Duration
		wantPaired bool
	}{
		{"Kaspi → Freedom in 4 min", anonymousOut, func(s string) map[string]any {
			return freedom("Пополнение с карты др…", "+"+s+"\nДоступно 1 ₸")
		}, 4 * time.Minute, true},
		{"the same bank", anonymousOut, func(s string) map[string]any {
			return kaspi("Пополнение: " + s + "\nС карты другого банка")
		}, 4 * time.Minute, false},
		{"11 minutes", anonymousOut, func(s string) map[string]any { return freedom("Пополнение", "+"+s) }, 11 * time.Minute, false},
		// Критик Б2 (AP-10 «без получателя»): a transfer naming a person is a spend, whatever came in —
		// "sent a friend 20 000, got 20 000 from someone in another bank" is not a transfer to oneself.
		{"a friend out, a top-up in", "Перевод: 20 000 ₸\nАйгерим С.", func(s string) map[string]any {
			return freedom("Пополнение с карты др…", "+"+s)
		}, 4 * time.Minute, false},
		{"out, a person's transfer in", anonymousOut, func(s string) map[string]any {
			return freedom("Входящий перевод", "+"+s+"\nЕрлан Б.")
		}, 4 * time.Minute, false},
	}
	for _, c := range cases {
		app, clock, key := setupTap(t)
		if s := pushStatus(t, app.push(t, key, kaspi(c.out))); s != "saved" {
			t.Fatalf("%s: out %s", c.name, s)
		}
		clock.t = clock.t.Add(c.gap)
		if s := pushStatus(t, app.push(t, key, c.inBank("20 000 ₸"))); s != "saved" {
			t.Fatalf("%s: in %s", c.name, s)
		}
		ops := app.aliceOps(t)
		if len(ops) != 2 {
			t.Fatalf("%s: %+v", c.name, ops)
		}
		for _, o := range ops {
			if o.Internal != c.wantPaired {
				t.Errorf("%s: %s internal %v", c.name, o.Kind, o.Internal)
			}
		}
	}
	// The incoming first, then the outgoing: paired too.
	app, clock, key := setupTap(t)
	pushStatus(t, app.push(t, key, freedom("Пополнение", "+15 000 ₸")))
	clock.t = clock.t.Add(2 * time.Minute)
	pushStatus(t, app.push(t, key, kaspi("Перевод: 15 000 ₸\nНа карту другого банка")))
	for _, o := range app.aliceOps(t) {
		if !o.Internal {
			t.Errorf("in, then out: %+v", o)
		}
	}
	// "Между своими" — the bank says it: internal at once.
	clock.t = clock.t.Add(time.Hour)
	pushStatus(t, app.push(t, key, freedom("Перевод между своими счетами", "-1 000 ₸")))
	for _, o := range app.aliceOps(t) {
		if o.Amount == -1000 && !o.Internal {
			t.Errorf("own accounts: %+v", o)
		}
	}
}

func TestPushSkippedCountedAndGuarded(t *testing.T) {
	app, clock, key := setupTap(t)
	for body, want := range map[string]string{
		"Что-то произошло 5 000 ₸":                  "skipped/format",   // unknown
		"Код подтверждения: 1234":                   "skipped/format",   // ignore
		"Возврат: 5 000 ₸\nMAGNUM":                  "skipped/format",   // ignore
		"Покупка: 50 £\nHARRODS":                    "skipped/currency", // a currency the app does not keep
		"Покупка: 0,50 ₸\nMAGNUM":                   "skipped/amount",
		"Пополнение: $50.00\nС карты другого банка": "skipped/currency", // foreign income
	} {
		if s := pushStatus(t, app.push(t, key, kaspi(body))); s != want {
			t.Errorf("%q: %s, want %s", body, s, want)
		}
	}
	if n := len(app.aliceOps(t)); n != 0 {
		t.Fatalf("skipped pushes wrote %d operations", n)
	}
	if s := app.repos.Statements.PushStats("2026-10-16", "kaspi"); s.Unknown != 1 || s.Ignored != 3 || s.Parsed != 2 {
		t.Errorf("counter: %+v", s)
	}
	// A push that names no bank counts as unknown.
	pushStatus(t, app.push(t, key, map[string]any{"title": "Привет", "body": "Встречаемся в 18:30"}))
	if s := app.repos.Statements.PushStats("2026-10-16", "unknown"); s.Unknown != 1 {
		t.Errorf("no bank: %+v", s)
	}
	// Not an admin: no body kept.
	if app.keys.DebugRows() != 0 {
		t.Fatal("a non-admin push body was stored")
	}
	// An admin: the last push the server could not read is kept for the parser.
	adminKey, hash, _ := applepay.NewKey()
	_ = app.keys.Add(t.Context(), app.adminID, hash)
	pushStatus(t, app.push(t, adminKey, kaspi("Странный пуш 1 234 ₸")))
	if d, _ := app.keys.LastDebug(t.Context(), app.adminID); d == nil || !strings.Contains(d.Body, "Странный пуш") {
		t.Fatalf("admin debug: %+v", d)
	}

	// The whole notification sent as one string, or as an object: still read.
	clock.t = clock.t.Add(time.Hour)
	if s := pushStatus(t, app.push(t, key, []byte(`"Kaspi.kz\nKaspi Gold\nПокупка: 1 100 ₸\nMAGNUM"`))); s != "saved" {
		t.Errorf("one string: %s", s)
	}
	clock.t = clock.t.Add(time.Hour)
	whole := map[string]any{"notification": map[string]any{"app": "Freedom", "title": "Покупка", "body": "-1 200 ₸\nSMALL"}, "at": "x"}
	if s := pushStatus(t, app.push(t, key, whole)); s != "saved" {
		t.Errorf("object: %s", s)
	}
	var small models.Operation
	for _, o := range app.aliceOps(t) {
		if o.Amount == -1200 {
			small = o
		}
	}
	if small.Bank != "freedom" || small.Merchant != "SMALL" {
		t.Errorf("object op: %+v", small)
	}

	// Guards: viewer 403, no key 401, a big body 413, not JSON 400, the shared daily limit 429.
	if rec := app.call(t, http.MethodPost, "/api/wallet/push", "", []byte(`{}`)); rec.Code != http.StatusUnauthorized {
		t.Errorf("no key: %d", rec.Code)
	}
	app.repos.Households.SetRole(app.familyID, app.aliceID, "viewer")
	if rec := app.push(t, key, kaspi("Покупка: 5 000 ₸\nMAGNUM")); rec.Code != http.StatusForbidden {
		t.Errorf("viewer: %d", rec.Code)
	}
	app.repos.Households.SetRole(app.familyID, app.aliceID, "member")
	if rec := app.push(t, key, []byte(`{"body":"`+strings.Repeat("x", 5<<10)+`"}`)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("5 KB: %d", rec.Code)
	}
	if rec := app.push(t, key, []byte(`{nope`)); rec.Code != http.StatusBadRequest {
		t.Errorf("not JSON: %d", rec.Code)
	}
	for i := range 200 {
		_, _ = app.repos.Statements.InsertPhoneOperation(t.Context(), app.aliceID, app.familyID, repository.PhoneOperation{
			ID: fmt.Sprintf("%016x", i+1), Bank: "kaspi", Date: "2026-10-16", Amount: -int64(i + 1), Merchant: "Loop",
			Source: "tap", OccurredAt: clock.t,
		}, repository.PhoneWindows{Repeat: tapRepeat})
	}
	if rec := app.push(t, key, kaspi("Покупка: 7 777 ₸\nMAGNUM")); rec.Code != http.StatusTooManyRequests {
		t.Errorf("limit: %d %s", rec.Code, rec.Body.String())
	}
}

// One iPhone, both commands (критик возврата 2026-10-19; владелец 2026-10-19 — «считать команды, а
// не телефоны»): the touch command with one key, «Пуши банков» from the card with another; the
// status names the commands that paid — a tap and a push — whatever the number of keys. A push
// that is not an operation is not the push command yet.
func TestWalletStatusNamesCommands(t *testing.T) {
	app, clock, tapKey := setupTap(t)
	if out := tapStatus(t, app.tap(t, tapKey, map[string]any{"merchant": "Magnum", "amount": "5 000 ₸"})); out["status"] != "saved" {
		t.Fatalf("tap: %v", out)
	}
	if s := app.status(t); !s.Connected || !s.Tap || s.Push {
		t.Fatalf("tap only: %+v", s)
	}
	pushKey := app.connect(t)
	if s := pushStatus(t, app.push(t, pushKey, kaspi("Новые бонусы"))); !strings.HasPrefix(s, "skipped") {
		t.Fatalf("not an operation: %s", s)
	}
	if s := app.status(t); !s.Tap || s.Push {
		t.Fatalf("a skipped push: %+v", s)
	}
	// The same purchase by push 30 s later — one operation, both commands paid.
	clock.t = clock.t.Add(30 * time.Second)
	if s := pushStatus(t, app.push(t, pushKey, kaspi("Покупка: 5 000 ₸\nMAGNUM\nДоступно: 1 ₸"))); s != "duplicate" {
		t.Fatalf("the same purchase by push: %s", s)
	}
	if s := app.status(t); !s.Connected || !s.Tap || !s.Push || s.Waiting {
		t.Fatalf("tap and push: %+v", s)
	}
	// "Отключить" forgets the commands too.
	if rec := app.call(t, http.MethodDelete, "/api/wallet", "Bearer "+app.alice, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("disconnect: %d", rec.Code)
	}
	if s := app.status(t); s.Connected || s.Tap || s.Push {
		t.Fatalf("after disconnect: %+v", s)
	}
}
