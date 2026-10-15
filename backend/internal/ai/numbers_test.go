package ai

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

// summary is an AI-07 summary as the handler decodes it (UseNumber).
func summary(t *testing.T) any {
	t.Helper()
	raw := `{"month":"2026-10","daysToPayday":12,"income":{"total":1200000,"byPerson":[{"who":"участник 1","amount":700000}]},
		"dues":{"total":278000,"items":[{"name":"Аренда","amount":220000},{"name":"iPhone 15","amount":58000}]},
		"spend":{"total":120000,"fact":null,"byCategory":[]},"rest":0,"short":0,"free":-50000,"saved":0,
		"debts":{"total":1000000,"items":[{"name":"Кредит","left":1000000,"payment":58000,"ratePercent":16.5,"endMonth":"2028-06"},
		{"name":"Кредитка","left":200000,"payment":20000,"ratePercent":33,"endMonth":null}]},
		"goals":[{"name":"Квартира","want":10000000,"have":1000000,"monthlyPut":150000,"doneMonth":"2031-02","paused":false}]}`
	dec := json.NewDecoder(strings.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestCheckNumbers(t *testing.T) {
	in := summary(t)
	cases := []struct {
		text string
		bad  []string
	}{
		{"Аренда 220 000 ₸ оплачена.", nil},
		{"Аренда 220000 ₸.", nil},
		{"Аренда 220 000 ₸ и 1 200 000 дохода.", nil},
		{"Кредитка под 33% и кредит под 16,5%.", nil},
		{"Ставка 16.5 % годовых.", nil},
		{"Доход — 1,2 млн.", nil},
		{"Доход 1.2 млн, на квартиру нужно 10 млн, есть 1 млн.", nil},
		{"Откладываем 150 тыс. в месяц.", nil},
		{"Сделаем 2 шага, первый — самый важный, и ещё 3 мелочи.", nil},
		{"Октябрь 2026: до зарплаты 12 дней.", nil},
		{"Кредит закроем к июню 2028, квартиру — к 2031-02.", nil},
		{"Платёж за iPhone 15 — 58 000 ₸.", nil},
		{"Не хватает 50 000 ₸.", nil},
		{"Не хватает −50 000 ₸.", nil},
		{"Хватит 0 ₸ запаса.", nil},
		// Defects: the model counted or rounded.
		{"Платим 215 000 ₸.", []string{"215 000"}},
		{"Платежи — 23% дохода.", []string{"23"}},
		{"Доход ≈ 1,3 млн.", []string{"1,3 млн"}},
		{"Это 4 шага.", []string{"4"}},
		{"К 2029 году.", []string{"2029"}},
		{"Остаток 1 200 001.", []string{"1 200 001"}},
		{"Два числа: 7 и 7 тыс.", []string{"7", "7 тыс"}},
	}
	for _, tc := range cases {
		got := CheckNumbers([]string{tc.text}, in)
		if !slices.Equal(got, tc.bad) {
			t.Errorf("%q: bad = %q, want %q", tc.text, got, tc.bad)
		}
	}
}

func TestCheckNumbersAcrossTexts(t *testing.T) {
	bad := CheckNumbers([]string{"Аренда 220 000.", "Риск 999 ₸.", "Шаг: 999 ₸ отложить, 888 тоже."}, summary(t))
	if want := []string{"999", "888"}; !slices.Equal(bad, want) {
		t.Errorf("bad = %q, want %q (each once, in order)", bad, want)
	}
}

func TestScanNumbersGroups(t *testing.T) {
	cases := map[string][]string{
		"1 200 000":           {"1200000"},
		"2026 120 000":        {"2026", "120000"},
		"12 2000":             {"12", "2000"},
		"100 000, 50 000":     {"100000", "50000"},
		"1,5%":                {"3/2"},
		"2028-06":             {"2028", "6"},
		"Миллион: 1 миллион":  {"1000000"},
		"тыс без числа 5 тыс": {"5000"},
	}
	for text, want := range cases {
		var got []string
		for _, n := range scanNumbers(text) {
			got = append(got, n.value.RatString())
		}
		if !slices.Equal(got, want) {
			t.Errorf("%q: %v, want %v", text, got, want)
		}
	}
}
