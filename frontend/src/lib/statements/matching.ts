import type { AccountShift, Credit, FxExchange, Obligation, Payment, Person, PersonId, RateBook } from '@/types/finance'
import type { MerchantRule, Operation, PaymentRule } from './types'
import { dayNumber, isHand, ruleFor, type PaymentAmount } from './model'
import { amountAt, creditDueAmount, dueIn, expectedEventTenge, isSubscription, liveCredits, liveExchanges, liveObligations, paidFor, payEventOf, payEvents, type PayEvent, type SalaryCtx } from '@/lib/finance'
import { addMonths, dayLabel, daysInMonth, monthKey, todayIso } from '@/lib/dates'
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
/** Допуск плавающей зарплаты (Р-6, понятность Б7): сумма меняется — от среднего трёх последних. */
export const SALARY_FLOATING_TOLERANCE = 0.3
/** Окно дат вокруг дня платежа, дней. */
export const DAY_WINDOW = 5
/** Окно дат вокруг дня зарплаты, дней. */
export const SALARY_WINDOW = 7

const within = (actual: number, expected: number, tolerance: number) => expected > 0 && Math.abs(actual - expected) <= expected * tolerance

/** Ближайший к дате операции месяц с днём платежа `day` и расстояние до него в днях. */
export function nearestPeriod(date: string, day: number): { period: string; gap: number } {
  const month = date.slice(0, 7)
  let best = { period: month, gap: Infinity }
  for (const period of [addMonths(month, -1), month, addMonths(month, 1)]) {
    const d = Math.min(day, daysInMonth(period))
    const gap = Math.abs(dayNumber(date) - dayNumber(`${period}-${String(d).padStart(2, '0')}`))
    if (gap < best.gap) best = { period, gap }
  }
  return best
}

/**
 * Ближайший к дате операции приход зарплаты по ритму (понятность Б7, Р-5): события `payEvents` прошлого, этого и
 * следующего месяца; месячный ритм — тот же ответ, что `nearestPeriod` по дню зарплаты. Нет событий — null.
 */
export function nearestEvent(date: string, p: Person): { event: PayEvent; gap: number } | null {
  const month = date.slice(0, 7)
  let best: { event: PayEvent; gap: number } | null = null
  for (const key of [addMonths(month, -1), month, addMonths(month, 1)]) {
    for (const event of payEvents(p, key)) {
      const gap = Math.abs(dayNumber(date) - dayNumber(event.day))
      if (!best || gap < best.gap) best = { event, gap }
    }
  }
  return best
}

/** Зарплата в допуске прихода `event`: ±10 % ожидаемого, плавающая — ±30 % от среднего (`expectedEventTenge`). */
function salaryFits(amount: number, p: Person, event: PayEvent, ctx?: SalaryCtx): boolean {
  return within(amount, expectedEventTenge(p, event, ctx), p.floating ? SALARY_FLOATING_TOLERANCE : SALARY_TOLERANCE)
}

/** Вопрос по приходу: «Это аванс Ильяса?», «Это зарплата Ильяса за неделю?», иначе «Это зарплата Ильяса?». */
export const salaryQuestion = (name: string, kind: PayEvent['kind'] = 'salary') =>
  kind === 'advance' ? `Это аванс ${name}?` : kind === 'week' ? `Это зарплата ${name} за неделю?` : `Это зарплата ${name}?`

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
type RuleTargets = { obligations: Obligation[]; credits: Credit[]; people: Person[]; salary?: SalaryCtx }

/**
 * «Такая» строка правила «это платёж по …» (Р-6: «дальше *такие* строки отмечаются сами»): знак и
 * сумма в допуске — зарплата ±10 % ближайшего прихода по ритму (плавающая — ±30 % среднего; Б7), кредит ±2 % `creditDueAmount` или ровно платёж,
 * обязательство ±2 % суммы месяца в должный месяц (`dueIn`); оценка (коммуналка) суммой не
 * ограничена — зимой уходит за 30 %. Окна дат нет: поздний платёж — тоже платёж. Под одним продавцом идут и зарплата, и мелкие
 * пополнения, и платежи всех кредитов Kaspi, а «Перевод с карты на карту» Freedom — все переводы
 * подряд. Нет цели или строка не такая — null.
 */
export function ruleHit(op: Operation, payment: PaymentRule, targets: RuleTargets): { target: Obligation | Credit | Person; period: string } | null {
  const amount = Math.abs(op.amount)
  if (payment.kind === 'salary') {
    const p = targets.people.find((x) => x.id === payment.targetId)
    if (!p || op.amount <= 0) return null
    const near = nearestEvent(op.date, p)
    return near && salaryFits(amount, p, near.event, targets.salary) ? { target: p, period: near.event.period } : null
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
  // Годовое — только в свой месяц (`dueIn`, как эвристика ниже): другая страховка тем же переводом
  // в сентябре — не платёж за март (критик возврата 2).
  if (!dueIn(o, period)) return null
  return o.estimate || within(amount, amountAt(o, period, targets.salary?.book), AMOUNT_TOLERANCE) ? { target: o, period } : null
}

/**
 * Сумма цели правила платежа на месяц строки (TL-02, Р-2): обязательство — `amountAt` ближайшего месяца по дню платежа,
 * кредит — `creditDueAmount`; зарплата и цели нет — null. По ней `ruleFor` выбирает из нескольких правил платежа продавца
 * (две подписки) — одинаково для раздела (`applyRules`), отметки (`matchCandidates`), «Подорожало» и «В платежи».
 */
export function paymentAmount(state: { obligations?: Obligation[]; credits?: Credit[]; book?: RateBook | null }): PaymentAmount {
  return (payment, op) => {
    if (payment.kind === 'credit') {
      const c = (state.credits ?? []).find((x) => x.id === payment.targetId && !x.deletedAt)
      return c ? creditDueAmount(c) : null
    }
    if (payment.kind !== 'obligation') return null
    const o = (state.obligations ?? []).find((x) => x.id === payment.targetId && !x.deletedAt)
    return o ? amountAt(o, nearestPeriod(op.date, o.day).period, state.book) : null
  }
}

/**
 * Проверка для `applyRules` (возврат приёмки 2 п. 2): плановый раздел правила платежа — только
 * «таким» строкам (`ruleHit`), остальные строки продавца — траты по словарю или незнакомое. Иначе
 * правило на «Перевод с карты на карту» 15 000 убирало из «Свободно» все переводы месяца. Кредит —
 * и закрытый: его последний платёж остаётся в плане месяца.
 */
export function paymentFits(state: {
  obligations?: Obligation[]
  credits?: Credit[]
  book?: RateBook | null
  payments?: Payment[]
}): (op: Operation, payment: PaymentRule) => boolean {
  const targets = { obligations: liveObligations(state.obligations ?? []), credits: liveCredits(state.credits ?? []), people: [], salary: { book: state.book } }
  // Пара «цель · месяц» уже отмечена другой строкой — эта не «такая» (хвост 967): два перевода по 15 000 — плановый один.
  const byOp = new Map((state.payments ?? []).filter((p) => !p.deletedAt && p.opId).map((p) => [key(p), p.opId!]))
  return (op, payment) => {
    const hit = ruleHit(op, payment, targets)
    if (!hit) return false
    const other = byOp.get(key({ kind: payment.kind, targetId: payment.targetId, period: hit.period }))
    return !other || other === op.id
  }
}

/**
 * Строки, чей платёж уже в платежах месяца (`monthDues`, хвосты 952/967): отмеченные из выписки (живой
 * `Payment.opId`) и та строка, которую сопоставление отдаёт паре «цель · месяц» без такой отметки — отмеченной руками
 * или ждущей ответа «это платёж по …?»: в платежах месяца уже её сумма, вычесть строку ещё и тратой — дважды. Пара
 * берёт одну строку (`matchCandidates`): вторая строка продавца в месяце — трата. «Нет, это другое» (`declined`) —
 * трата. Остальные строки разделов платежей — траты (`SpendTotal.unmarked`).
 */
export function markedOps(
  ops: Operation[],
  state: { obligations?: Obligation[]; credits?: Credit[]; people?: Person[]; payments?: Payment[]; fxExchanges?: FxExchange[]; book?: RateBook | null },
  rules: MerchantRule[],
  me?: PersonId,
  declined: string[] = [],
): Set<string> {
  const linked = (state.payments ?? []).filter((p) => !p.deletedAt && p.opId)
  const out = new Set(linked.map((p) => p.opId!))
  for (const c of matchCandidates(ops, { ...state, payments: linked }, rules, me)) if (!isDeclined(c, declined)) out.add(c.opId)
  return out
}

/**
 * Строки выписки, уже вычтенные из счёта сдвигом рукой (FG-15, F2-Х1): взнос в цель с карты, снятие, внеплановый доход,
 * «Сбылось» двигают остаток сами, и тот же перевод в выписке не должен списаться второй раз (`spentSince`). Каждому
 * живому сдвигу `me` (по дате) — ближайшая по дате свободная строка той же суммы со знаком (тенге — точно; покупка в валюте
 * — в допуске `AMOUNT_TOLERANCE` по пересчитанным тенге), не дальше `DAY_WINDOW` дней; одна строка — одному сдвигу.
 * Вид строки не важен (перевод на депозит, покупка, приход). Строки `skip` (`markedOps`) не берутся. Только для потраченного
 * со счёта: итоги разделов (`SpendTotal`) пару считают — покупка мечты остаётся тратой раздела. `me` null — сдвиги любого
 * телефона (счёт для трат одного хозяина: его выписки — только у него).
 */
export function shiftedOps(ops: Operation[], shifts: AccountShift[], me: PersonId | null, skip: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>()
  const fits = (o: Operation, s: AccountShift) =>
    o.fx ? Math.sign(o.amount) === Math.sign(s.amount) && within(Math.abs(o.amount), Math.abs(s.amount), AMOUNT_TOLERANCE) : o.amount === s.amount
  const mine = shifts
    .filter((s) => !s.deletedAt && (me === null || s.by === me) && s.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  for (const s of mine) {
    let best: { id: string; gap: number; date: string } | null = null
    for (const o of ops) {
      if (out.has(o.id) || skip.has(o.id) || !fits(o, s)) continue
      const gap = Math.abs(dayNumber(o.date) - dayNumber(s.date))
      if (gap > DAY_WINDOW) continue
      if (!best || gap < best.gap || (gap === best.gap && (o.date < best.date || (o.date === best.date && o.id < best.id)))) best = { id: o.id, gap, date: o.date }
    }
    if (best) out.add(best.id)
  }
  return out
}

function key(c: { kind: string; targetId: string; period: string }) {
  return `${c.kind}:${c.targetId}:${c.period}`
}

/** Пара «цель · месяц» предложения. */
export const matchKey = key

/**
 * Запись «Нет, это другое» — личный документ (`answers`, TL-08; до него — `ff_match_declined` устройства): операция и пара, `<opId>|<kind>:<targetId>:<period>`
 * (FB-01, Р-15 в). Пара одна помнила «нет» только пока операция занята ею: отметили пару руками — операция уходила к
 * следующей цели с похожей суммой, и вопрос по той же строке вставал снова.
 */
export const declineKey = (c: { opId: string; kind: string; targetId: string; period: string }) => `${c.opId}|${key(c)}`

/** Отклонено ли предложение: операция — любой цели (запись с `opId`); старая запись без `opId` — пара на этот месяц. */
export function isDeclined(c: { opId: string; kind: string; targetId: string; period: string }, declined: readonly string[]): boolean {
  return declined.some((d) => {
    const bar = d.indexOf('|')
    return bar < 0 ? d === key(c) : d.slice(0, bar) === c.opId
  })
}

/**
 * Обмен валютной зарплаты (B2C-80, Р-74), которым была операция тенговой выписки: у валютного участника
 * в тенговую выписку приходит обмен, а не оклад (приход на валютный счёт она не видит). Свой живой обмен
 * с зачислением, тенге в допуске зарплаты (±10 %: банк округляет курс) и день в окне зарплаты от дня
 * обмена; из нескольких — ближайший суммой. Нет — null.
 */
export function exchangeOfOperation(op: Operation, exchanges: FxExchange[], me: PersonId): FxExchange | null {
  if (op.amount <= 0 || (op.kind !== 'transfer-in' && op.kind !== 'income')) return null
  let best: FxExchange | null = null
  for (const x of liveExchanges(exchanges)) {
    if (x.by !== me || !x.toAccountId || !within(op.amount, x.tenge, SALARY_TOLERANCE)) continue
    if (Math.abs(dayNumber(op.date) - dayNumber(todayIso(new Date(x.at)))) > SALARY_WINDOW) continue
    if (!best || Math.abs(op.amount - x.tenge) < Math.abs(op.amount - best.tenge)) best = x
  }
  return best
}

/**
 * Предложения отметок по строкам выписки. Зарплата валютного участника ищется в тенге месяца
 * (`salaryTenge`, Р-74: не оклад в валюте), зачисления его обменов — не предложения (`exchangeOfOperation`).
 */
export function matchCandidates(
  ops: Operation[],
  state: { obligations?: Obligation[]; credits?: Credit[]; people?: Person[]; payments?: Payment[]; fxExchanges?: FxExchange[]; book?: RateBook | null },
  rules: MerchantRule[],
  me?: PersonId,
): MatchCandidate[] {
  const payments = state.payments ?? []
  const salary: SalaryCtx = { book: state.book, payments, exchanges: state.fxExchanges }
  const obligations = liveObligations(state.obligations ?? [])
  const credits = liveCredits(state.credits ?? []).filter((c) => c.principal > 0)
  // Чужая зарплата — не кандидат и правилом не применяется: иначе приход A закрыл бы месяц B.
  const people = (state.people ?? []).filter((p) => !p.deletedAt && p.id === me)
  const linked = new Set(payments.map((p) => p.opId).filter((id): id is string => !!id))
  const amountOf = paymentAmount(state)
  // Вторая строка — факт из выписки: сумма и дата операции, строка банка (DESIGN.md §6).
  const when = (op: Operation) => dayLabel(Number(op.date.slice(8, 10)), op.date.slice(0, 7))
  const text = (kind: MatchKind, name: string, op: Operation, pay?: PayEvent['kind']) =>
    kind === 'salary'
      ? { question: salaryQuestion(name, pay), meta: `${money(Math.abs(op.amount))} · ${when(op)} · поступление` }
      : { question: `Похоже, это платёж по ${name} — отметить?`, meta: `${money(Math.abs(op.amount))} · ${when(op)} · «${op.merchant}»` }
  const near = (amount: number, expected: number) => (expected > 0 ? Math.abs(amount - expected) / expected : 0)

  /*
   * Кандидаты всех строк сразу, затем одна очередь (хвост 959): правило семьи раньше эвристик, затем ближе к сумме
   * (оклад, платёж), затем раньше по дате. Пара «цель · месяц» и строка — по одному разу, по этой очереди: приход
   * другого отправителя выше по выписке больше не занимает месяц раньше строки правила, порядок строк не важен.
   */
  type Scored = MatchCandidate & { tier: 0 | 1; score: number; date: string; index: number }
  const all: Scored[] = []
  ops.forEach((op, index) => {
    // Ручная трата — уже трата раздела, который выбрал человек (Р-1): вопросом «это платёж по …?» не становится.
    if (op.internal || linked.has(op.id) || isHand(op)) return
    // Зачисление обмена валютной зарплаты (B2C-80) — отметка этого обмена, не зарплата и не вопрос.
    if (me && exchangeOfOperation(op, state.fxExchanges ?? [], me)) return
    const amount = Math.abs(op.amount)
    const add = (c: MatchCandidate, tier: 0 | 1, score: number) => all.push({ ...c, tier, score, date: op.date, index })

    // Правило семьи — без вопроса, но только «такая» строка (`ruleHit`: знак и сумма в допуске),
    // иначе месяц отметился бы чужой суммой. Не прошедшая строка идёт к эвристикам ниже и может
    // стать вопросом; прошедшая, чья пара уже занята, — тоже.
    const rule = ruleFor(op, rules, amountOf)
    const hit = rule && 'payment' in rule.to ? ruleHit(op, rule.to.payment, { obligations, credits, people, salary }) : null
    if (rule && 'payment' in rule.to && hit) {
      const { kind, targetId, categoryId } = rule.to.payment
      const t = hit.target
      const event = kind === 'salary' ? payEventOf(t as Person, hit.period) : null
      const expected =
        kind === 'salary' ? (event ? expectedEventTenge(t as Person, event, salary) : 0) : kind === 'credit' ? creditDueAmount(t as Credit) : amountAt(t as Obligation, hit.period, salary.book)
      add({ opId: op.id, kind, targetId, period: hit.period, amount, confidence: 'rule', categoryId: categoryId ?? matchCategory(kind, t), ...text(kind, t.name, op, event?.kind) }, 0, near(amount, expected))
    }

    if (op.amount < 0) {
      for (const o of obligations) {
        const { period, gap } = nearestPeriod(op.date, o.day)
        if (gap > DAY_WINDOW || !dueIn(o, period)) continue
        const expected = amountAt(o, period, salary.book)
        if (!within(amount, expected, o.estimate ? ESTIMATE_TOLERANCE : AMOUNT_TOLERANCE)) continue
        add({
          opId: op.id, kind: 'obligation', targetId: o.id, period, amount, confidence: 'likely',
          categoryId: matchCategory('obligation', o), subscription: isSubscription(o) || undefined, ...text('obligation', o.name, op),
        }, 1, near(amount, expected) + gap / 100)
      }
      for (const c of credits) {
        const { period, gap } = nearestPeriod(op.date, c.day)
        if (gap > DAY_WINDOW) continue
        const due = creditDueAmount(c)
        if (!within(amount, due, AMOUNT_TOLERANCE) && amount !== c.payment) continue
        add({ opId: op.id, kind: 'credit', targetId: c.id, period, amount, confidence: 'likely', categoryId: 'sc_credit', ...text('credit', c.name, op) }, 1, near(amount, due) + gap / 100)
      }
    }

    if (op.amount > 0 && (op.kind === 'transfer-in' || op.kind === 'income')) {
      // Ритм (Б7): ближайший приход — аванс, неделя или зарплата месяца; `period` кандидата — ключ прихода.
      for (const p of people) {
        const hitEvent = nearestEvent(op.date, p)
        if (!hitEvent || hitEvent.gap > SALARY_WINDOW) continue
        const { event, gap } = hitEvent
        if (!salaryFits(amount, p, event, salary)) continue
        const expected = expectedEventTenge(p, event, salary)
        add({ opId: op.id, kind: 'salary', targetId: p.id, period: event.period, amount, confidence: 'likely', categoryId: null, ...text('salary', p.name, op, event.kind) }, 1, near(amount, expected) + gap / 100)
      }
    }
  })

  all.sort((a, b) => a.tier - b.tier || a.score - b.score || a.date.localeCompare(b.date) || a.index - b.index)
  const taken = new Set<string>()
  const chosen = new Map<string, Scored>()
  for (const c of all) {
    if (chosen.has(c.opId) || taken.has(key(c)) || paidFor(payments, c.kind, c.targetId, c.period)) continue
    taken.add(key(c))
    chosen.set(c.opId, c)
  }
  return [...chosen.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ tier: _tier, score: _score, date: _date, index: _index, ...candidate }) => candidate)
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
