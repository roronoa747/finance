import { describe, expect, it } from 'vitest'
import type { Obligation } from '@/types/finance'
import { DOUBLE_DAYS, FIND_NAME_MAX, FINDS_MAX, dueFinds, leakFinds, reviewFinds, sameFind, sellerOk, topFinds } from './finds'
import { normalizeMerchant } from './model'
import { paymentAmount } from './matching'
import type { MerchantRule, Operation } from './types'

// Находки участника RZ-01 (Р-13, Р-14): утечки, верхушки разделов, новые регулярные, подорожания и двойные — по
// операциям одного участника за 4 месяца; в записи нет дат, людей и «ИП + фамилия».
let n = 0
const op = (merchant: string, amount: number, categoryId: string | null, date: string, extra: Partial<Operation> = {}): Operation => ({
  id: `o${++n}`, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const day = (month: string, d: number) => `${month}-${String(d).padStart(2, '0')}`
/** k покупок в месяце, по одной в день начиная с `from` (суббота и будни — без разницы для утечек вне кафе). */
const times = (k: number, merchant: string, amount: number, categoryId: string | null, month: string, from = 1, extra: Partial<Operation> = {}) =>
  Array.from({ length: k }, (_, i) => op(merchant, amount, categoryId, day(month, from + i), extra))

const SEP = '2026-09'
const NONE = { rules: [] as MerchantRule[], obligations: [] as Obligation[], credits: [], book: null }
const obligation = (id: string, name: string, amount: number, extra: Partial<Obligation> = {}): Obligation => ({
  id, name, note: '', day: 5, category: 'd4', versions: [{ from: '2026-01', amount }], updatedAt: '2026-01-01T00:00:00Z', ...extra,
} as Obligation)
const payRule = (merchant: string, targetId: string): MerchantRule => ({
  id: `r-${targetId}`, match: { merchant: normalizeMerchant(merchant) }, to: { payment: { kind: 'obligation', targetId } }, by: 'a', updatedAt: '2026-01-01T00:00:00Z',
})

describe('sellerOk — кого можно назвать', () => {
  it('трата у продавца — да; перевод человеку, внутренний, ИП с фамилией, номер 6+ цифр, приход — нет', () => {
    expect(sellerOk(op('Apteka Plus', -1_500, 'sc_health', day(SEP, 3)))).toBe(true)
    expect(sellerOk(op('Перевод', -5_000, 'sc_people', day(SEP, 3), { counterparty: 'Дана К.', kind: 'transfer-out' }))).toBe(false)
    expect(sellerOk(op('Kaspi Gold', -5_000, null, day(SEP, 3), { internal: true }))).toBe(false)
    expect(sellerOk(op('ИП Абенова', -1_500, null, day(SEP, 3)))).toBe(false)
    expect(sellerOk(op('Terminal 1234567', -1_500, null, day(SEP, 3)))).toBe(false)
    expect(sellerOk(op('Apteka Plus', 1_500, 'sc_health', day(SEP, 3)))).toBe(false)
  })

  // Критик Блока 1: строка без `counterparty`, которую семья сама отнесла к «Переводам людям» (имя латиницей заглавными
  // банк печатает продавцом), и наличные — не продавец: ни в утечку, ни в новое регулярное, ни в двойное.
  it('раздел «Переводы людям» и наличные без counterparty — нет: утечки и регулярного не будет', () => {
    expect(sellerOk(op('RUSLAN T.', -5_000, 'sc_people', day(SEP, 3), { kind: 'transfer-out' }))).toBe(false)
    expect(sellerOk(op('ATM Kaspi', -5_000, 'sc_cash', day(SEP, 3), { kind: 'cash' }))).toBe(false)
    const nanny = [...times(7, 'RUSLAN T.', -3_000, 'sc_people', '2026-08', 1, { kind: 'transfer-out' }), ...times(7, 'RUSLAN T.', -3_000, 'sc_people', SEP, 1, { kind: 'transfer-out' })]
    expect(leakFinds(nanny, 'a', SEP)).toEqual([])
    const monthly = (month: string) => op('RUSLAN T.', -60_000, 'sc_people', day(month, 10), { kind: 'transfer-out' })
    expect(dueFinds([monthly('2026-08'), monthly(SEP)], 'a', SEP, NONE)).toEqual([])
  })

  it('с разделами — раздел из плана (подписки) мимо', () => {
    expect(sellerOk(op('Netflix', -4_000, 'sc_subscriptions', day(SEP, 3)), [])).toBe(false)
    expect(sellerOk(op('Netflix', -4_000, 'sc_subscriptions', day(SEP, 3)))).toBe(true)
  })
})

describe('leakFinds — утечки', () => {
  it('7 покупок по 1 500 в аптеке — утечка: счётчик и сумма месяца, без дат', () => {
    const out = leakFinds(times(7, 'APTEKA PLUS ALMATY KZ', -1_500, 'sc_health', SEP), 'a', SEP, [], 'T')
    expect(out).toEqual([
      { id: 'a:2026-09:leak:apteka plus', by: 'a', period: SEP, kind: 'leak', name: 'APTEKA PLUS ALMATY KZ', categoryId: 'sc_health', count: 7, amount: 10_500, updatedAt: 'T' },
    ])
    expect(JSON.stringify(out)).not.toMatch(/2026-09-\d\d/)
  })

  it('5 покупок — нет; средний чек 9 000 — нет; «ИП Абенова» 8 раз — нет; такси 10 раз — привычка, нет; перевод человеку — нет', () => {
    expect(leakFinds(times(5, 'Apteka Plus', -1_500, 'sc_health', SEP), 'a', SEP)).toEqual([])
    expect(leakFinds(times(7, 'Apteka Plus', -9_000, 'sc_health', SEP), 'a', SEP)).toEqual([])
    expect(leakFinds(times(8, 'ИП Абенова', -1_500, null, SEP), 'a', SEP)).toEqual([])
    expect(leakFinds(times(10, 'YANDEX GO', -1_500, 'sc_transport', SEP), 'a', SEP)).toEqual([])
    expect(leakFinds(times(8, 'Перевод', -1_500, 'sc_people', SEP, 1, { counterparty: 'Дана К.', kind: 'transfer-out' }), 'a', SEP)).toEqual([])
  })

  it('другой месяц не считается; до 5 утечек по сумме', () => {
    const ops = [
      ...times(7, 'Apteka Plus', -1_500, 'sc_health', '2026-08'),
      ...Array.from({ length: 7 }, (_, i) => times(6, `Shop ${'ABCDEFG'[i]}`, -(1_000 + i * 100), 'sc_home', SEP)).flat(),
    ]
    const out = leakFinds(ops, 'a', SEP)
    expect(out).toHaveLength(FINDS_MAX.leak)
    expect(out.map((f) => f.name)).toEqual(['Shop G', 'Shop F', 'Shop E', 'Shop D', 'Shop C'])
  })
})

describe('topFinds — верхушки разделов', () => {
  it('сумма, число операций и две крупнейшие покупки; разделы платежей, «не разобрано», люди — мимо', () => {
    const ops = [
      op('Zara', -45_000, 'sc_shopping', day(SEP, 2)),
      op('Lc Waikiki', -12_000, 'sc_shopping', day(SEP, 4)),
      op('Kaspi Magazin', -3_000, 'sc_shopping', day(SEP, 6)),
      op('ИП Абенова', -60_000, 'sc_shopping', day(SEP, 7)),
      op('Netflix', -4_000, 'sc_subscriptions', day(SEP, 3)),
      op('Unknown shop', -9_000, null, day(SEP, 3)),
      op('Перевод', -20_000, 'sc_people', day(SEP, 3), { counterparty: 'Дана К.', kind: 'transfer-out' }),
    ]
    const out = topFinds(ops, 'a', SEP, [], 'T')
    expect(out).toEqual([
      {
        id: 'a:2026-09:top:sc_shopping', by: 'a', period: SEP, kind: 'top', name: '', categoryId: 'sc_shopping', count: 4, amount: 120_000,
        top: [{ name: 'Zara', amount: 45_000 }, { name: 'Lc Waikiki', amount: 12_000 }], updatedAt: 'T',
      },
    ])
  })

  it('до 5 разделов по сумме', () => {
    const cats = ['sc_food', 'sc_cafe', 'sc_health', 'sc_home', 'sc_shopping', 'sc_fun']
    const out = topFinds(cats.map((c, i) => op(`Shop ${i}`, -(1_000 * (i + 1)), c, day(SEP, 5))), 'a', SEP)
    expect(out.map((f) => f.categoryId)).toEqual(['sc_fun', 'sc_shopping', 'sc_home', 'sc_health', 'sc_cafe'])
  })
})

describe('dueFinds — новые регулярные, подорожания, двойные', () => {
  const plus = (month: string, amount = -1_990) => op('YANDEX PLUS', amount, 'sc_subscriptions', day(month, 12))

  it('Yandex Plus 1 990 два месяца подряд без правила — новое регулярное; без строки в этом месяце — нет', () => {
    const out = dueFinds([plus('2026-08'), plus(SEP)], 'a', SEP, NONE, 'T')
    expect(out).toEqual([
      { id: 'a:2026-09:recurring:yandex plus', by: 'a', period: SEP, kind: 'recurring', name: 'YANDEX PLUS', categoryId: 'sc_subscriptions', count: 2, amount: 1_990, updatedAt: 'T' },
    ])
    expect(dueFinds([plus('2026-07'), plus('2026-08')], 'a', SEP, NONE)).toEqual([])
  })

  it('с правилом платежа — нет; с обязательством того же имени — нет; старше 3 закрытых месяцев не смотрится', () => {
    const o = obligation('o1', 'Yandex Plus', 1_990)
    expect(dueFinds([plus('2026-08'), plus(SEP)], 'a', SEP, { ...NONE, obligations: [o], rules: [payRule('YANDEX PLUS', 'o1')] })).toEqual([])
    expect(dueFinds([plus('2026-08'), plus(SEP)], 'a', SEP, { ...NONE, obligations: [obligation('o2', 'yandex plus', 1_990)] })).toEqual([])
    // Не словарный продавец: два списания нужны в окне — май вне окна (июнь…сентябрь).
    const gym = (month: string) => op('FITNESS LAB', -15_000, 'sc_fun', day(month, 3))
    expect(dueFinds([gym('2026-05'), gym(SEP)], 'a', SEP, NONE)).toEqual([])
    expect(dueFinds([gym('2026-06'), gym(SEP)], 'a', SEP, NONE).map((f) => f.kind)).toEqual(['recurring'])
  })

  it('подписка по правилу 2 990 при плане 2 490 — подорожание (было 2 490); 2 590 — нет', () => {
    const ctx = { ...NONE, obligations: [obligation('o1', 'Кинопоиск', 2_490)], rules: [payRule('KINOPOISK', 'o1')] }
    const kino = (amount: number) => op('KINOPOISK', amount, 'sc_subscriptions', day(SEP, 10))
    expect(dueFinds([kino(-2_990)], 'a', SEP, ctx, 'T')).toEqual([
      { id: 'a:2026-09:pricier:kinopoisk', by: 'a', period: SEP, kind: 'pricier', name: 'KINOPOISK', categoryId: 'sc_subscriptions', count: 1, amount: 2_990, was: 2_490, targetId: 'o1', updatedAt: 'T' },
    ])
    expect(dueFinds([kino(-2_590)], 'a', SEP, ctx)).toEqual([])
  })

  it('TL-02: две подписки продавца (1 990 и 4 990), подорожала одна (5 900) → «Подорожало» по ней, вторая не задета', () => {
    const obligations = [obligation('music', 'Apple Music', 1_990), obligation('cloud', 'iCloud', 4_990)]
    const rules = [{ ...payRule('APPLE.COM BILL', 'music'), updatedAt: '2026-02-01T00:00:00Z' }, payRule('APPLE.COM BILL', 'cloud')]
    const ctx = { ...NONE, obligations, rules, amountOf: paymentAmount({ obligations }) }
    const apple = (amount: number, d: number) => op('APPLE.COM BILL', amount, 'sc_subscriptions', day(SEP, d))
    expect(dueFinds([apple(-1_990, 3), apple(-5_900, 14)], 'a', SEP, ctx).map((f) => [f.kind, f.amount, f.was, f.targetId])).toEqual([['pricier', 5_900, 4_990, 'cloud']])
    expect(dueFinds([apple(-1_990, 3), apple(-4_990, 14)], 'a', SEP, ctx)).toEqual([])
    // Без сумм — последнее правило (Apple Music) на обе строки, как до TL-02: 5 900 «дороже» 1 990 — ложное подорожание.
    expect(dueFinds([apple(-1_990, 3), apple(-5_900, 14)], 'a', SEP, { ...ctx, amountOf: undefined }).map((f) => [f.was, f.targetId])).toEqual([[1_990, 'music']])
  })

  it('оценка («сумма плавает») 20 000, пришло 28 000 — не подорожание; та же сумма без оценки — подорожание', () => {
    const bill = op('ALSECO', -28_000, 'sc_utilities', day(SEP, 15))
    const rules = [payRule('ALSECO', 'u1')]
    expect(dueFinds([bill], 'a', SEP, { ...NONE, obligations: [obligation('u1', 'Коммуналка', 20_000, { estimate: true })], rules })).toEqual([])
    expect(dueFinds([bill], 'a', SEP, { ...NONE, obligations: [obligation('u1', 'Коммуналка', 20_000)], rules }).map((f) => [f.kind, f.amount, f.was])).toEqual([['pricier', 28_000, 20_000]])
  })

  it('два списания 12 000 одному продавцу через день — двойное; через 5 дней — нет; 800 ₸ — нет', () => {
    const at = (d: number, amount = -12_000) => op('SPORT CLUB', amount, 'sc_fun', day(SEP, d))
    expect(dueFinds([at(3), at(4)], 'a', SEP, NONE, 'T')).toEqual([
      { id: 'a:2026-09:double:sport club', by: 'a', period: SEP, kind: 'double', name: 'SPORT CLUB', categoryId: 'sc_fun', count: 2, amount: 12_000, updatedAt: 'T' },
    ])
    expect(dueFinds([at(3), at(3 + DOUBLE_DAYS + 2)], 'a', SEP, NONE).filter((f) => f.kind === 'double')).toEqual([])
    expect(dueFinds([at(3, -800), at(4, -800)], 'a', SEP, NONE)).toEqual([])
  })

  it('частый продавец с одной ценой (столовая 7 раз по 2 000) — ни двойного, ни регулярного; такси — привычка, не двойное', () => {
    const canteen = [...times(7, 'STOLOVAYA', -2_000, 'sc_food', '2026-08'), ...times(7, 'STOLOVAYA', -2_000, 'sc_food', SEP)]
    expect(dueFinds(canteen, 'a', SEP, NONE)).toEqual([])
    expect(dueFinds(times(2, 'YANDEX GO', -1_500, 'sc_transport', SEP), 'a', SEP, NONE)).toEqual([])
  })

  it('вместе — до 6 по сумме', () => {
    const ops = Array.from({ length: 8 }, (_, i) => [op(`Club ${'ABCDEFGH'[i]}`, -(2_000 + i * 1_000), 'sc_fun', day(SEP, 3)), op(`Club ${'ABCDEFGH'[i]}`, -(2_000 + i * 1_000), 'sc_fun', day(SEP, 4))]).flat()
    const out = dueFinds(ops, 'a', SEP, NONE)
    expect(out).toHaveLength(FINDS_MAX.dues)
    expect(out[0].amount).toBe(9_000)
  })
})

describe('reviewFinds — всё вместе', () => {
  it('по виду и id; id стабильны; названия ≤ 40; в записях нет дат и людей', () => {
    const long = 'MAGAZIN OCHEN DLINNOE NAZVANIE SETI MAGAZINOV U DOMA'
    const ops = [
      ...times(7, long, -1_500, 'sc_home', SEP),
      op('Zara', -45_000, 'sc_shopping', day(SEP, 2)),
      op('YANDEX PLUS', -1_990, 'sc_subscriptions', day('2026-08', 12)),
      op('YANDEX PLUS', -1_990, 'sc_subscriptions', day(SEP, 12)),
      op('Перевод', -20_000, 'sc_people', day(SEP, 3), { counterparty: 'Дана К.', kind: 'transfer-out' }),
    ]
    const ctx = { ...NONE, categories: [] }
    const one = reviewFinds(ops, 'a', SEP, ctx, 'T')
    const two = reviewFinds([...ops].reverse(), 'a', SEP, ctx, 'T')
    expect(one).toEqual(two)
    expect(one.map((f) => f.kind)).toEqual(['leak', 'recurring', 'top', 'top'])
    for (const f of one) expect(f.name.length).toBeLessThanOrEqual(FIND_NAME_MAX)
    expect(JSON.stringify(one)).not.toMatch(/2026-0\d-\d\d|Дана/)
  })

  it('sameFind — тот же итог; другая сумма, другая верхушка, надгробие — нет', () => {
    const [f] = topFinds([op('Zara', -45_000, 'sc_shopping', day(SEP, 2))], 'a', SEP, [], 'T')
    expect(sameFind({ ...f, updatedAt: 'X' }, f)).toBe(true)
    expect(sameFind({ ...f, amount: 1 }, f)).toBe(false)
    expect(sameFind({ ...f, top: [] }, f)).toBe(false)
    expect(sameFind({ ...f, deletedAt: 'X' }, f)).toBe(false)
    expect(sameFind(undefined, f)).toBe(false)
  })
})

describe('«Мне вернули» в находках (FB-02, Р-12)', () => {
  it('утечка — сумма за вычетом возврата; полный возврат — не покупка утечки', () => {
    const list = times(7, 'Apteka Plus', -1_500, 'sc_health', SEP)
    list[0] = { ...list[0], refund: { amount: 500 } }
    expect(leakFinds(list, 'a', SEP)[0]).toMatchObject({ count: 7, amount: 10_000 })
    // Шесть покупок и одна возвращённая целиком: в утечке шесть (порог LEAK_MIN_COUNT = 6) — 9 000.
    const full = times(7, 'Apteka Plus', -1_500, 'sc_health', SEP)
    full[0] = { ...full[0], refund: { amount: 1_500 } }
    expect(leakFinds(full, 'a', SEP)[0]).toMatchObject({ count: 6, amount: 9_000 })
    // Шестая тоже возвращена — пять, не утечка.
    full[1] = { ...full[1], refund: { amount: 1_500 } }
    expect(leakFinds(full, 'a', SEP)).toEqual([])
  })

  it('верхушка раздела — сумма и крупнейшие покупки по spendOf', () => {
    const ops = [op('Divan Store', -200_000, 'sc_home', day(SEP, 3), { refund: { amount: 150_000 } }), op('Leroy', -80_000, 'sc_home', day(SEP, 4))]
    const top = topFinds(ops, 'a', SEP)[0]
    expect(top).toMatchObject({ amount: 130_000, count: 2 })
    expect(top.top).toEqual([{ name: 'Leroy', amount: 80_000 }, { name: 'Divan Store', amount: 50_000 }])
  })

  it('двойное, которое вернули целиком, — не находка; подорожание — по сумме за вычетом возврата (критик Блока 1)', () => {
    const at = (d: number, extra: Partial<Operation> = {}) => op('SPORT CLUB', -12_000, 'sc_fun', day(SEP, d), extra)
    expect(dueFinds([at(3), at(4)], 'a', SEP, NONE).map((f) => f.kind)).toEqual(['double'])
    expect(dueFinds([at(3), at(4, { refund: { amount: 12_000 } })], 'a', SEP, NONE)).toEqual([])
    // Кинопоиск 2 990 при плане 2 490, вернули 600 — заплачено 2 390: не дороже.
    const ctx = { ...NONE, obligations: [obligation('o1', 'Кинопоиск', 2_490)], rules: [payRule('KINOPOISK', 'o1')] }
    expect(dueFinds([op('KINOPOISK', -2_990, 'sc_subscriptions', day(SEP, 10))], 'a', SEP, ctx).map((f) => f.kind)).toEqual(['pricier'])
    expect(dueFinds([op('KINOPOISK', -2_990, 'sc_subscriptions', day(SEP, 10), { refund: { amount: 600 } })], 'a', SEP, ctx)).toEqual([])
  })
})

describe('«Разовая» в находках (FB-07, Р-16)', () => {
  it('разовая — не продавец находки: не утечка, не покупка верхушки и не в её сумме', () => {
    expect(sellerOk(op('Avtoshkola', -300_000, 'sc_education', day(SEP, 3), { oneOff: true }))).toBe(false)
    const list = times(7, 'Apteka Plus', -1_500, 'sc_health', SEP)
    expect(leakFinds(list, 'a', SEP)).toHaveLength(1)
    expect(leakFinds(list.map((o) => ({ ...o, oneOff: true })), 'a', SEP)).toEqual([])
    const ops = [op('Divan Store', -200_000, 'sc_home', day(SEP, 3), { oneOff: true }), op('Leroy', -80_000, 'sc_home', day(SEP, 4))]
    const top = topFinds(ops, 'a', SEP)[0]
    expect(top).toMatchObject({ amount: 80_000, count: 1 })
    expect(top.top).toEqual([{ name: 'Leroy', amount: 80_000 }])
    expect(topFinds([ops[0]], 'a', SEP)).toEqual([])
  })
})
