import type { Credit, Obligation, Payment, Person, PersonId } from '@/types/finance'
import type { MerchantRule, Operation, PaymentRule } from './types'
import { ruleFor } from './model'
import { amountAt, creditDueAmount, dueIn, isSubscription, liveCredits, liveObligations, paidFor, salaryAt } from '@/lib/finance'
import { addMonths, dayLabel, daysInMonth, monthKey } from '@/lib/dates'
import { money } from '@/lib/money'

/**
 * Сопоставление строк выписки с отметками (Р-6, B2C-15): «похоже, это платёж по Автокредиту —
 * отметить?», «это зарплата Ильяса?». Чистые функции: предложения считаются здесь, запись
 * `payments` и правило пишет стор. Одна операция — не больше одного предложения (лучшее);
 * одна пара «цель · месяц» — не больше одного; отмеченный месяц и операции, уже привязанные к
 * отметке (`Payment.opId`, в том числе снятой), пропускаются. Зарплату отмечает только сам
 * участник (RP-10: «каждый отмечает свою»): кандидаты и правила зарплаты — только для `me`,
 * слота владельца телефона (выписка — его); без `me` зарплата не предлагается.
 */
export type MatchKind = PaymentRule['kind']

export interface MatchCandidate {
  opId: string
  kind: MatchKind
  targetId: string
  /** Месяц платежа по графику. */
  period: string
  /** Сумма операции, целые тенге, без знака. */
  amount: number
  /** `rule` — правило семьи, отмечается без вопроса; `likely` — спросить. */
  confidence: 'rule' | 'likely'
  question: string
  meta: string
  /** Раздел трат для операции при «да»; null — оставить по словарю. */
  categoryId: string | null
  subscription?: boolean
}

/** Допуск суммы обязательства с точной суммой и кредита. */
export const AMOUNT_TOLERANCE = 0.02
/** Допуск суммы обязательства-оценки (коммуналка плавает). */
export const ESTIMATE_TOLERANCE = 0.3
/** Допуск суммы зарплаты (премия, вычеты). */
export const SALARY_TOLERANCE = 0.1
/** Окно дат вокруг дня платежа, дней. */
export const DAY_WINDOW = 5
/** Окно дат вокруг дня зарплаты, дней. */
export const SALARY_WINDOW = 7

const DAY_MS = 86_400_000
const dayNo = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS
const within = (actual: number, expected: number, tolerance: number) => expected > 0 && Math.abs(actual - expected) <= expected * tolerance

/** Ближайший к дате операции месяц с днём платежа `day` и расстояние до него в днях. */
export function nearestPeriod(date: string, day: number): { period: string; gap: number } {
  const month = date.slice(0, 7)
  let best = { period: month, gap: Infinity }
  for (const period of [addMonths(month, -1), month, addMonths(month, 1)]) {
    const d = Math.min(day, daysInMonth(period))
    const gap = Math.abs(dayNo(date) - dayNo(`${period}-${String(d).padStart(2, '0')}`))
    if (gap < best.gap) best = { period, gap }
  }
  return best
}

/** Раздел трат операции, отмеченной платежом (плановые разделы — `plannedElsewhere`). */
export function matchCategory(kind: MatchKind, target: Obligation | Credit | Person): string | null {
  if (kind === 'credit') return 'sc_credit'
  if (kind !== 'obligation') return null
  const o = target as Obligation
  if (o.category === 'd2') return 'sc_credit'
  if (o.category === 'd1') return o.estimate ? 'sc_utilities' : 'sc_rent'
  if (isSubscription(o)) return 'sc_subscriptions'
  return null
}

/** Цели правил платежа: обязательства, кредиты, участники (для зарплаты). */
type RuleTargets = { obligations: Obligation[]; credits: Credit[]; people: Person[] }

/**
 * «Такая» строка правила «это платёж по …» (Р-6: «дальше *такие* строки отмечаются сами»): знак и
 * сумма в допуске — зарплата ±10 % оклада, кредит ±2 % `creditDueAmount` или ровно платёж,
 * обязательство ±2 % суммы месяца; оценка (коммуналка) суммой не ограничена — зимой уходит за
 * 30 %. Окна дат нет: поздний платёж — тоже платёж. Под одним продавцом идут и зарплата, и мелкие
 * пополнения, и платежи всех кредитов Kaspi, а «Перевод с карты на карту» Freedom — все переводы
 * подряд. Нет цели или строка не такая — null.
 */
export function ruleHit(op: Operation, payment: PaymentRule, targets: RuleTargets): { target: Obligation | Credit | Person; period: string } | null {
  const amount = Math.abs(op.amount)
  if (payment.kind === 'salary') {
    const p = targets.people.find((x) => x.id === payment.targetId)
    if (!p || op.amount <= 0) return null
    const { period } = nearestPeriod(op.date, p.payday)
    return within(amount, salaryAt(p, period), SALARY_TOLERANCE) ? { target: p, period } : null
  }
  if (op.amount >= 0) return null
  if (payment.kind === 'credit') {
    const c = targets.credits.find((x) => x.id === payment.targetId)
    if (!c || !(within(amount, creditDueAmount(c), AMOUNT_TOLERANCE) || amount === c.payment)) return null
    return { target: c, period: nearestPeriod(op.date, c.day).period }
  }
  const o = targets.obligations.find((x) => x.id === payment.targetId)
  if (!o) return null
  const { period } = nearestPeriod(op.date, o.day)
  return o.estimate || within(amount, amountAt(o, period), AMOUNT_TOLERANCE) ? { target: o, period } : null
}

/**
 * Проверка для `applyRules` (возврат приёмки 2 п. 2): плановый раздел правила платежа — только
 * «таким» строкам (`ruleHit`), остальные строки продавца — траты по словарю или незнакомое. Иначе
 * правило на «Перевод с карты на карту» 15 000 убирало из «Свободно» все переводы месяца. Кредит —
 * и закрытый: его последний платёж остаётся в плане месяца.
 */
export function paymentFits(state: { obligations?: Obligation[]; credits?: Credit[] }): (op: Operation, payment: PaymentRule) => boolean {
  const targets = { obligations: liveObligations(state.obligations ?? []), credits: liveCredits(state.credits ?? []), people: [] }
  return (op, payment) => ruleHit(op, payment, targets) !== null
}

const key = (c: Pick<MatchCandidate, 'kind' | 'targetId' | 'period'>) => `${c.kind}:${c.targetId}:${c.period}`

/** Ключ решения «нет» на этот месяц — помнит устройство (стор). */
export const matchKey = key

export function matchCandidates(
  ops: Operation[],
  state: { obligations?: Obligation[]; credits?: Credit[]; people?: Person[]; payments?: Payment[] },
  rules: MerchantRule[],
  me?: PersonId,
): MatchCandidate[] {
  const payments = state.payments ?? []
  const obligations = liveObligations(state.obligations ?? [])
  const credits = liveCredits(state.credits ?? []).filter((c) => c.principal > 0)
  // Чужая зарплата — не кандидат и правилом не применяется: иначе приход A закрыл бы месяц B.
  const people = (state.people ?? []).filter((p) => !p.deletedAt && p.id === me)
  const linked = new Set(payments.map((p) => p.opId).filter((id): id is string => !!id))
  const taken = new Set<string>()
  const out: MatchCandidate[] = []

  // Вторая строка — факт из выписки: сумма и дата операции, строка банка (DESIGN.md §6).
  const when = (op: Operation) => dayLabel(Number(op.date.slice(8, 10)), op.date.slice(0, 7))
  const text = (kind: MatchKind, name: string, op: Operation) =>
    kind === 'salary'
      ? { question: `Это зарплата ${name}?`, meta: `${money(Math.abs(op.amount))} · ${when(op)} · поступление` }
      : { question: `Похоже, это платёж по ${name} — отметить?`, meta: `${money(Math.abs(op.amount))} · ${when(op)} · «${op.merchant}»` }

  for (const op of ops) {
    if (op.internal || linked.has(op.id)) continue
    const amount = Math.abs(op.amount)
    let best: (MatchCandidate & { score: number }) | null = null
    const consider = (c: MatchCandidate & { score: number }) => {
      if (paidFor(payments, c.kind, c.targetId, c.period) || taken.has(key(c))) return
      if (!best || c.score < best.score) best = c
    }

    // Правило семьи — без вопроса, но только «такая» строка (`ruleHit`: знак и сумма в допуске),
    // иначе месяц отметился бы чужой суммой. Не прошедшая строка идёт к эвристикам ниже и может
    // стать вопросом.
    const rule = ruleFor(op, rules)
    const hit = rule && 'payment' in rule.to ? ruleHit(op, rule.to.payment, { obligations, credits, people }) : null
    if (rule && 'payment' in rule.to && hit) {
      const { kind, targetId, categoryId } = rule.to.payment
      consider({ opId: op.id, kind, targetId, period: hit.period, amount, confidence: 'rule', categoryId: categoryId ?? matchCategory(kind, hit.target), ...text(kind, hit.target.name, op), score: -1 })
    }

    if (!best && op.amount < 0) {
      for (const o of obligations) {
        const { period, gap } = nearestPeriod(op.date, o.day)
        if (gap > DAY_WINDOW || !dueIn(o, period)) continue
        const expected = amountAt(o, period)
        if (!within(amount, expected, o.estimate ? ESTIMATE_TOLERANCE : AMOUNT_TOLERANCE)) continue
        consider({
          opId: op.id, kind: 'obligation', targetId: o.id, period, amount, confidence: 'likely',
          categoryId: matchCategory('obligation', o), subscription: isSubscription(o) || undefined,
          ...text('obligation', o.name, op), score: Math.abs(amount - expected) / expected + gap / 100,
        })
      }
      for (const c of credits) {
        const { period, gap } = nearestPeriod(op.date, c.day)
        if (gap > DAY_WINDOW) continue
        const due = creditDueAmount(c)
        if (!within(amount, due, AMOUNT_TOLERANCE) && amount !== c.payment) continue
        consider({
          opId: op.id, kind: 'credit', targetId: c.id, period, amount, confidence: 'likely', categoryId: 'sc_credit',
          ...text('credit', c.name, op), score: Math.abs(amount - due) / due + gap / 100,
        })
      }
    }

    if (!best && op.amount > 0 && (op.kind === 'transfer-in' || op.kind === 'income')) {
      for (const p of people) {
        const { period, gap } = nearestPeriod(op.date, p.payday)
        if (gap > SALARY_WINDOW) continue
        const expected = salaryAt(p, period)
        if (!within(amount, expected, SALARY_TOLERANCE)) continue
        consider({
          opId: op.id, kind: 'salary', targetId: p.id, period, amount, confidence: 'likely', categoryId: null,
          ...text('salary', p.name, op), score: Math.abs(amount - expected) / expected + gap / 100,
        })
      }
    }

    if (best) {
      const { score: _score, ...candidate } = best as MatchCandidate & { score: number }
      taken.add(key(candidate))
      out.push(candidate)
    }
  }
  return out
}

/**
 * Момент отметки по строке выписки (`Payment.at`): полдень дня операции по Алматы, ISO UTC, как
 * остальные `at`; не позже «сейчас» — строка выписки не из будущего. Отметка с моментом «сейчас»
 * встала бы после сверки остатка кредита (`principalSetAt`) и уменьшила бы долг ещё раз на
 * платёж, который сверенный остаток уже учёл (первый запуск, выписка за прошлые месяцы).
 */
export function operationAt(date: string, now = Date.now()): string {
  return new Date(Math.min(Date.parse(`${date}T12:00:00+05:00`), now)).toISOString()
}

/**
 * Операции со снятой отметкой (B2C-15 п. 3): запись с `opId` — надгробие, живой записи с этой
 * операцией нет и месяц той пары снова не отмечен. Им правило платежа раздел не ставит
 * (`applyRules`), и они возвращаются в траты. Правка отметки (`editPaid`) переносит `opId` в новую
 * запись — операция не освобождается; месяц отметили снова вручную — операция и есть этот платёж.
 * Месяц отметила другая строка выписки («снял ошибочное — принял верное») — платёж она, снятая
 * остаётся тратой (критик возврата Блока 3).
 */
export function releasedOps(payments: Payment[]): Set<string> {
  const pair = (p: Payment) => `${p.kind}:${p.targetId}:${p.period}`
  const live = payments.filter((p) => !p.deletedAt)
  const linked = new Set(live.map((p) => p.opId).filter((id): id is string => !!id))
  const paid = new Set(live.filter((p) => !p.opId).map(pair))
  const out = new Set<string>()
  for (const p of payments) if (p.deletedAt && p.opId && !linked.has(p.opId) && !paid.has(pair(p))) out.add(p.opId)
  return out
}

/** Операции недавних месяцев — только их есть смысл сопоставлять (этот и прошлый месяц). */
export function recentOperations(ops: Operation[], now = monthKey()): Operation[] {
  const from = `${addMonths(now, -1)}-01`
  return ops.filter((o) => o.date >= from)
}
