import { describe, expect, it } from 'vitest'
import {
  ONE_OFF_MAX,
  ONE_OFF_MIN,
  SMALL_MAX,
  cashShare,
  dearerWeek,
  oneOffLike,
  peopleShare,
  smallBuys,
  unknownShare,
  weekendShare,
} from './finds'
import { UNKNOWN_CATEGORY } from './dictionary'
import type { Operation, SpendCategory } from './types'

// Находки разбора v4 по своим операциям (бэклог «Фидбек», Р-24, FB-15): считаются на телефоне, в документ не пишутся;
// разовые и возвращённое целиком — мимо; имя человека — только в `top` переводов людям.
let n = 0
const op = (merchant: string, amount: number, categoryId: string | null, date: string, extra: Partial<Operation> = {}): Operation => ({
  id: `o${++n}`, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
})
const SEP = '2026-09'
const NAME = 'Замира Ш.'
const person = (amount: number, date: string, extra: Partial<Operation> = {}) =>
  op(NAME, amount, 'sc_people', date, { kind: 'transfer-out', counterparty: NAME, note: 'Перевод', ...extra })
const CATS: Pick<SpendCategory, 'id' | 'plannedElsewhere'>[] = [{ id: 'sc_subs', plannedElsewhere: true }]

describe('доли разделов месяца — люди, наличные, не разобрано', () => {
  it('сумма и счётчик по разделу; разовая, возвращённая целиком и чужой месяц — мимо; частичный возврат — за вычетом', () => {
    const ops = [
      person(-30_000, '2026-09-03'),
      person(-10_000, '2026-09-05', { refund: { amount: 4_000 } }),
      person(-8_000, '2026-09-06', { refund: { amount: 8_000 } }),
      person(-50_000, '2026-09-07', { oneOff: true }),
      person(-70_000, '2026-08-30'),
      op('Дана К.', -5_000, 'sc_people', '2026-09-08', { kind: 'transfer-out', counterparty: 'Дана К.' }),
    ]
    const p = peopleShare(ops, SEP)
    expect(p).toMatchObject({ amount: 41_000, count: 3, top: NAME })
    expect(p.opIds).toEqual([ops[0].id, ops[1].id, ops[5].id])
  })

  it('ответ «Кому → что» перенёс перевод в другой раздел — не люди', () => {
    const gift = person(-20_000, '2026-09-03', { categoryId: 'sc_gifts' })
    expect(peopleShare([gift], SEP)).toEqual({ amount: 0, count: 0, opIds: [], top: null })
  })

  it('наличные: `bare` — снятия без заметки', () => {
    const atm = (memo?: string) => op('ATM Kaspi', -20_000, 'sc_cash', '2026-09-04', { kind: 'cash', memo })
    expect(cashShare([atm(), atm('ремонт'), atm()], SEP)).toMatchObject({ amount: 60_000, count: 3, bare: 2 })
  })

  it('не разобрано — без раздела (null) и `_unknown`, как в итогах', () => {
    const ops = [op('SHOP A', -3_000, null, '2026-09-02'), op('SHOP B', -2_000, UNKNOWN_CATEGORY, '2026-09-02'), op('SHOP C', -1_000, 'sc_food', '2026-09-02')]
    expect(unknownShare(ops, SEP)).toMatchObject({ amount: 5_000, count: 2 })
  })
})

describe('oneOffLike — похоже на разовую', () => {
  const before = [op('MAGNUM', -5_000, 'sc_food', '2026-06-10'), op('MAGNUM', -5_000, 'sc_food', '2026-07-10'), op('KAFE', -4_000, 'sc_cafe', '2026-08-10')]
  const fact = 400_000 // 5 % — 20 000

  it('свои траты не во всех 3 прошлых месяцах (выписка с конца августа) — «впервые за 3 месяца» не скажешь: пусто (критик 4б)', () => {
    const at = op('AVTOSHKOLA', -90_000, 'sc_edu', '2026-09-12')
    expect(oneOffLike([op('KAFE', -4_000, 'sc_cafe', '2026-08-28'), at], SEP, fact)).toEqual([])
    expect(oneOffLike([...before.slice(1), at], SEP, fact)).toEqual([])
    expect(oneOffLike([...before, at], SEP, fact)).toHaveLength(1)
  })

  it('порог: 20 000 и 5 % факта — да; на шаг ниже — нет', () => {
    const at = op('AVTOSHKOLA', -ONE_OFF_MIN, 'sc_edu', '2026-09-12')
    expect(oneOffLike([...before, at], SEP, fact)).toEqual([{ opId: at.id, name: 'AVTOSHKOLA', amount: 20_000 }])
    expect(oneOffLike([...before, op('AVTOSHKOLA', -(ONE_OFF_MIN - 1), 'sc_edu', '2026-09-12')], SEP, fact)).toEqual([])
    // Доля: 20 000 при факте 400 001 — ниже 5 %.
    expect(oneOffLike([...before, at], SEP, fact + 1)).toEqual([])
  })

  it('продавец был в 3 прошлых месяцах — не новый; своих операций раньше нет — пусто; разовая, люди, платежи, без раздела — мимо', () => {
    const seen = op('KAFE', -30_000, 'sc_cafe', '2026-09-12')
    expect(oneOffLike([...before, seen], SEP, fact)).toEqual([])
    expect(oneOffLike([op('DIVAN', -90_000, 'sc_home', '2026-09-12')], SEP, fact)).toEqual([])
    const marked = op('DIVAN', -90_000, 'sc_home', '2026-09-12', { oneOff: true })
    const subs = op('NEW SUB', -30_000, 'sc_subs', '2026-09-12')
    expect(oneOffLike([...before, marked, person(-90_000, '2026-09-12'), subs], SEP, fact, CATS)).toEqual([])
    // Без раздела — сначала «Не разобрано».
    expect(oneOffLike([...before, op('NEW SHOP', -90_000, null, '2026-09-12'), op('NEW SHOP 2', -90_000, UNKNOWN_CATEGORY, '2026-09-12')], SEP, fact)).toEqual([])
  })

  it('до двух — самые крупные', () => {
    const big = [90_000, 30_000, 60_000].map((a, i) => op(`NEW ${i}`, -a, 'sc_home', '2026-09-1' + i))
    const out = oneOffLike([...before, ...big], SEP, fact)
    expect(out).toHaveLength(ONE_OFF_MAX)
    expect(out.map((o) => o.amount)).toEqual([90_000, 60_000])
  })
})

describe('dearerWeek — неделя дороже обычной', () => {
  // Сентябрь 2026: понедельник 7-го. Прошлые полные недели — с 10, 17, 24, 31 августа, по 10 000 свободных трат.
  const base = ['2026-08-10', '2026-08-18', '2026-08-25', '2026-09-01'].map((d) => op('MAGNUM', -10_000, 'sc_food', d))
  const end = op('MAGNUM', -1, 'sc_food', '2026-09-30')

  it('неделя 7–13 сентября на 130 % — карточка (+30 %), самая крупная трата; на шаг ниже — нет', () => {
    const big = op('SULPAK', -9_000, 'sc_home', '2026-09-08')
    const week = [big, op('KAFE', -4_000, 'sc_cafe', '2026-09-12')]
    // Неделя 14–20 — без трат, 21–27 и 28–4 — не дороже.
    expect(dearerWeek([...base, ...week, end], SEP)).toEqual({ week: '2026-W37', amount: 13_000, usual: 10_000, pct: 30, opId: big.id })
    const less = [op('SULPAK', -8_999, 'sc_home', '2026-09-08'), op('KAFE', -4_000, 'sc_cafe', '2026-09-12')]
    expect(dearerWeek([...base, ...less, end], SEP)).toBeNull()
  })

  it('разовая и переводы людям в неделю не входят; без 4 полных недель раньше — нет', () => {
    const week = [op('SULPAK', -90_000, 'sc_home', '2026-09-08', { oneOff: true }), person(-90_000, '2026-09-09')]
    expect(dearerWeek([...base, ...week, end], SEP)).toBeNull()
    expect(dearerWeek([...base.slice(1), op('SULPAK', -90_000, 'sc_home', '2026-09-08'), end], SEP)?.week).not.toBe('2026-W37')
  })

  it('неполная неделя (после последней своей даты) — не сравнивается', () => {
    const late = op('SULPAK', -90_000, 'sc_home', '2026-09-28')
    expect(dearerWeek([...base, late], SEP)).toBeNull()
  })
})

describe('smallBuys и weekendShare', () => {
  it('мелочь — покупки дешевле 2 000; 2 000 — уже нет; разовая и перевод — мимо', () => {
    const ops = [
      op('KOFE', -(SMALL_MAX - 1), 'sc_cafe', '2026-09-02'),
      op('KOFE', -SMALL_MAX, 'sc_cafe', '2026-09-03'),
      op('KOFE', -500, 'sc_cafe', '2026-09-04', { oneOff: true }),
      person(-500, '2026-09-04'),
    ]
    expect(smallBuys(ops, SEP)).toEqual({ count: 1, amount: 1_999 })
  })

  it('выходные: доля свободных трат в сб–вс и доля таких дней месяца', () => {
    // 5 сентября — суббота. В сентябре 2026 — 8 выходных из 30 дней → 27 %.
    const ops = [op('KAFE', -3_000, 'sc_cafe', '2026-09-05'), op('MAGNUM', -1_000, 'sc_food', '2026-09-07'), person(-100_000, '2026-09-06')]
    expect(weekendShare(ops, SEP)).toEqual({ share: 75, days: 27 })
    expect(weekendShare([], SEP)).toBeNull()
  })
})

describe('имена людей не покидают переводы', () => {
  it('имя получателя — только в `top`; остальные находки его не несут', () => {
    const before = [op('MAGNUM', -5_000, 'sc_food', '2026-07-10')]
    const ops = [...before, person(-90_000, '2026-09-08'), op(NAME, -60_000, 'sc_home', '2026-09-09', { kind: 'transfer-out' })]
    expect(peopleShare(ops, SEP).top).toBe(NAME)
    const rest = [cashShare(ops, SEP), unknownShare(ops, SEP), oneOffLike(ops, SEP, 100_000), dearerWeek(ops, SEP), smallBuys(ops, SEP), weekendShare(ops, SEP)]
    // Строка без `counterparty` с именем, которую семья отнесла к дому, — продавец (`sellerOk` её пускает): имя банка, не перевод.
    expect(JSON.stringify(rest.slice(0, 2))).not.toContain('Замира')
    expect(JSON.stringify(rest.slice(3))).not.toContain('Замира')
  })
})
