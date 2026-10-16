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
		{"Аренда 220\u00a0000\u00a0₸ и 1\u202f200\u202f000 дохода.", nil},
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
		// Thousands by comma or dot, groups of 3 (ревью backend Блока 2, Н-1).
		{"Квартира: 150,000 ₸ в месяц.", nil},
		{"Квартира: 150.000 ₸ в месяц.", nil},
		{"Есть 1.000.000, доход 1,200,000.", nil},
		{"Квартира — 1,250 млн? Нет, 10 млн.", []string{"1,250 млн"}},
		// Defects: the model counted or rounded.
		{"Нужно 2,000,000 ₸.", []string{"2,000,000"}},
		{"Отложим 10,000 ₸.", []string{"10,000"}},
		{"Отложим 1,000 ₸.", []string{"1,000"}},
		// A date is a month of the summary: month and year together, the month number alone is
		// not allowed (ревью backend Блока 2, Н-2).
		{"Кредит закроем к июню 2028, квартиру — к февралю 2031, в октябре 2026 начнём.", nil},
		{"К 2028-06 закроем кредит, к 2031-02 — квартиру.", nil},
		{"Самая 2028 года — квартира.", nil},
		{"Кредит закроем к марту 2028.", []string{"марту 2028"}},
		{"Кредит закроем к 2028-03.", []string{"2028-03"}},
		{"Квартиру соберём в мае 2031.", []string{"мае 2031"}},
		{"Сроки: июню 2028 марту 2028 Февралю 2031.", []string{"марту 2028"}},
		{"Кредит под 10% закроем через 6 месяцев.", []string{"10", "6"}},
		{"Платим 215 000 ₸.", []string{"215 000"}},
		{"Платежи — 23% дохода.", []string{"23"}},
		{"Доход ≈ 1,3 млн.", []string{"1,3 млн"}},
		{"Это 4 шага.", []string{"4"}},
		{"К 2029 году.", []string{"2029"}},
		{"Остаток 1 200 001.", []string{"1 200 001"}},
		{"Два числа: 7 и 7 тыс.", []string{"7", "7 тыс"}},
		// Numbers in words cannot be matched — a defect whatever the value (критик Блока 2).
		{"Доход — миллион.", []string{"миллион"}},
		{"Платим около двухсот тысяч.", []string{"двухсот", "тысяч"}},
		{"Пятьдесят тысяч свободно.", []string{"Пятьдесят", "тысяч"}},
		{"Доход — полтора миллиона, на квартиру нужно 10 млн.", []string{"полтора", "миллиона"}},
		{"Половина дохода уходит на платежи.", []string{"Половина"}},
		{"Доход вдвое больше платежей.", []string{"вдвое"}},
		{"Кредит закроем через полгода, а за сто дней накопим.", []string{"полгода", "сто"}},
		{"Без выписок не видно — млн или тыс.", []string{"млн", "тыс"}},
		// A ratio is a computation, even with 1–3.
		{"Доход в 3 раза больше платежей.", []string{"в 3 раза"}},
		{"Платежи в два раза меньше дохода.", []string{"в два раза"}},
		{"Траты в 1,5 раза выше плана.", []string{"1,5", "в 1,5 раза"}},
		// Not numbers: counting 1–3 in words, ordinals, look-alike words, a scale after digits, frequency.
		{"Поддержим семью: три шага, оба простые, первый — главный, четвёртого не будет.", nil},
		{"Опять просто: место для взноса есть, 150 тысяч в месяц.", nil},
		{"Сверим траты 2 раза в месяц, в этот раз — по разделам.", nil},
		{"Доход 1 200 000 — это 1,2 миллиона.", nil},
	}
	for _, tc := range cases {
		got := CheckNumbers([]string{tc.text}, in)
		if !slices.Equal(got, tc.bad) {
			t.Errorf("%q: bad = %q, want %q", tc.text, got, tc.bad)
		}
	}
}

// A number word of the summary's own strings (a name the family wrote) may be repeated.
func TestCheckNumbersWordsFromInput(t *testing.T) {
	var in any
	dec := json.NewDecoder(strings.NewReader(`{"goals":[{"name":"Тысяча мелочей","want":50000}],"dues":[{"name":"Сто дорог в 2 раза","amount":7000}]}`))
	dec.UseNumber()
	if err := dec.Decode(&in); err != nil {
		t.Fatal(err)
	}
	if bad := CheckNumbers([]string{"Цель «тысяча мелочей» — 50 000; «Сто дорог в 2 раза» — 7 000."}, in); bad != nil {
		t.Errorf("bad = %q, want none", bad)
	}
	if bad := CheckNumbers([]string{"Двести дорог."}, in); !slices.Equal(bad, []string{"Двести"}) {
		t.Errorf("bad = %q, want [Двести]", bad)
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
		"2,000,000 и 150.000": {"2000000", "150000"},
		"1,250 млн и 16,50":   {"1250000", "33/2"},
		"1,2,3 и 1,0000":      {"6/5", "3", "1"},
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
