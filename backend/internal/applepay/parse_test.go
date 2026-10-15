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
