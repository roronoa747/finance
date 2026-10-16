package applepay

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Bank pushes (бэклог «Apple Pay», Блок 2, Р-8, Р-10, Р-11, Р-23): the Shortcuts "Notification"
// trigger (iOS 27) sends the bank app's name, the title and the text of a push. ParsePush reads
// an operation out of them by the table of forms below — or says it is not one. Nothing here is
// logged or kept: the balance ("Доступно …") and card masks never reach the result.
//
// The forms are guesses (Р-10, решение владельца 2026-10-16): two samples of the owner (Kaspi and
// Freedom top-ups) and the regularities found on the web — the live pushes of the morning smoke
// test tune the table. Known shapes:
//
//	Kaspi    title = product ("Kaspi Gold"); text "<Вид>: <сумма> ₸" / source or merchant / "Доступно: <остаток> ₸"
//	Freedom  title = kind ("Пополнение с карты др…", iOS cuts it); text "+<сумма> ₸" / "Доступно <остаток> ₸" / "<глагол> SuperCard **NNNN"
//	Halyk    unknown (pushes only since 2022, no public samples) — the same words in one or several lines
//
// Kaspi sends no push for Kaspi QR, «Платежи», the Shop and transfers to Kaspi clients (its help
// pages): those come with the statement.

// Result says what a push is: an operation, a push that is not one (a decline, a code, an
// advert, a refund…) or a text the table does not know.
type Result string

const (
	ResultOp      Result = "op"
	ResultIgnore  Result = "ignore"
	ResultUnknown Result = "unknown"
)

// PushOp is the operation read from a push. Minor is in minor units of Currency, always
// positive; Sign says the direction (−1 money out, +1 money in). Currency Unsupported — a
// currency the app does not keep (the result is then ignore).
type PushOp struct {
	Bank     string // kaspi | freedom | halyk | card (not recognised)
	Kind     string // purchase | transfer-out | transfer-in | income | cash
	Sign     int
	Currency string
	Minor    int64
	Merchant string
	// Own: the bank itself says the transfer is between the person's own accounts — not a spend.
	Own bool
	// Placeholder: the push named no merchant or person, Merchant is the kind's word.
	Placeholder bool
}

// pushKind is one row of the table: words that name the kind of an operation.
type pushKind struct {
	kind string
	sign int // 0 — by the amount's sign and the words around
	re   *regexp.Regexp
}

// wordStart: a word starts here (Go's \b does not see Cyrillic).
const wordStart = `(?:^|[^\p{L}\d])`

func words(alts string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)` + wordStart + `(?:` + alts + `)`)
}

var (
	// pushKinds: the earliest word in the lead (title and the first line) names the kind.
	pushKinds = []pushKind{
		{"income", +1, words(`зарплат|заработн|salary`)},
		{"cash", -1, words(`сняти[ея]|выдача наличных|банкомат|atm|cash withdrawal`)},
		{"transfer", 0, words(`перевод|transfer`)},
		{"transfer-in", +1, words(`пополнен|пополнено|зачислен|поступлен|поступил|входящ|получен|top-?up`)},
		{"purchase", -1, words(`покупк|оплат|платеж|платёж|kaspi qr|purchase|payment`)},
		// "Списание" is a transfer when the text says so, a purchase otherwise.
		{"debit", -1, words(`списан`)},
	}
	transferWords = words(`перевод|transfer`)
	// salaryWords anywhere in an incoming push make it income (the bank marks a salary).
	salaryWords = words(`зарплат|заработн|salary`)
	// incomingWords make a transfer incoming when the amount has no sign.
	incomingWords = words(`от\s|входящ|поступ|получен|зачислен|отправител|from\s`)
	// ownWords: the bank says the money stays with the person (between own accounts).
	ownWords = words(`между своими|на свой сч|со своего сч|собственн`)
	// ignoreWords in the lead: not an operation — a decline, a code, a reversal, an advert, an
	// exchange-rate difference (Kaspi's later correction of a foreign purchase — not a spend).
	ignoreWords = words(`отклон|отказ|недостаточно|не выполн|не прош|отмен|код|парол|никому|` +
		`возврат|курсов\S*\s+разниц|кэшбэк|кешбэк|cashback|бонус|акци|скидк|розыгрыш|подарок|declined|code`)
	// balance: "Доступно: 1 529,82 ₸" — the rest of the account, never an operation (Р-8, Р-11).
	balance = regexp.MustCompile(`(?i)` + wordStart + `(?:доступно|остаток|баланс|available|balance)[^\p{L}\d]{0,3}(?:` + moneyToken.String() + `)`)
	// cardMask: "**0166", "*1234", "•• 1234" — never stored.
	cardMask = regexp.MustCompile(`[*•·]+\s?\d{2,4}`)
	// lineSplit: one-line texts split at "/", "|", ";" and at ". " before a capital letter.
	sentence = regexp.MustCompile(`\.\s+(\p{Lu})`)
	// kindWordAtStart: the kind's own words leading a line ("Покупка:", "Пополнено", "Перевод от").
	kindWordAtStart = regexp.MustCompile(`(?i)^(?:покупка|оплата|платеж|платёж|пополнение|пополнено|перевод|` +
		`снятие наличных|снятие|зачисление|поступление|списание|зарплата|kaspi qr|оплачено|списано|` +
		`входящий перевод|исходящий перевод)(?:[^\p{L}\d]+|$)`)
	// prepositionAtStart: "в MAGNUM", "от Айгерим С." — the word before the merchant or person.
	prepositionAtStart = regexp.MustCompile(`(?i)^(?:в|во|у|на|от|для|с|со|at|in|from|to|получатель:?|отправитель:?)\s+`)
	// bankWords: the bank and its products inside a detail line.
	bankWords = regexp.MustCompile(`(?i)` + wordStart + `(?:kaspi(?:\.kz)?(?:\s*(?:gold|red|qr|pay|депозит|bank|банк))?|` +
		`freedom(?:\s*(?:bank|finance|superapp))?|supercard|halyk(?:\s*bank)?|homebank|народный банк|каспи|фридом|халык)`)
	// aboutCard: a detail about the card or account the money went from or to ("карты другого
	// банка" after the preposition) — not the merchant.
	aboutCard = regexp.MustCompile(`(?i)^(?:карт|счет|счёт|депозит)`)
	// notAName: details of a transfer that are about cards and accounts, not a person.
	notAName = words(`карт|банк|счет|счёт|депозит|свой|своей|своего|собствен|клиент|kaspi|freedom|halyk|card|account`)
	digitRe  = regexp.MustCompile(`\d`)
)

// placeholders: the merchant of a push that named nobody, by kind.
var placeholders = map[string]string{
	"purchase":     "Покупка",
	"transfer-out": "Перевод",
	"transfer-in":  "Пополнение",
	"income":       "Зарплата",
	"cash":         "Снятие наличных",
}

// PushBank names the bank of a push: by the app first (Kaspi.kz, Freedom, Halyk / Homebank),
// then by the title and the text; "card" when none names one.
func PushBank(app, title, body string) string {
	for _, s := range []string{app, title, body} {
		l := strings.ToLower(s)
		if strings.Contains(l, "homebank") {
			return "halyk"
		}
		if b := BankOfCard(s); b != "card" {
			return b
		}
	}
	return "card"
}

// ParsePush reads an operation out of a bank push (Р-8, Р-10, Р-23). The amount is the first
// money in the text after the balance is cut out; its sign or the kind's words say the
// direction. A push without money and digits, or with the words of a decline, a code, a
// reversal or an advert, is ignore; money without a known kind — unknown.
func ParsePush(app, title, body string) (PushOp, Result) {
	op := PushOp{Bank: PushBank(app, title, body)}
	lines := pushLines(title, body)
	if len(lines) == 0 {
		return op, ResultIgnore
	}
	lead := strings.Join(lines[:leadLines(title, lines)], "\n")
	if ignoreWords.MatchString(lead) {
		return op, ResultIgnore
	}
	all := strings.Join(lines, "\n")
	sign, currency, minor, found := pushAmount(all)
	if !found {
		if currency == Unsupported {
			op.Currency = Unsupported
			return op, ResultIgnore
		}
		if digitRe.MatchString(all) {
			return op, ResultUnknown
		}
		return op, ResultIgnore
	}
	kind, kindSign := kindOf(lead)
	if kind == "" {
		kind, kindSign = kindOf(all)
	}
	if kind == "" {
		return op, ResultUnknown
	}
	if kind == "debit" {
		kind = "purchase"
		if transferWords.MatchString(all) {
			kind = "transfer"
		}
	}
	if kind == "transfer" {
		switch {
		case sign != 0:
			kindSign = sign
		case incomingWords.MatchString(all):
			kindSign = +1
		default:
			kindSign = -1
		}
		kind = map[int]string{-1: "transfer-out", +1: "transfer-in"}[kindSign]
	}
	// "+5 000 ₸" under a purchase word, "−5 000 ₸" under a top-up: the table does not know it.
	if sign != 0 && sign != kindSign {
		return op, ResultUnknown
	}
	if kindSign > 0 && salaryWords.MatchString(all) {
		kind = "income"
	}
	op.Kind, op.Sign, op.Currency, op.Minor = kind, kindSign, currency, minor
	if currency == Unsupported {
		return op, ResultIgnore
	}
	op.Own = (kind == "transfer-out" || kind == "transfer-in") && ownWords.MatchString(all)
	op.Merchant, op.Placeholder = pushMerchant(kind, lines)
	return op, ResultOp
}

// pushLines: the title and the text as lines without the balance and card masks; a one-line
// text is split at " / ", "|", ";" and sentence ends.
func pushLines(title, body string) []string {
	text := title + "\n" + body
	text = balance.ReplaceAllString(text, "\n")
	text = cardMask.ReplaceAllString(text, " ")
	text = sentence.ReplaceAllString(text, "\n$1")
	text = strings.ReplaceAll(text, " / ", "\n") // "APPLE.COM/BILL" stays whole
	parts := strings.FieldsFunc(text, func(r rune) bool { return strings.ContainsRune("\n\r|;", r) })
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.Join(strings.Fields(strings.Map(func(r rune) rune {
			if unicode.IsControl(r) || r == utf8.RuneError {
				return ' '
			}
			return r
		}, p)), " ")
		p = strings.Trim(p, " .,:;…") // not "-": it is the sign of "-5 000 ₸"
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// leadLines: the title and the first line of the text; without a title — the first three lines
// (a command that sends the whole notification as one text).
func leadLines(title string, lines []string) int {
	n := 3
	if strings.TrimSpace(title) != "" {
		n = len(pushLines(title, "")) + 1
	}
	return min(n, len(lines))
}

// kindOf: the earliest kind word of the text.
func kindOf(text string) (string, int) {
	best, kind, sign := -1, "", 0
	for _, k := range pushKinds {
		if loc := k.re.FindStringIndex(text); loc != nil && (best < 0 || loc[0] < best) {
			best, kind, sign = loc[0], k.kind, k.sign
		}
	}
	return kind, sign
}

// pushAmount finds the first money token of the text and the sign right before it (one space
// allowed): "+200 ₸" is +1, "−5 000 ₸" −1, "Покупка: 5 000 ₸" 0. Only tokens in currencies the
// app does not keep — not found, currency Unsupported.
func pushAmount(text string) (sign int, currency string, minor int64, found bool) {
	unsupported := false
	for _, loc := range moneyToken.FindAllStringIndex(text, -1) {
		start, end := loc[0], loc[1]
		first, _ := utf8.DecodeRuneInString(text[start:])
		before, bsize := utf8.DecodeLastRuneInString(text[:start])
		if start > 0 && (unicode.IsDigit(before) || isLetter(before) && wordy(first)) {
			continue // the tail of a longer number or word
		}
		if end = tokenEnd(text, start, end); end < 0 {
			continue
		}
		code, m, ok := ParseAmount(text[start:end])
		if !ok {
			if c, _, _ := currencyIn(text[start:end]); c == Unsupported {
				unsupported = true
			}
			continue
		}
		s := start
		if s > 0 && (before == ' ' || before == ' ' || before == ' ') {
			s -= bsize
			before, _ = utf8.DecodeLastRuneInString(text[:s])
		}
		switch {
		case s > 0 && before == '+':
			sign = +1
		case s > 0 && (before == '-' || before == '−'):
			sign = -1
		}
		return sign, code, m, true
	}
	if unsupported {
		return 0, Unsupported, 0, false
	}
	return 0, "", 0, false
}

// pushMerchant: what the operation is called. A purchase — the merchant line; a transfer — the
// person ("Перевод Имя Ф.", Р-23), never a card or an account; otherwise the kind's word.
func pushMerchant(kind string, lines []string) (string, bool) {
	details := make([]string, 0, len(lines))
	for _, l := range lines {
		l = moneyToken.ReplaceAllString(l, " ")
		l = strings.Trim(strings.Join(strings.Fields(l), " "), " +-−.,:;…")
		l = kindWordAtStart.ReplaceAllString(l, "")
		// The bank and the product ("Kaspi Gold", "Kaspi QR · Coffee", "SuperCard") are not the merchant.
		l = bankWords.ReplaceAllString(l, " ")
		l = strings.Trim(strings.Join(strings.Fields(l), " "), " +-−.,:;…·•–—")
		l = prepositionAtStart.ReplaceAllString(l, "")
		l = strings.Trim(l, " +-−.,:;…")
		if l == "" {
			continue
		}
		details = append(details, l)
	}
	switch kind {
	case "purchase":
		kept := details[:0:0]
		for _, d := range details {
			if !aboutCard.MatchString(d) {
				kept = append(kept, d)
			}
		}
		if m := CleanMerchant(strings.Join(kept, " ")); len(kept) > 0 && m != FallbackMerchant {
			return m, false
		}
	case "transfer-out", "transfer-in":
		for _, d := range details {
			if name, ok := personName(d); ok {
				// CleanMerchant trims the end: the initial's dot comes back after it.
				m := CleanMerchant("Перевод " + name)
				if strings.HasSuffix(name, ".") && !strings.HasSuffix(m, ".") {
					m += "."
				}
				return m, false
			}
		}
	}
	return placeholders[kind], true
}

const patronymic = `(?:вич|вна|ична|ұлы|улы|қызы|кызы|оглы)`

var (
	// fullName: "Фамилия Имя Отчество" (Freedom prints it at transfers), also in capitals.
	fullName = regexp.MustCompile(`^(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?) (\p{Lu}\p{Ll}+) \p{Lu}\p{Ll}+` + patronymic + `$` +
		`|^(\p{Lu}{2,}(?:-\p{Lu}{2,})?) (\p{Lu}{2,}) \p{Lu}{2,}` + strings.ToUpper(patronymic) + `$`)
	// shortName: "Айгерим С." / "АЙГЕРИМ С." — the bank's own short form.
	shortName = regexp.MustCompile(`^(\p{Lu}[\p{L}-]+) (\p{Lu})\.?$`)
	// twoWords: "Айгерим Сапарова" — the first word is taken as the name.
	twoWords = regexp.MustCompile(`^(\p{Lu}\p{Ll}+) (\p{Lu})\p{Ll}+$`)
	// oneWord: "Айгерим".
	oneWord = regexp.MustCompile(`^\p{Lu}\p{Ll}+$`)
)

// personName reads a person out of a transfer detail as "Имя Ф." (Р-23: like shortenFullNames of
// the statements) — full surnames are not stored.
func personName(d string) (string, bool) {
	if notAName.MatchString(d) {
		return "", false
	}
	if m := fullName.FindStringSubmatch(d); m != nil {
		if m[1] != "" {
			return m[2] + " " + firstRune(m[1]) + ".", true
		}
		return title(m[4]) + " " + firstRune(m[3]) + ".", true
	}
	if m := shortName.FindStringSubmatch(d); m != nil {
		return title(m[1]) + " " + m[2] + ".", true
	}
	if m := twoWords.FindStringSubmatch(d); m != nil {
		return m[1] + " " + m[2] + ".", true
	}
	if oneWord.MatchString(d) {
		return d, true
	}
	return "", false
}

func firstRune(s string) string {
	r, _ := utf8.DecodeRuneInString(s)
	return string(r)
}

// title: "АЙГЕРИМ" → "Айгерим".
func title(s string) string {
	r, size := utf8.DecodeRuneInString(s)
	return string(unicode.ToUpper(r)) + strings.ToLower(s[size:])
}
