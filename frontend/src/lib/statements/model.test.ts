import { describe, expect, it } from 'vitest'
import type { Person, SyncDoc } from '@/types/finance'
import { DEFAULT_SPEND_CATEGORIES, DICTIONARY } from './dictionary'
import {
  applyRules,
  assignIds,
  categorize,
  fingerprint,
  matchPerson,
  normalizeMerchant,
  pairInternalTransfers,
  sanitize,
  seedSpendCategories,
  spendTotals,
} from './model'
import type { MerchantRule, Operation } from './types'

const T = '2026-09-20T10:00:00.000Z'
let seq = 0
const op = (p: Partial<Operation>): Operation => ({
  id: `op${++seq}`, bank: 'kaspi', date: '2026-09-21', amount: -1000, kind: 'purchase', merchant: 'Magnum',
  categoryId: null, internal: false, ...p,
})
const rule = (p: Partial<MerchantRule>): MerchantRule => ({
  id: `r${++seq}`, match: {}, to: { categoryId: 'sc_other' }, by: 'a', updatedAt: T, ...p,
})

describe('sanitize', () => {
  it('режет 6+ цифр и не трогает 5', () => {
    expect(sanitize('Справка №1285656765 от')).toBe('Справка № от')
    expect(sanitize('POS 123456 и 12345')).toBe('POS и 12345')
    expect(sanitize('На карту Банк*0166')).toBe('На карту Банк*0166')
  })

  it('IBAN — целиком, а не только его длинные цифры', () => {
    expect(sanitize('на счет KZ00551Z000000000KZT. По договору')).toBe('на счет . По договору')
    expect(sanitize('счет KZ00722C000000000000')).toBe('счет')
  })

  it('полное ФИО → «Имя Ф.» (и заглавными); «Имя Ф.» и продавцы не трогаются', () => {
    expect(sanitize('Кенесова Дана Маратовна . Безвозмездный перевод')).toBe('Дана К. . Безвозмездный перевод')
    expect(sanitize('Сапаров Алихан Болатұлы')).toBe('Алихан С.')
    expect(sanitize('САПАРОВ АЛИХАН СЕРИКОВИЧ')).toBe('Алихан С.')
    expect(sanitize('Дана К. Безвозмездный перевод')).toBe('Дана К. Безвозмездный перевод')
    expect(sanitize('IP ASANOVA A.B. ASTANA KZ')).toBe('IP ASANOVA A.B. ASTANA KZ')
    expect(sanitize('Центральная мечеть Иванович')).toBe('Центральная мечеть Иванович')
  })

  it('схлопывает пробелы и обрезает до 120 символов', () => {
    expect(sanitize('  a \n  b\t c ')).toBe('a b c')
    expect(sanitize('x'.repeat(200))).toHaveLength(120)
  })
})

describe('normalizeMerchant', () => {
  it('«MAGNUM ALMATY KZ» и «Magnum» — одно', () => {
    expect(normalizeMerchant('MAGNUM ALMATY KZ')).toBe('magnum')
    expect(normalizeMerchant('Magnum')).toBe('magnum')
  })

  it('снимает правовую форму, кавычки, точки, город, отметку города и код терминала', () => {
    expect(normalizeMerchant('TOO "KASPI MAGAZIN"')).toBe('kaspi magazin')
    expect(normalizeMerchant('YANDEX.GO ALMATY KZ')).toBe('yandex go')
    expect(normalizeMerchant('MAGAZIN SMALL MARKET ASTANA Q. KZ')).toBe('magazin small market')
    expect(normalizeMerchant('ASKHANA ZIRA G.ASTANA KZ')).toBe('askhana zira')
    expect(normalizeMerchant('SMALL SUPERMARKET AST1 ALMATY KZ')).toBe('small supermarket')
    expect(normalizeMerchant('Google One Mountain View US')).toBe('google one')
    expect(normalizeMerchant('IP ASANOVA A.B. NUR-SULTAN KZ')).toBe('asanova a b')
  })

  it('не съедает название до пустоты', () => {
    expect(normalizeMerchant('KZ')).toBe('kz')
    expect(normalizeMerchant('Tele2')).toBe('tele2')
  })
})

describe('fingerprint и assignIds', () => {
  const base = { bank: 'kaspi' as const, date: '2026-09-21', amount: -380, merchant: 'Аппарат самообслуживания' }

  it('стабилен, 14 hex-знаков, различает ordinal', () => {
    expect(fingerprint(base, 0)).toBe(fingerprint({ ...base }, 0))
    expect(fingerprint(base, 0)).toMatch(/^[0-9a-f]{14}$/)
    expect(fingerprint(base, 0)).not.toBe(fingerprint(base, 1))
  })

  it('название сравнивается нормализованным, сумма и дата — различают', () => {
    expect(fingerprint({ ...base, merchant: 'MAGNUM ALMATY KZ' }, 0)).toBe(fingerprint({ ...base, merchant: 'Magnum' }, 0))
    expect(fingerprint({ ...base, amount: -381 }, 0)).not.toBe(fingerprint(base, 0))
    expect(fingerprint({ ...base, date: '2026-09-22' }, 0)).not.toBe(fingerprint(base, 0))
    expect(fingerprint({ ...base, bank: 'freedom' }, 0)).not.toBe(fingerprint(base, 0))
  })

  it('две одинаковые покупки за день — разные id; повторный разбор — те же', () => {
    const rows = [base, base, { ...base, amount: -20 }].map((b) => ({ ...b, kind: 'purchase' as const, categoryId: null, internal: false }))
    const first = assignIds(rows)
    expect(new Set(first.map((o) => o.id)).size).toBe(3)
    expect(assignIds(rows).map((o) => o.id)).toEqual(first.map((o) => o.id))
  })
})

describe('categorize', () => {
  it('правило по получателю сильнее правила по продавцу, то — сильнее словаря', () => {
    const o = op({ kind: 'transfer-out', merchant: 'Magnum', counterparty: 'Дана К.' })
    expect(categorize(o, []).categoryId).toBe('sc_people')
    const byMerchant = rule({ match: { merchant: 'magnum' }, to: { categoryId: 'sc_home' } })
    expect(categorize(op({}), [byMerchant]).categoryId).toBe('sc_home')
    const byWho = rule({ match: { counterparty: 'дана к.' }, to: { categoryId: 'sc_fun' } })
    expect(categorize(o, [byMerchant, byWho]).categoryId).toBe('sc_fun')
  })

  it('словарь: продукты, такси, вид операции; незнакомое — null', () => {
    expect(categorize(op({ merchant: 'MAGNUM CASH&CARRY ASTANA KZ' }), []).categoryId).toBe('sc_food')
    expect(categorize(op({ merchant: 'YANDEX.GO ALMATY KZ' }), []).categoryId).toBe('sc_transport')
    expect(categorize(op({ merchant: 'YANDEX.EDA ALMATY KZ' }), []).categoryId).toBe('sc_cafe')
    expect(categorize(op({ merchant: 'Кофейня у дома' }), []).categoryId).toBe('sc_cafe')
    expect(categorize(op({ merchant: 'Оплата Kaspi Кредита', kind: 'transfer-out' }), []).categoryId).toBe('sc_credit')
    expect(categorize(op({ merchant: 'Банкомат Tumar', kind: 'cash' }), []).categoryId).toBe('sc_cash')
    expect(categorize(op({ merchant: 'Комиссия за перевод', kind: 'fee' }), []).categoryId).toBe('sc_fees')
    expect(categorize(op({ merchant: 'IP ZHANSAYA KOSTANAY KZ' }), []).categoryId).toBeNull()
  })

  it('кириллица целым словом: «аптек…» узнаётся, «кино» внутри слова — нет', () => {
    expect(categorize(op({ merchant: 'Аптека Жансая' }), []).categoryId).toBe('sc_health')
    expect(categorize(op({ merchant: 'Кинотеатр' }), []).categoryId).toBeNull()
    expect(categorize(op({ merchant: 'Кино' }), []).categoryId).toBe('sc_fun')
  })

  it('правило «внутренний» и «кому → что»; удалённое правило не действует; позднее побеждает', () => {
    const o = op({ kind: 'transfer-out', counterparty: 'Дана К.', merchant: 'Дана К.' })
    expect(categorize(o, [rule({ match: { counterparty: 'дана к.' }, to: { internal: true } })]))
      .toEqual({ categoryId: null, internal: true })
    expect(categorize(o, [rule({ match: { counterparty: 'дана к.' }, to: { person: 'няня' } })]))
      .toEqual({ categoryId: 'sc_people', internal: false, personLabel: 'няня' })
    const gone = rule({ match: { counterparty: 'дана к.' }, to: { internal: true }, deletedAt: T })
    expect(categorize(o, [gone]).internal).toBe(false)
    const older = rule({ match: { merchant: 'magnum' }, to: { categoryId: 'sc_home' }, updatedAt: '2026-09-01T00:00:00Z' })
    const newer = rule({ match: { merchant: 'magnum' }, to: { categoryId: 'sc_fun' }, updatedAt: '2026-09-02T00:00:00Z' })
    expect(categorize(op({}), [newer, older]).categoryId).toBe('sc_fun')
  })

  it('приходы и внутренние не раскладываются, но правило может снять «внутренний»', () => {
    expect(categorize(op({ amount: 5000, kind: 'transfer-in' }), [])).toEqual({ categoryId: null, internal: false })
    expect(categorize(op({ internal: true, merchant: 'С Kaspi Депозита' }), [])).toEqual({ categoryId: null, internal: true })
    const r = rule({ match: { merchant: 'с kaspi депозита' }, to: { categoryId: 'sc_other' } })
    expect(categorize(op({ internal: true, merchant: 'С Kaspi Депозита' }), [r])).toEqual({ categoryId: 'sc_other', internal: false })
  })

  it('applyRules пересчитывает все операции после нового правила', () => {
    const ops = [op({ merchant: 'IP ZHANSAYA KOSTANAY KZ' }), op({ merchant: 'IP ZHANSAYA ASTANA KZ' }), op({})]
    const once = applyRules(ops, [])
    expect(once.map((o) => o.categoryId)).toEqual([null, null, 'sc_food'])
    const r = rule({ match: { merchant: 'zhansaya' }, to: { categoryId: 'sc_cafe' } })
    expect(applyRules(once, [r]).map((o) => o.categoryId)).toEqual(['sc_cafe', 'sc_cafe', 'sc_food'])
  })

  it('словарь — данные: у каждой записи раздел из набора по умолчанию', () => {
    const ids = new Set(DEFAULT_SPEND_CATEGORIES.map((c) => c.id))
    for (const d of DICTIONARY) expect(ids.has(d.categoryId)).toBe(true)
  })
})

describe('pairInternalTransfers', () => {
  const out = (p: Partial<Operation>) => op({ kind: 'transfer-out', merchant: 'На карту Freedom Finance Bank*1234', amount: -50000, ...p })
  const inc = (p: Partial<Operation>) => op({ bank: 'freedom', kind: 'transfer-in', merchant: 'Перевод с карты на карту', amount: 50000, ...p })

  it('пара между банками ±1 день — обе внутренние', () => {
    const ops = pairInternalTransfers([out({ date: '2026-09-20' }), inc({ date: '2026-09-21' })])
    expect(ops.map((o) => o.internal)).toEqual([true, true])
  })

  it('разные суммы, 2 дня, один банк, перевод человеку — не пара', () => {
    expect(pairInternalTransfers([out({}), inc({ amount: 49999 })]).some((o) => o.internal)).toBe(false)
    expect(pairInternalTransfers([out({ date: '2026-09-19' }), inc({ date: '2026-09-21' })]).some((o) => o.internal)).toBe(false)
    expect(pairInternalTransfers([out({}), inc({ bank: 'kaspi' })]).some((o) => o.internal)).toBe(false)
    expect(pairInternalTransfers([out({ counterparty: 'Дана К.' }), inc({})]).some((o) => o.internal)).toBe(false)
  })

  it('одна операция — не в двух парах; ближайшая по дате побеждает', () => {
    const o = out({ date: '2026-09-20' })
    const far = inc({ date: '2026-09-21' })
    const near = inc({ date: '2026-09-20' })
    const ops = pairInternalTransfers([o, far, near])
    expect(ops.map((x) => x.internal)).toEqual([true, false, true])
  })
})

describe('matchPerson', () => {
  const people = [
    { id: 'a', name: 'Алихан', updatedAt: T },
    { id: 'b', name: 'Дана Кенесова', updatedAt: T },
  ] as Person[]

  it('точное совпадение первой части имени', () => {
    expect(matchPerson('Дана К.', people)).toBe('b')
    expect(matchPerson('дана к.', people)).toBe('b')
    expect(matchPerson('Данияр К.', people)).toBeNull()
    expect(matchPerson(undefined, people)).toBeNull()
  })
})

describe('spendTotals', () => {
  const ops = [
    op({ date: '2026-09-21', amount: -1200, categoryId: 'sc_food' }),
    op({ date: '2026-09-22', amount: -800, categoryId: 'sc_food' }),
    op({ date: '2026-09-22', amount: -500, categoryId: null }),
    op({ date: '2026-09-23', amount: -50000, categoryId: null, internal: true }),
    op({ date: '2026-09-23', amount: 90000, kind: 'transfer-in' }),
    op({ date: '2026-09-28', amount: -700, categoryId: 'sc_cafe' }),
  ]

  it('неделя: только списания, без внутренних, незнакомое — _unknown; сумма = сумма списаний', () => {
    const totals = spendTotals(ops, 'a', 'week', '2026-W39', T)
    expect(totals).toEqual([
      { id: 'a:week:2026-W39:_unknown', by: 'a', kind: 'week', period: '2026-W39', categoryId: '_unknown', amount: 500, ops: 1, updatedAt: T },
      { id: 'a:week:2026-W39:sc_food', by: 'a', kind: 'week', period: '2026-W39', categoryId: 'sc_food', amount: 2000, ops: 2, updatedAt: T },
    ])
    const spent = ops.filter((o) => o.amount < 0 && !o.internal && o.date <= '2026-09-27').reduce((s, o) => s - o.amount, 0)
    expect(totals.reduce((s, t) => s + t.amount, 0)).toBe(spent)
  })

  it('месяц берёт операции месяца; суммы — целые и положительные', () => {
    const totals = spendTotals(ops, 'b', 'month', '2026-09', T)
    expect(totals.map((t) => [t.id, t.amount])).toEqual([
      ['b:month:2026-09:_unknown', 500],
      ['b:month:2026-09:sc_cafe', 700],
      ['b:month:2026-09:sc_food', 2000],
    ])
    expect(totals.every((t) => Number.isInteger(t.amount) && t.amount > 0)).toBe(true)
  })
})

describe('seedSpendCategories', () => {
  it('сеет набор по умолчанию один раз', () => {
    const doc = { people: [] } as unknown as SyncDoc
    expect(seedSpendCategories(doc, T)).toBe(true)
    expect(doc.spendCategories).toHaveLength(DEFAULT_SPEND_CATEGORIES.length)
    expect(doc.spendCategories?.[0]).toEqual({ ...DEFAULT_SPEND_CATEGORIES[0], updatedAt: T })
    expect(seedSpendCategories(doc, '2027-01-01T00:00:00Z')).toBe(false)
    expect(doc.spendCategories?.[0].updatedAt).toBe(T)
  })
})
