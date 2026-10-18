import { addMonths } from '@/lib/dates'
import { amountAt, SPEND_LAST } from '@/lib/finance'
import type { Credit, Obligation, PersonId, RateBook } from '@/types/finance'
import { UNKNOWN_CATEGORY, plannedElsewhere } from './dictionary'
import { detectRecurring } from './firstRun'
import { habitKeepFrom, habitOf } from './habits'
import { dayNumber, entrepreneurName, isSpend, normalizeMerchant, ruleFor } from './model'
import type { MerchantRule, Operation, ReviewFind, SpendCategory } from './types'

// Находки по операциям (бэклог «Разбор», Р-13, Р-14, RZ-01): каждый телефон ищет их по своим операциям — операции
// личные и есть только у участника. В общий документ уходят итоги месяца: продавец (как печатает банк после `sanitize`,
// ≤ 40 знаков), раздел, счётчик, сумма, у подорожания — «было». Не уходят: даты операций, переводы людям
// (`counterparty`), внутренние, «ИП + фамилия» (`entrepreneurName`) и названия с 6+ цифрами. Находки семьи, цену в год,
// образы и сценарий считает `finance.ts` по документу (правило 6). Пороги — константы, владелец правит числом.

/** Утечка: продавец с ≥ 6 операций в месяц при среднем чеке ≤ 8 000 ₸ (привычки Блока 7 — мимо). */
export const LEAK_MIN_COUNT = 6
export const LEAK_MAX_AVG = 8_000
/** Двойное: два списания одного продавца одной суммы ≥ 1 000 ₸ в ≤ 3 дня одного месяца. */
export const DOUBLE_MIN = 1_000
export const DOUBLE_DAYS = 3
/**
 * Двойное — только у нечастого продавца (≤ 4 операций в месяце) и не у привычек: столовая и такси с одной ценой каждый
 * день — не двойное списание (уточнение исполнителя RZ-01, Handoff).
 */
export const DOUBLE_MAX_OPS = 4
/**
 * Регулярное — не чаще 2 раз в любом месяце окна и (словарный раздел или списания в ≥ 2 разных месяцах): частый продавец
 * с повторяющимся чеком — не подписка (уточнение исполнителя RZ-01, Handoff).
 */
export const RECURRING_MAX_PER_MONTH = 2
/** Подорожание: списание по правилу платежа больше плана месяца на ≥ 10 % и ≥ 500 ₸. */
export const PRICIER_SHARE = 10
export const PRICIER_MIN = 500
/** На участника в месяц: утечек, верхушек разделов, списаний (новые + подорожания + двойные). */
export const FINDS_MAX = { leak: 5, top: 5, dues: 6 } as const
export const FIND_NAME_MAX = 40
/** Сколько закрытых месяцев до месяца находки смотрит поиск повторов. */
const DUE_MONTHS = 3

/** Окно месяцев находок — как у итогов привычек (`HABIT_KEEP_MONTHS`). */
export const findKeepFrom = habitKeepFrom

type Categories = Pick<SpendCategory, 'id' | 'plannedElsewhere'>[]

export type DueCtx = {
  /** Правила семьи — личный документ (`financeStore.merchantRules`). */
  rules: MerchantRule[]
  obligations: Obligation[]
  credits: Pick<Credit, 'id' | 'name' | 'deletedAt'>[]
  book?: RateBook | null
}

const clipName = (name: string) => name.trim().slice(0, FIND_NAME_MAX).trim()
const keyOf = (op: Operation) => normalizeMerchant(op.merchant).slice(0, FIND_NAME_MAX)
const inMonth = (op: Operation, period: string) => op.date.slice(0, 7) === period

/**
 * Продавец, которого можно назвать в документе и модели: трата, не перевод человеку, не внутренний, без 6+ цифр, не
 * «ИП + фамилия»; `categories` — ещё и раздел не из плана (кредиты, аренда, подписки — для утечек и верхушек).
 */
export function sellerOk(op: Operation, categories?: Categories): boolean {
  if (!isSpend(op) || op.counterparty || op.internal) return false
  const name = op.merchant.trim()
  if (!name || /\d{6,}/.test(name) || entrepreneurName(name)) return false
  return !(categories && op.categoryId && plannedElsewhere(op.categoryId, categories))
}

const find = (by: PersonId, period: string, kind: ReviewFind['kind'], key: string, rest: Omit<ReviewFind, 'id' | 'by' | 'period' | 'kind' | 'updatedAt'>, at: string): ReviewFind => ({
  id: `${by}:${period}:${kind}:${key}`,
  by,
  period,
  kind,
  ...rest,
  updatedAt: at,
})

/** Группы операций по нормализованному продавцу; название и раздел — у последней по дате. */
function bySeller(ops: Operation[]): Map<string, Operation[]> {
  const out = new Map<string, Operation[]>()
  for (const op of ops) {
    const key = keyOf(op)
    if (!key) continue
    const list = out.get(key)
    if (list) list.push(op)
    else out.set(key, [op])
  }
  return out
}
const latest = (list: Operation[]) => list.reduce((a, b) => (b.date > a.date ? b : a))

/** Утечки участника за месяц: частые мелкие траты у одного продавца; до 5 по сумме. */
export function leakFinds(ops: Operation[], by: PersonId, period: string, categories: Categories = [], at = new Date().toISOString()): ReviewFind[] {
  const mine = ops.filter((op) => inMonth(op, period) && sellerOk(op, categories) && habitOf(op) === null)
  const out: ReviewFind[] = []
  for (const [key, list] of bySeller(mine)) {
    const amount = list.reduce((s, op) => s - op.amount, 0)
    if (list.length < LEAK_MIN_COUNT || amount > LEAK_MAX_AVG * list.length) continue
    const last = latest(list)
    out.push(find(by, period, 'leak', key, { name: clipName(last.merchant), categoryId: last.categoryId, count: list.length, amount }, at))
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, FINDS_MAX.leak)
}

/** Верхушки разделов участника за месяц: сумма, число операций и две крупнейшие покупки; до 5 разделов по сумме. */
export function topFinds(ops: Operation[], by: PersonId, period: string, categories: Categories = [], at = new Date().toISOString()): ReviewFind[] {
  const groups = new Map<string, Operation[]>()
  for (const op of ops) {
    if (!inMonth(op, period) || !isSpend(op) || !op.categoryId) continue
    const c = op.categoryId
    if (c === UNKNOWN_CATEGORY || SPEND_LAST.includes(c) || plannedElsewhere(c, categories)) continue
    const list = groups.get(c)
    if (list) list.push(op)
    else groups.set(c, [op])
  }
  const out: ReviewFind[] = []
  for (const [categoryId, list] of groups) {
    const amount = list.reduce((s, op) => s - op.amount, 0)
    // В покупки — только те, что можно назвать (без людей и ИП); в сумму и счётчик — все траты раздела.
    const top = list
      .filter((op) => sellerOk(op))
      .sort((a, b) => a.amount - b.amount || a.date.localeCompare(b.date))
      .slice(0, 2)
      .map((op) => ({ name: clipName(op.merchant), amount: -op.amount }))
    out.push(find(by, period, 'top', categoryId, { name: '', categoryId, count: list.length, amount, top }, at))
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, FINDS_MAX.top)
}

/** Правило платежа операции (обязательство, кредит, зарплата) или null. */
const paymentOf = (op: Operation, rules: MerchantRule[]) => {
  const to = ruleFor(op, rules)?.to
  return to && 'payment' in to ? to.payment : null
}

/**
 * Списания участника за месяц: новые регулярные (`detectRecurring` по 3 закрытым месяцам и этому, которых нет в плане —
 * ни правила платежа, ни обязательства / кредита того же продавца), подорожания (списание по правилу платежа
 * обязательства больше плана месяца) и двойные; вместе — до 6 по сумме.
 */
export function dueFinds(ops: Operation[], by: PersonId, period: string, ctx: DueCtx, at = new Date().toISOString()): ReviewFind[] {
  const from = addMonths(period, -DUE_MONTHS)
  const window = ops.filter((op) => op.date.slice(0, 7) >= from && op.date.slice(0, 7) <= period && sellerOk(op))
  const out: ReviewFind[] = []
  const planned = new Set(
    [...ctx.obligations, ...ctx.credits].filter((x) => !x.deletedAt).map((x) => normalizeMerchant(x.name)),
  )

  // Новые регулярные: повтор с операцией в этом месяце, ни одной строки по правилу платежа.
  const byKey = bySeller(window)
  for (const c of detectRecurring(window)) {
    const key = c.key.startsWith('m:') ? c.key.slice(2).slice(0, FIND_NAME_MAX) : ''
    const list = byKey.get(key)
    if (!key || !list || planned.has(key)) continue
    const now = list.filter((op) => inMonth(op, period))
    if (!now.length || list.some((op) => paymentOf(op, ctx.rules))) continue
    const perMonth = new Map<string, number>()
    for (const op of list) perMonth.set(op.date.slice(0, 7), (perMonth.get(op.date.slice(0, 7)) ?? 0) + 1)
    if (Math.max(...perMonth.values()) > RECURRING_MAX_PER_MONTH || (c.kind === 'obligation' && perMonth.size < 2)) continue
    const last = latest(now)
    out.push(find(by, period, 'recurring', key, { name: clipName(last.merchant), categoryId: last.categoryId, count: c.count, amount: c.amount }, at))
  }

  // Подорожания: строка месяца по правилу платежа обязательства дороже плана месяца.
  const pricier = new Map<string, ReviewFind>()
  for (const op of window) {
    if (!inMonth(op, period)) continue
    const p = paymentOf(op, ctx.rules)
    if (p?.kind !== 'obligation') continue
    const o = ctx.obligations.find((x) => x.id === p.targetId && !x.deletedAt)
    if (!o) continue
    const was = amountAt(o, period, ctx.book)
    const paid = -op.amount
    if (was <= 0 || paid * 100 < was * (100 + PRICIER_SHARE) || paid - was < PRICIER_MIN) continue
    const key = keyOf(op)
    const prev = pricier.get(key)
    if (prev && prev.amount >= paid) continue
    pricier.set(key, find(by, period, 'pricier', key, { name: clipName(op.merchant), categoryId: op.categoryId, count: 1, amount: paid, was, targetId: o.id }, at))
  }
  out.push(...pricier.values())

  // Двойные: одна сумма одного продавца дважды за ≤ 3 дня внутри месяца.
  for (const [key, month] of bySeller(window.filter((op) => inMonth(op, period)))) {
    if (month.length > DOUBLE_MAX_OPS) continue
    const list = month.filter((op) => -op.amount >= DOUBLE_MIN && habitOf(op) === null)
    const sums = new Map<number, Operation[]>()
    for (const op of list) sums.set(op.amount, [...(sums.get(op.amount) ?? []), op])
    let best: ReviewFind | null = null
    for (const [amount, same] of sums) {
      if (same.length < 2) continue
      const days = same.map((op) => dayNumber(op.date)).sort((a, b) => a - b)
      const hit = new Set<number>()
      for (let i = 1; i < days.length; i++) {
        if (days[i] - days[i - 1] <= DOUBLE_DAYS) {
          hit.add(i - 1)
          hit.add(i)
        }
      }
      if (!hit.size || (best && best.amount >= -amount)) continue
      const last = latest(same)
      best = find(by, period, 'double', key, { name: clipName(last.merchant), categoryId: last.categoryId, count: hit.size, amount: -amount }, at)
    }
    if (best) out.push(best)
  }

  return out.sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id)).slice(0, FINDS_MAX.dues)
}

/** Все находки участника за месяц `period` — по виду и id. */
export function reviewFinds(ops: Operation[], by: PersonId, period: string, ctx: DueCtx & { categories: Categories }, at = new Date().toISOString()): ReviewFind[] {
  return [
    ...leakFinds(ops, by, period, ctx.categories, at),
    ...topFinds(ops, by, period, ctx.categories, at),
    ...dueFinds(ops, by, period, ctx, at),
  ].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

/** Итог тот же, что в документе: запись не нужна (B2C-25 — открытие ревизию не растит). */
export function sameFind(a: ReviewFind | undefined, b: ReviewFind): boolean {
  if (!a || a.deletedAt) return false
  return (
    a.name === b.name &&
    a.categoryId === b.categoryId &&
    a.count === b.count &&
    a.amount === b.amount &&
    (a.was ?? null) === (b.was ?? null) &&
    (a.targetId ?? null) === (b.targetId ?? null) &&
    JSON.stringify(a.top ?? null) === JSON.stringify(b.top ?? null)
  )
}
