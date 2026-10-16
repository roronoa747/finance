package ai

import (
	"encoding/json"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// CheckNumbers returns the numbers of texts that are not in input (Р-3: the model does not
// count — a number of the answer that the summary does not have is a defect). input is the
// summary decoded with json.Decoder.UseNumber (json.Number) or plain float64.
//
// A number is read the Russian way: thousands split by a space, NBSP or narrow NBSP
// ("220 000") or by a comma or dot in groups of 3 ("2,000,000", "150.000" — no number of the
// summary has 3 decimals), a decimal comma or dot ("1,5"), a scale word after it ("1,2 млн" =
// 1 200 000, "1,250 млн" = 1 250 000, "тыс." = ×1000); signs, "₸" and "%" are ignored (a percent is matched as its number). The
// input's numbers count by absolute value (free −50 000 is "не хватает 50 000"), and so do the
// numbers written inside its strings (a month "2026-10" allows 2026 and 10, "iPhone 15" — 15).
// 1–3 are always allowed: "2 шага", "первый" is counting, not money. No tolerance:
// "≈ 1,2 млн" for 1 234 000 is a defect.
//
// A number in words ("двести тысяч", "миллион", "половина", "вдвое", "полгода") cannot be
// matched — the instruction wants the summary's digits — so it is a defect, unless the same word
// is in the summary's strings (a goal «Тысяча мелочей»). So is a ratio "в 2 раза": a comparison
// is a computation even with 1–3 (критик Блока 2 «ИИ»).
func CheckNumbers(texts []string, input any) []string {
	allowed := map[string]bool{}
	for _, n := range []int64{1, 2, 3} {
		allowed[new(big.Rat).SetInt64(n).RatString()] = true
	}
	words := map[string]bool{}
	collectNumbers(input, allowed, words)

	var bad []string
	seen := map[string]bool{}
	add := func(raw string) {
		if !seen[raw] {
			seen[raw] = true
			bad = append(bad, raw)
		}
	}
	for _, t := range texts {
		for _, n := range scanNumbers(t) {
			if !allowed[n.value.RatString()] {
				add(n.raw)
			}
		}
		for _, w := range numberWords(t) {
			if !words[foldWord(w)] {
				add(w)
			}
		}
		for _, m := range ratio.FindAllStringSubmatch(t, -1) {
			if !words[foldWord(m[1])] {
				add(m[1])
			}
		}
	}
	return bad
}

// collectNumbers adds every number of v (absolute) and every number written in its strings;
// words gets the number words and ratios of its strings.
func collectNumbers(v any, into, words map[string]bool) {
	switch x := v.(type) {
	case json.Number:
		if r, ok := new(big.Rat).SetString(x.String()); ok {
			into[r.Abs(r).RatString()] = true
		}
	case float64:
		// Through the shortest decimal text: 0.1 as a float is not 1/10 exactly.
		if r, ok := new(big.Rat).SetString(strconv.FormatFloat(x, 'f', -1, 64)); ok {
			into[r.Abs(r).RatString()] = true
		}
	case string:
		for _, n := range scanNumbers(x) {
			into[n.value.RatString()] = true
		}
		for _, w := range numberWords(x) {
			words[foldWord(w)] = true
		}
		for _, m := range ratio.FindAllStringSubmatch(x, -1) {
			words[foldWord(m[1])] = true
		}
	case []any:
		for _, e := range x {
			collectNumbers(e, into, words)
		}
	case map[string]any:
		for _, e := range x {
			collectNumbers(e, into, words)
		}
	}
}

// foldWord compares words: lower case, "ё" as "е", spaces as one.
func foldWord(s string) string {
	return strings.Join(strings.FieldsFunc(strings.ReplaceAll(strings.ToLower(s), "ё", "е"), unicode.IsSpace), " ")
}

// cardinalWords are numbers 4–900 in words, in their cases (folded). 1–3 (один, два, три, двух,
// трёх, оба, двое, трое) are counting and ordinals are not amounts, so neither is here; "семью"
// is the family, not «семью» (7).
var cardinalWords = func() map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(`четыре четырех четырем четырьмя пять пяти пятью шесть шести шестью семь семи
		восемь восьми восемью девять девяти девятью десять десяти десятью
		одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать
		одиннадцати двенадцати тринадцати четырнадцати пятнадцати шестнадцати семнадцати восемнадцати девятнадцати
		двадцать двадцати двадцатью тридцать тридцати тридцатью сорок сорока пятьдесят пятидесяти шестьдесят
		шестидесяти семьдесят семидесяти восемьдесят восьмидесяти девяносто девяноста
		сто ста двести двухсот двумстам триста трехсот тремстам четыреста четырехсот пятьсот пятисот шестьсот
		шестисот семьсот семисот восемьсот восьмисот девятьсот девятисот
		вдвое втрое вчетверо впятеро вдесятеро вполовину полгода полугода треть трети четверть четверти
		тыс млн млрд`) {
		m[w] = true
	}
	return m
}()

// numberStems start a number word in any case: "тысяча", "миллионов", "полтора", "половину".
var numberStems = []string{"тысяч", "миллион", "миллиард", "полмиллион", "полтысяч", "полтор", "полутор", "половин"}

// scaleWord is the scale of a number in digits ("1,2 млн", "300 тысяч") — scanNumbers reads it.
func scaleWord(w string) bool {
	for _, sc := range scales {
		if strings.HasPrefix(w, sc.prefix) {
			return true
		}
	}
	return false
}

// numberWords finds the numbers of s written in words, as written. A scale right after digits
// ("300 тысяч") belongs to that number, not here.
func numberWords(s string) []string {
	rs := []rune(s)
	var out []string
	for i := 0; i < len(rs); {
		if !unicode.IsLetter(rs[i]) {
			i++
			continue
		}
		start := i
		for i < len(rs) && unicode.IsLetter(rs[i]) {
			i++
		}
		w := foldWord(string(rs[start:i]))
		isNumber := cardinalWords[w]
		for _, st := range numberStems {
			isNumber = isNumber || strings.HasPrefix(w, st)
		}
		if !isNumber {
			continue
		}
		if scaleWord(w) {
			k := start - 1
			for k >= 0 && isGroupSpace(rs[k]) {
				k--
			}
			if k >= 0 && isDigit(rs[k]) {
				continue
			}
		}
		out = append(out, string(rs[start:i]))
	}
	return out
}

// ratio is a comparison "в 2 раза", "в полтора раза" (group 1); "2 раза в месяц" is not one.
var ratio = regexp.MustCompile(`(?i)(?:^|[^\p{L}\d])(в[\s\x{00a0}\x{202f}]+(?:\d+(?:[.,]\d+)?|два|две|три|четыре|пять|шесть|семь|восемь|девять|десять|полтора|полторы)[\s\x{00a0}\x{202f}]+раза?)(?:[^\p{L}]|$)`)

// number is one number found in a text: as written, and its value.
type number struct {
	raw   string
	value *big.Rat
}

// isGroupSpace is a thousands separator: space, NBSP, narrow NBSP, thin space.
func isGroupSpace(r rune) bool {
	return r == ' ' || r == ' ' || r == ' ' || r == ' '
}

func isDigit(r rune) bool { return r >= '0' && r <= '9' }

// scales are the words after a number that multiply it ("1,2 млн").
var scales = []struct {
	prefix string
	mul    int64
}{
	{"млрд", 1_000_000_000},
	{"миллиард", 1_000_000_000},
	{"млн", 1_000_000},
	{"миллион", 1_000_000},
	{"тыс", 1_000},
}

// scanNumbers finds the numbers of s in order.
func scanNumbers(s string) []number {
	rs := []rune(s)
	var out []number
	for i := 0; i < len(rs); {
		if !isDigit(rs[i]) {
			i++
			continue
		}
		start := i
		var digits strings.Builder
		first := 0
		for i < len(rs) && isDigit(rs[i]) {
			digits.WriteRune(rs[i])
			i++
			first++
		}
		// Thousands: a group of 1–3 digits, then groups of exactly 3 after a space.
		spaced := false
		if first <= 3 {
			for i < len(rs) && isGroupSpace(rs[i]) && threeDigits(rs, i+1) {
				for _, r := range rs[i+1 : i+4] {
					digits.WriteRune(r)
				}
				i += 4
				spaced = true
			}
		}
		// Thousands by comma or dot ("2,000,000", "150.000"): exactly 3 digits after it, then
		// groups by the same mark — no number of the summary has 3 decimals (money is whole, a
		// rate has 2), unless a scale follows ("1,250 млн" is a fraction).
		if first <= 3 && !spaced && i < len(rs) && (rs[i] == ',' || rs[i] == '.') && threeDigits(rs, i+1) && !scaleAt(rs, i+4) {
			mark := rs[i]
			for i < len(rs) && rs[i] == mark && threeDigits(rs, i+1) {
				for _, r := range rs[i+1 : i+4] {
					digits.WriteRune(r)
				}
				i += 4
			}
		}
		value, _ := new(big.Rat).SetString(digits.String())
		// A fraction: comma or dot, then digits ("1,5", "16.5").
		if i+1 < len(rs) && (rs[i] == ',' || rs[i] == '.') && isDigit(rs[i+1]) {
			j := i + 1
			var frac strings.Builder
			for j < len(rs) && isDigit(rs[j]) {
				frac.WriteRune(rs[j])
				j++
			}
			if f, ok := new(big.Rat).SetString(digits.String() + "." + frac.String()); ok {
				value = f
				i = j
			}
		}
		end := i
		// A scale word after spaces: "1,2 млн", "300 тыс.".
		k := i
		for k < len(rs) && isGroupSpace(rs[k]) {
			k++
		}
		rest := strings.ToLower(string(rs[k:]))
		for _, sc := range scales {
			if strings.HasPrefix(rest, sc.prefix) {
				value = new(big.Rat).Mul(value, new(big.Rat).SetInt64(sc.mul))
				end = k + utf8.RuneCountInString(sc.prefix)
				break
			}
		}
		out = append(out, number{raw: strings.TrimRightFunc(string(rs[start:end]), unicode.IsSpace), value: value})
		i = end
	}
	return out
}

// scaleAt is a scale word at i, after spaces.
func scaleAt(rs []rune, i int) bool {
	for i < len(rs) && isGroupSpace(rs[i]) {
		i++
	}
	rest := strings.ToLower(string(rs[min(i, len(rs)):]))
	for _, sc := range scales {
		if strings.HasPrefix(rest, sc.prefix) {
			return true
		}
	}
	return false
}

// threeDigits is exactly three digits at i, not followed by a fourth.
func threeDigits(rs []rune, i int) bool {
	if i+3 > len(rs) {
		return false
	}
	for _, r := range rs[i : i+3] {
		if !isDigit(r) {
			return false
		}
	}
	return i+3 == len(rs) || !isDigit(rs[i+3])
}
