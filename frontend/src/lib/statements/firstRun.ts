import type { Operation } from './types'
import { categorize, normalizeCounterparty, normalizeMerchant } from './model'
import { AMOUNT_TOLERANCE, SALARY_TOLERANCE } from './matching'

/**
 * Первый запуск из выписки (Р-7, B2C-19): по операциям одной выписки приложение само находит
 * доход и повторяющиеся списания и спрашивает по одному — не больше `QUESTION_LIMIT` вопросов;
 * повторы за лимитом пока нигде не спрашиваются (хвост §4 индекса, критик Б3). Чистые функции:
 * денег не считают, только группируют.
 */
export const QUESTION_LIMIT = 7

/** Приход, похожий на зарплату: крупный или регулярный. */
export type IncomeCandidate = {
  /** Ключ группы — нормализованный отправитель или продавец. */
  key: string
  /** Как печатает банк (последняя операция группы). */
  name: string
  /** Типичная сумма (медиана), целые тенге. */
  amount: number
  /** Типичный день месяца (медиана). */
  day: number
  count: number
  /** Суммы в группе близки (±15 %) и их ≥ 2. */
  regular: boolean
  opIds: string[]
}

export type RecurringKind = 'credit' | 'rent' | 'utilities' | 'subscription' | 'obligation'

/** Повторяющееся списание с предложенным видом записи. */
export type RecurringCandidate = {
  key: string
  name: string
  amount: number
  day: number
  count: number
  kind: RecurringKind
  /** Раздел трат по словарю (правил семьи у новой семьи ещё нет). */
  categoryId: string | null
  /** Раздел бюджета для обязательства: жильё, кредиты, быт. */
  budget: 'd1' | 'd2' | 'd4'
  opIds: string[]
}

export type FirstRunQuestion = { type: 'income'; candidate: IncomeCandidate } | { type: 'recurring'; candidate: RecurringCandidate }

const INCOME_TOLERANCE = 0.15
const RECURRING_TOLERANCE = 0.05
const DAY_TOLERANCE = 3
const BIG_SHARE = 0.5
/** Мелочь регулярной не считается: чеки самообслуживания и проезд повторяются каждый день. */
const MIN_RECURRING = 500

const KIND_BY_CATEGORY: Record<string, RecurringKind> = {
  sc_credit: 'credit',
  sc_rent: 'rent',
  sc_utilities: 'utilities',
  sc_telecom: 'subscription',
  sc_subscriptions: 'subscription',
}

/** Раздел бюджета по виду регулярного платежа; `Start` берёт его же, когда вид меняют чипом. */
export const BUDGET_BY_KIND: Record<RecurringKind, RecurringCandidate['budget']> = {
  credit: 'd2',
  rent: 'd1',
  utilities: 'd1',
  subscription: 'd4',
  obligation: 'd4',
}

/** Кредит наличными и прочие выдачи — приход, но не доход. */
const NOT_INCOME = /кредит|займ|рассрочк|loan|credit/iu

export const groupKey = (op: Pick<Operation, 'merchant' | 'counterparty'>) =>
  op.counterparty ? `c:${normalizeCounterparty(op.counterparty)}` : `m:${normalizeMerchant(op.merchant)}`

const median = (list: number[]) => {
  const s = [...list].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const dayOf = (op: Operation) => Number(op.date.slice(8, 10)) || 1
const close = (values: number[], center: number, tolerance: number) => values.filter((v) => Math.abs(v - center) <= center * tolerance).length

function groups(ops: Operation[]): Map<string, Operation[]> {
  const out = new Map<string, Operation[]>()
  for (const op of ops) {
    const key = groupKey(op)
    const list = out.get(key)
    if (list) list.push(op)
    else out.set(key, [op])
  }
  return out
}

/** Кандидаты дохода: приходы не от своих счетов; регулярные первыми, затем по сумме. */
export function detectIncome(ops: Operation[]): IncomeCandidate[] {
  const incoming = ops.filter((o) => o.amount > 0 && !o.internal && (o.kind === 'income' || o.kind === 'transfer-in') && !NOT_INCOME.test(o.merchant))
  if (!incoming.length) return []
  const max = Math.max(...incoming.map((o) => o.amount))
  const out: IncomeCandidate[] = []
  for (const [key, list] of groups(incoming)) {
    const amounts = list.map((o) => o.amount)
    const amount = median(amounts)
    const regular = list.length >= 2 && close(amounts, amount, INCOME_TOLERANCE) >= 2
    const big = Math.max(...amounts) >= max * BIG_SHARE
    if (!regular && !big) continue
    const typical = regular ? amount : Math.max(...amounts)
    const days = list.filter((o) => o.amount === typical || regular).map(dayOf)
    out.push({ key, name: list[0].counterparty ?? list[0].merchant, amount: typical, day: median(days), count: list.length, regular, opIds: list.map((o) => o.id) })
  }
  return out.sort((a, b) => Number(b.regular) - Number(a.regular) || b.amount - a.amount)
}

/** Операция месяца `month` со знаком `sign` в допуске суммы `amount`, ближайшая к ней. */
function closestOfMonth(ops: Operation[], amount: number, month: string, tolerance: number, sign: 1 | -1): Operation | undefined {
  let best: Operation | undefined
  for (const o of ops) {
    if (Math.sign(o.amount) !== sign || !o.date.startsWith(month)) continue
    const gap = Math.abs(Math.abs(o.amount) - amount)
    if (gap > amount * tolerance) continue
    if (!best || gap < Math.abs(Math.abs(best.amount) - amount)) best = o
  }
  return best
}

/**
 * Операция, которой первый запуск отмечает зарплату месяца (возврат приёмки п. 7): приход
 * отправителя в месяце `month` в допуске оклада (`SALARY_TOLERANCE`, как правило зарплаты в
 * «Неделе»), ближайший к окладу. Такого нет (в этом месяце от него только мелкий перевод) — месяц
 * не отмечается: иначе отметка и история врали бы суммой.
 */
export function salaryOpOfMonth(ops: Operation[], salary: number, month: string): Operation | undefined {
  return closestOfMonth(ops, salary, month, SALARY_TOLERANCE, 1)
}

/**
 * Операция, которой первый запуск отмечает платёж месяца по «Записать» (возврат приёмки 2 п. 2):
 * списание в допуске суммы, ближайшее к ней — ±2 %, как правило платежа (`ruleHit`); у оценки
 * (коммуналка) — ближайшее списание месяца любой суммы, как у правила (зимой уходит за 30 %):
 * иначе строка вне допуска ушла бы в плановый раздел правилом, а месяц остался бы «не оплачен»
 * (критик возврата 2). Такого нет — месяц не отмечается: под «Переводом с карты на карту»
 * Freedom первая строка месяца — любой перевод (2 000 при обязательстве 15 000).
 */
export function paymentOpOfMonth(ops: Operation[], amount: number, month: string, estimate = false): Operation | undefined {
  return closestOfMonth(ops, amount, month, estimate ? Infinity : AMOUNT_TOLERANCE, -1)
}

/**
 * Повторяющиеся списания: кредиты, аренда, коммуналка, связь и подписки — по словарю даже с
 * одного раза; прочие продавцы — при ≥ 2 списаниях близкой суммы в близкие дни. Переводы
 * людям и внутренние — мимо.
 */
export function detectRecurring(ops: Operation[]): RecurringCandidate[] {
  const outgoing = ops.filter((o) => o.amount < 0 && !o.internal && !o.counterparty && (o.kind === 'purchase' || o.kind === 'transfer-out' || o.kind === 'other'))
  const out: RecurringCandidate[] = []
  for (const [key, list] of groups(outgoing)) {
    const amounts = list.map((o) => -o.amount)
    const amount = median(amounts)
    if (amount < MIN_RECURRING) continue
    const categoryId = categorize(list[0], []).categoryId
    const known = categoryId ? KIND_BY_CATEGORY[categoryId] : undefined
    const days = list.map(dayOf)
    const day = median(days)
    const steady = list.length >= 2 && close(amounts, amount, RECURRING_TOLERANCE) >= 2 && days.filter((d) => Math.abs(d - day) <= DAY_TOLERANCE).length >= 2
    const kind: RecurringKind | null = known ?? (steady ? 'obligation' : null)
    if (!kind) continue
    out.push({ key, name: list[0].merchant, amount, day, count: list.length, kind, categoryId, budget: BUDGET_BY_KIND[kind], opIds: list.map((o) => o.id) })
  }
  return out.sort((a, b) => b.amount - a.amount)
}

/** Вопросы первого запуска: доход первым, затем повторы по сумме; не больше лимита. */
export function firstRunQuestions(ops: Operation[], limit = QUESTION_LIMIT): FirstRunQuestion[] {
  const out: FirstRunQuestion[] = []
  const income = detectIncome(ops)[0]
  if (income) out.push({ type: 'income', candidate: income })
  for (const candidate of detectRecurring(ops)) {
    if (out.length >= limit) break
    out.push({ type: 'recurring', candidate })
  }
  return out
}

/** Сколько повторов осталось за лимитом первого запуска. */
export function beyondLimit(ops: Operation[], limit = QUESTION_LIMIT): number {
  const total = (detectIncome(ops).length ? 1 : 0) + detectRecurring(ops).length
  return Math.max(0, total - limit)
}
