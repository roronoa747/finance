import { describe, expect, it } from 'vitest'
import { coffeeCupCost, habitImages, imageLine, imageMath, imageMoveFrom, interestImage, yearsMonths } from './finance'
import { MEASURES, PRICES } from './prices'
import { money } from './money'
import type { HabitId, HabitTotal } from './statements/types'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import type { Goal, ImageMove, PersonId, SpendPlan, WishItem } from '@/types/finance'

/**
 * AU-28: образы трат против ручного расчёта (правило 6 — числа в комментариях). Месяц `2026-10`, закрытые — июль,
 * август, сентябрь. Семья — Ильяс (a) и Аруна (b).
 */
const KEY = '2026-10'
const MONTHS = ['2026-07', '2026-08', '2026-09']
const people = [
  { id: 'a' as const, name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
  { id: 'b' as const, name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
]
const ht = (by: PersonId, period: string, habit: HabitId, count: number, amount: number): HabitTotal => ({
  id: `${by}:${period}:${habit}`, by, period, habit, count, amount, updatedAt: T0,
})
/** Привычка в каждом из трёх месяцев: у a и (если задано) у b. */
const every = (habit: HabitId, a: [number, number], b?: [number, number]) =>
  MONTHS.flatMap((m) => [ht('a', m, habit, ...a), ...(b ? [ht('b', m, habit, ...b)] : [])])
const goal = (id: string, name: string, need: number, have: number, monthly: number, extra: Partial<Goal> = {}): Goal => ({
  id, name, need, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
const wish = (name: string, price: number): WishItem => ({ id: 'w1', name, price, by: 'a', addedOn: '2026-09-01', bought: false, updatedAt: T0 })
const state = (habitTotals: HabitTotal[], extra: { goals?: Goal[]; wishlist?: WishItem[] } = {}) => ({ people, habitTotals, ...extra })

describe('prices — справочник', () => {
  it('у каждой мерки цена > 0 (целые ₸), источник, ссылка и дата', () => {
    for (const p of Object.values(PRICES)) {
      expect(Number.isInteger(p.price) && p.price > 0).toBe(true)
      expect(p.source.length).toBeGreaterThan(0)
      expect(p.url).toMatch(/^https:\/\//)
      expect(p.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    // Мерки по возрастанию цены — «ближайшая снизу» выбирается среди них.
    expect(MEASURES.map((id) => PRICES[id].price)).toEqual([...MEASURES.map((id) => PRICES[id].price)].sort((x, y) => x - y))
  })
})

describe('habitImages — образы', () => {
  it('такси 92 000 × 3 месяца (60 000 + 32 000) → накопить на машину: 4 750 000 ÷ 92 000 = 51,6 → 52 месяца', () => {
    const [img] = habitImages(state(every('taxi', [30, 60_000], [16, 32_000])), KEY)
    expect(img).toMatchObject({ habit: 'taxi', categoryId: 'sc_transport', kind: 'save', monthly: 92_000, count: 46, left: 4_750_000, months: 52 })
    expect(img.price).toEqual({ from: 'ref', id: 'car_used', name: 'своя машина', price: 4_750_000 })
    expect(img.action).toEqual({ kind: 'goal', name: 'Машина', need: 4_750_000, monthly: 92_000, template: 'car' })
    expect(imageLine(img)).toBe('Такси за 4 года 4 месяца — своя машина без долга')
  })

  it('2 месяца из 3 — образа нет; итог участника, которого нет в семье, не считается', () => {
    const two = every('taxi', [30, 60_000]).filter((t) => t.period !== '2026-08')
    expect(habitImages(state(two), KEY)).toEqual([])
    const stranger = MONTHS.map((m) => ht('c' as PersonId, m, 'taxi', 30, 60_000))
    expect(habitImages(state(stranger), KEY)).toEqual([])
  })

  it('мечта «Машина» в семье — цена из мечты, срок по остатку: (3 000 000 − 600 000) ÷ 92 000 = 26,1 → 27; кнопки нет', () => {
    const car = goal('car', 'Машина', 3_000_000, 600_000, 50_000, { template: 'car' })
    const [img] = habitImages(state(every('taxi', [46, 92_000]), { goals: [car] }), KEY)
    expect(img.price).toEqual({ from: 'goal', goalId: 'car', name: 'Машина', price: 3_000_000 })
    expect(img).toMatchObject({ left: 2_400_000, months: 27, action: null })
  })

  it('кофе: 20 чашек, 30 000 ₸ → дома 20 × 244 = 4 880; 218 864 ÷ 25 120 = 8,7 → 9 месяцев — есть', () => {
    expect(coffeeCupCost()).toBe(244) // 12 000 × 10 / 1000 + 826 × 150 / 1000 = 120 + 123,9
    const [img] = habitImages(state(every('coffee', [20, 30_000])), KEY)
    expect(img).toMatchObject({ kind: 'payback', cost: 4_880, saving: 25_120, months: 9 })
    expect(img.action).toEqual({ kind: 'wish', name: 'Кофемашина', price: 218_864 })
    expect(imageLine(img)).toBe('Кофемашина окупится за 9 месяцев')
  })

  it('кофе с окупаемостью 15 месяцев (10 чашек, 18 000 ₸: 218 864 ÷ 15 560 = 14,1) — нет; желание «Кофемашина» с ценой — цена из желания', () => {
    expect(habitImages(state(every('coffee', [10, 18_000])), KEY)).toEqual([])
    const [img] = habitImages(state(every('coffee', [10, 18_000]), { wishlist: [wish('Кофемашина Philips', 90_000)] }), KEY)
    // 90 000 ÷ 15 560 = 5,8 → 6 месяцев; желание уже есть — кнопки нет.
    expect(img).toMatchObject({ months: 6, action: null, price: { from: 'wish', price: 90_000 } })
  })

  it('доставка 40 000 → за год 480 000 = 80 % мечты «Япония» (600 000); перенос 50 % = 20 000, раньше на 104 дня', () => {
    const japan = goal('jp', 'Япония', 600_000, 0, 50_000)
    const [img] = habitImages(state(every('delivery', [8, 40_000]), { goals: [japan] }), KEY)
    expect(img).toMatchObject({ kind: 'dream', categoryId: 'sc_cafe', yearly: 480_000, share: 80 })
    // 600 000 / 50 000 = 12 мес.; 600 000 / 70 000 = 8,571; (12 − 8,571) × 30,4 = 104,2 → 104.
    expect(img.action).toEqual({ kind: 'move', categoryId: 'sc_cafe', goalId: 'jp', goalName: 'Япония', amount: 20_000, days: 104 })
    expect(imageLine(img)).toBe('Доставка за год — 80 % мечты «Япония»')
    expect(img.moved).toBeNull()
  })

  it('перенос записан (Х-9): на ту же мечту — «✓» вместо кнопки; на другую мечту или отменён — кнопка есть', () => {
    const japan = goal('jp', 'Япония', 600_000, 0, 50_000)
    const move = (goalId: string, deletedAt: string | null = null): ImageMove => ({ id: `m-${goalId}`, categoryId: 'sc_cafe', goalId, amount: 20_000, by: 'a', at: T0, updatedAt: T0, deletedAt })
    const of = (imageMoves: ImageMove[]) => habitImages({ ...state(every('delivery', [8, 40_000]), { goals: [japan] }), imageMoves }, KEY)[0]
    expect(of([move('jp')])).toMatchObject({ action: null, moved: 20_000 })
    expect(of([move('car')])).toMatchObject({ action: { kind: 'move', goalId: 'jp' }, moved: null })
    expect(of([move('jp', T0)])).toMatchObject({ action: { kind: 'move', goalId: 'jp' }, moved: null })
  })

  it('без мечты — мерка ближайшая снизу: обеды 60 000 × 12 = 720 000 → неделя в Анталье (637 000); меньше всех мерок — сумма', () => {
    const [img] = habitImages(state(every('lunch', [20, 60_000])), KEY)
    expect(img.price).toMatchObject({ from: 'ref', id: 'sea_week_two' })
    expect(img.action).toBeNull()
    expect(imageLine(img)).toBe('Обеды в будни за год — неделя в Анталье на двоих')
    const [small] = habitImages(state(every('marketplace', [12, 20_000])), KEY)
    expect(small.price).toBeNull()
    expect(imageLine(small)).toBe(`Мелкие покупки за год — ${money(240_000)}`)
  })

  it('один образ на раздел — самый крупный: обеды 45 000 и доставка 40 000 в «Кафе» → обеды', () => {
    const images = habitImages(state([...every('delivery', [8, 40_000]), ...every('lunch', [15, 45_000]), ...every('taxi', [30, 60_000])]), KEY)
    expect(images.map((i) => [i.categoryId, i.habit])).toEqual([['sc_transport', 'taxi'], ['sc_cafe', 'lunch']])
  })

  // Критик Блока 7: честность Р-30 на краях.
  it('текущий месяц не закрыт: итоги августа, сентября и октября при ключе октября — образа нет', () => {
    const open = ['2026-08', '2026-09', '2026-10'].map((m) => ht('a', m, 'taxi', 30, 60_000))
    expect(habitImages(state(open), KEY)).toEqual([])
  })

  it('кофе дешевле расхода дома: 20 чашек на 4 000 ₸ < 20 × 244 = 4 880 — образа нет и при дешёвом желании', () => {
    expect(habitImages(state(every('coffee', [20, 4_000]), { wishlist: [wish('Кофемашина', 10_000)] }), KEY)).toEqual([])
  })

  it('мечта «Машина» уже собрана — копить нечего, образа такси нет', () => {
    const car = goal('car', 'Машина', 3_000_000, 3_000_000, 0, { template: 'car' })
    expect(habitImages(state(every('taxi', [46, 92_000]), { goals: [car] }), KEY)).toEqual([])
  })
})

describe('imageMoveFrom — откуда урезать план', () => {
  const plan = (by: PersonId, amount: number, extra: Partial<SpendPlan> = {}): SpendPlan => ({
    id: `${by}:sc_cafe`, by, categoryId: 'sc_cafe', amount, updatedAt: T0, ...extra,
  })

  it('план участника с бо́льшим планом: 50 000 − 20 000 = 30 000; больше плана — до 0', () => {
    const plans = [plan('a', 30_000), plan('b', 50_000)]
    expect(imageMoveFrom({ people, spendPlans: plans }, 'sc_cafe', 20_000)).toEqual({ by: 'b', plan: 50_000, next: 30_000 })
    expect(imageMoveFrom({ people, spendPlans: plans }, 'sc_cafe', 70_000)).toEqual({ by: 'b', plan: 50_000, next: 0 })
  })

  it('плана нет, план удалён или участника нет в семье — null (только взнос)', () => {
    expect(imageMoveFrom({ people, spendPlans: [] }, 'sc_cafe', 20_000)).toBeNull()
    expect(imageMoveFrom({ people, spendPlans: [plan('a', 50_000, { deletedAt: T0 })] }, 'sc_cafe', 20_000)).toBeNull()
    expect(imageMoveFrom({ people, spendPlans: [plan('c' as PersonId, 50_000)] }, 'sc_cafe', 20_000)).toBeNull()
  })
})

describe('interestImage — проценты банку', () => {
  it('Кредит 1 000 000 × 33 % / 12 = 27 500 + кредитка 300 000 × 40 % / 12 = 10 000 → 37 500 в месяц, 450 000 за год', () => {
    const img = interestImage(planFamilyDoc())!
    expect(img).toMatchObject({ perMonth: 37_500, yearly: 450_000, price: null, action: { kind: 'faster' } })
    expect(imageLine(img)).toBe(`За год банку уходит ${money(450_000)}`)
  })

  it('больше — мерка: кредит 2 400 000 × 33 % / 12 = 66 000 → 792 000 за год ≥ неделя в Анталье', () => {
    const doc = planFamilyDoc()
    const credits = doc.credits!.map((c) => (c.id === 'loan' ? { ...c, principal: 2_400_000, payment: 120_000 } : c.id === 'cc' ? { ...c, principal: 0 } : c))
    const img = interestImage({ credits })!
    expect(img.yearly).toBe(792_000)
    expect(imageLine(img)).toBe('За год банку уходит неделя в Анталье на двоих')
  })

  it('без процентных долгов — null', () => {
    expect(interestImage({ credits: [] })).toBeNull()
    const doc = planFamilyDoc()
    expect(interestImage({ credits: doc.credits!.filter((c) => c.annualRate === 0) })).toBeNull()
  })
})

describe('imageMath — «Как посчитали»', () => {
  /** Числа строки (без пробелов-разделителей) — разбор регуляркой. */
  const numbers = (s: string) => (s.match(/\d[\d\s  ]*(?:,\d+)?/g) ?? []).map((x) => x.replace(/[\s  ]/g, ''))

  it('такси: цена мерки с моделью, источником и датой; арифметика — числа образа', () => {
    const [img] = habitImages(state(every('taxi', [46, 92_000])), KEY)
    const m = imageMath(img)
    expect(m.item).toMatch(/^Hyundai Accent 2015 — 4\s750\s000\s₸$/)
    expect(m.source).toEqual({ name: PRICES.car_used.source, url: PRICES.car_used.url })
    expect(m.checkedAt).toBe(PRICES.car_used.checkedAt)
    expect(numbers(m.lines[1])).toEqual([String(img.left), String(img.monthly), String(img.months), '4', '4'])
  })

  it('кофе: расход дома и окупаемость — те же числа', () => {
    const [img] = habitImages(state(every('coffee', [20, 30_000])), KEY)
    const m = imageMath(img)
    expect(numbers(m.lines[1]).slice(0, 3)).toEqual([String(img.count), String(coffeeCupCost()), String(img.cost)])
    expect(numbers(m.lines[2])).toEqual([String(img.monthly), String(img.cost), String(img.saving), String(PRICES.coffee_machine.price), String(img.saving), '8,7', String(img.months)])
  })

  it('доставка в мечту: цена «из вашей мечты», без источника; сумма за год, доля и перенос', () => {
    const japan = goal('jp', 'Япония', 600_000, 0, 50_000)
    const [img] = habitImages(state(every('delivery', [8, 40_000]), { goals: [japan] }), KEY)
    const m = imageMath(img)
    expect(m.item).toMatch(/^цена из вашей мечты «Япония» — 600\s000\s₸$/)
    expect(m.source).toBeNull()
    expect(numbers(m.lines[0]).slice(-3)).toEqual([String(img.monthly), '12', String(img.yearly)])
    expect(numbers(m.lines[1])).toEqual([String(img.yearly), '600000', String(img.share)])
    expect(m.lines[2]).toContain(money(20_000)) // перенос — сумма действия
  })

  it('проценты: в месяц × 12 = за год', () => {
    const img = interestImage(planFamilyDoc())!
    expect(numbers(imageMath(img).lines[0])).toEqual(['37500', '37500', '12', '450000'])
  })

  it('yearsMonths', () => {
    expect([yearsMonths(52), yearsMonths(9), yearsMonths(24), yearsMonths(13)]).toEqual(['4 года 4 месяца', '9 месяцев', '2 года', '1 год 1 месяц'])
  })
})
