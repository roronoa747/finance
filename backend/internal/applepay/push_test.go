package applepay

import (
	"strings"
	"testing"
)

// Pushes of three banks by kind (AP-09). The sums and merchants are synthetic; the forms follow
// the owner's two samples (Kaspi and Freedom top-ups) and the regularities found on the web.
func TestParsePushTable(t *testing.T) {
	const nbsp, narrow = " ", " "
	type want struct {
		bank, kind string
		sign       int
		currency   string
		minor      int64
		merchant   string
	}
	cases := []struct {
		app, title, body string
		want             want
	}{
		// Kaspi: title — the product; "<Вид>: <сумма> ₸" / detail / "Доступно: <остаток> ₸".
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 5 000 ₸\nMAGNUM CASH&CARRY\nДоступно: 12 345,67 ₸", want{"kaspi", "purchase", -1, "KZT", 500000, "MAGNUM CASH&CARRY"}},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 1" + nbsp + "250 ₸\nYANDEX.GO\nДоступно: 999,10 ₸", want{"kaspi", "purchase", -1, "KZT", 125000, "YANDEX.GO"}},
		{"Kaspi.kz", "Kaspi Gold", "Оплата: 3 400 ₸\nBeeline\nДоступно: 10" + narrow + "000 ₸", want{"kaspi", "purchase", -1, "KZT", 340000, "Beeline"}},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 7 500 ₸ в SMALL\nДоступно: 1 000,00 ₸", want{"kaspi", "purchase", -1, "KZT", 750000, "SMALL"}},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 2 000 ₸\nKaspi QR · Coffee Boom\nДоступно: 5 ₸", want{"kaspi", "purchase", -1, "KZT", 200000, "Coffee Boom"}},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: $12.50\nAPPLE.COM/BILL\nДоступно: 5 ₸", want{"kaspi", "purchase", -1, "USD", 1250, "APPLE.COM/BILL"}},
		{"Kaspi.kz", "Kaspi Gold", "Перевод: 15 000 ₸\nАйгерим С.\nДоступно: 1 ₸", want{"kaspi", "transfer-out", -1, "KZT", 1500000, "Перевод Айгерим С."}},
		{"Kaspi.kz", "Kaspi Gold", "Перевод: 15 000 ₸\nНа карту другого банка\nДоступно: 1 ₸", want{"kaspi", "transfer-out", -1, "KZT", 1500000, "Перевод"}},
		{"Kaspi.kz", "Kaspi Gold", "Перевод: 2 000 ₸\nСАПАРОВА АЙГЕРИМ БОЛАТОВНА\nДоступно: 1 ₸", want{"kaspi", "transfer-out", -1, "KZT", 200000, "Перевод Айгерим С."}},
		// The owner's sample form (the sums replaced).
		{"Kaspi.kz", "Kaspi Gold", "Пополнение: 300 ₸\nС карты другого банка\nДоступно: 2 468,13 ₸", want{"kaspi", "transfer-in", +1, "KZT", 30000, "Пополнение"}},
		{"Kaspi.kz", "Kaspi Gold", "Перевод: 5 000 ₸\nОт Айгерим С.\nДоступно: 1 ₸", want{"kaspi", "transfer-in", +1, "KZT", 500000, "Перевод Айгерим С."}},
		{"Kaspi.kz", "Kaspi Gold", "Поступление: 10 000 ₸\nДоступно: 1 ₸", want{"kaspi", "transfer-in", +1, "KZT", 1000000, "Пополнение"}},
		{"Kaspi.kz", "Kaspi Gold", "Зарплата: 450 000 ₸\nТОО Ромашка\nДоступно: 1 ₸", want{"kaspi", "income", +1, "KZT", 45000000, "Зарплата"}},
		{"Kaspi.kz", "Kaspi Gold", "Пополнение: 450 000 ₸\nЗаработная плата\nДоступно: 1 ₸", want{"kaspi", "income", +1, "KZT", 45000000, "Зарплата"}},
		{"Kaspi.kz", "Kaspi Gold", "Зачисление зарплаты: 300 000 ₸", want{"kaspi", "income", +1, "KZT", 30000000, "Зарплата"}},
		{"Kaspi.kz", "Kaspi Gold", "Снятие: 20 000 ₸\nБанкомат Kaspi\nДоступно: 1 ₸", want{"kaspi", "cash", -1, "KZT", 2000000, "Снятие наличных"}},
		{"Kaspi.kz", "Kaspi Gold", "Снятие наличных: 10 000 ₸", want{"kaspi", "cash", -1, "KZT", 1000000, "Снятие наличных"}},
		{"Kaspi.kz", "Kaspi Gold", "Выдача наличных: 5 000 ₸\nДоступно: 1 ₸", want{"kaspi", "cash", -1, "KZT", 500000, "Снятие наличных"}},

		// Freedom: title — the kind (iOS cuts it with "…"); "+сумма ₸" / "Доступно …" / "<глагол> SuperCard **NNNN".
		{"Freedom SuperApp", "Покупка", "-5 000 ₸\nДоступно 1 234,56 ₸\nMAGNUM\nОплачено SuperCard **1234", want{"freedom", "purchase", -1, "KZT", 500000, "MAGNUM"}},
		{"Freedom SuperApp", "Оплата", "−3 400 ₸\nBeeline\nДоступно 100,00 ₸", want{"freedom", "purchase", -1, "KZT", 340000, "Beeline"}},
		{"Freedom SuperApp", "Покупка в SMALL", "1 250 ₸\nДоступно 10 ₸", want{"freedom", "purchase", -1, "KZT", 125000, "SMALL"}},
		{"Freedom SuperApp", "Перевод", "-15 000 ₸\nДоступно 1 ₸\nСАПАРОВА АЙГЕРИМ БОЛАТОВНА", want{"freedom", "transfer-out", -1, "KZT", 1500000, "Перевод Айгерим С."}},
		{"Freedom SuperApp", "Перевод на карту другого банка", "-15 000 ₸\nДоступно 1 ₸\nСписано SuperCard **0166", want{"freedom", "transfer-out", -1, "KZT", 1500000, "Перевод"}},
		{"Freedom SuperApp", "Исходящий перевод", "-2 000 ₸ / Айгерим С.", want{"freedom", "transfer-out", -1, "KZT", 200000, "Перевод Айгерим С."}},
		// The owner's sample form (the sums and the mask replaced).
		{"Freedom SuperApp", "Пополнение с карты др…", "+300 ₸\nДоступно 12" + nbsp + "468,13 ₸\nПополнено SuperCard **9876", want{"freedom", "transfer-in", +1, "KZT", 30000, "Пополнение"}},
		{"Freedom SuperApp", "Входящий перевод", "+5 000 ₸\nДоступно 1 ₸\nАйгерим С.", want{"freedom", "transfer-in", +1, "KZT", 500000, "Перевод Айгерим С."}},
		{"Freedom SuperApp", "Пополнение", "+10 000 ₸ / Доступно 1 ₸", want{"freedom", "transfer-in", +1, "KZT", 1000000, "Пополнение"}},
		{"Freedom SuperApp", "Зачисление зарплаты", "+450 000 ₸\nДоступно 1 ₸", want{"freedom", "income", +1, "KZT", 45000000, "Зарплата"}},
		{"Freedom SuperApp", "Пополнение", "+300 000 ₸\nЗарплата за октябрь\nДоступно 1 ₸", want{"freedom", "income", +1, "KZT", 30000000, "Зарплата"}},
		{"Freedom SuperApp", "Заработная плата", "+100 000 ₸", want{"freedom", "income", +1, "KZT", 10000000, "Зарплата"}},
		{"Freedom SuperApp", "Снятие наличных", "-20 000 ₸\nДоступно 1 ₸", want{"freedom", "cash", -1, "KZT", 2000000, "Снятие наличных"}},
		{"Freedom SuperApp", "Снятие в банкомате", "-5 000 ₸", want{"freedom", "cash", -1, "KZT", 500000, "Снятие наличных"}},
		{"Freedom SuperApp", "Выдача наличных", "−10 000 ₸", want{"freedom", "cash", -1, "KZT", 1000000, "Снятие наличных"}},

		// Halyk (Homebank): no samples — one-line forms like its old SMS.
		{"Homebank", "Halyk Bank", "Покупка 5 000,00 KZT MAGNUM ALMATY. Доступно 1 000,00 KZT. Карта *1234", want{"halyk", "purchase", -1, "KZT", 500000, "MAGNUM ALMATY"}},
		{"Homebank", "Halyk Bank", "Оплата 3 400 KZT Beeline. Доступно 10 KZT", want{"halyk", "purchase", -1, "KZT", 340000, "Beeline"}},
		{"Homebank", "Halyk Bank", "Покупка: 1 250 ₸, SMALL, Алматы. Баланс: 100 ₸", want{"halyk", "purchase", -1, "KZT", 125000, "SMALL, Алматы"}},
		{"Homebank", "Halyk Bank", "Перевод 15 000 KZT Айгерим С. Доступно 1 KZT", want{"halyk", "transfer-out", -1, "KZT", 1500000, "Перевод Айгерим С."}},
		{"Homebank", "Halyk Bank", "Перевод с карты 15 000 KZT на карту другого банка", want{"halyk", "transfer-out", -1, "KZT", 1500000, "Перевод"}},
		{"Homebank", "Halyk Bank", "Перевод: 2 000 ₸ Получатель: Айгерим С.", want{"halyk", "transfer-out", -1, "KZT", 200000, "Перевод Айгерим С."}},
		{"Homebank", "Halyk Bank", "Пополнение 5 000 KZT. Доступно 10 KZT", want{"halyk", "transfer-in", +1, "KZT", 500000, "Пополнение"}},
		{"Homebank", "Halyk Bank", "Входящий перевод 10 000 KZT от Айгерим С.", want{"halyk", "transfer-in", +1, "KZT", 1000000, "Перевод Айгерим С."}},
		{"Halyk", "", "Зачисление 7 000 ₸ с карты другого банка", want{"halyk", "transfer-in", +1, "KZT", 700000, "Пополнение"}},
		{"Homebank", "Halyk Bank", "Зачисление заработной платы 450 000 KZT", want{"halyk", "income", +1, "KZT", 45000000, "Зарплата"}},
		{"Homebank", "Halyk Bank", "Зарплата 300 000 ₸. Доступно 1 ₸", want{"halyk", "income", +1, "KZT", 30000000, "Зарплата"}},
		{"Homebank", "Halyk Bank", "Поступление 100 000 KZT Заработная плата ТОО Ромашка", want{"halyk", "income", +1, "KZT", 10000000, "Зарплата"}},
		{"Homebank", "Halyk Bank", "Снятие наличных 20 000 KZT ATM HALYK ALMATY", want{"halyk", "cash", -1, "KZT", 2000000, "Снятие наличных"}},
		{"Homebank", "Halyk Bank", "Выдача наличных 5 000 ₸", want{"halyk", "cash", -1, "KZT", 500000, "Снятие наличных"}},
		{"Homebank", "Halyk Bank", "Снятие 10 000,00 KZT. Доступно 1,00 KZT", want{"halyk", "cash", -1, "KZT", 1000000, "Снятие наличных"}},

		// The balance first: still not the amount. No app: the bank from the title.
		{"", "Kaspi Gold", "Доступно: 9 999 ₸\nПокупка: 100 ₸\nMAGNUM", want{"kaspi", "purchase", -1, "KZT", 10000, "MAGNUM"}},
		// The whole notification as one text (a command sending the trigger's variable whole).
		{"", "", "Kaspi.kz\nKaspi Gold\nПокупка: 5 000 ₸\nMAGNUM\nДоступно: 1 ₸", want{"kaspi", "purchase", -1, "KZT", 500000, "MAGNUM"}},
		// No app, no bank in the title: "card".
		{"", "Покупка", "-700 ₸\nMAGNUM", want{"card", "purchase", -1, "KZT", 70000, "MAGNUM"}},
	}
	perBank := map[string]map[string]int{}
	for _, c := range cases {
		op, res := ParsePush(c.app, c.title, c.body)
		got := want{op.Bank, op.Kind, op.Sign, op.Currency, op.Minor, op.Merchant}
		if res != ResultOp || got != c.want {
			t.Errorf("%q / %q: %v %+v, want %+v", c.title, c.body, res, got, c.want)
		}
		if strings.Contains(op.Merchant, "Доступно") || strings.Contains(op.Merchant, "**") || strings.Contains(op.Merchant, "*1234") {
			t.Errorf("%q: balance or mask in the merchant %q", c.body, op.Merchant)
		}
		if perBank[c.want.bank] == nil {
			perBank[c.want.bank] = map[string]int{}
		}
		perBank[c.want.bank][c.want.kind]++
	}
	for _, bank := range []string{"kaspi", "freedom", "halyk"} {
		for _, kind := range []string{"purchase", "transfer-out", "transfer-in", "income", "cash"} {
			if perBank[bank][kind] < 3 {
				t.Errorf("%s %s: %d samples, want ≥ 3", bank, kind, perBank[bank][kind])
			}
		}
	}
}

func TestParsePushPlaceholderAndOwn(t *testing.T) {
	op, _ := ParsePush("Kaspi.kz", "Kaspi Gold", "Перевод: 1 000 ₸\nНа карту другого банка")
	if !op.Placeholder || op.Own {
		t.Errorf("transfer without a person: %+v", op)
	}
	op, _ = ParsePush("Kaspi.kz", "Kaspi Gold", "Покупка: 1 000 ₸\nMAGNUM")
	if op.Placeholder {
		t.Errorf("a merchant is not a placeholder: %+v", op)
	}
	op, res := ParsePush("Freedom", "Перевод между своими счетами", "-1 000 ₸")
	if res != ResultOp || !op.Own || op.Kind != "transfer-out" {
		t.Errorf("own transfer: %v %+v", res, op)
	}
}

func TestParsePushIgnoreAndUnknown(t *testing.T) {
	for _, c := range []struct {
		app, title, body string
		want             Result
	}{
		{"Kaspi.kz", "Kaspi Gold", "Отклонено: Покупка 5 000 ₸\nНедостаточно средств", ResultIgnore},
		{"Kaspi.kz", "Kaspi Gold", "Операция не выполнена: 5 000 ₸", ResultIgnore},
		{"Halyk", "Halyk Bank", "Код подтверждения: 1234. Никому не сообщайте", ResultIgnore},
		{"Kaspi.kz", "Kaspi Red", "Скидки до 30% в магазинах-партнёрах", ResultIgnore},
		{"Kaspi.kz", "Kaspi Gold", "Возврат: 5 000 ₸\nMAGNUM", ResultIgnore},
		{"Freedom", "Отмена покупки", "+5 000 ₸", ResultIgnore},
		{"Kaspi.kz", "Kaspi Gold", "Курсовая разница: 150 ₸", ResultIgnore},
		{"Kaspi.kz", "Kaspi.kz", "Обновите приложение", ResultIgnore},
		{"Freedom", "Кэшбэк начислен", "+500 ₸", ResultIgnore},
		{"", "", "", ResultIgnore},
		{"Kaspi.kz", "Kaspi Gold", "Что-то произошло 5 000 ₸", ResultUnknown},
		{"Freedom", "Покупка", "+5 000 ₸\nMAGNUM", ResultUnknown}, // money in under a purchase word
		{"Freedom", "Пополнение", "-5 000 ₸", ResultUnknown},      // money out under a top-up word
		{"Halyk", "Halyk Bank", "Операция 5000 от 16.10", ResultUnknown},
		{"Отправитель", "Привет", "Встречаемся в 18:30", ResultUnknown},
	} {
		if _, res := ParsePush(c.app, c.title, c.body); res != c.want {
			t.Errorf("%q / %q: %v, want %v", c.title, c.body, res, c.want)
		}
	}
	// A currency the app does not keep: recognised, not written.
	op, res := ParsePush("Kaspi.kz", "Kaspi Gold", "Покупка: 50 £\nHARRODS")
	if res != ResultIgnore || op.Currency != Unsupported {
		t.Errorf("pounds: %v %+v", res, op)
	}
}

// Критик Б2: the balance under a longer label is never the amount nor the merchant; an advert's
// "до / от N ₸" is no money moved; a refund in any line is not an operation; a phone or card
// number split by spaces never reaches the merchant.
func TestParsePushBalanceAdvertsRefunds(t *testing.T) {
	for _, c := range []struct {
		app, title, body string
		want             Result
		minor            int64
		merchant         string
	}{
		// Balance labels with words before the money: cut with the money.
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 500 ₸\nMAGNUM\nДоступно на карте: 1 529,82 ₸", ResultOp, 50000, "MAGNUM"},
		{"Homebank", "Halyk Bank", "Покупка 700 KZT SMALL. Остаток на счёте 9 000 KZT", ResultOp, 70000, "SMALL"},
		{"Freedom SuperApp", "Покупка", "-300 ₸\nДоступный остаток 2 000 ₸\nMAGNUM", ResultOp, 30000, "MAGNUM"},
		// Only the balance has money: no operation (the balance is never a purchase).
		{"Kaspi.kz", "Kaspi Gold", "Покупка в MAGNUM\nДоступно на карте: 1 529,82 ₸", ResultIgnore, 0, ""},
		{"Homebank", "Halyk Bank", "Покупка MAGNUM. Остаток на счёте 1 000 KZT", ResultIgnore, 0, ""},
		// Adverts: a range is not money moved — not written (digits stay: «не разобрано»).
		{"Kaspi.kz", "Kaspi.kz", "Переводите без комиссии до 1 000 000 ₸", ResultUnknown, 0, ""},
		{"Kaspi.kz", "Kaspi Red", "Покупки в рассрочку 0-0-24 от 50 000 ₸", ResultUnknown, 0, ""},
		{"Freedom SuperApp", "Пополните депозит", "Ставка 15% на сумму свыше 100 000 ₸", ResultUnknown, 0, ""},
		// A refund or a cancellation in any line: not money of its own (отклонение 3 исполнителя).
		{"Kaspi.kz", "Kaspi Gold", "Пополнение: 5 000 ₸\nВозврат покупки MAGNUM\nДоступно: 1 ₸", ResultIgnore, 0, ""},
		{"Freedom SuperApp", "Пополнение", "+5 000 ₸\nОтмена покупки\nДоступно 1 ₸", ResultIgnore, 0, ""},
		// Digits of a phone or a card split by spaces never reach the merchant (Р-11).
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 2 000 ₸\nОплата по номеру +7 701 123 45 67", ResultOp, 200000, "по номеру"},
		{"Homebank", "Halyk Bank", "Покупка 5 000 KZT MAGNUM. Карта 4400 43** **** 0166. Доступно 1 KZT", ResultOp, 500000, "MAGNUM"},
	} {
		op, res := ParsePush(c.app, c.title, c.body)
		if res != c.want || res == ResultOp && (op.Minor != c.minor || op.Merchant != c.merchant) {
			t.Errorf("%q / %q: %v %d %q, want %v %d %q", c.title, c.body, res, op.Minor, op.Merchant, c.want, c.minor, c.merchant)
		}
		if strings.ContainsAny(op.Merchant, "0123456789") || strings.Contains(strings.ToLower(op.Merchant), "доступ") {
			t.Errorf("%q: digits or the balance label in the merchant %q", c.body, op.Merchant)
		}
	}
	// The owner's two samples (sums replaced, NBSP as on the lock screen): top-ups, never purchases.
	const nbsp = " "
	for _, s := range [][3]string{
		{"Kaspi.kz", "Kaspi Gold", "Пополнение: 200" + nbsp + "₸\nС карты другого банка\nДоступно: 1" + nbsp + "529,82" + nbsp + "₸"},
		{"Freedom SuperApp", "Пополнение с карты др…", "+200" + nbsp + "₸\nДоступно 19" + nbsp + "539,74" + nbsp + "₸\nПополнено SuperCard **0166"},
	} {
		op, res := ParsePush(s[0], s[1], s[2])
		if res != ResultOp || op.Kind != "transfer-in" || op.Sign != +1 || op.Minor != 20000 || !op.Placeholder || op.Merchant != Placeholder("transfer-in") {
			t.Errorf("owner's top-up %q: %v %+v", s[1], res, op)
		}
	}
}

// Приёмка Б2 п. 1: a decline or a confirmation code below the first line is still no operation;
// a lone "скидк" or "бонус" in a merchant line is one (they are lead-only).
func TestParsePushDeclineAndCodeInAnyLine(t *testing.T) {
	for _, c := range [][3]string{
		{"Freedom SuperApp", "Покупка", "−5 110 ₸\nОтклонено: недостаточно средств"},
		{"Kaspi.kz", "Kaspi Gold", "Оплата: 5 120 ₸\nОперация не выполнена"},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 5 040 ₸\nНедостаточно средств"},
		{"Homebank", "Halyk Bank", "Purchase 5 130,00 KZT MAGNUM. Declined"},
		{"Homebank", "Halyk Bank", "Покупка 5 130,00 KZT MAGNUM. Отказ: недостаточно средств"},
		{"Homebank", "Halyk Bank", "Покупка 5 130,00 KZT MAGNUM. Код подтверждения: 1234"},
		{"Kaspi.kz", "Kaspi Gold", "Оплата 5 140 ₸ в MAGNUM\nОдноразовый код: 5521"},
		{"Kaspi.kz", "Kaspi Gold", "Покупка: 5 145 ₸\nMAGNUM\nНикому не сообщайте код"},
	} {
		if op, res := ParsePush(c[0], c[1], c[2]); res != ResultIgnore {
			t.Errorf("%q / %q: %v %+v, want ignore", c[1], c[2], res, op)
		}
	}
	// The lead-only words in a merchant line: a purchase.
	for _, c := range []struct {
		body     string
		minor    int64
		merchant string
	}{
		{"Покупка: 5 150 ₸\nМир скидок", 515000, "Мир скидок"},
		{"Покупка: 5 155 ₸\nБонус Маркет", 515500, "Бонус Маркет"},
		{"Покупка: 5 160 ₸\nСкидка Плюс", 516000, "Скидка Плюс"},
	} {
		op, res := ParsePush("Kaspi.kz", "Kaspi Gold", c.body)
		if res != ResultOp || op.Minor != c.minor || op.Merchant != c.merchant {
			t.Errorf("%q: %v %+v, want the purchase %q", c.body, res, op, c.merchant)
		}
	}
}
