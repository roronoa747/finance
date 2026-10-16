package applepay

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Unsupported is the currency of an amount in a currency the app does not keep (£, ₺, AED…):
// such a purchase is not recorded (Р-7), the statement brings it later.
const Unsupported = "?"

// FallbackMerchant names a purchase whose merchant came empty (an Apple bug): it lands in
// "Без раздела", and the statement replaces it by the amount (Р-16 п. 2).
const FallbackMerchant = "Apple Pay"

const maxMerchantRunes = 200

// currencyTokens: symbol or code → currency, the longer token first ("US$" before "$").
var currencyTokens = []struct{ token, code string }{
	{"us$", "USD"}, {"usd", "USD"}, {"$", "USD"},
	{"₸", "KZT"}, {"kzt", "KZT"}, {"тенге", "KZT"}, {"тг", "KZT"},
	{"€", "EUR"}, {"eur", "EUR"},
	{"₽", "RUB"}, {"rub", "RUB"}, {"руб", "RUB"},
	{"¥", "CNY"}, {"cny", "CNY"}, {"元", "CNY"}, {"rmb", "CNY"},
	// Recognised but not kept — never guessed as tenge.
	{"£", Unsupported}, {"gbp", Unsupported}, {"₺", Unsupported}, {"try", Unsupported},
	{"aed", Unsupported}, {"₩", Unsupported}, {"krw", Unsupported}, {"jpy", Unsupported},
	{"chf", Unsupported}, {"₴", Unsupported}, {"uah", Unsupported}, {"uzs", Unsupported},
	{"kgs", Unsupported}, {"₾", Unsupported}, {"gel", Unsupported}, {"₼", Unsupported},
	{"azn", Unsupported}, {"฿", Unsupported}, {"thb", Unsupported}, {"₹", Unsupported},
	{"inr", Unsupported}, {"сом", Unsupported}, {"сум", Unsupported}, {"₫", Unsupported},
}

const groupSeps = "   '’"

var (
	numberPart = `\d{1,3}(?:[ \x{00A0}\x{202F}'’.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
	moneyToken = func() *regexp.Regexp {
		alts := make([]string, 0, len(currencyTokens))
		for _, c := range currencyTokens {
			alts = append(alts, regexp.QuoteMeta(c.token))
		}
		cur := strings.Join(alts, "|")
		space := `[ \x{00A0}\x{202F}]?`
		return regexp.MustCompile(`(?i)(?:(?:` + cur + `)` + space + `(?:` + numberPart + `)|(?:` + numberPart + `)` + space + `(?:` + cur + `))`)
	}()
	longDigitRun = regexp.MustCompile(`[0-9]{6,}`)
	// The whole part: plain digits, or groups of three after the first (one separator each).
	wholePart = regexp.MustCompile(`^(?:\d+|\d{1,3}(?:[ \x{00A0}\x{202F}'’.,]\d{3})+)$`)
)

func isLetter(r rune) bool { return unicode.IsLetter(r) }

// currencyIn finds the currency tokens of s (letter codes only as whole words) and returns the
// one currency named, s with the tokens blanked out, and whether exactly one currency was named.
func currencyIn(s string) (code, rest string, ok bool) {
	lower := []rune(strings.ToLower(s))
	codes := map[string]bool{}
	for _, c := range currencyTokens {
		tok := []rune(c.token)
		for i := 0; i+len(tok) <= len(lower); i++ {
			if string(lower[i:i+len(tok)]) != c.token {
				continue
			}
			if isLetter(tok[0]) {
				before := i > 0 && isLetter(lower[i-1])
				after := i+len(tok) < len(lower) && isLetter(lower[i+len(tok)])
				if before || after {
					continue
				}
			}
			codes[c.code] = true
			for j := i; j < i+len(tok); j++ {
				lower[j] = ' '
			}
		}
	}
	if len(codes) != 1 {
		return "", string(lower), false
	}
	for c := range codes {
		code = c
	}
	return code, string(lower), true
}

// ParseAmount reads the trigger's Amount string ("1 234,50 ₸", "$6.22", "5,00 EUR") into a
// currency code and whole minor units (×100). Without a currency sign or code, with a sign or
// brackets, in a currency the app does not keep, or zero — not ok: nothing is guessed.
func ParseAmount(s string) (currency string, minor int64, ok bool) {
	code, rest, found := currencyIn(s)
	if !found || code == Unsupported {
		return "", 0, false
	}
	// "1 200 руб." leaves the abbreviation's dot behind.
	num := strings.TrimRight(strings.Trim(rest, groupSeps+"\t\n\r"), ".   ")
	if num == "" || strings.ContainsAny(num, "-−+()") {
		return "", 0, false
	}
	minor, ok = parseNumber(num)
	if !ok || minor == 0 {
		return "", 0, false
	}
	return code, minor, true
}

// parseNumber: groups by space, NBSP, narrow NBSP, apostrophe, dot or comma; a dot or comma with
// one or two digits at the end is the fraction ("1,234" and "1.234" are thousands).
func parseNumber(num string) (int64, bool) {
	intPart, frac := num, ""
	if i := strings.LastIndexAny(num, ".,"); i >= 0 {
		tail := num[i+1:]
		if len(tail) >= 1 && len(tail) <= 2 && allDigits(tail) {
			intPart, frac = num[:i], tail
		}
	}
	if !wholePart.MatchString(intPart) {
		return 0, false
	}
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, intPart)
	if len(digits) > 13 {
		return 0, false
	}
	whole, err := strconv.ParseInt(digits, 10, 64)
	if err != nil {
		return 0, false
	}
	cents := int64(0)
	if frac != "" {
		c, _ := strconv.ParseInt(frac, 10, 64)
		if len(frac) == 1 {
			c *= 10
		}
		cents = c
	}
	return whole*100 + cents, true
}

func allDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// SkipReason says why ParseAmount refused s: "currency" — there is a number but no currency the
// app keeps; "amount" — no number at all, a sign, or zero.
func SkipReason(s string) string {
	code, _, found := currencyIn(s)
	hasDigit := strings.IndexFunc(s, unicode.IsDigit) >= 0
	if hasDigit && (!found || code == Unsupported) {
		return "currency"
	}
	return "amount"
}

const (
	// signRunes right before an amount make it a refund or incoming money, not a purchase (as in
	// ParseAmount) — unless a digit stands before them ("2026-10-16 500 ₸" is a date).
	signRunes = "-−+("
	// After a digit these glue the next digits to it: "10:23 500 ₸" is not 23 500 ₸, "16.10 500 ₸"
	// is not 10 500 ₸.
	numberGlue = ":.,/-−"
	// numberMarks always start a number of their own: "№1 500 ₸" is not 1 500 ₸.
	numberMarks = "№#"
	// groupRunes split thousands; a match running into the next number is cut back at one.
	groupRunes = "   '’"
)

// moneyTokenWhole is moneyToken over a whole string.
var moneyTokenWhole = regexp.MustCompile(`^(?:` + moneyToken.String() + `)$`)

// wordy: a digit or a letter — a token edge that must not touch another word or number.
// A currency symbol may touch a letter ("MAGNUM₸500").
func wordy(r rune) bool { return unicode.IsDigit(r) || isLetter(r) }

// FindAmount looks for the first money token ("5 000 ₸", "$6.22") in free text — the owner's
// command sends the whole transaction as one string (Р-13а). rest is the text without the
// token. A signed amount ("−5 000 ₸", a refund) means no purchase in the text. Only tokens in
// currencies the app does not keep — currency Unsupported, not ok.
func FindAmount(text string) (currency string, minor int64, rest string, ok bool) {
	unsupported := false
	for offset := 0; offset < len(text); {
		loc := moneyToken.FindStringIndex(text[offset:])
		if loc == nil {
			break
		}
		start, end := offset+loc[0], offset+loc[1]
		first, size := utf8.DecodeRuneInString(text[start:])
		offset = start + size // a refused match: the next try starts one character later
		if start > 0 {
			before, bsize := utf8.DecodeLastRuneInString(text[:start])
			prev, _ := utf8.DecodeLastRuneInString(text[:start-bsize])
			afterDigit := unicode.IsDigit(prev)
			switch {
			case strings.ContainsRune(signRunes, before) && !afterDigit:
				return "", 0, text, false
			// Not the tail of a longer number or word: "1234 000 ₸" is not 234 000, "тгк" is not тг.
			case unicode.IsDigit(before), strings.ContainsRune(numberMarks, before),
				afterDigit && strings.ContainsRune(numberGlue, before), isLetter(before) && wordy(first):
				continue
			}
		}
		if end = tokenEnd(text, start, end); end < 0 {
			continue
		}
		code, m, parsed := ParseAmount(text[start:end])
		if !parsed {
			// "NAIL GEL 5 000 ₸": a word like a currency code — the tenge may still follow.
			if c, _, _ := currencyIn(text[start:end]); c == Unsupported {
				unsupported = true
			}
			continue
		}
		return code, m, text[:start] + "\n" + text[end:], true
	}
	if unsupported {
		return Unsupported, 0, "", false
	}
	return "", 0, text, false
}

// tokenEnd is where the money token text[start:end] really ends: there, when the next character
// does not continue it; otherwise cut back at a thousands separator that still leaves a whole
// token ("₸500 2026-10-16" is ₸500); -1 when there is none.
func tokenEnd(text string, start, end int) int {
	for limit := end; ; {
		last, _ := utf8.DecodeLastRuneInString(text[start:end])
		after, _ := utf8.DecodeRuneInString(text[end:])
		if end == len(text) || !unicode.IsDigit(after) && !(isLetter(after) && wordy(last)) {
			return end
		}
		i := strings.LastIndexAny(text[start:limit], groupRunes)
		if i <= 0 {
			return -1
		}
		limit = start + i
		if moneyTokenWhole.MatchString(text[start:limit]) {
			end = limit
		}
	}
}

// BankOfCard maps the Wallet card name to a bank: Kaspi, Freedom, Halyk, otherwise "card".
func BankOfCard(card string) string {
	c := strings.ToLower(card)
	switch {
	case strings.Contains(c, "kaspi") || strings.Contains(c, "каспи"):
		return "kaspi"
	case strings.Contains(c, "freedom") || strings.Contains(c, "supercard") || strings.Contains(c, "фридом"):
		return "freedom"
	case strings.Contains(c, "halyk") || strings.Contains(c, "халык") || strings.Contains(c, "народный"):
		return "halyk"
	}
	return "card"
}

// MerchantFrom takes the merchant out of the transaction text left after FindAmount: the card
// name and the parts naming a bank go, the rest is cleaned.
func MerchantFrom(rest, card string) string {
	if c := strings.TrimSpace(card); c != "" {
		rest = replaceFold(rest, c, "\n")
	}
	parts := strings.FieldsFunc(rest, func(r rune) bool { return strings.ContainsRune("\n\r\t·•|;", r) })
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) == "" || BankOfCard(p) != "card" {
			continue
		}
		kept = append(kept, p)
	}
	return CleanMerchant(strings.Join(kept, " "))
}

// replaceFold replaces every case-insensitive occurrence of old in s.
func replaceFold(s, old, repl string) string {
	lowerS, lowerOld := strings.ToLower(s), strings.ToLower(old)
	if len(lowerS) != len(s) || lowerOld == "" {
		return strings.ReplaceAll(s, old, repl) // case mapping changed byte lengths: exact only
	}
	var b strings.Builder
	for {
		i := strings.Index(lowerS, lowerOld)
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		b.WriteString(s[:i])
		b.WriteString(repl)
		s, lowerS = s[i+len(old):], lowerS[i+len(old):]
	}
}

// CleanMerchant makes the merchant safe to store (Р-11): no control characters, no runs of 6+
// digits (card and ID numbers), single spaces, at most 200 characters; empty → "Apple Pay".
func CleanMerchant(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == utf8.RuneError {
			return ' '
		}
		return r
	}, s)
	s = longDigitRun.ReplaceAllString(s, " ")
	s = strings.Join(strings.Fields(s), " ")
	s = strings.Trim(s, " -–—:,.;·•|")
	if r := []rune(s); len(r) > maxMerchantRunes {
		s = strings.TrimSpace(string(r[:maxMerchantRunes]))
	}
	if s == "" {
		return FallbackMerchant
	}
	return s
}
