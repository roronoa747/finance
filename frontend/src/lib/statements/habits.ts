import { addMonths } from '@/lib/dates'
import type { PersonId } from '@/types/finance'
import { words } from './dictionary'
import { isSpend, normalizeMerchant } from './model'
import type { HabitId, HabitTotal, Operation } from './types'

// Привычки трат (бэклог «ИИ-польза», Р-24, Р-29, Р-30, AU-27): каждый телефон находит их по своим операциям, в общий
// документ уходят только итоги месяца — счётчик и сумма, без продавцов и дат. Список и пороги — в коде; образы из них
// собирает `finance.ts` (AU-28). Сверено по настоящим выпискам семьи (июнь–сентябрь 2026, Handoff Блока 7).

const TAXI = words('yandex go', 'яндекс go', 'yandex taxi', 'яндекс такси', 'indrive', 'uber', 'taxi', 'такси')
/** Yandex Go Power — аренда пауэрбанков, не поездка (на выписке — «YANDEX GO POWER»). */
const NOT_TAXI = words('power')
const COFFEE = words('coffee', 'кофе', 'kofeynya', 'кофейня', 'espresso', 'starbucks', 'coffee boom', 'zebra coffee', 'double coffee', 'traveler s coffee')
const DELIVERY = words('yandex eda', 'яндекс еда', 'wolt', 'glovo', 'chocofood')
const MARKETPLACE = words('kaspi magazin', 'wildberries', 'ozon', 'lamoda', 'yandex market', 'яндекс маркет', 'yandex delivery', 'aliexpress', 'temu')

/** Пороги чека: кофе навынос, обед в будни, мелкая покупка (целые ₸). */
export const COFFEE_MAX = 3_000
export const LUNCH_MIN = 1_500
export const LUNCH_MAX = 7_000
export const MARKETPLACE_MAX = 5_000

/** Порог привычки — операций в месяц (Р-30, дефолт AU-27). */
export const HABIT_MIN_PER_MONTH: Record<HabitId, number> = { taxi: 8, coffee: 10, delivery: 4, lunch: 8, marketplace: 10 }

/** Сколько последних месяцев итогов держит участник в документе (AU-27): текущий и 3 закрытых для образа. */
export const HABIT_KEEP_MONTHS = 4

/** Будний день по дате выписки `YYYY-MM-DD` (календарь банка = Алматы, время не нужно). */
const weekday = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay()
  return d >= 1 && d <= 5
}

/**
 * Правила привычек (Р-29) — по порядку, операция попадает в первую подошедшую. Раздел операции должен совпадать с
 * разделом привычки: продавца, которого семья увела в другой раздел, привычка не считает.
 */
export const HABITS: { id: HabitId; categoryId: string; test: (op: Operation, name: string) => boolean }[] = [
  { id: 'taxi', categoryId: 'sc_transport', test: (_, n) => TAXI.test(n) && !NOT_TAXI.test(n) },
  { id: 'coffee', categoryId: 'sc_cafe', test: (op, n) => COFFEE.test(n) && -op.amount <= COFFEE_MAX },
  { id: 'delivery', categoryId: 'sc_cafe', test: (_, n) => DELIVERY.test(n) },
  { id: 'lunch', categoryId: 'sc_cafe', test: (op) => weekday(op.date) && -op.amount >= LUNCH_MIN && -op.amount <= LUNCH_MAX },
  { id: 'marketplace', categoryId: 'sc_shopping', test: (op, n) => MARKETPLACE.test(n) && -op.amount <= MARKETPLACE_MAX },
]

/** Привычка операции или null: только трата (`isSpend`), не перевод человеку. */
export function habitOf(op: Operation): HabitId | null {
  if (!isSpend(op) || op.counterparty) return null
  const name = normalizeMerchant(op.merchant)
  return HABITS.find((h) => h.categoryId === op.categoryId && h.test(op, name))?.id ?? null
}

/** Итоги привычек участника за месяц `YYYY-MM`: ниже порога — не пишется. */
export function habitTotals(ops: Operation[], by: PersonId, period: string, at = new Date().toISOString()): HabitTotal[] {
  const out = new Map<HabitId, HabitTotal>()
  for (const op of ops) {
    if (op.date.slice(0, 7) !== period) continue
    const habit = habitOf(op)
    if (!habit) continue
    const t = out.get(habit) ?? { id: `${by}:${period}:${habit}`, by, period, habit, count: 0, amount: 0, updatedAt: at }
    t.count += 1
    t.amount += -op.amount
    out.set(habit, t)
  }
  return [...out.values()].filter((t) => t.count >= HABIT_MIN_PER_MONTH[t.habit]).sort((a, b) => a.habit.localeCompare(b.habit))
}

/** Самый ранний месяц, который участник держит: от его последнего месяца с итогом или записью назад. */
export function habitKeepFrom(periods: string[]): string | null {
  const last = periods.reduce<string | null>((m, p) => (!m || p > m ? p : m), null)
  return last ? addMonths(last, -(HABIT_KEEP_MONTHS - 1)) : null
}
