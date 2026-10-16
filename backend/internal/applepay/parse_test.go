package applepay

import (
	"strings"
	"testing"
)

func TestParseAmount(t *testing.T) {
	const nbsp, narrow = " ", " "
	cases := []struct {
		in       string
		currency string
		minor    int64
		ok       bool
	}{
		{"1 234,50 ₸", "KZT", 123450, true},
		{"₸1 234", "KZT", 123400, true},
		{"1" + nbsp + "234" + nbsp + "₸", "KZT", 123400, true},
		{"1" + narrow + "234" + narrow + "₸", "KZT", 123400, true},
		{"KZT 5 000", "KZT", 500000, true},
		{"5000 тг", "KZT", 500000, true},
		{"5 000 тенге", "KZT", 500000, true},
		{"5,000.00 KZT", "KZT", 500000, true},
		{"$6.22", "USD", 622, true},
		{"US$6.22", "USD", 622, true},
		{"6.22 USD", "USD", 622, true},
		{"€5,00", "EUR", 500, true},
		{"5,00 EUR", "EUR", 500, true},
		{"₽1 200", "RUB", 120000, true},
		{"1 200 руб.", "RUB", 120000, true},
		{"¥88", "CNY", 8800, true},
		{"88 元", "CNY", 8800, true},
		{"1,234.56 $", "USD", 123456, true},
		{"1.234,56 €", "EUR", 123456, true},
		{"1,234 $", "USD", 123400, true},            // three digits — thousands
		{"1.234 €", "EUR", 123400, true},            // three digits — thousands
		{"₸ 12 345 678,9", "KZT", 1234567890, true}, // one digit of fraction
		{"1'234.50 $", "USD", 123450, true},
		{"£3", "", 0, false},
		{"3 GBP", "", 0, false},
		{"₺100", "", 0, false},
		{"100 AED", "", 0, false},
		{"6.22", "", 0, false}, // no currency: never tenge by default
		{"5 000", "", 0, false},
		{"-$5", "", 0, false},
		{"+5 000 ₸", "", 0, false},
		{"(5 000 ₸)", "", 0, false},
		{"−5 000 ₸", "", 0, false}, // U+2212
		{"$0.00", "", 0, false},
		{"", "", 0, false},
		{"abc", "", 0, false},
		{"₸", "", 0, false},
		{"$5 €5", "", 0, false}, // two currencies
		{"1..234 ₸", "", 0, false},
		{"12 34 ₸", "", 0, false},
		{"5,123 ₸ 4", "", 0, false},
		{"99999999999999 ₸", "", 0, false}, // 14 digits
		{"тгк 500", "", 0, false},          // a word, not the code
	}
	if len(cases) < 25 {
		t.Fatal("the table must hold at least 25 rows")
	}
	for _, c := range cases {
		currency, minor, ok := ParseAmount(c.in)
		if currency != c.currency || minor != c.minor || ok != c.ok {
			t.Errorf("ParseAmount(%q) = %q %d %v, want %q %d %v", c.in, currency, minor, ok, c.currency, c.minor, c.ok)
		}
	}
}

func TestSkipReason(t *testing.T) {
	for in, want := range map[string]string{
		"6.22": "currency", "£3": "currency", "": "amount", "abc": "amount", "-$5": "amount", "$0.00": "amount",
	} {
		if got := SkipReason(in); got != want {
			t.Errorf("SkipReason(%q) = %q, want %q", in, got, want)
		}
	}
}

// Р-13а: the owner's command sends the whole transaction as text in "merchant".
func TestFindAmountInWholeTransaction(t *testing.T) {
	for _, text := range []string{
		"MAGNUM 5 000 ₸ Kaspi Gold",
		"5 000 ₸ · MAGNUM",
		"Kaspi Gold\nMAGNUM\n5 000,00 ₸",
		"MAGNUM\n₸5 000",
	} {
		currency, minor, rest, ok := FindAmount(text)
		if !ok || currency != "KZT" || minor != 500000 {
			t.Errorf("FindAmount(%q) = %q %d %v", text, currency, minor, ok)
			continue
		}
		if m := MerchantFrom(rest, ""); m != "MAGNUM" {
			t.Errorf("merchant of %q = %q", text, m)
		}
	}
	// With the card field the card name goes even inside one line.
	if _, _, rest, ok := FindAmount("Kaspi Gold MAGNUM 5 000 ₸"); !ok || MerchantFrom(rest, "Kaspi Gold") != "MAGNUM" {
		t.Errorf("card name inside the line: %q", MerchantFrom(rest, "Kaspi Gold"))
	}
	// A number glued to another number or word is not an amount.
	if _, minor, _, ok := FindAmount("Card 1234 000 ₸ 7 500 ₸"); !ok || minor != 750000 {
		t.Errorf("glued number: %d %v", minor, ok)
	}
	if c, _, _, ok := FindAmount("Tesco £3.50"); ok || c != Unsupported {
		t.Errorf("unsupported currency: %q %v", c, ok)
	}
	if _, _, _, ok := FindAmount("MAGNUM Kaspi Gold"); ok {
		t.Error("no amount found in text without money")
	}
	if c, m, _, ok := FindAmount("Apple Store $6.22 Freedom"); !ok || c != "USD" || m != 622 {
		t.Errorf("dollars in text: %q %d %v", c, m, ok)
	}
}

// Критик Б1 (скептик): the whole-transaction text around the amount.
func TestFindAmountEdges(t *testing.T) {
	// A time, date or number right before the amount is not its thousands group.
	for text, want := range map[string]int64{
		"16.10.2026, 10:23 500 ₸ MAGNUM": 50000,
		"MAGNUM 10:23 150 000 ₸":         15000000,
		"MAGNUM 10:23:45 500 ₸":          50000,
		"MAGNUM 16.10 500 ₸":             50000,
		"2026-10-16 500 ₸ MAGNUM":        50000,
		"Магазин №1 500 ₸":               50000,
		"10:23 1 234 ₸":                  123400,
		"Сумма:5 000 ₸":                  500000,
		"MAGNUM, 5 000 ₸":                500000,
		"MAGNUM - 5 000 ₸":               500000, // a dash between words is not a sign
		// A greedy group running into the next number is cut back at the separator.
		"MAGNUM ₸500 2026-10-16":      50000,
		"KZT 1 500 2026-10-16 MAGNUM": 150000,
		// A word equal to a currency code the app does not keep does not hide the tenge.
		"NAIL GEL 5 000 ₸":       500000,
		"Pizza Try 2 Go 5 000 ₸": 500000,
		// A currency symbol may touch a letter.
		"MAGNUM₸500":       50000,
		"500₸MAGNUM":       50000,
		"Apple Store$6.22": 622,
	} {
		if _, m, _, ok := FindAmount(text); !ok || m != want {
			t.Errorf("FindAmount(%q) = %d %v, want %d", text, m, ok, want)
		}
	}
	// A signed amount is a refund or incoming money: no purchase in the text.
	for _, text := range []string{
		"Возврат −5 000 ₸ MAGNUM", "MAGNUM -5 000 ₸", "MAGNUM +5 000 ₸", "MAGNUM (5 000 ₸)", "MAGNUM -$5", "MAGNUM −₸5 000",
	} {
		if c, m, _, ok := FindAmount(text); ok {
			t.Errorf("FindAmount(%q) = %q %d: a signed amount taken as a purchase", text, c, m)
		}
	}
	// Glued tokens (acceptance tails): a time or date glued to the currency is not the amount, a
	// letter glued to the number starts a word, and a code word before a number with its own
	// currency belongs to the words before.
	for text, want := range map[string]struct {
		code  string
		minor int64
	}{
		"MAGNUM 500 ₸10:23":                     {"KZT", 50000},
		"5 001 ₸16.10.2026":                     {"KZT", 500100},
		"MAGNUM₸5 003Kaspi Gold":                {"KZT", 500300},
		"MAGNUM 500 KZT10:23":                   {"KZT", 50000},
		"Kaspi Gold USD 5 004 ₸":                {"KZT", 500400},
		"Kaspi Gold USD\u00a05\u00a0004\u00a0₸": {"KZT", 500400},
		"Kaspi Gold USD\n5 004 ₸":               {"KZT", 500400},
		"500 ₸\n10:23 MAGNUM":                   {"KZT", 50000},
		"USD 5 004 Kaspi":                       {"USD", 500400},
		"ALMATY 2 ₸500":                         {"KZT", 50000}, // the mirror: no time or date after ₸
	} {
		if c, m, _, ok := FindAmount(text); !ok || c != want.code || m != want.minor {
			t.Errorf("FindAmount(%q) = %q %d %v, want %q %d", text, c, m, ok, want.code, want.minor)
		}
	}
	// Only unsupported money — Unsupported.
	if c, _, _, ok := FindAmount("GEL 5 000 Tbilisi"); ok || c != Unsupported {
		t.Errorf("lari only: %q %v", c, ok)
	}
}

func TestBankOfCard(t *testing.T) {
	for card, want := range map[string]string{
		"Kaspi Gold": "kaspi", "KASPI RED": "kaspi", "Каспи": "kaspi",
		"Freedom Card": "freedom", "SuperCard": "freedom", "Фридом": "freedom",
		"Halyk Bonus": "halyk", "Халык": "halyk", "Народный банк": "halyk",
		"Visa ••1234": "card", "": "card",
	} {
		if got := BankOfCard(card); got != want {
			t.Errorf("BankOfCard(%q) = %q, want %q", card, got, want)
		}
	}
}

func TestCleanMerchant(t *testing.T) {
	for in, want := range map[string]string{
		"  MAGNUM   ALMATY ":     "MAGNUM ALMATY",
		"Shop **** 1234":         "Shop **** 1234",
		"Shop 1234567":           "Shop",
		"":                       FallbackMerchant,
		"   ":                    FallbackMerchant,
		"A\x00B\tC\nD":           "A B C D",
		"1234567":                FallbackMerchant,
		"· MAGNUM ·":             "MAGNUM",
		strings.Repeat("я", 250): strings.Repeat("я", 200),
	} {
		if got := CleanMerchant(in); got != want {
			t.Errorf("CleanMerchant(%q) = %q, want %q", in, got, want)
		}
	}
}
