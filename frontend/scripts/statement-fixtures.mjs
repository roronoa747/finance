// Синтетические фикстуры выписок (B2C-01) → src/lib/statements/fixtures/<банк>-NN.rows.json.
// Решение владельца 2026-09-26: из настоящих выписок в git не идёт ничего. Раскладка
// (координаты колонок, шаг строк, страницы, колонтитулы, переносы и разрывы ячеек) — по фактам
// memory/backlog/идея-и-редизайн/block-1-parser/CORPUS.md; люди, продавцы и суммы — выдуманы.
// Элементы проходят через тот же groupItems, что и pdfToRows, — фикстура равна его выходу.
//
//   node scripts/statement-fixtures.mjs
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { groupItems } from '../src/lib/statements/pdf.ts'

const OUT = join(import.meta.dirname, '../src/lib/statements/fixtures')
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа',
  'сентября', 'октября', 'ноября', 'декабря']

const split = (v) => Math.abs(v).toFixed(2).split('.')
const group = (int, sep) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
const r1 = (v) => Math.round(v * 10) / 10
const sum = (list) => Math.round(list.reduce((s, v) => s + v, 0) * 100) / 100

function writeFixture(name, items) {
  const rows = groupItems(items).map((row) => ({
    page: row.page, y: r1(row.y), cells: row.cells.map((c) => ({ x: r1(c.x), text: c.text })),
  }))
  writeFileSync(join(OUT, name), rows.map((r) => JSON.stringify(r)).join(',\n').replace(/^/, '[\n') + '\n]\n')
  const pages = rows[rows.length - 1].page
  console.log(`${name}: страниц ${pages}, строк ${rows.length}`)
}

// ─── Kaspi Gold ──────────────────────────────────────────────────────────────────────────
// Строка: 4 ячейки на одном y (дата · сумма вправо · операция по центру · детали), шаг 15,9;
// перенос в «Операции»/«Деталях» — следующая строка без даты.

const KASPI_OP_LINES = {
  'Перевод на свой счет': ['Перевод на свой', 'счет'],
  'Поступление со своего счета': ['Поступление со', 'своего счета'],
  'Зачисление кредита': ['Зачисление', 'кредита'],
}
const KASPI_OP_X = { Покупка: 257, Перевод: 254, Пополнение: 238, 'Перевод на свой': 218, счет: 273,
  'Поступление со': 236, 'своего счета': 236, Зачисление: 244, кредита: 257, Снятие: 259, Разное: 259 }
const KASPI_FOOTER = 'АО «Kaspi Bank», БИК CASPKZKA, www.kaspi.kz'

const kaspiMoney = (v, sign = true) => {
  const [int, frac] = split(v)
  const s = !sign || v === 0 ? '' : v < 0 ? '- ' : '+ '
  return `${s}${group(int, ' ')},${frac} ₸`
}

function kaspi({ from, to, opening, ops }) {
  const items = []
  const put = (page, x, y, text) => items.push({ page, x, y, text })
  // Слова строки — отдельными элементами, как печатает Kaspi (пробелы pdf.js отбрасываются).
  const words = (page, x, y, text) => {
    for (const w of text.split(' ')) { put(page, x, y, w); x += w.length * 5.6 + 3.2 }
  }
  const [d, m, yy] = to.split('.')
  const issued = `${+d} ${MONTHS[+m - 1]} 20${yy}`
  const closing = sum([opening, ...ops.map((o) => o[1])])
  const total = (op, sign) => sum(ops.filter((o) => o[2] === op && (sign === 0 || Math.sign(o[1]) === sign)).map((o) => o[1]))

  // Стр. 1 — справка об остатке.
  put(1, 40, 698.9, 'СПРАВКА'); put(1, 40, 678.9, 'об остатке на счете'); put(1, 40, 656.3, issued)
  words(1, 40, 599.3, 'АО «Kaspi Bank» подтверждает, что Сапаров Алихан Серикович, ИИН')
  put(1, 40, 586.3, 'действительно является клиентом со счетом KZ**.')
  put(1, 48.1, 525.9, 'Сумма на счете в теңге'); put(1, 213.1, 525.9, 'Эквивалент в USD'); put(1, 376.1, 525.9, 'Эквивалент в EUR')
  put(1, 48.1, 510.9, kaspiMoney(closing, false)); put(1, 213.1, 510.9, '$ 12,40'); put(1, 376.1, 510.9, '€ 10,85')
  put(1, 40, 482.3, 'По курсу, установленному Банком на момент выдачи справки.')
  put(1, 40, 457.1, 'Информация действительна на момент выдачи справки №40213.')
  put(1, 40, 431.9, `Выписка по Kaspi Gold за период с ${from} по ${to} прилагается.`)
  put(1, 40, 122.9, 'Как проверить справку?'); put(1, 87.8, 107.8, 'Откройте сервис проверки')
  put(1, 40, 27.5, KASPI_FOOTER)

  // Стр. 2 — шапка выписки и итоги по видам.
  put(2, 40, 711.9, `Приложение к Справке №40213 от ${issued}`)
  put(2, 40, 674, 'ВЫПИСКА'); put(2, 40, 654, `по Kaspi Gold за период с ${from} по ${to}`)
  put(2, 40, 621, 'Сапаров'); put(2, 326.6, 621, 'Номер карты:'); put(2, 403.1, 621, '*1234')
  put(2, 40, 605.5, 'Алихан Серикович'); put(2, 326.6, 605.5, 'Номер счета:'); put(2, 403.1, 605.5, 'KZ**')
  put(2, 40, 592.5, `Доступно на ${to}:`); put(2, 225, 592.5, kaspiMoney(closing)); put(2, 326.5, 592.5, 'Валюта счета:'); put(2, 403, 592.5, 'теңге')
  put(2, 43.2, 532.3, 'Краткое содержание операций по карте:'); put(2, 325.3, 532.3, 'Лимит на снятие наличности без комиссии:')
  const summary = [
    [`Доступно на ${from}`, opening, 'Остаток зарплатных денег', '0,00 ₸'],
    ['Пополнения', total('Пополнение', 1), 'Другие пополнения', '300 000,00 ₸'],
    ['Поступления со своих счетов', total('Поступление со своего счета', 0), 'Итого', '300 000,00 ₸'],
    ['Зачисления кредитов', total('Зачисление кредита', 0)],
    ['Переводы', total('Перевод', 0)],
    ['Переводы на свои счета', total('Перевод на свой счет', 0)],
    ['Покупки', total('Покупка', 0)],
    ['Снятия', total('Снятие', 0)],
    ['Разное', total('Разное', 0)],
    [`Доступно на ${to}`, closing],
  ]
  summary.forEach(([label, value, rightLabel, rightValue], i) => {
    const y = 516.4 - i * 15.9
    const text = kaspiMoney(value)
    put(2, i === 0 || i === summary.length - 1 ? 43.2 : 48.8, y, label)
    put(2, 300.8 - text.length * 4.3, y, text)
    if (rightLabel) { put(2, i === 2 ? 325.3 : 330.9, y, rightLabel); put(2, 564.3 - rightValue.length * 4.3, y, rightValue) }
  })
  put(2, 59, 333.7, 'Дата'); put(2, 133.6, 333.7, 'Сумма'); put(2, 243, 333.7, 'Операция'); put(2, 311.5, 333.7, 'Детали')

  // Строки таблицы.
  let page = 2
  let y = 317.8
  const newPage = () => {
    page++
    y = 787.7
    put(page, 40, 815, `Приложение к Справке №40213 от ${issued}`)
    put(page, 40, 27.5, KASPI_FOOTER)
  }
  for (const [date, amount, op, details] of ops) {
    const opLines = KASPI_OP_LINES[op] ?? [op]
    const detLines = Array.isArray(details) ? details : [details]
    const lines = Math.max(opLines.length, detLines.length)
    if (y - (lines - 1) * 15.9 < 71.7) newPage()
    const money = kaspiMoney(amount)
    put(page, 51.8, y, date)
    put(page, 190.9 - money.length * 4.26, y, money)
    for (let i = 0; i < lines; i++) {
      const ly = y - i * 15.9
      if (opLines[i]) put(page, KASPI_OP_X[opLines[i]] ?? 275 - opLines[i].length * 2.9, ly, opLines[i])
      if (detLines[i]) put(page, 311, ly, detLines[i])
    }
    y -= lines * 15.9
  }
  if (y - 60 < 71.7) newPage()
  put(page, 49, y - 20, '- Сумма заблокирована. Банк ожидает подтверждения от платежной системы.')
  put(page, 40, y - 37, 'Раздел «Краткое содержание операций по карте», в строках «Поступления со своих счетов», «Зачисления кредитов», «Переводы на свои')
  put(page, 40, y - 46, 'счета» содержит информацию об операциях клиента между счетами в Kaspi.')
  put(2, 40, 27.5, KASPI_FOOTER) // на стр. 2 колонтитул напечатан дважды
  return items
}

// ─── Freedom (Super Card) ────────────────────────────────────────────────────────────────
// Ячейки центрируются по вертикали: строка даты — посередине многострочного блока, строки
// продолжения выше и ниже (шаг 12,7). Детали x ≈ 384 — левее заголовка «Детали» (452).

const FREEDOM_SYMBOL = { KZT: '₸', USD: '$', EUR: '€' }
const freedomMoney = (v, currency = 'KZT') => {
  const [int, frac] = split(v)
  return `${v < 0 ? '-' : '+'}${group(int, ',')}.${frac} ${FREEDOM_SYMBOL[currency]}`
}
const freedomTotal = (v) => {
  const [int, frac] = split(v)
  return `${v < 0 ? '-' : v > 0 ? '+' : ''}${group(int, ',')}.${frac}₸`
}
const FREEDOM_FOOTER = ['Подлинность справки можете проверить',
  'просканировав QR-код или перейдите по ссылке:', 'https://bankffin.kz/ru/check-receipt']

/** op: [дата, сумма, валюта, операция (строка или строки), детали (строка или строки), опции]. */
function freedom({ from, to, ops }) {
  const items = []
  const put = (page, x, y, text) => items.push({ page, x, y, text })
  const footer = (page) => FREEDOM_FOOTER.forEach((t, i) => put(page, 164, 56 - i * 9, t))
  const kzt = ops.filter((o) => o[2] === 'KZT')
  const opName = (o) => (Array.isArray(o[3]) ? o[3].join(' ') : o[3])
  const total = (name) => sum(kzt.filter((o) => opName(o) === name).map((o) => o[1]))

  // Стр. 1 — шапка, счета, итоги.
  put(1, 423, 711, 'АО "Фридом Банк Казахстан"'); put(1, 484, 698, 'БИК KSNVKZKA'); put(1, 482, 685, 'www.bankffin.kz')
  put(1, 164, 630, 'Управляющий директор'); put(1, 489, 624, 'Сапарова Д.К.'); put(1, 164, 617, 'АО «Фридом Банк Казахстан»')
  put(1, 57, 538, 'Выписка по карте Super Card'); put(1, 57, 507, `за период с ${from} по ${to}`)
  put(1, 305, 473, 'Номер счёта'); put(1, 447, 473, 'Валюта'); put(1, 515, 473, 'Остаток')
  put(1, 57, 457, 'САПАРОВ АЛИХАН СЕРИКОВИЧ')
  const accounts = [['USD', '0.00 $'], ['KZT', '48,210.35 ₸'], ['CNY', '0.00 ¥'], ['AED', '0.00 AED'], ['TRY', '0.00 ₺'], ['RUB', '0.00 ₽'], ['EUR', '0.00 €']]
  accounts.forEach(([cur, rest], i) => {
    const y = 453 - i * 20.2
    put(1, 305, y, `KZ**${cur}`); put(1, 454, y, cur); put(1, 530 - rest.length * 1.1, y, rest)
  })
  put(1, 60, 420, 'ИИН:'); put(1, 60, 402, 'Номер карты:'); put(1, 139, 402, '**1234')
  put(1, 60, 383, 'Валюта счета:'); put(1, 139, 383, 'USD, KZT, CNY, AED, TRY, RUB, EUR')
  put(1, 60, 364, 'Дата:'); put(1, 139, 364, to); put(1, 60, 345, 'Номер справки:'); put(1, 139, 345, '40213')
  put(1, 337, 312, 'Краткое содержание операций по карте:')
  const pending = sum(kzt.filter((o) => opName(o) === 'Сумма в обработке').map((o) => Math.abs(o[1])))
  const summary = [['Платеж', total('Платеж')], ['Перевод', total('Перевод')], ['Покупка', total('Покупка')],
    ['Снятие', 0], ['Платеж по кредиту', 0], ['Пополнение', total('Пополнение')], ['Сумма в обработке', pending],
    ['Погашение', 0], ['Овердрафт', 0], ['Другое', total('Другое')]]
  summary.forEach(([label, value], i) => {
    const y = 291 - i * 20.1
    const text = label === 'Сумма в обработке' ? freedomTotal(value).replace('+', '') : freedomTotal(value)
    put(1, 305, y, label); put(1, 548 - text.length * 5.5, y, text)
  })
  footer(1)

  // Стр. 2+ — таблица.
  let page = 2
  put(2, 277, 705, 'По курсу, установленному Банком на момент выдачи справки.')
  put(2, 121, 654, 'Сумма в обработке. Банк ожидает подтверждения от платежной системы')
  const header = (p, y) => {
    put(p, 83, y, 'Дата'); put(p, 223, y, 'Сумма'); put(p, 264, y, 'Валюта'); put(p, 321, y, 'Операция'); put(p, 452, y, 'Детали')
  }
  header(2, 630)
  footer(2)
  let headerY = 630
  let bottom = null // y нижней строки предыдущего блока; null — блок первый на странице
  let prevSingle = false
  const STEP = 12.7
  const newPage = () => {
    page++
    headerY = 722
    header(page, headerY)
    footer(page)
    bottom = null
  }

  for (const [date, amount, currency, op, details, opts = {}] of ops) {
    const opLines = Array.isArray(op) ? op : [op]
    let detLines = Array.isArray(details) ? details : [details]
    const topFor = (single) =>
      bottom === null ? headerY - (single ? 23 : 19) : bottom - (single && prevSingle ? 26 : 20)
    if (opts.splitAcrossPages) {
      // Как в корпусе: первая строка деталей — внизу страницы, остальное — блоком на следующей.
      put(page, 384, topFor(false), detLines[0])
      detLines = detLines.slice(1)
      newPage()
    }
    const lines = Math.max(opLines.length, detLines.length)
    const single = lines === 1
    const height = (lines - 1) * STEP
    let top = topFor(single)
    if (top - height < 112) {
      newPage()
      top = topFor(single)
    }
    const center = top - height / 2
    const place = (x, cellLines) => {
      const first = center + ((cellLines.length - 1) * STEP) / 2
      cellLines.forEach((t, i) => put(page, x, first - i * STEP, t))
    }
    const money = freedomMoney(amount, currency)
    put(page, date.startsWith('1') || date.startsWith('2') ? 69.5 : 70.3, center, date)
    put(page, 262 - money.length * 5.8, center + (opts.amountDy ?? 0), money)
    put(page, currency === 'KZT' ? 273 : 272, center, currency)
    place(309, opLines)
    place(384, detLines)
    bottom = top - height
    prevSingle = single
  }
  return items
}

// ─── Данные ───────────────────────────────────────────────────────────────────────────────
// Люди и продавцы выдуманы (общие сети — не из корпуса). Даты — от новых к старым.

const kaspi01 = kaspi({
  from: '26.06.25', to: '26.07.25', opening: 184250.4,
  ops: [
    ['26.07.25', -20, 'Покупка', 'Аппарат самообслуживания'],
    ['26.07.25', -380, 'Покупка', 'Аппарат самообслуживания'],
    ['26.07.25', -380, 'Покупка', 'Аппарат самообслуживания'],
    ['26.07.25', -4200, 'Покупка', 'Magnum'],
    ['25.07.25', 15000, 'Пополнение', 'С карты другого банка'],
    ['25.07.25', -15000, 'Перевод', 'Дана К.'],
    ['24.07.25', -2890, 'Покупка', 'Wolt'],
    ['24.07.25', -151790, 'Перевод на свой счет', 'Оплата Kaspi Кредита'],
    ['24.07.25', 120000, 'Пополнение', 'С карты другого банка'],
    ['23.07.25', -300, 'Покупка', 'Билет Avtobys. Оплата проезда'],
    ['23.07.25', -12500, 'Покупка', 'Small'],
    ['22.07.25', 1990, 'Покупка', 'Small'],
    ['22.07.25', -1990, 'Покупка', 'Small'],
    ['21.07.25', -3500, 'Перевод', 'Марат С.'],
    ['21.07.25', 25000, 'Пополнение', 'Марат С.'],
    ['20.07.25', -1175.94, 'Покупка', 'Beeline Интернет дома'],
    ['20.07.25', -2100, 'Покупка', 'Altel'],
    ['19.07.25', -50000, 'Перевод', 'На карту Freedom Finance Bank*1234'],
    ['19.07.25', -500, 'Разное', 'Комиссия за перевод на карту др. банка'],
    ['18.07.25', -8900, 'Покупка', 'ИП Береке'],
    ['18.07.25', -4600, 'Покупка', 'Popeyes'],
    ['17.07.25', 60000, 'Поступление со своего счета', 'С Kaspi Депозита'],
    ['17.07.25', -60000, 'Перевод', 'Нур Али Т.'],
    ['16.07.25', -3000, 'Покупка', 'Steam'],
    ['15.07.25', -2000, 'Покупка', ['Центральная мечеть. Оплата за вход на', 'смотровую площадку']],
    ['15.07.25', -5000, 'Покупка', 'Садака в мечети'],
    ['14.07.25', -20000, 'Снятие', 'Банкомат Tumar'],
    ['14.07.25', -350, 'Разное', 'Комиссия за снятие наличных сверх лимита'],
    ['13.07.25', 4750, 'Пополнение', 'Ruslan T.'],
    ['12.07.25', -839, 'Перевод', 'Ruslan T.'],
    ['12.07.25', -17684, 'Покупка', 'IP ASANOVA'],
    ['11.07.25', -990, 'Покупка', 'Kcell'],
    ['10.07.25', -6200, 'Покупка', 'TOO "KASPI MAGAZIN"'],
    ['10.07.25', 500000, 'Зачисление кредита', 'Кредит Наличными'],
    ['09.07.25', -45000, 'Перевод на свой счет', 'Оплата Kaspi Red'],
    ['08.07.25', -2595, 'Перевод', 'Жанна Қ.'],
    ['08.07.25', 2500, 'Пополнение', 'Жанна Қ.'],
    ['07.07.25', -7300, 'Покупка', 'Galmart'],
    ['06.07.25', -1500, 'Покупка', 'Аптека Жансая'],
    ['05.07.25', -3990, 'Покупка', 'Яндекс Плюс'],
    ['04.07.25', -14455, 'Перевод', 'Дана К.'],
    ['04.07.25', 16205, 'Пополнение', 'В Kaspi Банкомате'],
    ['03.07.25', -700, 'Перевод', 'Марат С.'],
    ['02.07.25', -9692, 'Покупка', 'ИП Береке'],
    ['02.07.25', 9692, 'Покупка', 'ИП Береке'],
    ['01.07.25', -200, 'Покупка', 'Аппарат самообслуживания'],
    ['30.06.25', -524, 'Перевод', 'Нур Али Т.'],
    ['30.06.25', -100, 'Покупка', 'Аппарат самообслуживания'],
    ['29.06.25', -25000, 'Перевод', 'Дана К.'],
    ['29.06.25', 25000, 'Пополнение', 'С карты другого банка'],
    ['28.06.25', -10000, 'Перевод', 'На карту Банк ЦентрКредит*5678'],
    ['28.06.25', -200, 'Разное', 'Комиссия за перевод на карту др. банка'],
    ['27.06.25', -3300, 'Покупка', 'Onay'],
    ['27.06.25', -12000, 'Покупка', 'Magnum'],
    ['26.06.25', 30000, 'Поступление со своего счета', 'С Kaspi Депозита'],
    ['26.06.25', -1200, 'Покупка', 'Живая Вода'],
    ['26.06.25', -4400, 'Покупка', 'Wolt'],
    ['26.06.25', -890, 'Покупка', 'Small'],
    ['26.06.25', -2300, 'Покупка', 'Магазин у дома Береке'],
    ['26.06.25', -6000, 'Перевод', 'Марат С.'],
  ],
})

const kaspi02 = kaspi({
  from: '15.08.25', to: '15.09.25', opening: 12400,
  ops: [
    ['15.09.25', -560, 'Покупка', 'Аппарат самообслуживания'],
    ['14.09.25', -3400, 'Покупка', 'Magnum'],
    ['12.09.25', -151790, 'Перевод на свой счет', 'Оплата Kaspi Кредита'],
    ['12.09.25', 160000, 'Пополнение', 'С карты другого банка'],
    ['10.09.25', -2100, 'Покупка', 'Altel'],
    ['08.09.25', -7000, 'Перевод', 'Дана К.'],
    ['05.09.25', -1175.94, 'Покупка', 'Beeline Интернет дома'],
    ['02.09.25', -300, 'Покупка', 'Билет Avtobys. Оплата проезда'],
    ['02.09.25', -300, 'Покупка', 'Билет Avtobys. Оплата проезда'],
    ['01.09.25', -12000, 'Покупка', 'Galmart'],
    ['31.08.25', -5000, 'Перевод', 'Азамат Б.'],
    ['31.08.25', 5000, 'Пополнение', 'С карты другого банка'],
    ['29.08.25', -3990, 'Покупка', 'Яндекс Плюс'],
    ['27.08.25', -2600, 'Покупка', 'Coffee Boom'],
    ['25.08.25', -30000, 'Снятие', 'Банкомат Gastronom 1'],
    ['22.08.25', 18000, 'Пополнение', 'Азамат Б.'],
    ['20.08.25', -40000, 'Перевод', 'На карту Freedom Finance Bank*1234'],
    ['20.08.25', -400, 'Разное', 'Комиссия за перевод на карту др. банка'],
    ['18.08.25', -8900, 'Покупка', 'IP ASANOVA'],
    ['16.08.25', 70000, 'Пополнение', 'С карты другого банка'],
    ['15.08.25', -1500, 'Покупка', 'Аптека Жансая'],
  ],
})

const PURCHASE = 'Покупка'
const TRANSFER = 'Перевод'
const TOPUP = 'Пополнение'
const PENDING = ['Сумма в', 'обработке']

const freedom01 = freedom({
  from: '26.06.2025', to: '26.07.2025',
  ops: [
    ['26.07.2025', -1260, 'KZT', PENDING, ['MAGAZIN SMALL MARKET ASTANA Q.', 'KZ']],
    ['26.07.2025', -6550, 'KZT', PENDING, 'KOFEYNYA BEREKE ASTANA KZ'],
    ['26.07.2025', -2000, 'KZT', PENDING, 'Перевод с карты на карту'],
    ['25.07.2025', -2500, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['25.07.2025', -1790, 'KZT', PURCHASE, 'MAGNUM CASH&CARRY ASTANA KZ'],
    ['25.07.2025', -1540, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['24.07.2025', -300, 'KZT', PURCHASE, 'IP ASANOVA A.B. ASTANA KZ'],
    ['24.07.2025', -1550, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['24.07.2025', -1550, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['23.07.2025', -11299, 'KZT', PURCHASE, 'YANDEX.EDA ALMATY KZ'],
    ['23.07.2025', -4500, 'KZT', PURCHASE, 'APTEKA PLUS ASTANA KZ'],
    ['22.07.2025', -11000, 'KZT', TRANSFER, 'Перевод с карты на карту'],
    ['22.07.2025', 60000, 'KZT', TOPUP, ['Кенесова Дана Маратовна .', 'Безвозмездный перевод']],
    ['21.07.2025', -15000, 'KZT', TRANSFER, 'Дана К. Безвозмездный перевод'],
    ['21.07.2025', -23525, 'KZT', PURCHASE, ['SMALL SUPERMARKET AST1 ALMATY', 'KZ']],
    ['20.07.2025', 720000, 'KZT', TOPUP, 'Пополнение через банкомат'],
    ['20.07.2025', 36902.34, 'KZT', TRANSFER, ['Перевод валюты Freedom на счет', 'KZ**KZT. По', 'договору №SRV- от', '11.05.2023']],
    ['19.07.2025', -25, 'USD', PURCHASE, 'STEAMGAMES.COM BELLEVUE US'],
    ['19.07.2025', 21.31, 'USD', TRANSFER, ['Перевод валюты Freedom на счет', 'KZ**USD. По', 'договору №SRV- от', '11.05.2023']],
    ['18.07.2025', -11.99, 'EUR', PURCHASE, 'NETFLIX.COM AMSTERDAM NL'],
    ['18.07.2025', -6500, 'KZT', PURCHASE, 'APPLE.COM BILL CORK IE'],
    ['17.07.2025', -76849, 'KZT', 'Платеж', ['ТОО "Aviata" За оплату билета', '/услугу/продукты/товар заказ', 'AMKKFVAM Aviata']],
    ['16.07.2025', -12.3, 'KZT', TRANSFER, ['Возврат кешбека по', 'cap_id= на сумму 12.3', 'KZT']],
    ['16.07.2025', 410, 'KZT', PURCHASE, 'Возврат. Отмена покупки'],
    ['15.07.2025', 1160, 'KZT', PURCHASE, ['Возврат. Отмена покупки YANDEX.', 'GO']],
    ['15.07.2025', -1160, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['14.07.2025', -2350, 'KZT', PURCHASE, 'WOLT.COM ALMATY KZ'],
    ['13.07.2025', -50000, 'KZT', TRANSFER, 'Перевод с карты на карту'],
    ['13.07.2025', 50000, 'KZT', TOPUP, 'Пополнение через банкомат'],
    ['12.07.2025', -9576, 'KZT', 'Платеж', ['ТОО "Arbuz Group (Арбуз Груп)" За', 'оплату билета/услугу/продукты', '/товар заказ Arbuz']],
    ['11.07.2025', -5640, 'KZT', PURCHASE, 'COFFEE BOOM ASTANA KZ'],
    ['10.07.2025', 20000, 'KZT', TOPUP, 'Перевод с карты на карту'],
    ['10.07.2025', -4.73, 'EUR', 'Другое', ['продажа на сумму 4.73 валюта', '(EUR), курс 535'], { splitAcrossPages: true, amountDy: -4 }],
    ['10.07.2025', -2530, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['09.07.2025', -2.96, 'EUR', 'Другое', ['продажа на сумму 2.96 валюта', '(EUR), курс 536']],
    ['08.07.2025', -9990, 'KZT', PURCHASE, 'Google One Mountain View US'],
    ['07.07.2025', -3200, 'KZT', PURCHASE, 'INDRIVE ALMATY KZ'],
    ['06.07.2025', -14200, 'KZT', TRANSFER, 'Марат С. Безвозмездный перевод'],
    ['05.07.2025', -780, 'KZT', PURCHASE, ['MAGAZIN SMALL MARKET ASTANA Q.', 'KZ']],
    ['04.07.2025', -20990, 'KZT', PURCHASE, 'AIRBAPAY TECHNODOM ALMATY KZ'],
    ['03.07.2025', -2800, 'KZT', PURCHASE, 'IP ZHANSAYA KOSTANAY KZ'],
    ['02.07.2025', -248312, 'KZT', 'Платеж', ['Возмещение за QR оплату через', 'POS на сумму KZT']],
    ['01.07.2025', -1450, 'KZT', PURCHASE, 'M-MART SHOP ASTANA KZ'],
    ['30.06.2025', -200, 'KZT', PURCHASE, 'ONAY ALMATY KZ'],
    ['28.06.2025', 20000, 'KZT', TOPUP, ['Сапаров Алихан Серикович .', 'Безвозмездный перевод']],
    ['27.06.2025', -1830, 'KZT', PURCHASE, 'GLOVO ALMATY KZ'],
    ['26.06.2025', -5900, 'KZT', PURCHASE, 'SPOTIFY STOCKHOLM SE'],
  ],
})

const freedom02 = freedom({
  from: '26.07.2025', to: '26.08.2025',
  ops: [
    ['26.08.2025', -1680, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['25.08.2025', -2250, 'KZT', PURCHASE, 'MAGNUM CASH&CARRY ASTANA KZ'],
    ['24.08.2025', -6500, 'KZT', PURCHASE, 'APPLE.COM BILL CORK IE'],
    ['23.08.2025', -499, 'KZT', PURCHASE, 'APPLE.COM BILL CORK IE'],
    ['22.08.2025', -15000, 'KZT', TRANSFER, 'Перевод с карты на карту'],
    ['21.08.2025', 3, 'KZT', TOPUP, 'Пополнение.'],
    ['20.08.2025', -46.66, 'USD', PURCHASE, 'LOTTE MART NHA TRANG KHANH'],
    ['20.08.2025', -4.9, 'USD', PURCHASE, 'PAYOO-COFFEE 8 KHA VN'],
    ['19.08.2025', 40000, 'KZT', TOPUP, ['Кенесова Дана Маратовна .', 'Безвозмездный перевод']],
    ['18.08.2025', -1260, 'KZT', PURCHASE, 'IP ZHANSAYA KOSTANAY KZ'],
    ['18.08.2025', -1260, 'KZT', PURCHASE, 'IP ZHANSAYA KOSTANAY KZ'],
    ['17.08.2025', -3900, 'KZT', PURCHASE, 'YANDEX.LAVKA ALMATY KZ'],
    ['15.08.2025', -40000, 'KZT', TRANSFER, 'Дана К. Безвозмездный перевод'],
    ['12.08.2025', 40000, 'KZT', TOPUP, 'Перевод с карты на карту'],
    ['10.08.2025', -5300, 'KZT', PURCHASE, 'BIOSFERA PHARMACY ASTANA KZ'],
    ['05.08.2025', -1830, 'KZT', PURCHASE, 'GLOVO ALMATY KZ'],
    ['03.08.2025', -120000, 'KZT', TRANSFER, 'Перевод с карты на карту'],
    ['01.08.2025', -2170, 'KZT', PURCHASE, ['SMALL SUPERMARKET AST1 ALMATY', 'KZ']],
    ['31.07.2025', -2800, 'KZT', PURCHASE, 'COFFEE BOOM ASTANA KZ'],
    ['28.07.2025', -9990, 'KZT', PURCHASE, 'Google One Mountain View US'],
    ['27.07.2025', -1940, 'KZT', PURCHASE, 'YANDEX.GO ALMATY KZ'],
    ['26.07.2025', -20000, 'KZT', TRANSFER, 'Марат С. Безвозмездный перевод'],
  ],
})

writeFixture('kaspi-01.rows.json', kaspi01)
writeFixture('kaspi-02.rows.json', kaspi02)
writeFixture('freedom-01.rows.json', freedom01)
writeFixture('freedom-02.rows.json', freedom02)
