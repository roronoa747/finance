package ai

import (
	"encoding/json"
	"math/big"
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
// ("220 000"), a decimal comma or dot ("1,5"), a scale word after it ("1,2 млн" = 1 200 000,
// "тыс." = ×1000); signs, "₸" and "%" are ignored (a percent is matched as its number). The
// input's numbers count by absolute value (free −50 000 is "не хватает 50 000"), and so do the
// numbers written inside its strings (a month "2026-10" allows 2026 and 10, "iPhone 15" — 15).
// 1–3 are always allowed: "2 шага", "в 3 раза меньше"… is counting, not money. No tolerance:
// "≈ 1,2 млн" for 1 234 000 is a defect.
func CheckNumbers(texts []string, input any) []string {
	allowed := map[string]bool{}
	for _, n := range []int64{1, 2, 3} {
		allowed[new(big.Rat).SetInt64(n).RatString()] = true
	}
	collectNumbers(input, allowed)

	var bad []string
	seen := map[string]bool{}
	for _, t := range texts {
		for _, n := range scanNumbers(t) {
			if allowed[n.value.RatString()] || seen[n.raw] {
				continue
			}
			seen[n.raw] = true
			bad = append(bad, n.raw)
		}
	}
	return bad
}

// collectNumbers adds every number of v (absolute) and every number written in its strings.
func collectNumbers(v any, into map[string]bool) {
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
	case []any:
		for _, e := range x {
			collectNumbers(e, into)
		}
	case map[string]any:
		for _, e := range x {
			collectNumbers(e, into)
		}
	}
}

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
		if first <= 3 {
			for i < len(rs) && isGroupSpace(rs[i]) && threeDigits(rs, i+1) {
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
