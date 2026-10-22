import type { Account, Category, Credit, DebtPlan, Goal, Obligation, Payment, PayRhythm, Person, PersonId, PlanForecast, WishItem, Allocation, AllocationPart, ArticleKey, MoneyArticle, MoneySettings, Currency, RateBook, FxExchange, ObligationVersion, QueueOrder, SpendPlan, DebtCard, TripSpend, TermSnap, PlanShift, ImageMove, AiReview } from '@/types/finance'
import type { MatchCandidate } from '@/lib/statements/matching'
import type { UnknownGroup } from '@/lib/statements/model'
import { isHand, isSpend, normalizeCounterparty, normalizeMerchant, shortMerchant, spendOf } from '@/lib/statements/model'
import type { RecurringPrefill } from '@/lib/statements/firstRun'
import type { HabitId, HabitTotal, Operation, ReviewFind, SpendCategory, SpendTotal } from '@/lib/statements/types'
import { HABITS } from '@/lib/statements/habits'
import { COFFEE_CUP, MEASURES, PRICES, type PriceId } from '@/lib/prices'
import { templateById } from '@/lib/goalTemplates'
import { DEFAULT_SPEND_CATEGORIES, RK_GROUP_BY_CATEGORY, UNKNOWN_CATEGORY, plannedElsewhere, type RkGroup } from '@/lib/statements/dictionary'
import { addDaysIso, addMonths, dayLabel, daysInMonth, isoIn, monthBy, monthFrom, monthKey, parseMonthKey, today, todayIso, weekdayShort, weekKey, weekRange } from '@/lib/dates'
import { spendColor } from '@/lib/palette'
import { money, pct, plain } from '@/lib/money'
import { plural } from '@/lib/utils'
import { maskNames } from '@/lib/aiSummary'
/**
 * Расчётное ядро. Чистые функции: ни сети, ни состояния, ни ИИ.
 *
 * Все числа в приложении считаются ЗДЕСЬ. ИИ-советник, когда появится,
 * получает готовые результаты и только объясняет их словами — модель,
 * которой позволили считать аннуитет самой, ошибается, а ошибка в деньгах
 * стоит доверия ко всему приложению.
 *
 * Находки разбора (бэклог «Разбор», RZ-02) — тоже здесь: телефон пишет итоги находок участника
 * (`lib/statements/finds.ts`), а находки семьи, цену в год, образы, сценарий и счётчик считает
 * `reviewFindings` и соседи по документу; модель их только выбирает и объясняет.
 */

/** Ежемесячная ставка из годовой. */
const m = (annual: number) => annual / 12

/** Аннуитетный платёж по кредиту. */
export function annuityPayment(principal: number, annualRate: number, months: number): number {
  const i = m(annualRate)
  if (i <= 0) return principal / months
  const g = Math.pow(1 + i, months)
  return (principal * i * g) / (g - 1)
}

/** За сколько месяцев закроется долг при заданном платеже. Infinity — платёж не покрывает проценты. */
export function annuityMonths(principal: number, annualRate: number, payment: number): number {
  const i = m(annualRate)
  if (i <= 0) return principal / payment
  const x = 1 - (principal * i) / payment
  if (x <= 0) return Infinity
  return -Math.log(x) / Math.log(1 + i)
}

/** Всё, что будет отдано банку при заданном платеже. */
export function annuityTotal(principal: number, annualRate: number, payment: number): number {
  const n = annuityMonths(principal, annualRate, payment)
  return Number.isFinite(n) ? payment * n : Infinity
}

/**
 * Ставка, выведенная из условий кредита.
 *
 * В договоре ГЭСВ есть всегда, но найти её там умеет не каждый, а платёж
 * и срок человек помнит наизусть. Из них ставка вычисляется однозначно:
 * подбираем ту, при которой график сходится за нужное число месяцев.
 *
 * Возвращает null, когда решения нет: если платёж меньше, чем принципал,
 * делённый на срок, долг не закроется ни при какой ставке — значит в цифрах
 * ошибка, и лучше сказать об этом, чем показать выдуманный процент.
 */
export function rateFromSchedule(
  principal: number,
  payment: number,
  months: number,
): number | null {
  if (principal <= 0 || payment <= 0 || months <= 0) return null

  // При нулевой ставке долг гасится ровно за principal / payment месяцев.
  // Если это больше запрошенного срока, платёж не покрывает даже тело долга.
  if (principal / payment > months + 1e-9) return null

  // Срок растёт вместе со ставкой, поэтому годится обычное деление пополам.
  let low = 0
  let high = 2 // 200% годовых — заведомо выше любого потребительского кредита

  if (annuityMonths(principal, high, payment) < months) return high

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2
    if (annuityMonths(principal, mid, payment) < months) low = mid
    else high = mid
  }
  return (low + high) / 2
}

/** Сколько платежей у долга без процентов: рассрочка гасится ровно суммой платежей. */
export const installmentMonths = (principal: number, payment: number) =>
  payment > 0 ? Math.ceil(principal / payment) : 0

/**
 * Почему из срока не выводится ставка — словами и цифрой (React `AddDebtDialog`).
 *
 * Форма долга не отказывает: человек переносит цифры из банковского приложения,
 * и если они не сходятся, где-то в выписке комиссия, страховка или лишний
 * платёж. Запись проходит как рассрочка без процентов, а расхождение видно:
 * `paid` — сколько дадут названные платежи, `gap` — сколько не хватает до
 * остатка (минус — выходит больше остатка), `suggest` — сколько платежей было
 * бы без процентов. null — график сходится (ставка есть) или входы не заданы.
 */
export function scheduleMismatch(
  principal: number,
  payment: number,
  months: number,
): { paid: number; gap: number; suggest: number } | null {
  if (principal <= 0 || payment <= 0 || months <= 0) return null
  if (rateFromSchedule(principal, payment, months) !== null) return null
  const paid = months * payment
  return { paid, gap: principal - paid, suggest: installmentMonths(principal, payment) }
}

export type Prepayment = {
  monthsNow: number
  monthsAfter: number
  monthsSaved: number
  overpayNow: number
  overpayAfter: number
  saved: number
}

/**
 * Досрочное погашение стратегией «сокращать срок»: платёж растёт на extra.
 * Это калькулятор ежемесячной добавки. Разовую досрочку, которую применяют к
 * кредиту, в обоих режимах — «сократить срок» и «снизить платёж» — считает
 * `lumpPlan`.
 */
export function prepayment(
  principal: number,
  annualRate: number,
  payment: number,
  extra: number,
): Prepayment {
  const monthsNow = annuityMonths(principal, annualRate, payment)
  const monthsAfter = annuityMonths(principal, annualRate, payment + extra)
  const overpayNow = payment * monthsNow - principal
  const overpayAfter = (payment + extra) * monthsAfter - principal
  return {
    monthsNow,
    monthsAfter,
    monthsSaved: monthsNow - monthsAfter,
    overpayNow,
    overpayAfter,
    saved: overpayNow - overpayAfter,
  }
}

export type DepositInput = {
  principal: number
  annualRate: number
  months: number
  monthlyTopUp: number
  /** true — проценты капитализируются ежемесячно, false — выплата в конце срока */
  capitalize: boolean
}

export type DepositResult = {
  future: number
  contributed: number
  interest: number
  /** эффективная годовая ставка с учётом капитализации */
  effectiveRate: number
}

export function deposit(input: DepositInput): DepositResult {
  const { principal, annualRate, months, monthlyTopUp, capitalize } = input
  const i = m(annualRate)
  let future: number
  let effectiveRate: number

  if (capitalize) {
    const g = Math.pow(1 + i, months)
    const annuity = i > 0 ? ((g - 1) / i) * monthlyTopUp : monthlyTopUp * months
    future = principal * g + annuity
    effectiveRate = Math.pow(1 + i, 12) - 1
  } else {
    // Простые проценты: тело работает весь срок, каждое пополнение — оставшиеся месяцы.
    const onPrincipal = principal * annualRate * (months / 12)
    const onTopUps = monthlyTopUp * i * ((months * (months - 1)) / 2)
    future = principal + monthlyTopUp * months + onPrincipal + onTopUps
    effectiveRate = annualRate
  }

  const contributed = principal + monthlyTopUp * months
  return { future, contributed, interest: future - contributed, effectiveRate }
}

/** Реальная доходность по Фишеру: что останется после инфляции. */
export function realRate(nominal: number, inflation: number): number {
  return (1 + nominal) / (1 + inflation) - 1
}

/**
 * Инфляция в год — одна на приложение (Р-19). В React это была настройка
 * устройства без UI, то есть фактически константа; поля в документе и стора
 * настроек нет.
 */
export const INFLATION = 0.102

/**
 * Во что обойдётся та же цель через `months` месяцев, если она дорожает вместе
 * с рынком. null — взнос 0, срок не наступит, и прогноза нет.
 */
export function indexedNeed(need: number, months: number, inflation = INFLATION): number | null {
  if (!Number.isFinite(months)) return null
  return Math.round(need * Math.pow(1 + inflation, months / 12))
}

/**
 * Сколько лежит в цели: стартовое накопленное плюс все движения. Меньше нуля не
 * бывает — снятие сверх накопленного пишется в историю целиком, а остаток 0.
 * Одна формула для стора и слияния, иначе телефоны покажут разное.
 */
export function goalHave(seed: number | undefined, movements: { amount: number }[] = []): number {
  return Math.max(0, (seed ?? 0) + movements.reduce((a, m) => a + m.amount, 0))
}

/** Сколько месяцев копить остаток при заданном взносе. */
export function goalMonths(remaining: number, monthly: number): number {
  if (monthly <= 0) return Infinity
  return Math.max(1, Math.ceil(remaining / monthly))
}

/**
 * Месяц, когда цель закроется за `months` взносов (Н-8 ревью Блока 3): взносы идут с месяца
 * `key`. Цель на паузе ради плана (`pause` — прогноз активного плана) стоит, пока план не
 * закроет последний долг с процентами: взносы — с месяца после `debtFreeMonth`. null — месяца
 * нет: долги не закрываются или взнос 0.
 */
export function goalDoneMonth(months: number, key: string, pause?: { debtFreeMonth: string | null }): string | null {
  if (!Number.isFinite(months)) return null
  if (!pause) return addMonths(key, months - 1)
  return pause.debtFreeMonth === null ? null : addMonths(pause.debtFreeMonth, months)
}

/** Какой взнос нужен, чтобы успеть за N месяцев. */
export function goalMonthly(remaining: number, months: number): number {
  if (months <= 0) return remaining
  return Math.ceil(remaining / months)
}

/**
 * Взнос, при котором срок цели прежний после правки суммы или накопленного (хотфикс 2026-10-12, владелец: «по текущему
 * сроку»): новый остаток на те же `months` взносов, что показывает экран (`goalTerm` — с очередью плана). Срока нет,
 * взноса нет или новый остаток 0 — взнос прежний.
 */
export function keepTermMonthly(months: number, monthly: number, remaining: number): number {
  if (!Number.isFinite(months) || months <= 0 || monthly <= 0 || remaining <= 0) return monthly
  return goalMonthly(remaining, months)
}

/**
 * Размер подушки. Не «шесть расходов вслепую», а максимум из базового пола
 * и сценария: при потере работы одним партнёром покрывается только дефицит,
 * а не все расходы семьи.
 */
export function emergencyTarget(opts: {
  mandatoryMonthly: number
  partnerIncome: number
  floorMonths: number
  scenarioMonths: number
}): number {
  const floor = opts.mandatoryMonthly * opts.floorMonths
  const deficit = Math.max(0, opts.mandatoryMonthly - opts.partnerIncome)
  const scenario = deficit * opts.scenarioMonths
  return Math.max(floor, scenario)
}

/**
 * Во что обходится долг прямо сейчас.
 *
 * Смысл в доле платежа, уходящей в проценты. Человек сравнивает долги по
 * остатку и по платежу, а дороже всего оказывается не самый большой и не самый
 * заметный: кредитная карта с маленьким платежом гасится годами, потому что
 * почти весь платёж съедают проценты, и остаток почти не двигается.
 */
export function debtCost(principal: number, annualRate: number, payment: number) {
  const monthlyInterest = (principal * annualRate) / 12
  const months = annuityMonths(principal, annualRate, payment)
  const closes = Number.isFinite(months) && months > 0
  return {
    /** Сколько уходит в проценты за месяц, ничего не погашая. */
    monthlyInterest,
    /** Какая доля платежа — проценты. Выше половины значит, что долг почти стоит. */
    interestShare: payment > 0 ? Math.min(1, monthlyInterest / payment) : 1,
    months,
    closes,
    overpay: closes ? payment * months - principal : Infinity,
  }
}

export type CreditOutlook = {
  closes: boolean
  months: number
  overpay: number
  /** Проценты за месяц — до тенге. */
  monthlyInterest: number
  /** Доля платежа в проценты — целые проценты. */
  sharePct: number
}

/**
 * Что станет с долгом при нынешнем платеже — выводы модалки кредита (React
 * `CreditDialog`) и «Что гасить первым»: сколько платежей осталось (вверх до целого),
 * сколько уйдёт банку сверх остатка (до тенге), проценты за месяц и их доля в платеже.
 * `closes: false` — чисел срока и переплаты нет: платёж не покрывает проценты **или
 * долг уже закрыт** (остаток 0). Различать эти случаи — по остатку.
 */
export function creditOutlook(c: { principal: number; annualRate: number; payment: number }): CreditOutlook {
  const cost = debtCost(c.principal, c.annualRate, c.payment)
  const now = { monthlyInterest: Math.round(cost.monthlyInterest), sharePct: Math.round(cost.interestShare * 100) }
  return cost.closes
    ? { closes: true, months: Math.ceil(cost.months), overpay: Math.round(cost.overpay), ...now }
    : { closes: false, months: Infinity, overpay: Infinity, ...now }
}

/** Выводы калькулятора досрочки — целые платежи и тенге. */
export type PrepayOutcome = {
  /** Платежей сейчас и после взноса — вверх до целого. */
  monthsNow: number
  monthsAfter: number
  /** На сколько месяцев раньше — до целого. */
  monthsSaved: number
  /** Срок сокращается хотя бы на месяц (React сравнивает до округления). */
  sooner: boolean
  /** Сколько процентов не отдадим банку — до тенге, не меньше нуля. */
  saved: number
}

/**
 * Досрочка в калькуляторе (React `PayoffDialog`): ежемесячная добавка (`prepayment`)
 * или разовый взнос (`lumpSum`). null — выводов нет: долг не закрывается при нынешнем
 * платеже или после взноса, и срок с переплатой бесконечны.
 */
export function prepayOutcome(
  c: { principal: number; annualRate: number; payment: number },
  extra: number,
  mode: 'monthly' | 'once',
): PrepayOutcome | null {
  const r =
    mode === 'monthly'
      ? prepayment(c.principal, c.annualRate, c.payment, extra)
      : lumpSum(c.principal, c.annualRate, c.payment, extra)
  if (!Number.isFinite(r.monthsNow) || !Number.isFinite(r.monthsAfter)) return null
  return {
    monthsNow: Math.ceil(r.monthsNow),
    monthsAfter: Math.max(0, Math.ceil(r.monthsAfter)),
    monthsSaved: Math.round(r.monthsSaved),
    sooner: r.monthsSaved >= 1,
    saved: Math.max(0, Math.round(r.saved)),
  }
}

/**
 * Чипы ежемесячной добавки: половина платежа, платёж (до тысячи) и добавка, снимающая
 * половину переплаты. Без повторов и нулей, по возрастанию.
 */
export function payoffChips(c: { principal: number; annualRate: number; payment: number }): number[] {
  const half = halfOverpayExtra(c.principal, c.annualRate, c.payment)
  const round = (v: number) => Math.round(v / 1000) * 1000
  return [...new Set([round(c.payment / 2), round(c.payment), ...(half ? [half] : [])].filter((v) => v > 0))].sort(
    (a, b) => a - b,
  )
}

/**
 * «Отдача падает»: добавка в полплатежа, платёж, два и четыре (до тысячи) и что каждая
 * даёт. Только у долга, который закрывается: у закрытого и у того, где платёж не
 * покрывает проценты, лесенки нет.
 */
export function payoffLadder(c: { principal: number; annualRate: number; payment: number }) {
  if (!creditOutlook(c).closes) return []
  return [0.5, 1, 2, 4]
    .map((k) => Math.round((c.payment * k) / 1000) * 1000)
    .filter((extra) => extra > 0)
    .flatMap((extra) => {
      const out = prepayOutcome(c, extra, 'monthly')
      return out ? [{ extra, ...out }] : []
    })
}

/**
 * Разовый досрочный взнос: часть остатка гасится сразу, платёж не меняется.
 *
 * Второй способ рядом с ежемесячной добавкой, потому что деньги приходят
 * по-разному. Премия или возврат — это разовая сумма, и «добавляйте по столько
 * каждый месяц» для неё бессмысленный совет.
 *
 * Взнос больше остатка — это просто закрытие долга: считаем по остатку, чтобы
 * экономия не оказалась завышенной на сумму, которую платить было не нужно.
 */
export function lumpSum(
  principal: number,
  annualRate: number,
  payment: number,
  lump: number,
): Prepayment {
  const paid = Math.max(0, Math.min(lump, principal))
  const left = principal - paid
  const monthsNow = annuityMonths(principal, annualRate, payment)
  const monthsAfter = left <= 0 ? 0 : annuityMonths(left, annualRate, payment)
  const overpayNow = payment * monthsNow - principal
  const overpayAfter = left <= 0 ? 0 : payment * monthsAfter - left
  return {
    monthsNow,
    monthsAfter,
    monthsSaved: monthsNow - monthsAfter,
    overpayNow,
    overpayAfter,
    saved: overpayNow - overpayAfter,
  }
}

export type LumpMode = 'term' | 'payment'

export type LumpPlan = {
  /** Сколько реально уйдёт в тело: не больше остатка. */
  paid: number
  /** Остаток после взноса. */
  left: number
  /** Платёж после: тот же при «сократить срок», новый при «снизить платёж». */
  payment: number
  /** Сколько платежей останется. */
  months: number
  monthsBefore: number
  /** Сколько процентов не отдадим банку. */
  saved: number
  /**
   * Платёж не покрывает проценты (Р-11): до взноса долг не закрывался, сравнивать
   * не с чем — `monthsBefore` бесконечен, экономия 0. Срок после взноса — число,
   * если взнос сделал платёж посильным, иначе тоже бесконечен.
   */
  openEnded?: boolean
}

/** Р-11: платёж не покрывает проценты — сравнивать не с чем. Один текст для всех экранов. */
export const NO_SAVING = 'при текущем платеже долг не закрывается — экономию не считаем'

/**
 * Разовая досрочка, применённая к кредиту (Р-6): что станет с остатком, платежом
 * и сроком и сколько процентов не отдадим банку. Два режима, как у банков:
 *
 *  - «сократить срок» (term) — платёж тот же, долг закроется раньше (`lumpSum`);
 *  - «снизить платёж» (payment) — срок тот же, платёж пересчитывается аннуитетом
 *    на остаток. При том же сроке проценты пропорциональны долгу, поэтому новый
 *    платёж — прежний × остаток / долг (вверх до тенге), а экономия меньше, чем у
 *    «сократить срок»: там весь прежний платёж продолжает гасить тело.
 *
 * `saved` — оценка в непрерывных месяцах, как у `lumpSum` и калькулятора; снимок на
 * момент применения, а не обещание до тенге. С помесячным графиком (`creditSplit`:
 * проценты округляются каждый месяц, последний платёж — остаток с процентами за
 * целый месяц) она расходится: на реальных кредитах — до нескольких процентов
 * экономии, на коротких и дорогих — больше.
 *
 * Всё на выходе — целые тенге и целые платежи: это пишется в документ и
 * показывается как сумма. null — считать нечего: взноса нет или долга нет.
 *
 * Платёж не покрывает проценты (кредитка с минимальным платежом) — взнос всё равно
 * вносится (Р-11: иначе план назначил бы шаг, который нельзя применить), но
 * экономию не с чем сравнить: `openEnded`, `saved` 0, платёж прежний в обоих
 * режимах — срока, который сохранять, не существует.
 */
export function lumpPlan(
  principal: number,
  annualRate: number,
  payment: number,
  lump: number,
  mode: LumpMode,
): LumpPlan | null {
  const debt = Math.round(principal)
  const paid = Math.max(0, Math.min(Math.round(lump), debt))
  if (debt <= 0 || paid <= 0) return null
  const n = annuityMonths(debt, annualRate, payment)
  const left = debt - paid
  if (!Number.isFinite(n)) {
    const after = left === 0 ? 0 : Math.ceil(annuityMonths(left, annualRate, payment))
    return { paid, left, payment: left === 0 ? 0 : payment, months: after, monthsBefore: Infinity, saved: 0, openEnded: true }
  }
  const monthsBefore = Math.ceil(n)
  const overpayNow = payment * n - debt
  const saved = (overpayAfter: number) => Math.round(Math.max(0, overpayNow - overpayAfter))

  if (left === 0) return { paid, left, payment: 0, months: 0, monthsBefore, saved: saved(0) }
  if (mode === 'term') {
    const r = lumpSum(debt, annualRate, payment, paid)
    return { paid, left, payment, months: Math.ceil(r.monthsAfter), monthsBefore, saved: saved(r.overpayAfter) }
  }
  const next = annuityPayment(left, annualRate, n)
  // Новый платёж — прежний × остаток / долг на целых (без шума плавающей точки
  // аннуитета), округлённый вверх: платёж ниже точного растянул бы долг на лишний
  // платёж, и строка кредита показала бы срок длиннее прежнего. Платёж 0 при
  // живом остатке не закрыл бы долг никогда: не меньше тенге.
  const lowered = Math.max(1, Math.ceil((payment * left) / debt))
  return { paid, left, payment: lowered, months: monthsBefore, monthsBefore, saved: saved(next * n - left) }
}

/**
 * Наименьшая ежемесячная добавка, снимающая половину переплаты.
 *
 * Это и есть «разумные рамки». На кредитной карте с остатком 165 000 и
 * платежом 8 433 добавка в 5 000 убирает 31 000 переплаты из 66 000, а
 * вчетверо большая — только вдвое больше. Отдача падает быстро, и совет
 * «вносите как можно больше» бесполезен человеку, у которого таких сумм нет.
 *
 * Ищем делением пополам: экономия растёт с добавкой монотонно. Возвращаем
 * округление вверх до шага, чтобы получилось число, которое можно назвать
 * вслух, а не 4 137.
 */
export function halfOverpayExtra(
  principal: number,
  annualRate: number,
  payment: number,
  step = 1000,
): number | null {
  const months = annuityMonths(principal, annualRate, payment)
  if (!Number.isFinite(months)) return null
  const target = (payment * months - principal) / 2
  if (target <= 0) return null

  const savedBy = (extra: number) => {
    const m = annuityMonths(principal, annualRate, payment + extra)
    return payment * months - principal - ((payment + extra) * m - principal)
  }

  let lo = 0
  let hi = principal
  if (savedBy(hi) < target) return null
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (savedBy(mid) < target) lo = mid
    else hi = mid
  }
  return Math.ceil(hi / step) * step
}

export type StrategyDebt = { principal: number; annualRate: number; payment: number }

export type StrategyResult = {
  /** Сколько лежит в накоплениях к горизонту, включая то, что было на старте. */
  savings: number
  /** Сколько долга осталось к горизонту. */
  debtLeft: number
  /** Накопления минус долг — единственное число, по которому стратегии сравнимы. */
  net: number
  /** Проценты, отданные к горизонту. */
  interest: number
  /** Проценты за всё время, пока не закроется последний процентный долг. */
  interestTotal: number
  /** Месяц, в котором закрыт последний процентный долг; null — не закрывается. */
  debtFreeMonth: number | null
}

/**
 * Что будет с деньгами, если копить как сейчас, и что — если сначала гасить.
 *
 * Мысль заказчика: пока на долгах 26–33% годовых, откладывать под 2% — значит
 * терять разницу на каждом тенге. На его числах разница за три года вышла
 * 986 247 ₸. Формулой это не берётся: закрытый долг освобождает платёж,
 * и он каскадом уходит в следующий. Поэтому считаем помесячно.
 *
 * Обе стратегии тратят одинаково — платежи плюс взносы в цели, — и отличаются
 * только тем, куда идут деньги. Без этого сравнение было бы нечестным.
 *
 * Три правила, без которых совет стал бы вредным:
 *
 * - Беспроцентные долги досрочно не гасятся. Рассрочка под 0% ничего не стоит,
 *   а деньги, внесённые в неё раньше срока, просто перестают быть доступными.
 * - Сначала подушка. Пока её нет, любая поломка вернёт на кредитную карту, и
 *   выигрыш съест она же. Подушка считается накоплением, а не тратой.
 * - Часть целей продолжает пополняться (keep). Декретный депозит — страховка:
 *   если декрет близко, пауза там обходится дороже процентов.
 */
export function simulateStrategy(opts: {
  debts: StrategyDebt[]
  /** Сколько сейчас уходит в цели за месяц. */
  saving: number
  /** Из них продолжает идти в цели и в стратегии «сначала долги». */
  keep: number
  /** true — «сначала долги», false — «копим как сейчас». */
  payDebts: boolean
  /** Уже накоплено на старте. */
  start: number
  /** Сколько из накопленного сразу направить в долги. */
  lump?: number
  /** Размер подушки, которую набрать прежде, чем гасить досрочно. */
  buffer?: number
  months: number
}): StrategyResult {
  const { saving, keep, payDebts, start, months } = opts
  const debts = opts.debts.map((d) => ({ ...d }))
  const budget = debts.reduce((a, d) => a + d.payment, 0) + saving
  // Досрочно гасятся только долги с процентами, самый дорогой первым.
  const costly = () =>
    debts.filter((d) => d.principal > 0.5 && d.annualRate > 0).sort((a, b) => b.annualRate - a.annualRate)

  let savings = start
  let interest = 0
  let buffered = 0
  const buffer = payDebts ? Math.max(0, opts.buffer ?? 0) : 0

  if (payDebts && opts.lump) {
    let lump = Math.min(opts.lump, start)
    for (const d of costly()) {
      if (lump <= 0) break
      const put = Math.min(lump, d.principal)
      d.principal -= put
      lump -= put
      savings -= put
    }
  }

  let snapshot: StrategyResult | null = null
  let debtFreeMonth: number | null = costly().length ? null : 0

  // Считаем дальше горизонта, чтобы знать, когда закроется последний долг.
  for (let m = 1; m <= 600; m++) {
    let pool = budget
    for (const d of debts) {
      if (d.principal <= 0.5) continue
      const due = (d.principal * d.annualRate) / 12
      interest += due
      const pay = Math.min(d.payment, d.principal + due)
      d.principal = d.principal + due - pay
      pool -= pay
    }

    if (payDebts) {
      const kept = Math.min(pool, keep)
      savings += kept
      pool -= kept
      const toBuffer = Math.min(pool, buffer - buffered)
      buffered += toBuffer
      savings += toBuffer
      pool -= toBuffer
      for (const d of costly()) {
        if (pool <= 0) break
        const put = Math.min(pool, d.principal)
        d.principal -= put
        pool -= put
      }
    }
    savings += pool

    if (debtFreeMonth === null && costly().length === 0) debtFreeMonth = m

    if (m === months) {
      const debtLeft = debts.reduce((a, d) => a + Math.max(0, d.principal), 0)
      snapshot = { savings, debtLeft, net: savings - debtLeft, interest, interestTotal: 0, debtFreeMonth: null }
    }
    if (m >= months && debtFreeMonth !== null) break
  }

  const result = snapshot ?? { savings, debtLeft: 0, net: savings, interest, interestTotal: 0, debtFreeMonth: null }
  return { ...result, interestTotal: interest, debtFreeMonth }
}

export type StrategyInputs = {
  debts: StrategyDebt[]
  /** Сколько сейчас уходит в цели за месяц. */
  saving: number
  /** Из них — взносы целей, которые не останавливать. */
  keep: number
  /** Уже накоплено во всех целях. */
  start: number
  /** Накоплено в целях, которые можно трогать (не отмеченных). */
  movable: number
  /** Месяц обязательных списаний: живые платежи и платежи по долгам. */
  mandatory: number
  /** Подушка — тот же месяц, до тысяч; видна и при снятой галке. */
  cushionSize: number
  /** Подушка, которую «Сначала долги» набирает до досрочек: 0 без галки. */
  buffer: number
  /** Что из накопленного можно вложить в долги: неотмеченные цели минус подушка. */
  spare: number
  /** Сколько из накопленного вкладывается сразу: `spare` с галкой, иначе 0. */
  lump: number
  /** Беспроцентные долги с остатком — досрочно не гасятся. */
  interestFree: Credit[]
  /** Долги, чью ставку не знаем (`rateUnknown`, кредит из выписки) — не беспроцентные: ставку уточнить. */
  unknownRate: Credit[]
  /** Сколько взносов в месяц «Сначала долги» направляет в долги. */
  redirected: number
}

/**
 * Входы калькулятора «копить или гасить» — формулы React `StrategyCompare`.
 * Кредиты — производные (геттер стора); закрытые и удалённые отсекаются здесь
 * же: платёж закрытого стал бы в `simulateStrategy` «лишними деньгами».
 * Какая цель — страховка, решают люди галочкой (`kept`), по названию не угадываем.
 */
export function strategyInputs(opts: {
  credits: Credit[]
  goals: Goal[]
  obligations: Obligation[]
  key: string
  /** id целей, которые не останавливать. */
  kept: string[]
  cushion: boolean
  useSaved: boolean
}): StrategyInputs {
  const credits = openCredits(opts.credits)
  const goals = openGoals(opts.goals) // Сбылось (PN-13): сбывшаяся не копится — стратегии её не видят
  const kept = goals.filter((g) => opts.kept.includes(g.id))
  const free = goals.filter((g) => !opts.kept.includes(g.id))
  const have = (list: Goal[]) => list.reduce((a, g) => a + Math.max(0, g.have), 0)

  const debts = credits.map((c) => ({ principal: c.principal, annualRate: c.annualRate, payment: c.payment }))
  const saving = goals.reduce((a, g) => a + g.monthly, 0)
  const keep = kept.reduce((a, g) => a + g.monthly, 0)
  const start = have(goals)
  const movable = have(free)
  // Годовые платежи входят долей месяца — отсюда дробь; наружу — целые.
  const month =
    liveObligations(opts.obligations).reduce((a, o) => a + monthlyAmount(o, opts.key), 0) +
    credits.reduce((a, c) => a + c.payment, 0)
  const cushionSize = Math.round(month / 1000) * 1000
  const buffer = opts.cushion ? cushionSize : 0
  const spare = Math.max(0, movable - buffer)

  return {
    debts,
    saving,
    keep,
    start,
    movable,
    mandatory: Math.round(month),
    cushionSize,
    buffer,
    spare,
    lump: opts.useSaved ? spare : 0,
    interestFree: credits.filter((c) => c.annualRate === 0 && !c.rateUnknown && c.principal > 0),
    unknownRate: credits.filter((c) => !!c.rateUnknown),
    redirected: saving - keep,
  }
}

/** Насколько «Сначала долги» богаче «Копим как сейчас» к горизонту; минус — копить выгоднее. */
export const strategyGain = (a: StrategyResult, b: StrategyResult) => Math.round(b.net - a.net)


/* ---------------- производные величины и расчеты бюджетов ---------------- */

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

export const liveGoals = (goals: Goal[]) => (goals || []).filter(alive);
/** Активные цели (PN-13): живые без «Сбылось» — деньги, очередь и план считают только их. */
export const openGoals = (goals: Goal[]) => liveGoals(goals).filter((g) => !g.doneAt);
/** Сбывшиеся (PN-13, альбом «Сбылось»): живые с `doneAt`, новые первыми. */
export const doneGoals = (goals: Goal[]) =>
  liveGoals(goals)
    .filter((g) => !!g.doneAt)
    .sort((a, b) => (b.doneAt! < a.doneAt! ? -1 : b.doneAt! > a.doneAt! ? 1 : 0));
/**
 * Живые обязательства — то, что платится. Группа подписок (RP-09) — не платёж и
 * сюда не входит: ни в бюджет, ни в календарь, ни в «до зарплаты», ни в отметки.
 * Группы отдаёт `liveGroups`.
 */
export const liveObligations = (list: Obligation[]) => (list || []).filter((o) => alive(o) && !o.group);
export const liveGroups = (list: Obligation[]) => (list || []).filter((o) => alive(o) && !!o.group);
export const liveCredits = (list: Credit[]) => (list || []).filter(alive);
/**
 * Открытые кредиты — живые, по которым ещё есть что платить. Закрытый (остаток 0,
 * строка остаётся с «долг закрыт») не входит ни в стратегию, ни в разбор (`breakdownArticles`), ни в
 * план. В бюджете месяца его платёж ещё есть, если долг закрыли плановым «Оплатил»
 * этого месяца — деньги ушли в этом месяце (`creditMonthPayment`, PV-14 п. 5);
 * закрытый досрочкой выпадает сразу (PV-01).
 *
 * Принимает **производные** кредиты — геттер `financeStore.credits`, где остаток
 * уже выведен из отметок (RP-06). Сырой документ не давать: там `principal` —
 * база последней сверки, закрытость в нём не видна.
 */
export const openCredits = (list: Credit[]) => liveCredits(list).filter((c) => c.principal > 0);

/** Остаток открытых долгов семьи — квадрат и карточка «Долги», строка под «Капиталом» (Р-91). */
export const openDebt = (list: Credit[]) => openCredits(list).reduce((a, c) => a + c.principal, 0);
/**
 * Долги, которые стоит гасить досрочно: открытые с процентами, самый дорогой
 * первым (при равной ставке — тот, что больше съедает процентами в месяц).
 * Беспроцентные досрочно не гасятся: они ничего не стоят. Кредиты — производные,
 * как у `openCredits`.
 */
export const costliestCredits = (list: Credit[]) =>
  openCredits(list)
    .filter((c) => c.annualRate > 0)
    .map((c) => ({ c, interest: debtCost(c.principal, c.annualRate, c.payment).monthlyInterest }))
    .sort((a, b) => b.c.annualRate - a.c.annualRate || b.interest - a.interest)
    .map((x) => x.c);
export const liveAccounts = (list: Account[]) => (list || []).filter(alive);
/** Счета, с которых списывают платежи: живые, в тенге (валюта платежей — не-скоуп, Р-1). */
export const payableAccounts = (list: Account[]) => liveAccounts(list).filter((a) => (a.currency ?? 'KZT') === 'KZT');
export const liveWishlist = (list: WishItem[]) => (list || []).filter(alive);
/** Сумма цен списка желаний (итог «Куплено» на «Желаниях»), целые тенге; какие желания — решает экран. */
export const wishTotal = (list: Pick<WishItem, 'price'>[]) => list.reduce((a, w) => a + w.price, 0);

/** Сколько осталось до цели, целые тенге; накоплено больше нужного — 0 (одно место вместо четырёх экранов). */
export const goalRemaining = (g: Pick<Goal, 'need' | 'have'>) => Math.max(0, g.need - g.have);

/** Валюта в тенге по курсу — целые тенге. Единственное место, где сумма умножается на курс. */
export const fxToTenge = (foreignAmount: number, rate: number) => Math.round(foreignAmount * rate);

/**
 * Курс валюты на день `YYYY-MM-DD` по книге (Р-72): последний опубликованный день ≤ `day`
 * (выходные, праздники — курс пятницы). Дня нет (раньше начала книги, книги нет) — `fallback`
 * (снимок курса версии или счёта), нет и его — `null`. Тенге — курс 1. «Сейчас» внутри нет.
 */
export function rateOn(book: RateBook | null | undefined, code: Currency, day: string, fallback?: number | null): number | null {
  if (code === 'KZT') return 1;
  let best: string | null = null;
  for (const d in book?.[code] ?? {}) if (d <= day && (best === null || d > best)) best = d;
  if (best !== null) return book![code]![best];
  return fallback && fallback > 0 ? fallback : null;
}

/** Курс дня покупки с телефона — не старше недели (выходные и праздники — курс пятницы, Р-7). */
export const PHONE_RATE_MAX_DAYS = 7;

/**
 * Тенге покупки Apple Pay в валюте (Р-15): минорные единицы → по курсу Нацбанка на день операции (`rateOn`) → целые
 * тенге со знаком списания. Курса ещё нет — `null` (операция ждёт и в итоги не входит); операция без валюты — `null`.
 * Последний курс книги старше недели — тоже `null`: запрос курса дня не удался, а курс июня — не курс октября, и
 * пересчитанная трата больше не пересчитывается (критик Б1).
 */
export function phoneOpTenge(op: { date: string; fx?: { currency: Currency; amount: number } }, book: RateBook | null | undefined): number | null {
  if (!op.fx) return null;
  const from = addDaysIso(op.date, -PHONE_RATE_MAX_DAYS);
  const days = Object.fromEntries(Object.entries(book?.[op.fx.currency] ?? {}).filter(([d]) => d >= from));
  const rate = rateOn({ [op.fx.currency]: days }, op.fx.currency, op.date);
  return rate === null ? null : -fxToTenge(op.fx.amount / 100, rate);
}

/** Сумма `actual` в пределах доли `share` от `expected` (модули сумм; знак сравнивает вызывающий). */
export const withinShare = (actual: number, expected: number, share: number) =>
  expected !== 0 && Math.abs(Math.abs(actual) - Math.abs(expected)) <= Math.abs(expected) * share;

/** Валюты документа, которым нужна книга курсов (Р-72): счета, оклады и платежи (Р-75); без тенге. */
export function docCurrencies(doc: { accounts?: Account[]; people?: Person[]; obligations?: Obligation[] }): Currency[] {
  const out = new Set<Currency>();
  for (const a of liveAccounts(doc.accounts ?? [])) if (a.currency) out.add(a.currency);
  for (const p of (doc.people ?? []).filter(alive)) for (const v of p.salaryVersions ?? []) if (v.currency) out.add(v.currency);
  for (const o of liveObligations(doc.obligations ?? [])) for (const v of o.versions ?? []) if (v.currency) out.add(v.currency);
  out.delete('KZT');
  return [...out].sort();
}

/** Версия обязательства, действующая в месяце `key` (последняя с `from ≤ key`). */
function versionAt(o: Obligation, key: string): ObligationVersion | undefined {
  const active = (o.versions || []).filter((v) => v.from <= key).sort((a, b) => a.from.localeCompare(b.from));
  return active[active.length - 1];
}

/** Сумма месяца в своей валюте (Р-75) — для подписей «$15 · ≈ 7 700 ₸». Версий нет — 0 ₸. */
export function amountIn(o: Obligation, key = monthKey()): { amount: number; currency: Currency } {
  const v = versionAt(o, key);
  return { amount: v?.amount ?? 0, currency: v?.currency ?? 'KZT' };
}

/**
 * День списания обязательства `YYYY-MM-DD` для месяца `key`: ежемесячное — `day` этого месяца, годовое —
 * `day` своего месяца (`month`) того же года (31-е в коротком месяце — последний день).
 */
export function debitDayIso(o: Pick<Obligation, 'day' | 'every' | 'month'>, key: string): string {
  const month = o.every === 'year' ? `${key.slice(0, 4)}-${String(o.month ?? 1).padStart(2, '0')}` : key;
  return isoIn(month, o.day);
}

/**
 * Сумма обязательства месяца в тенге (Р-75). Тенговая — как записана. Валютная — по курсу Нацбанка на
 * день списания из книги (выходной — пятница, день впереди — последний курс книги, `rateOn`); книги или
 * дня нет — курс версии на момент ввода; нет и его — 0. Наценки банка нет.
 */
export function amountAt(o: Obligation, key = monthKey(), book?: RateBook | null): number {
  const v = versionAt(o, key);
  if (!v) return 0;
  if (!v.currency || v.currency === 'KZT') return v.amount;
  const rate = rateOn(book, v.currency, debitDayIso(o, key), v.rate);
  return rate ? fxToTenge(v.amount, rate) : 0;
}

/** Сколько этот платёж занимает в плане месяца, тенге (годовые делятся на 12). */
export function monthlyAmount(o: Obligation, key = monthKey(), book?: RateBook | null): number {
  const full = amountAt(o, key, book);
  return o.every === 'year' ? full / 12 : full;
}

/** Сколько годовой платёж занимает в плане месяца — до тенге (подсказки формы). */
export const yearShare = (yearly: number) => Math.round(yearly / 12);

/**
 * Запланированная смена суммы обязательства: насколько платёж изменится в месяц и
 * за год. Новой суммы нет — изменения нет. У годового сумма — за год: в месяц это
 * двенадцатая часть разницы, за год — сама разница (исключение из Р-2: React
 * умножал разницу годовой суммы ещё на 12, `memory/decisions/r2-exceptions-pv-block2.md`).
 */
export function plannedChange(current: number, planned: number, every?: Obligation['every']) {
  const diff = planned > 0 ? Math.round(planned - current) : 0;
  return every === 'year' ? { monthly: yearShare(diff), yearly: diff } : { monthly: diff, yearly: diff * 12 };
}

/** Списывается ли этот платёж в указанном месяце. Группа подписок не списывается никогда. */
export function dueIn(o: Obligation, key = monthKey()): boolean {
  if (o.group) return false;
  if (o.every !== 'year') return true;
  return (o.month ?? 1) === Number(key.split('-')[1]);
}

/** Ближайшее будущее изменение суммы; `delta` — в тенге (валютные — по книге, Р-75). */
export function nextChange(o: Obligation, key = monthKey(), book?: RateBook | null) {
  const versions = o.versions || [];
  const future = versions.filter((v) => v.from > key).sort((a, b) => a.from.localeCompare(b.from));
  if (!future.length) return null;
  return { ...future[0], delta: amountAt(o, future[0].from, book) - amountAt(o, key, book) };
}

export type FreedChange = {
  o: Obligation;
  change: NonNullable<ReturnType<typeof nextChange>>;
  /** Сколько освободится в месяц, целые тенге: у годового — двенадцатая часть разницы. */
  monthly: number;
  /** Сколько освободится за год: у годового — сама разница, у ежемесячного — ×12. */
  yearly: number;
};

/**
 * Событие «освободится N ₸ в месяц» («Деньги», разбор `?from=freed`): первое обязательство
 * списка, чья ближайшая новая сумма меньше текущей. Годовое — по реальной доле, как
 * `plannedChange` (`memory/decisions/r2-exceptions-pv-block2.md` п. 2: 60 000 → 48 000 —
 * 1 000 в месяц и 12 000 за год, а не 12 000 и 144 000); версия с нулём (конец платежа) —
 * освобождается вся сумма. null — снижений впереди нет.
 */
export function freedChange(list: Obligation[], key = monthKey(), book?: RateBook | null): FreedChange | null {
  for (const o of list) {
    const change = nextChange(o, key, book);
    if (!change || change.delta >= 0) continue;
    const d = -change.delta;
    return o.every === 'year' ? { o, change, monthly: yearShare(d), yearly: d } : { o, change, monthly: d, yearly: d * 12 };
  }
  return null;
}

/* ---------------- группы подписок и «оставить?» (RP-09) ---------------- */

/** Подписки группы — живые обязательства, лежащие в ней. */
export const groupChildren = (group: Obligation, list: Obligation[]) =>
  liveObligations(list).filter((o) => o.parentId === group.id);

/** Итог группы за месяц — сумма её подписок; годовые — долей, как в плане месяца. */
export function groupTotal(group: Obligation, list: Obligation[], key = monthKey(), book?: RateBook | null): number {
  return Math.round(groupChildren(group, list).reduce((a, o) => a + monthlyAmount(o, key, book), 0));
}

/**
 * Подписка — то, что заводит форма «Подписка или услуга»: быт (d4), сумма не
 * плавает. Аренду, кредиты и коммуналку «оставить?» не спрашиваем. Платёж людям (мелочи Р-5) — не подписка.
 */
export const isSubscription = (o: Obligation) => !o.group && o.category === 'd4' && !o.estimate && !o.people;
/** Платёж людям (мелочи Р-5): маме, алименты, школа — строка «Людям · N» в «Долгах» (`peopleGroup`). */
export const isPeoplePayment = (o: Obligation) => !o.group && !!o.people;

/**
 * За сколько дней до годового продления спрашивать «оставить?». Две недели —
 * успеть отменить до списания и решить вдвоём, а не в день, когда деньги ушли.
 */
export const KEEP_ASK_DAYS = 14;

/** Номер календарного дня — для разницы в днях. */
const dayNo = (key: string, day: number) => {
  const { year, month } = parseMonthKey(key);
  return Date.UTC(year, month, day) / 86_400_000;
};

/**
 * Кого спросить «оставить?» сейчас (Р-20). Только подписки, и не из группы с
 * флагом «рабочие». Годовую — в последние KEEP_ASK_DAYS дней перед продлением,
 * если в этом окне ещё не ответили. Ежемесячную — если последний ответ
 * «оставить» был до начала текущего квартала. Календарь — Алматы. Первыми —
 * ближайшие годовые продления, затем ежемесячные подороже.
 */
export function keepQuestions(list: Obligation[], now = new Date(), book?: RateBook | null): Obligation[] {
  const t = today(now);
  const todayNo = dayNo(t.key, t.day);
  const { year, month } = parseMonthKey(t.key);
  const quarterNo = dayNo(`${year}-${String(Math.floor(month / 3) * 3 + 1).padStart(2, '0')}`, 1);
  const quiet = new Set(liveGroups(list).filter((g) => g.noAsk).map((g) => g.id));

  const asks: { o: Obligation; wait: number }[] = [];
  for (const o of liveObligations(list)) {
    if (!isSubscription(o) || (o.parentId && quiet.has(o.parentId))) continue;
    const k = o.keptAt ? today(new Date(o.keptAt)) : null;
    const kept = k ? dayNo(k.key, k.day) : -Infinity;
    if (o.every === 'year') {
      const on = (y: number) => {
        const key = `${y}-${String(o.month ?? 1).padStart(2, '0')}`;
        return dayNo(key, Math.min(o.day, daysInMonth(key)));
      };
      const renewal = on(year) >= todayNo ? on(year) : on(year + 1);
      const from = renewal - KEEP_ASK_DAYS;
      if (todayNo >= from && kept < from) asks.push({ o, wait: renewal - todayNo });
    } else if (kept < quarterNo) {
      asks.push({ o, wait: Infinity });
    }
  }
  return asks
    .sort((a, b) => a.wait - b.wait || amountAt(b.o, t.key, book) - amountAt(a.o, t.key, book))
    .map((x) => x.o);
}

/** Оклад месяца в своей валюте (Р-70): версия с `from ≤ key`; версий нет — `p.salary` в тенге. */
export function salaryOf(p: Person, key = monthKey()): { amount: number; currency: Currency; rate?: number } {
  const v = (p.salaryVersions ?? [])
    .filter((x) => x.from <= key)
    .sort((a, b) => a.from.localeCompare(b.from));
  const cur = v[v.length - 1];
  return cur ? { amount: cur.amount, currency: cur.currency ?? 'KZT', rate: cur.rate } : { amount: p.salary, currency: 'KZT' };
}

/** День зарплаты месяца `key`, `YYYY-MM-DD` (31-е в сентябре — 30-е). */
export const paydayIso = (p: Pick<Person, 'payday'>, key: string) => isoIn(key, p.payday);

/* ---------------- Ритм зарплаты (понятность, Блок 7: Р-5, Р-6) ---------------- */

/**
 * Приход зарплаты месяца по ритму. `period` — ключ отметки «Пришла» (`Payment.period`): у месячного ритма — месяц
 * (старые отметки действуют), у аванса и недели — ISO-день события (уникален: `countedPayments` не схлопывает
 * соседние недели). `amount` — в валюте оклада.
 */
export type PayEvent = { period: string; day: string; amount: number; currency: Currency; kind: 'salary' | 'advance' | 'week' }

/** Месяц отметки: «2026-10» из «2026-10» и из «2026-10-02». */
export const periodMonth = (period: string) => period.slice(0, 7);

/** ISO-день недели даты `YYYY-MM-DD`: понедельник 1 … воскресенье 7. */
export const isoWeekday = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Ритм участника (Р-5): нет поля — `month`. Неполный ритм (аванс без своего дня или в день зарплаты, неделя без дня
 * недели) считается месячным — отметки не теряются, числа прежние.
 */
export function payRhythmOf(p: Pick<Person, 'payRhythm' | 'payday' | 'payday2' | 'weekday'>): PayRhythm {
  if (p.payRhythm === 'advance' && p.payday2 && p.payday2 >= 1 && p.payday2 <= 31 && p.payday2 !== p.payday) return 'advance';
  if (p.payRhythm === 'week' && p.weekday && p.weekday >= 1 && p.weekday <= 7) return 'week';
  return 'month';
}

/**
 * Приходы месяца по ритму (Р-5), по дням: месяц — один (`period = key`, день зарплаты); аванс — аванс в `payday2`
 * (`salary2`, не больше оклада) и остаток в `payday`; неделя — по одному на каждый `weekday` месяца (оклад — за
 * неделю). Аванс и зарплата в один день (31-е в феврале) или одна из сумм 0 — один приход всей суммой.
 */
export function payEvents(p: Person, key: string): PayEvent[] {
  const s = salaryOf(p, key);
  const rhythm = payRhythmOf(p);
  if (rhythm === 'week') {
    const out: PayEvent[] = [];
    for (let d = 1; d <= daysInMonth(key); d++) {
      const day = isoIn(key, d);
      if (isoWeekday(day) === p.weekday) out.push({ period: day, day, amount: s.amount, currency: s.currency, kind: 'week' });
    }
    return out;
  }
  if (rhythm === 'advance') {
    const advance = s.amount - advanceRest(s.amount, p.salary2);
    const a = isoIn(key, p.payday2!);
    const b = isoIn(key, p.payday);
    // Приход 0 (аванс не вписан — 0; оклад не больше аванса — остаток 0) не приход: его не отметить, и месяц не
    // «пришёл» бы никогда — ни «✓», ни «Отложить по плану» (критик Б7). Остаётся один приход всей суммой.
    const events = ([
      { period: a, day: a, amount: advance, currency: s.currency, kind: 'advance' },
      { period: b, day: b, amount: s.amount - advance, currency: s.currency, kind: 'salary' },
    ] as PayEvent[]).filter((e) => e.amount > 0);
    if (a === b || !events.length) return [{ period: b, day: b, amount: s.amount, currency: s.currency, kind: 'salary' }];
    return events.sort((x, y) => x.day.localeCompare(y.day));
  }
  return [{ period: key, day: paydayIso(p, key), amount: s.amount, currency: s.currency, kind: 'salary' }];
}

/** Остаток зарплаты после аванса (в валюте оклада): аванс не больше оклада и не меньше нуля. */
export const advanceRest = (salary: number, salary2 = 0) => salary - Math.min(Math.max(0, Math.round(salary2)), salary);

/** Подсказка при смене ритма «месяц → неделя» (PN-23): оклад месяца за неделю — × 12 / 52 (≈ ÷ 4,33), целые. */
export const weeklyFromMonthly = (amount: number) => Math.round((amount * 12) / 52);

/** Обратная подсказка «неделя → месяц» (`/ux` Б7): оклад недели за месяц — × 52 / 12, целые. */
export const monthlyFromWeekly = (amount: number) => Math.round((amount * 52) / 12);

/** Аванс по умолчанию — половина оклада, целые (PN-23; первый запуск держит его за окладом, пока аванс не вписан руками). */
export const advanceDefault = (salary: number) => Math.round(salary / 2);

/** Ритм по умолчанию при выборе в форме (PN-23): аванс — 25-го при зарплате до 15-го, иначе 15-го; половина оклада; неделя — пятница. */
export function rhythmDefaults(p: Pick<Person, 'payday' | 'payday2' | 'salary2' | 'weekday'>, rhythm: PayRhythm, salary: number): Partial<Person> {
  if (rhythm === 'advance') {
    const day = p.payday2 && p.payday2 !== p.payday ? p.payday2 : p.payday <= 15 ? 25 : 15;
    return { payRhythm: 'advance', payday2: day, salary2: p.salary2 ?? advanceDefault(salary) };
  }
  if (rhythm === 'week') return { payRhythm: 'week', weekday: p.weekday ?? 5 };
  return { payRhythm: 'month' };
}

/** Приход по ключу отметки (`period` месяца или ISO-дня); не нашёлся (ритм сменили) — null. */
export const payEventOf = (p: Person, period: string): PayEvent | null =>
  payEvents(p, periodMonth(period)).find((e) => e.period === period) ?? null;

/** Оклад месяца в валюте оклада по ритму — сумма приходов (неделя — × число недель месяца). */
export const salaryMonthly = (p: Person, key = monthKey()) => payEvents(p, key).reduce((a, e) => a + e.amount, 0);

/** Тенге прихода по окладу: тенговый — как есть; валютный — по курсу Нацбанка на день прихода (нет — курс версии). */
export function payEventTenge(ev: PayEvent, book?: RateBook | null, fallbackRate?: number): number {
  if (ev.currency === 'KZT') return ev.amount;
  const rate = rateOn(book, ev.currency, ev.day, fallbackRate);
  return rate ? fxToTenge(ev.amount, rate) : 0;
}

/**
 * Оклад месяца в тенге (Р-70, Р-72). Тенговый — как записан. Валютный — по курсу Нацбанка на
 * день зарплаты месяца из книги (выходной — пятница; день ещё не наступил — последний курс
 * книги); книги или дня в ней нет — по курсу версии на момент ввода. Это оклад (форма, подписи);
 * тенге зарплаты месяца с обменами — `salaryTenge` (Р-74). По ритму (Б7) — сумма приходов, каждый по курсу своего дня.
 */
export function salaryAt(p: Person, key = monthKey(), book?: RateBook | null): number {
  const s = salaryOf(p, key);
  return payEvents(p, key).reduce((a, e) => a + payEventTenge(e, book, s.rate), 0);
}

/** Тенге одного прихода по окладу (лист «Пришла», сумма по умолчанию): `period` — месяц или ISO-день. */
export function payEventAt(p: Person, period: string, book?: RateBook | null): number {
  const ev = payEventOf(p, period);
  return ev ? payEventTenge(ev, book, salaryOf(p, periodMonth(period)).rate) : 0;
}

/** Из чего считаются тенге зарплаты месяца (Р-74): книга курсов, отметки «Пришла», обмены. */
export type SalaryCtx = { book?: RateBook | null; payments?: Payment[]; exchanges?: FxExchange[] };

/** Контекст тенге зарплаты из состояния расчёта (документ семьи + книга). */
export const salaryCtxOf = (s: { book?: RateBook | null; payments?: Payment[]; fxExchanges?: FxExchange[] }): SalaryCtx => ({
  book: s.book,
  payments: s.payments,
  exchanges: s.fxExchanges,
});

export type SalaryTenge = {
  /** Тенге зарплаты месяца, целые. */
  tenge: number;
  currency: Currency;
  /** Обменяно за месяц, в валюте, и сколько тенге за это получили (по своему курсу). */
  exchanged: number;
  exchangedTenge: number;
  /** Необменянное, в валюте (не меньше нуля). */
  left: number;
  /** Курс Нацбанка для необменянного и его день (`YYYY-MM-DD`, день зарплаты месяца). */
  rate: number | null;
  rateDay: string;
};

/**
 * Тенге зарплаты месяца (Р-74) — вход «до зарплаты», бюджета, разбора и сопоставления выписки.
 * Тенговый оклад — как `salaryAt` (поведение прежнее). Валютный: обменянное за месяц — тенге
 * обменов (свой курс), необменянное — по курсу Нацбанка на день зарплаты (выходной — пятница;
 * день впереди — последний курс книги; книги нет — курс версии). До прихода необменянное — весь
 * оклад. Обменяли больше, чем пришло, — необменянное 0, тенге — сумма обменов (в минус не уходит).
 * Пришла в тенге (отметка без `foreign`: выписка тенгового счёта — банк уже обменял) — сумма отметки.
 */
export function salaryTenge(p: Person, key = monthKey(), ctx: SalaryCtx = {}): SalaryTenge {
  if (payRhythmOf(p) !== 'month') return rhythmSalaryTenge(p, key, ctx);
  const s = salaryOf(p, key);
  const rateDay = paydayIso(p, key);
  const none = { exchanged: 0, exchangedTenge: 0, left: 0, rateDay };
  if (s.currency === 'KZT') return { ...none, tenge: s.amount, currency: 'KZT', rate: 1 };
  const record = paidFor(ctx.payments, 'salary', p.id, key);
  if (record && !record.foreign) return { ...none, tenge: record.amount, currency: s.currency, rate: null };
  const currency = record?.currency ?? s.currency;
  const xs = liveExchanges(ctx.exchanges).filter((x) => x.by === p.id && x.period === key);
  const exchanged = xs.reduce((a, x) => a + x.foreign, 0);
  const exchangedTenge = xs.reduce((a, x) => a + x.tenge, 0);
  const left = Math.max(0, (record?.foreign ?? s.amount) - exchanged);
  const rate = rateOn(ctx.book, currency, rateDay, s.rate);
  return { tenge: exchangedTenge + (rate ? fxToTenge(left, rate) : 0), currency, exchanged, exchangedTenge, left, rate, rateDay };
}

/**
 * `salaryTenge` аванса и недели (Б7): тенговый — оклад месяца (сумма приходов); валютный — каждый приход по курсу
 * своего дня, пришедший в тенге — суммой отметки; обмены месяца (`FxExchange.period` — месяц) гасят необменянное с
 * первых приходов. Курс и день строки — первого прихода.
 */
function rhythmSalaryTenge(p: Person, key: string, ctx: SalaryCtx): SalaryTenge {
  const s = salaryOf(p, key);
  const events = payEvents(p, key);
  const rateDay = events[0]?.day ?? paydayIso(p, key);
  const none = { exchanged: 0, exchangedTenge: 0, left: 0, rateDay };
  if (s.currency === 'KZT') return { ...none, tenge: events.reduce((a, e) => a + e.amount, 0), currency: 'KZT', rate: 1 };
  const records = events.map((e) => paidFor(ctx.payments, 'salary', p.id, e.period));
  const currency = records.find((r) => r?.currency)?.currency ?? s.currency;
  const xs = liveExchanges(ctx.exchanges).filter((x) => x.by === p.id && x.period === key);
  const exchanged = xs.reduce((a, x) => a + x.foreign, 0);
  const exchangedTenge = xs.reduce((a, x) => a + x.tenge, 0);
  let cover = exchanged;
  let tenge = exchangedTenge;
  let left = 0;
  events.forEach((e, i) => {
    const r = records[i];
    if (r && !r.foreign) {
      tenge += r.amount;
      return;
    }
    const f = r?.foreign ?? e.amount;
    const take = Math.min(f, cover);
    cover -= take;
    left += f - take;
    const rate = rateOn(ctx.book, currency, e.day, s.rate);
    tenge += rate ? fxToTenge(f - take, rate) : 0;
  });
  return { tenge, currency, exchanged, exchangedTenge, left, rate: rateOn(ctx.book, currency, rateDay, s.rate), rateDay };
}

/**
 * Сколько курс отнял или добавил за год (Р-76): оклад месяца в валюте × (курс на день зарплаты −
 * курс дня зарплаты того же месяца год назад), каждая сторона — `fxToTenge`. `perUnit` — разница
 * курса за единицу до тенге (подпись «евро −134 ₸ за год»). Тенговый оклад или нет курса год назад
 * (книга короче) — null.
 */
export function fxYearDelta(p: Person, key = monthKey(), book?: RateBook | null) {
  const d = fxMonthDelta(p, key, addMonths(key, -12), book);
  if (!d) return null;
  return { currency: d.currency, rateNow: d.rateNow, rateThen: d.rate, perUnit: Math.round(d.rateNow - d.rate), tenge: -d.tenge };
}

/**
 * Зарплата месяца `key` против любого месяца `otherKey` (лист «Курс евро», Р-76): курс того месяца на
 * день зарплаты и сколько бы оклад этого месяца дал по нему — «в марте по 590 ₸ · было бы +126 000 ₸»
 * (`tenge` = по тому курсу − по нынешнему). Тенговый оклад или нет курса — null.
 */
export function fxMonthDelta(p: Person, key: string, otherKey: string, book?: RateBook | null) {
  const s = salaryOf(p, key);
  if (s.currency === 'KZT') return null;
  // Ритм (Б7): оклад месяца — сумма приходов, курс — на день первого прихода.
  const amount = salaryMonthly(p, key);
  const rateNow = rateOn(book, s.currency, firstPayDay(p, key), s.rate);
  const rate = rateOn(book, s.currency, firstPayDay(p, otherKey));
  if (!rateNow || !rate) return null;
  return {
    currency: s.currency,
    rateNow,
    rate,
    perUnit: Math.round(rate - rateNow),
    tenge: fxToTenge(amount, rate) - fxToTenge(amount, rateNow),
  };
}

/** День первого прихода месяца (месячный ритм — день зарплаты): курс строки «евро за год» и графика курса. */
export const firstPayDay = (p: Person, key: string) => payEvents(p, key)[0]?.day ?? paydayIso(p, key);

/** Курсы валюты по книге за период `[from, to]` по дням — линия графика листа курса. */
export function rateSeries(book: RateBook | null | undefined, code: Currency, from: string, to: string): { day: string; rate: number }[] {
  return Object.entries(book?.[code] ?? {})
    .filter(([d]) => d >= from && d <= to)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, rate]) => ({ day, rate }));
}

/**
 * Дни зарплаты прошлых `n` месяцев до `key` (старые первыми) с курсом на них и разницей против
 * `key` (`fxMonthDelta`) — отметки графика и чипы месяцев листа. Месяц без курса — пропускается.
 */
export function paydayRates(p: Person, key: string, book: RateBook | null | undefined, n = 12) {
  const out: { key: string; day: string; rate: number; tenge: number }[] = [];
  for (let i = n; i >= 1; i--) {
    const k = addMonths(key, -i);
    const d = fxMonthDelta(p, key, k, book);
    if (d) out.push({ key: k, day: firstPayDay(p, k), rate: d.rate, tenge: d.tenge });
  }
  return out;
}

/** Совокупный доход участников, тенге: зарплаты месяца по Р-74 (`salaryTenge`). */
export const totalIncome = (people: Person[], key = monthKey(), ctx: SalaryCtx = {}) =>
  (people || []).filter(alive).reduce((a, p) => a + salaryTenge(p, key, ctx).tenge, 0);

/** Проверка наличия заведённых данных в бюджете. */
export function hasBudgetData(state: {
  people?: Person[];
  obligations?: Obligation[];
  credits?: Credit[];
  goals?: Goal[];
  accounts?: Account[];
}): boolean {
  const people = state.people || [];
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const goals = state.goals || [];
  const accounts = state.accounts || [];

  return (
    people.some((p) => salaryOf(p).amount > 0) ||
    liveObligations(obligations).length > 0 ||
    liveCredits(credits).length > 0 ||
    liveGoals(goals).length > 0 || // Сбылось (PN-13): сбывшаяся — тоже данные семьи
    liveAccounts(accounts).length > 0
  );
}

/* ---------------- статьи разбора (Блок 11) ---------------- */

/** Порядок статей по умолчанию (Р-56) — ступени. */
export const ARTICLE_ORDER: ArticleKey[] = ['must', 'life', 'reserve', 'debts', 'cushion', 'dreams', 'spend']

export const ARTICLE_NAMES: Record<ArticleKey, string> = {
  must: 'Обязательное',
  life: 'Жизнь',
  reserve: 'Запас',
  debts: 'Дорогие долги',
  cushion: 'Подушка',
  dreams: 'Мечты',
  spend: 'Траты',
}

/** Пороги по умолчанию (B2C-54 п. 3): запас — месяц трат, подушка — 3 месяца, дорогой — любой процентный. */
export const DEFAULT_MONEY_SETTINGS = { reserveMonths: 1, cushionMonths: 3, costlyRate: 0 } as const

/**
 * План статей семьи (B2C-54): записи документа поверх умолчаний — порядок и `on` по Р-56,
 * «Жизнь» — сумма раздела d4 (как планировали до Блока 11), «Траты», «Запас», «Подушка»,
 * «Дорогие долги» — 0. Удалённая запись — снова умолчание. По `order`.
 */
export function moneyArticlesOf(doc: { moneyArticles?: MoneyArticle[]; categories?: Category[] }): MoneyArticle[] {
  const own = new Map((doc.moneyArticles ?? []).filter(alive).map((a) => [a.id, a]))
  const d4 = (doc.categories ?? []).find((c) => c.key === 'd4')?.amount ?? 0
  return ARTICLE_ORDER.map((id, i): MoneyArticle => {
    const base: MoneyArticle = {
      id,
      order: i + 1,
      on: true,
      updatedAt: '',
      ...(id === 'must' || id === 'dreams' ? {} : { amount: id === 'life' ? d4 : 0 }),
    }
    return { ...base, ...own.get(id) }
  }).sort((a, b) => a.order - b.order || ARTICLE_ORDER.indexOf(a.id) - ARTICLE_ORDER.indexOf(b.id))
}

/** Пороги ступеней семьи с умолчаниями (B2C-54). */
export function moneySettingsOf(doc: { moneySettings?: MoneySettings | null }): MoneySettings {
  return { ...DEFAULT_MONEY_SETTINGS, potGoalId: null, orderedAt: null, updatedAt: '', ...(doc.moneySettings ?? {}) }
}

/**
 * Итог раздела в тратах — одно правило «Свободно», «Месяца», «Истории» и «Недели» (хвосты 952/967): раздел платежей
 * (`plannedElsewhere`) — только строки без отметки (`unmarked`: незаведённая рассрочка, вторая строка продавца),
 * отмеченные уже в платежах месяца; остальные разделы и «не разобрано» — весь итог без разовых (FB-07, Р-16: разовая
 * не раздувает раздел и «обычно»; в факт месяца её возвращает `factOf`).
 */
export const spentOf = (t: SpendTotal, live: SpendCategory[]) =>
  t.categoryId === UNKNOWN_CATEGORY || !plannedElsewhere(t.categoryId, live) ? t.amount - (t.oneOff ?? 0) : (t.unmarked ?? 0)

/** Разовые итога (FB-07): в разделе платежей разовая — как обычная строка (`unmarked`), здесь 0. */
export const oneOffOf = (t: SpendTotal, live: SpendCategory[]) =>
  t.categoryId === UNKNOWN_CATEGORY || !plannedElsewhere(t.categoryId, live) ? (t.oneOff ?? 0) : 0

/** Итог в факте месяца и недели («потрачено», Р-5): траты раздела и разовые. */
export const factOf = (t: SpendTotal, live: SpendCategory[]) => spentOf(t, live) + oneOffOf(t, live)

/** Строка трат плана месяца (Р-81): живая, с суммой, раздел не учтён платежами (`plannedElsewhere`). */
export const planSpendOn = (x: SpendPlan, live: SpendCategory[]) => !x.deletedAt && x.amount > 0 && !plannedElsewhere(x.categoryId, live)

/** Траты плана месяца всех участников (`spendPlans`, Р-81) — `null`, пока семья их не завела. */
export function planSpendTotal(doc: { spendPlans?: SpendPlan[]; spendCategories?: SpendCategory[]; people?: Person[] }): number | null {
  const live = (doc.spendCategories ?? []).filter(alive)
  const ids = new Set((doc.people ?? []).filter(alive).map((p) => p.id))
  const rows = (doc.spendPlans ?? []).filter((x) => ids.has(x.by) && planSpendOn(x, live))
  return rows.length ? rows.reduce((s, x) => s + x.amount, 0) : null
}

/**
 * Сумма месяца «Жизни» и «Трат» — одна правда раздела d4 (B2C-54 п. 4): заведены траты плана месяца — их сумма
 * (`planSpendTotal`, хвост §4 Б14 «план трат в двух местах»); иначе статьи (выключенная — 0), без статей —
 * `d4.amount`, как до Блока 11.
 */
export function livingPlan(doc: {
  moneyArticles?: MoneyArticle[]
  categories?: Category[]
  spendPlans?: SpendPlan[]
  spendCategories?: SpendCategory[]
  people?: Person[]
}): number {
  const fromPlan = planSpendTotal(doc)
  if (fromPlan !== null) return fromPlan
  return moneyArticlesOf(doc)
    .filter((a) => (a.id === 'life' || a.id === 'spend') && a.on)
    .reduce((s, a) => s + (a.amount ?? 0), 0)
}

/**
 * Суммы по 5 разделам бюджета. Кредиты — производные (геттер стора): платёж
 * закрытого кредита в «Кредиты» не входит и освобождает «Свободно» — кроме месяца,
 * когда его закрыл плановый «Оплатил» (`creditMonthPayment`).
 *
 * С активным планом «Сначала долги» (PV-14) взносы целей на паузе и платежи
 * закрытых долгов плана уходят из «Взносов в цели» и «Свободно» в отдельную строку
 * `planExtra` — «Досрочно по плану». «Свободно» от выбора плана не меняется.
 * `key` — месяц плана (по умолчанию этот): раскладка зарплаты прошлого месяца считает его план.
 */
export function budgetAmounts(state: {
  categories?: Category[];
  obligations?: Obligation[];
  credits?: Credit[];
  goals?: Goal[];
  people?: Person[];
  payments?: Payment[];
  plans?: DebtPlan[];
  moneyArticles?: MoneyArticle[];
  /** Траты плана месяца (Р-81): заведены — «Жизнь» и «Траты» берутся из них (`livingPlan`). */
  spendPlans?: SpendPlan[];
  spendCategories?: SpendCategory[];
  /** Книга курсов и обмены (Р-74, Р-75): валютные зарплаты и платежи — в тенге по курсу. */
  book?: RateBook | null;
  fxExchanges?: FxExchange[];
}, key = monthKey()) {
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const goalsList = state.goals || [];
  const people = state.people || [];
  const categories = state.categories || [];
  const payments = state.payments || [];
  const plan = activePlan(state.plans ?? []);

  const housing = liveObligations(obligations)
    .filter((o) => o.category === 'd1')
    .reduce((a, o) => a + monthlyAmount(o, key, state.book), 0);
  const other = liveObligations(obligations)
    .filter((o) => o.category !== 'd1' && o.category !== 'd2')
    .reduce((a, o) => a + monthlyAmount(o, key, state.book), 0);
  const debts =
    liveCredits(credits).reduce((a, c) => a + creditMonthPayment(c, payments, key), 0) +
    liveObligations(obligations)
      .filter((o) => o.category === 'd2')
      .reduce((a, o) => a + monthlyAmount(o, key, state.book), 0);
  const paused = new Set(plan ? pausedGoals(plan, goalsList).map((g) => g.id) : []);
  const goals = openGoals(goalsList) // Сбылось (PN-13): деньги сбывшейся ушли покупкой — в бюджете их нет
    .filter((g) => !paused.has(g.id))
    .reduce((a, g) => a + g.monthly, 0);
  const extra = plan ? planExtra(plan, goalsList, credits, payments, key) : 0;
  const living = livingPlan({ categories, moneyArticles: state.moneyArticles, spendPlans: state.spendPlans, spendCategories: state.spendCategories, people }) + other;
  const income = totalIncome(people, key, salaryCtxOf(state));
  const free = income - housing - debts - goals - living - extra;

  return { d1: housing, d2: debts, d3: goals, d4: living, d5: free, income, planExtra: extra };
}

export const goalSavings = (goals: Goal[]) =>
  openGoals(goals) // Сбылось (PN-13): сбывшаяся — не актив, деньги ушли покупкой
    .filter((g) => !g.accountId)
    .reduce((a, g) => a + Math.max(0, g.have), 0);

/** Сумма строк с `amount` в тенге: живые счета (итог «Счетов»), досрочки месяца и т. п. — одно правило. */
export const amountTotal = (list: { amount: number }[]) => list.reduce((a, x) => a + x.amount, 0);

export const netWorth = (accounts: Account[], credits: Credit[], goals: Goal[] = []) =>
  amountTotal(liveAccounts(accounts)) +
  goalSavings(goals) -
  liveCredits(credits).reduce((a, c) => a + c.principal, 0);

export type CapitalGoal = { goalId: string; name: string; amount: number; accountName: string | null }

/**
 * «Цели · N» в «Счетах» «Капитала» (Р-109): живые цели с накопленным. Цель со счётом (`accountId`) — с его
 * именем: её деньги уже в остатке счёта, в `total` не входит (как в `goalSavings`, двойного счёта нет). `count` и
 * `total` — цели вне счетов (макет: «Цели · 3 · 4 140 000» над четырьмя строками), так что
 * итог «Счетов» (счета + `total`) − «Кредиты» = `netWorth`. Порядок: вне счетов, потом на счетах — по сумме.
 */
export function capitalGoals(goals: Goal[], accounts: Account[]): { count: number; total: number; items: CapitalGoal[] } {
  const named = new Map(accounts.map((a) => [a.id, a.name]))
  const items = openGoals(goals) // Сбылось (PN-13): деньги сбывшейся ушли покупкой — в «Цели · N» её нет
    .filter((g) => g.have > 0)
    .map((g) => ({ goalId: g.id, name: g.name, amount: g.have, accountName: g.accountId ? (named.get(g.accountId) ?? 'счёт') : null }))
    .sort((a, b) => Number(!!a.accountName) - Number(!!b.accountName) || b.amount - a.amount)
  const outside = items.filter((g) => !g.accountName)
  return { count: outside.length, total: amountTotal(outside), items }
}

/* ---------------- отметки оплат и остатки из них (RP-06) ---------------- */

/** Что можно отметить по графику. Досрочка — не платёж графика, а отдельный взнос. */
export type ScheduledKind = 'obligation' | 'credit'
/** Отметка за месяц — одна на пару (цель, месяц): платёж по графику или зарплата (RP-10). */
export type MonthlyKind = ScheduledKind | 'salary'

/**
 * Очередной платёж кредита: сколько уйдёт в проценты и сколько в тело (Р-4).
 *
 * Проценты за месяц — остаток × ставка / 12, как везде в этом файле, округлённые
 * до тенге: в документ и на экран попадают только целые. Больше остатка с
 * процентами не берётся — последний платёж закрывает долг, а не переплачивает.
 * Сумма меньше процентов долг не двигает: тело 0, всё ушло банку.
 */
export function creditSplit(principal: number, annualRate: number, amount: number) {
  const left = Math.max(0, Math.round(principal))
  return splitPayment(left, Math.round((left * annualRate) / 12), amount)
}

/**
 * Правка отметки кредита (другая сумма): проценты месяца — из исправляемой записи.
 * Они зависят от остатка до платежа, а не от суммы, и не должны пересчитываться
 * от остатка, который с тех пор уменьшили отметки следующих месяцев. `left` —
 * остаток без этой отметки: больше него в тело не уйдёт.
 */
export function creditResplit(old: Payment, amount: number, left: number) {
  return splitPayment(Math.max(0, Math.round(left)), Math.max(0, old.amount - (old.principal ?? 0)), amount)
}

function splitPayment(left: number, interest: number, amount: number) {
  const paid = Math.max(0, Math.min(Math.round(amount), left + interest))
  const body = Math.min(left, Math.max(0, paid - interest))
  return { amount: paid, interest: paid - body, body }
}

/** Сколько списать по графику в этом месяце: платёж, а в последний раз — остаток с процентами. */
export const creditDueAmount = (c: Credit) => creditSplit(c.principal, c.annualRate, c.payment).amount

/**
 * Ждёт ли кредит платежа в этом месяце. Закрытый долг (остаток из отметок 0) —
 * нет, если только его не закрыли платежом этого же месяца: тогда платёж есть и
 * показывается оплаченным. Одно правило для Бюджета, «Денег → История» и «до зарплаты».
 */
export const creditDueIn = (c: Credit, payments: Payment[], key: string) =>
  !!paidFor(payments, 'credit', c.id, key) || creditDueAmount(c) > 0

/**
 * Платёж кредита за месяц — одно правило для «Кредитов» бюджета, «На обязательства»
 * (`monthDues`) и плана (PV-14 п. 5): отмеченный в этом месяце — сумма отметки
 * (деньги ушли, даже если она закрыла долг); неотмеченный — платёж по графику
 * (`creditDueAmount`: в последний месяц — остаток с процентами); закрытый раньше или
 * досрочкой — 0: платёж свободен (без плана — в «Свободно», с планом — в следующий
 * долг, `planExtra`). Кредит — производный.
 */
export function creditMonthPayment(c: Credit, payments: Payment[], key: string): number {
  if (!creditDueIn(c, payments, key)) return 0
  return paidFor(payments, 'credit', c.id, key)?.amount ?? creditDueAmount(c)
}

/**
 * Отметки, которые считаются.
 *
 * Надгробия не считаются — так снятая отметка возвращает деньги. Одну пару
 * (цель, месяц) могли отметить с двух телефонов офлайн: записей две, а платёж
 * был один. Считается ранняя по времени, при равенстве — с меньшим id, остальные
 * ни на что не влияют (Р-7). Досрочки не схлопываются: две за месяц — два взноса.
 */
export function countedPayments(payments: Payment[] = []): Payment[] {
  const first = new Map<string, Payment>()
  const prepays: Payment[] = []
  for (const p of payments) {
    if (p.deletedAt) continue
    if (p.kind === 'prepay') {
      prepays.push(p)
      continue
    }
    const key = `${p.kind}:${p.targetId}:${p.period}`
    const cur = first.get(key)
    if (!cur || p.at < cur.at || (p.at === cur.at && p.id < cur.id)) first.set(key, p)
  }
  return [...first.values(), ...prepays]
}

/** Отметка, по которой платёж за месяц считается оплаченным; null — не отмечен. */
export function paidFor(
  payments: Payment[] = [],
  kind: MonthlyKind,
  targetId: string,
  period: string,
): Payment | null {
  return (
    countedPayments(payments).find(
      (p) => p.kind === kind && p.targetId === targetId && p.period === period,
    ) ?? null
  )
}

/**
 * Действует ли отметка на остаток: сделана не раньше ручной сверки — до неё
 * деньги уже вошли во введённую сумму. Сверки не было — действуют все.
 */
export const afterAnchor = (p: Pick<Payment, 'at'>, anchor?: string | null) => !anchor || p.at >= anchor

/** Обмены и курсы для остатков (B2C-79): `day` — сегодня (`YYYY-MM-DD`), курс валютного счёта — на него. */
export type BalanceCtx = { exchanges?: FxExchange[]; book?: RateBook | null; day?: string };

export const liveExchanges = (list: FxExchange[] = []) => list.filter(alive);

const isForeign = (a: Pick<Account, 'currency'>) => !!a.currency && a.currency !== 'KZT';

/**
 * Остаток валютного счёта в валюте (Р-73): база ручной сверки (`foreignAmount`) + пришедшие
 * зарплаты в валюте − обмены, всё — после сверки (`amountSetAt`): сверка после обмена его не удваивает.
 */
export function accountForeign(a: Account, payments: Payment[] = [], exchanges: FxExchange[] = []): number {
  const came = countedPayments(payments)
    .filter((p) => p.kind === 'salary' && p.accountId === a.id && p.foreign && afterAnchor(p, a.amountSetAt))
    .reduce((s, p) => s + (p.foreign ?? 0), 0);
  const sold = liveExchanges(exchanges)
    .filter((x) => x.accountId === a.id && afterAnchor(x, a.amountSetAt))
    .reduce((s, x) => s + x.foreign, 0);
  return (a.foreignAmount ?? 0) + came - sold;
}

/**
 * Остаток счёта в тенге: база минус списания и плюс зарплаты по отметкам после сверки.
 * Зарплата (RP-10) — зачисление; знак записи — только здесь: `shiftedBase` и стор
 * берут остаток отсюда. Тенговый счёт получает тенге обменов (B2C-79). Валютный (Р-73) —
 * остаток в валюте по курсу Нацбанка на `ctx.day` из книги; нет курса — ручной `rate` счёта.
 */
export function accountBalance(a: Account, payments: Payment[] = [], ctx: BalanceCtx = {}): number {
  if (isForeign(a)) {
    const rate = rateOn(ctx.book, a.currency!, ctx.day ?? '9999-12-31', a.rate);
    return rate ? fxToTenge(accountForeign(a, payments, ctx.exchanges), rate) : a.amount;
  }
  const bought = liveExchanges(ctx.exchanges)
    .filter((x) => x.toAccountId === a.id && afterAnchor(x, a.amountSetAt))
    .reduce((s, x) => s + x.tenge, 0);
  return countedPayments(payments)
    .filter((p) => p.accountId === a.id && afterAnchor(p, a.amountSetAt))
    .reduce((left, p) => (p.kind === 'salary' ? left + p.amount : left - p.amount), a.amount + bought)
}

/** Живые обмены зарплаты участника за месяц `period`, по времени записи (лист обменов, B2C-79-а). */
export const monthExchanges = (exchanges: FxExchange[] = [], by: PersonId, period: string) =>
  liveExchanges(exchanges)
    .filter((x) => x.by === by && x.period === period)
    .sort((a, b) => a.at.localeCompare(b.at));

/** Обменяно за месяц `period` из зарплаты участника, в валюте (строка «обменяно 800 € из 1 500 €»). */
export function exchangedIn(exchanges: FxExchange[] = [], by: PersonId, period: string): number {
  return monthExchanges(exchanges, by, period).reduce((s, x) => s + x.foreign, 0);
}

/**
 * Валютная зарплата месяца, пришедшая на валютный счёт: сколько пришло, обменяно и осталось
 * обменять (не меньше нуля). Тенговая или не пришедшая — null.
 */
export function salaryExchange(payments: Payment[] = [], exchanges: FxExchange[] = [], by: PersonId, period: string) {
  const record = paidFor(payments, 'salary', by, period);
  if (!record?.foreign || !record.currency || record.currency === 'KZT') return null;
  const exchanged = exchangedIn(exchanges, by, period);
  return { record, currency: record.currency, came: record.foreign, exchanged, left: Math.max(0, record.foreign - exchanged) };
}

/**
 * Тенге пришедшей зарплаты (отметка `record`): тенговая — сумма отметки (премия правкой), как
 * раньше; валютная — `salaryTenge` (обмены по своему курсу + остаток по курсу дня зарплаты, Р-74).
 */
export function paidTenge(
  state: { people?: Person[]; payments?: Payment[]; book?: RateBook | null; fxExchanges?: FxExchange[] },
  personId: PersonId,
  period: string,
  record: Payment,
): number {
  const p = record.foreign ? (state.people ?? []).find((x) => x.id === personId) : undefined;
  if (!p) return record.amount;
  // Приход аванса или недели (Б7, `period` — ISO-день): валюта по курсу дня прихода; обмены — у месячной строки.
  if (period.length > 7) {
    const rate = rateOn(state.book, record.currency ?? 'KZT', period);
    return rate ? fxToTenge(record.foreign!, rate) : record.amount;
  }
  return salaryTenge(p, period, salaryCtxOf(state)).tenge;
}

/* ---------------- Ожидание и отметки по ритму (Б7) ---------------- */

/**
 * Сколько ждать от прихода `ev`, тенге. Плавающая сумма (Р-6) — среднее трёх последних отметок участника того же
 * вида прихода (месяц — месячные, аванс — авансы, неделя — недели; по `at`, не позже месяца прихода; меньше трёх —
 * среднее имеющихся; нет — оклад). Иначе — оклад: месячный ритм — `salaryTenge` (обмены, Р-74), прочие — по курсу дня.
 */
export function expectedEventTenge(p: Person, ev: PayEvent, ctx: SalaryCtx = {}): number {
  if (p.floating) {
    const monthly = ev.period.length === 7;
    const kindOf = (r: Payment) => (r.period.length === 7 ? 'salary' : payEventOf(p, r.period)?.kind);
    const last = countedPayments(ctx.payments)
      .filter((r) => r.kind === 'salary' && r.targetId === p.id && periodMonth(r.period) <= periodMonth(ev.period))
      .filter((r) => (r.period.length === 7) === monthly && kindOf(r) === ev.kind)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 3);
    if (last.length) return Math.round(last.reduce((a, r) => a + r.amount, 0) / last.length);
  }
  if (ev.period.length === 7) return salaryTenge(p, ev.period, ctx).tenge;
  return payEventTenge(ev, ctx.book, salaryOf(p, periodMonth(ev.period)).rate);
}

/** Сколько ждём за месяц по ритму, тенге (без отметок): сумма ожиданий приходов. */
export const expectedSalaryTenge = (p: Person, key: string, ctx: SalaryCtx = {}) =>
  payEvents(p, key).reduce((a, e) => a + expectedEventTenge(p, e, ctx), 0);

/** Отметки «Пришла» по приходам месяца — по одной на событие (`paidFor` по `event.period`), null — не пришёл. */
export const salaryRecords = (payments: Payment[] = [], p: Person, key: string) =>
  payEvents(p, key).map((e) => paidFor(payments, 'salary', p.id, e.period));

/** Последняя по времени отметка «Пришла» участника за месяц `key` (любой приход ритма); нет — null. */
export const lastSalaryRecord = (payments: Payment[] = [], personId: string, key: string): Payment | null =>
  countedPayments(payments)
    .filter((r) => r.kind === 'salary' && r.targetId === personId && periodMonth(r.period) === key)
    .sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;

/** Приход месяца плана: тенге (пришёл — факт `paidTenge`, нет — ожидание) и пришёл ли. */
export type IncomeEvent = { period: string; day: string; kind: PayEvent['kind']; amount: number; came: boolean };

/** Приходы участника за месяц с фактом и ожиданием — доход плана (`monthPlan`) и строки зарплат. */
export function incomeEvents(
  state: { payments?: Payment[]; book?: RateBook | null; fxExchanges?: FxExchange[]; people?: Person[] },
  p: Person,
  key: string,
): IncomeEvent[] {
  const ctx = salaryCtxOf(state);
  return payEvents(p, key).map((e) => {
    const rec = paidFor(state.payments, 'salary', p.id, e.period);
    const amount = rec ? paidTenge(state, p.id, e.period, rec) : expectedEventTenge(p, e, ctx);
    return { period: e.period, day: e.day, kind: e.kind, amount, came: !!rec };
  });
}

/**
 * Новая база счёта, когда остаток сдвигают на сумму (взнос в цель со счёта,
 * снятие с цели, внеплановый доход). Это не сверка с банком: база меняется на ту
 * же дельту, якорь остаётся прежним — иначе отметки до этого момента (снятая по
 * ошибке, офлайн-отметка партнёра) перестали бы двигать остаток. Видимый остаток
 * ниже нуля не уводится — как раньше у взноса в цель.
 */
export function shiftedBase(a: Account, payments: Payment[], delta: number, ctx: BalanceCtx = {}): number {
  const visible = accountBalance(a, payments, ctx)
  return a.amount + Math.max(Math.round(delta), -Math.max(0, visible))
}

/** Остаток долга: база минус тело по отметкам и досрочкам после ручного ввода. */
export function creditBalance(c: Credit, payments: Payment[] = []): number {
  const paid = countedPayments(payments)
    .filter((p) => p.targetId === c.id && (p.kind === 'credit' || p.kind === 'prepay') && afterAnchor(p, c.principalSetAt))
    .reduce((sum, p) => sum + (p.principal ?? 0), 0)
  return Math.max(0, c.principal - paid)
}

/** Кредиты с остатком из отметок (RP-06) — как их отдаёт стор экранам (`financeStore.credits`) и сводка ИИ. */
export const derivedCredits = (list: Credit[], payments: Payment[]) => list.map((c) => ({ ...c, principal: creditBalance(c, payments) }))

/**
 * Ставка в процентах до сотых, числом (сводка ИИ): 0.19 → 19, 0.165 → 16.5 — как поле ставки (`rateField`, money.ts;
 * ту же формулу не переиспользовать оттуда — money.ts не тянет finance.ts, иначе цикл импортов).
 */
export const ratePercent = (r: number) => Math.round(r * 10_000) / 100

/**
 * Сколько процентов не отдадим банку по всем применённым досрочкам (Р-6): живые
 * досрочки живых кредитов. Удалённый кредит из счётчика уходит вместе со своими
 * досрочками — как из капитала: снять их уже негде, а кредит, заведённый по ошибке,
 * не должен оставлять экономию, которой не было.
 */
export function prepaySaved(payments: Payment[], credits: Credit[]): number {
  const live = new Set(liveCredits(credits).map((c) => c.id))
  return countedPayments(payments)
    .filter((p) => p.kind === 'prepay' && live.has(p.targetId))
    .reduce((sum, p) => sum + (p.saved ?? 0), 0)
}

/* ---------------- «в долг / банку» и график платежей (Р-8) ---------------- */

/** Досрочка — вся в тело; платёж графика — по снимку тела в записи. */
const recordBody = (p: Payment) => (p.kind === 'prepay' ? p.amount : (p.principal ?? 0))

/**
 * Сколько из платежа ушло в долг и сколько банку. Отмеченный — по записи: тело в
 * ней снимок на момент оплаты, пересчитывать от нынешнего остатка нечестно.
 * Неотмеченный — по графику (`creditSplit`) от остатка кредита сейчас (кредит —
 * производный, из геттера стора).
 */
export function paymentSplit(record: Payment | null, credit: Credit, due: number) {
  if (record) {
    const body = recordBody(record)
    return { body, interest: record.amount - body }
  }
  const s = creditSplit(credit.principal, credit.annualRate, due)
  return { body: s.body, interest: s.interest }
}

/** За всё время по кредиту: сколько ушло в долг и банку, сколько было платежей (с досрочками). */
export function creditTotals(payments: Payment[], creditId: string) {
  const list = countedPayments(payments).filter(
    (p) => p.targetId === creditId && (p.kind === 'credit' || p.kind === 'prepay'),
  )
  const body = list.reduce((a, p) => a + recordBody(p), 0)
  return { body, interest: list.reduce((a, p) => a + p.amount, 0) - body, count: list.length }
}

/**
 * Проценты банку в месяц по открытым кредитам — часть «Кредитов» Бюджета. Та же
 * разбивка, что у строки кредита: платёж меньше процентов — банку уходит весь платёж.
 * Кредиты — производные.
 */
export const budgetInterest = (credits: Credit[]) =>
  openCredits(credits).reduce((a, c) => a + creditSplit(c.principal, c.annualRate, c.payment).interest, 0)

/**
 * «Что гасить первым» (квадрат «Долги», пивот 3, Р-34; бывшая секция Капитала): долги с процентами
 * по `costliestCredits` с выводами `creditOutlook`, самый дорогой — первым; добавка в месяц,
 * снимающая половину его переплаты, и что она даёт (`prepayOutcome`). Долги без ставки (кредит из
 * выписки, B2C-19) не ранжируются — их просим уточнить. Кредиты — производные.
 */
export function debtAdvice(credits: Credit[]) {
  const rankedDebts = costliestCredits(credits).map((c) => ({ credit: c, cost: creditOutlook(c) }))
  const worstDebt = rankedDebts[0] ?? null
  const worstHalfExtra = worstDebt
    ? halfOverpayExtra(worstDebt.credit.principal, worstDebt.credit.annualRate, worstDebt.credit.payment)
    : null
  const worstGain = worstDebt && worstHalfExtra ? prepayOutcome(worstDebt.credit, worstHalfExtra, 'monthly') : null
  return { rankedDebts, worstDebt, worstHalfExtra, worstGain, unknownRate: openCredits(credits).filter((c) => c.rateUnknown) }
}

export type ScheduleRow = {
  period: string
  /** Число месяца; платёж 31-го в коротком месяце — в его последний день. */
  day: number
  /** Платёж графика: у оплаченного — из записи. */
  amount: number
  body: number
  interest: number
  /** Досрочка в этом месяце: применённая (запись) или запланированная (`extra`). */
  extra: number
  /** Остаток долга после этого месяца. */
  left: number
  paid: boolean
}

/** Дальше графика не считаем: платёж меньше процентов долг не закрывает никогда. */
const SCHEDULE_CAP = 600

/**
 * График платежей по кредиту с месяца `from` до закрытия (не больше 600 строк).
 * Остаток — производный: отметки и досрочки в нём уже учтены. Отмеченный месяц —
 * по записи; неотмеченные считаются помесячно (`creditSplit`) от остатка, поэтому
 * Σ тела неоплаченных строк и запланированных досрочек = остаток. `extra` —
 * досрочки будущих месяцев (план): гасят тело до платежа своего месяца. Уже
 * применённые досрочки видны в строке своего месяца, но второй раз не вычитаются.
 */
export function creditSchedule(
  credit: Credit,
  payments: Payment[] = [],
  opts: { from?: string; extra?: { period: string; amount: number }[] } = {},
): ScheduleRow[] {
  const from = opts.from ?? monthKey()
  const own = countedPayments(payments).filter((p) => p.targetId === credit.id)
  const applied = (period: string) =>
    own.filter((p) => p.kind === 'prepay' && p.period === period).reduce((a, p) => a + p.amount, 0)
  const planned = (period: string) =>
    (opts.extra ?? []).filter((x) => x.period === period).reduce((a, x) => a + Math.max(0, Math.round(x.amount)), 0)

  let left = Math.max(0, Math.round(credit.principal))
  const rows: ScheduleRow[] = []
  for (let i = 0; i < SCHEDULE_CAP; i++) {
    const period = addMonths(from, i)
    const day = Math.min(credit.day, daysInMonth(period))
    const rec = own.find((p) => p.kind === 'credit' && p.period === period)
    if (rec) {
      // Платёж месяца отмечен, а досрочка месяца ещё только запланирована (шаг плана) —
      // она тоже гасит тело в этом месяце.
      const body = recordBody(rec)
      const extra = Math.min(left, planned(period))
      left -= extra
      rows.push({ period, day, amount: rec.amount, body, interest: rec.amount - body, extra: extra + applied(period), left, paid: true })
      continue
    }
    if (left <= 0) break
    const extra = Math.min(left, planned(period))
    left -= extra
    const s = creditSplit(left, credit.annualRate, credit.payment)
    left -= s.body
    rows.push({ period, day, amount: s.amount, body: s.body, interest: s.interest, extra: extra + applied(period), left, paid: false })
  }
  // Оплаченные месяцы перед первым неоплаченным уже вычтены из остатка: остаток после
  // каждого из них — обратным ходом от первого неоплаченного.
  const first = rows.findIndex((r) => !r.paid)
  for (let j = (first < 0 ? rows.length : first) - 2; j >= 0; j--) {
    rows[j].left = rows[j + 1].left + rows[j + 1].body + rows[j + 1].extra
  }
  return rows
}

export type Due = {
  kind: ScheduledKind
  targetId: string
  /** Месяц платежа по графику. */
  period: string
  /** Число месяца; платёж 31-го в коротком месяце — в его последний день. */
  day: number
  amount: number
}

/** Сколько месяцев вперёд искать платёж: годовой найдётся за 12, остальное — запас. */
const DUE_HORIZON = 24

/**
 * Ближайший неоплаченный платёж обязательства: с текущего месяца вперёд,
 * отмеченные месяцы пропускаются. Прошедшее число этого месяца без отметки — всё
 * ещё «этот» платёж: его могли внести позже срока (Р-3, без упрёка). Прошлые
 * месяцы не ищем — неотмеченное там нейтрально и оплаты не ждёт.
 */
export function nextObligationDue(o: Obligation, payments: Payment[] = [], now = today(), book?: RateBook | null): Due | null {
  for (let i = 0; i < DUE_HORIZON; i++) {
    const period = addMonths(now.key, i)
    const amount = amountAt(o, period, book)
    if (!dueIn(o, period) || amount <= 0 || paidFor(payments, 'obligation', o.id, period)) continue
    return { kind: 'obligation', targetId: o.id, period, day: Math.min(o.day, daysInMonth(period)), amount }
  }
  return null
}

/** То же для кредита. Кредит — с остатком из отметок; закрытый платежей не ждёт. */
export function nextCreditDue(c: Credit, payments: Payment[] = [], now = today()): Due | null {
  if (creditDueAmount(c) <= 0) return null
  for (let i = 0; i < DUE_HORIZON; i++) {
    const period = addMonths(now.key, i)
    if (paidFor(payments, 'credit', c.id, period)) continue
    return {
      kind: 'credit',
      targetId: c.id,
      period,
      day: Math.min(c.day, daysInMonth(period)),
      amount: creditDueAmount(c),
    }
  }
  return null
}

/**
 * Счёт по умолчанию для оплаты цели — тот, с которого её оплачивали в прошлый раз
 * (Р-5): последняя живая отметка этой цели, включая досрочки кредита. null — в
 * прошлый раз выбрали «не списывать»; undefined — оплат не было или того счёта
 * здесь нет (удалён, личный счёт партнёра): счёт надо спросить.
 */
export function lastAccountFor(
  payments: Payment[],
  targetId: string,
  accounts: Account[],
): string | null | undefined {
  const last = payments
    .filter((p) => !p.deletedAt && p.targetId === targetId)
    .sort((a, b) => b.at.localeCompare(a.at))[0]
  if (!last) return undefined
  if (last.accountId === null) return null
  return liveAccounts(accounts).some((a) => a.id === last.accountId) ? last.accountId : undefined
}

type MonthDueBase = {
  targetId: string
  name: string
  /** Число месяца, как оно заведено у платежа. */
  day: number
  /** Сумма: у отмеченного — из отметки, иначе по графику месяца. */
  amount: number
  paid: boolean
}

/** Платёж месяца по графику; сам платёж — для подписи, цвета и ссылки на экране. */
export type MonthDue =
  | (MonthDueBase & { kind: 'obligation'; obligation: Obligation })
  | (MonthDueBase & { kind: 'credit'; credit: Credit })

/**
 * Платежи месяца — одно правило для «до зарплаты», календаря и списка Бюджета и
 * «Впереди» в «Деньгах → История». Обязательства, что списываются в этом месяце (группа
 * подписок — нет), и кредиты, ждущие платежа (закрытый — только в месяц, когда его
 * закрыли). Кредиты — с остатками из отметок, как их отдаёт стор. Сумма
 * отмеченного — из отметки, как в строке «Оплатил»: итог сходится со строками.
 * Порядок — обязательства, затем кредиты; сортирует экран.
 */
export function monthDues(
  state: { obligations?: Obligation[]; credits?: Credit[]; payments?: Payment[]; book?: RateBook | null },
  key: string,
): MonthDue[] {
  const payments = state.payments || []
  const obligations: MonthDue[] = liveObligations(state.obligations || [])
    .filter((o) => dueIn(o, key))
    .map((o) => {
      const paid = paidFor(payments, 'obligation', o.id, key)
      const amount = paid ? paid.amount : amountAt(o, key, state.book)
      return { kind: 'obligation', obligation: o, targetId: o.id, name: o.name, day: o.day, amount, paid: !!paid }
    })
  const credits: MonthDue[] = liveCredits(state.credits || [])
    .filter((c) => creditDueIn(c, payments, key))
    .map((c) => {
      const paid = !!paidFor(payments, 'credit', c.id, key)
      return { kind: 'credit', credit: c, targetId: c.id, name: c.name, day: c.day, amount: creditMonthPayment(c, payments, key), paid }
    })
  return [...obligations, ...credits]
}

/** Итог платежей месяца — сумма строк. */
export const duesTotal = (dues: MonthDue[]) => dues.reduce((a, d) => a + d.amount, 0)

/** Сколько месяцев вперёд «до зарплаты» ищет непришедшую зарплату (хвост RP: отмеченные заранее). */
export const PAYDAY_HORIZON = 3;

/**
 * До зарплаты: когда придут деньги и что нужно заплатить до этого.
 *
 * Счета и кредиты — с остатками из отметок (стор отдаёт такие). Отмеченное в своём
 * месяце в «заплатить» не входит: деньги уже ушли со счёта, иначе вычлись бы
 * дважды (Р-5, честный остаток). Оно возвращается отдельно (`paid`, сумма — из
 * отметки), чтобы экран показал его оплаченным, а не молча потерял. Закрытый
 * кредит платежа не ждёт. Зарплата, отмеченная «пришла» (RP-10), уже не «до»: блок
 * смотрит на следующую — в окне PAYDAY_HORIZON месяцев (хвост RP: все ближайшие
 * отмечены заранее — блок не пропадает). День 31-го в коротком месяце — его
 * последний день (хвост RP: «31 сентября»).
 */
export function untilPayday(
  state: {
    people?: Person[];
    obligations?: Obligation[];
    credits?: Credit[];
    accounts?: Account[];
    payments?: Payment[];
    book?: RateBook | null;
    fxExchanges?: FxExchange[];
  },
  now = today(),
) {
  const people = (state.people || []).filter(alive);
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const accountsList = state.accounts || [];
  const payments = state.payments || [];

  const key = now.key;
  const todayNo = dayNo(key, now.day);

  // Ближайший непришедший приход (Б7: события ритма — аванс, недели): этого месяца — с сегодняшнего дня, затем следующих.
  const slots: { p: Person; k: string; ev: PayEvent; inDays: number; day: number }[] = [];
  for (let i = 0; i <= PAYDAY_HORIZON; i++) {
    const k = addMonths(key, i);
    for (const p of people) {
      for (const ev of payEvents(p, k)) {
        const day = Number(ev.day.slice(8, 10));
        const inDays = dayNo(k, day) - todayNo;
        if (inDays >= 0) slots.push({ p, k, ev, inDays, day });
      }
    }
  }
  slots.sort((a, b) => a.inDays - b.inDays);
  const slot = slots.find((s) => !paidFor(payments, 'salary', s.p.id, s.ev.period));
  if (!slot) return null;

  const who = slot.p;
  const nextKey = slot.k;
  const inDays = slot.inDays;

  const itemsOf = (k: string) =>
    monthDues({ obligations, credits, payments, book: state.book }, k).map((d) => ({
      id: d.targetId,
      targetId: d.targetId,
      kind: d.kind,
      name: d.name,
      day: d.day,
      value: d.amount,
      when: k,
      paid: d.paid,
    }));

  // Платежи от сегодня до дня зарплаты: этот месяц с сегодняшнего числа, промежуточные
  // месяцы целиком, месяц зарплаты — до её дня.
  const inWindow: ReturnType<typeof itemsOf> = [];
  for (let k = key, i = 0; k <= nextKey; k = addMonths(k, 1), i++) {
    const items = itemsOf(k)
      .filter((x) => (k !== key || x.day >= now.day) && (k !== nextKey || x.day <= slot.day))
      .map((x) => (i ? { ...x, id: `${x.id}@next${i > 1 ? i : ''}` } : x));
    inWindow.push(...items);
  }
  inWindow.sort((a, b) => a.when.localeCompare(b.when) || a.day - b.day);
  const due = inWindow.filter((x) => !x.paid);
  const paid = inWindow.filter((x) => x.paid);

  const accounts = liveAccounts(accountsList).filter((a) => a.kind !== 'deposit');
  const onAccounts = accounts.reduce((a, x) => a + x.amount, 0);
  const dueTotal = due.reduce((a, x) => a + x.value, 0);

  return {
    who,
    income: expectedEventTenge(who, slot.ev, salaryCtxOf(state)),
    inDays,
    day: slot.day,
    key: nextKey,
    /** Ключ отметки прихода (`Payment.period`): месяц или ISO-день события (Б7). */
    period: slot.ev.period,
    kind: slot.ev.kind,
    due,
    paid,
    dueTotal,
    knowsCash: accounts.length > 0,
    onAccounts,
    shortfall: onAccounts - dueTotal,
  };
}

/* ---------------- «Пришла зарплата» (RP-10) ---------------- */

/**
 * За сколько дней до дня зарплаты её уже можно отметить «пришла»: деньги приходят
 * раньше, когда день выпадает на выходной или праздник.
 */
export const SALARY_EARLY_DAYS = 3;

/**
 * Ждёт ли зарплата участника за месяц `period` отметки «пришла» сейчас: не отмечена, и
 * её день настал или до него не больше SALARY_EARLY_DAYS. Зарплата этого месяца после
 * своего дня ждёт до конца месяца — неотмеченная нейтральна, как платёж (Р-3);
 * следующего — только в окне перед днём (зарплата 1-го числа — в конце этого месяца).
 * День 31-го в коротком месяце — его последний день. Календарь — Алматы (Р-30). Оклада
 * в месяце нет — отмечать нечего (как «Оплатил» при сумме 0): одно нажатие записало бы «+0».
 */
export function salaryOpen(p: Person, payments: Payment[], period: string, now = today()): boolean {
  // Б7: `period` — ключ прихода по ритму (месяц или ISO-день); приход другого ритма (сменили) — не ждёт.
  const ev = payEventOf(p, period);
  if (!ev || ev.amount <= 0 || paidFor(payments, 'salary', p.id, period)) return false;
  const month = periodMonth(period);
  if (month !== now.key && month !== addMonths(now.key, 1)) return false;
  return dayNo(month, Number(ev.day.slice(8, 10))) - dayNo(now.key, now.day) <= SALARY_EARLY_DAYS;
}

/**
 * «Пришла зарплата <имя>?» спрашивается сейчас (RP-10): ближайшая непришедшая зарплата
 * (`untilPayday`) — своя, и её день настал или близко (`salaryOpen`). Зарплата, чей день прошёл,
 * не спрашивается: `untilPayday` смотрит уже на следующую. Одно условие для очереди
 * «Недели» (`decisionQueue`), «Денег» и `salaryToAllocate` — иначе они расходятся по дням месяца.
 */
export function salaryAsk(
  state: Parameters<typeof untilPayday>[0],
  me: PersonId | undefined,
  now = today(),
): NonNullable<ReturnType<typeof untilPayday>> | null {
  const near = me ? untilPayday(state, now) : null;
  return near && near.who.id === me && salaryOpen(near.who, state.payments ?? [], near.period, now) ? near : null;
}

/* ---------------- вопрос в конце месяца (RP-11) ---------------- */

/**
 * Сколько последних дней месяца «Мечты» и «Неделя» спрашивают «Остались деньги?»: три дня — успеть
 * до 1-го числа, когда месяц закрывается, и не спрашивать раньше, пока остаток ещё
 * нужен на жизнь.
 */
export const MONTH_END_DAYS = 3;

/**
 * Показывать ли вопрос об остатке месяца (Р-19): последние MONTH_END_DAYS дней месяца по
 * Алматы (Р-30), и за этот месяц ещё не ответили. `answered` — месяц последнего ответа
 * («распределить», «всё ушло» или «не сейчас»); новый месяц спрашивает снова.
 */
export function monthEndAsk(answered: string | null, now = today()): boolean {
  return now.day > daysInMonth(now.key) - MONTH_END_DAYS && answered !== now.key;
}

/* ---------------- моменты прогресса (RP-12) ---------------- */

/** Момент прогресса семьи — одна спокойная строка «Денег → История» (Р-21). */
export type Moment =
  /** Долг закрыт: его платёж освободился. */
  | { kind: 'closed'; id: string; at: string; creditId: string; name: string; freed: number }
  /** Цель прошла половину. */
  | { kind: 'half'; id: string; at: string; goalId: string; name: string }
  /** Досрочка: столько процентов не отдадим банку (снимок записи, RP-08). */
  | { kind: 'saved'; id: string; at: string; creditId: string; name: string; saved: number };

/**
 * Моменты прогресса (Р-21) — выводятся из уже записанного, в документ ничего не пишется:
 * снятая отметка или взнос убирают свой момент сами. Новые — первыми.
 *
 * - **Долг закрыт** — запись (отметка или досрочка после сверки остатка, в порядке `at`),
 *   на которой тело по записям дошло до остатка сверки. Поэтому кредиты — **из документа**
 *   (база сверки `principal`), а не производные: у производного закрытого остаток 0, и
 *   какая запись его обнулила, уже не видно. Освободился платёж кредита.
 * - **Половина цели** — взнос, на котором накопленное (seed + взносы по дате) пересекло
 *   половину нужной суммы. Один момент на цель: последнее пересечение вверх, и только пока
 *   цель не ниже половины — снятие ниже половины момент убирает, новое пересечение даёт
 *   один момент с новой датой. Цель, начатая с половины и выше, момента не даёт.
 * - **Досрочка сэкономила** — каждая живая досрочка живого кредита со снимком `saved`.
 */
export function progressMoments(state: { credits?: Credit[]; goals?: Goal[]; payments?: Payment[] }): Moment[] {
  const counted = countedPayments(state.payments ?? []);
  const out: Moment[] = [];

  for (const c of liveCredits(state.credits ?? [])) {
    const own = counted
      .filter((p) => p.targetId === c.id && (p.kind === 'credit' || p.kind === 'prepay') && afterAnchor(p, c.principalSetAt))
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    let left = c.principal;
    for (const p of left > 0 ? own : []) {
      left -= p.principal ?? 0;
      if (left <= 0) {
        out.push({ kind: 'closed', id: `closed:${c.id}`, at: p.at, creditId: c.id, name: c.name, freed: c.payment });
        break;
      }
    }
    for (const p of counted) {
      if (p.kind === 'prepay' && p.targetId === c.id && (p.saved ?? 0) > 0) {
        out.push({ kind: 'saved', id: `saved:${p.id}`, at: p.at, creditId: c.id, name: c.name, saved: p.saved! });
      }
    }
  }

  for (const g of openGoals(state.goals ?? [])) { // Сбылось (PN-13): моменты прогресса — у активных
    if (!(g.need > 0)) continue;
    const half = g.need / 2;
    let sum = g.seed ?? 0;
    let crossed: string | null = null;
    const moves = [...(g.movements ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const m of moves) {
      const before = Math.max(0, sum);
      sum += m.amount;
      const after = Math.max(0, sum);
      if (before < half && after >= half) crossed = m.date;
      else if (after < half) crossed = null;
    }
    if (crossed) out.push({ kind: 'half', id: `half:${g.id}`, at: crossed, goalId: g.id, name: g.name });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

/* ---------------- итог месяца на двоих (RP-13) ---------------- */

/** Сколько первых дней месяца «Деньги → История» ещё показывает итог прошлого. */
export const SUMMARY_FIRST_DAYS = 5;

/**
 * За какой месяц показать итог сейчас (Р-22): в последние MONTH_END_DAYS дней — за этот
 * (он почти прожит), в первые SUMMARY_FIRST_DAYS дней — за прошлый (он только закончился);
 * в остальные дни — null, карточки нет. Календарь — Алматы.
 */
export function summaryMonth(now = today()): string | null {
  if (now.day > daysInMonth(now.key) - MONTH_END_DAYS) return now.key;
  if (now.day <= SUMMARY_FIRST_DAYS) return addMonths(now.key, -1);
  return null;
}

/** Ключ месяца даты покупки: ISO или «dd.mm.yyyy» старых записей из прода. */
function boughtMonth(on: string | null | undefined): string | null {
  if (!on) return null;
  const old = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(on);
  if (old) return `${old[3]}-${old[2]}`;
  const d = new Date(on);
  return Number.isNaN(d.getTime()) ? null : monthKey(d);
}

/** Итог месяца «мы» — без полей по участникам (Р-22). Суммы — целые тенге. */
export type MonthSummary = {
  key: string;
  /** Платежи по графику (обязательства и кредиты), отмеченные за этот месяц. */
  paid: { count: number; amount: number };
  /** Зарплаты, отмеченные «пришла» за этот месяц, — вместе. */
  income: number;
  /** Долги, закрытые в этом месяце. */
  closed: { creditId: string; name: string }[];
  /** Досрочки месяца: сколько внесли и сколько процентов не отдадим банку. */
  prepaid: { count: number; amount: number; saved: number };
  /** Взносы в цели за месяц и снятия из них. */
  toGoals: number;
  fromGoals: number;
  /**
   * Приближение к желаниям: цель, ближе всех к сумме среди тех, где в этом месяце было
   * движение, — сколько процентов собрано на начало и на конец месяца (целые, до 100).
   */
  closest: { goalId: string; name: string; from: number; to: number } | null;
  /** Купленное из списка покупок в этом месяце. */
  bought: { count: number; amount: number };
};

/** Записанная раскладка источника за период (B2C-21): живая, последняя по времени; нет — null. */
export function allocationFor(
  list: Allocation[] | undefined,
  src: { source: Allocation['source']; sourceId: string; period: string },
): Allocation | null {
  const own = (list ?? []).filter((a) => !a.deletedAt && a.source === src.source && a.sourceId === src.sourceId && a.period === src.period)
  if (!own.length) return null
  return own.reduce((best, a) => (a.at > best.at ? a : best))
}

/**
 * Зарплата, отмеченная по выписке, которую ещё не разобрали (B2C-21 п. 1, возврат приёмки Блока 3
 * п. 2; B2C-58): у ручного «Пришла» переход на разбор сразу после отметки, а «Да, зарплата» из выписки и
 * автоотметка по правилу его не открывают — без карточки он был бы недостижим. Можно отметить `record`
 * конкретного месяца (лист отметки) или найти свою последнюю — этого или прошлого месяца (очередь
 * «Недели» `decisionQueue`). Только `source: 'statement'`: ручные отметки до записи раскладок
 * (`allocations`, B2C-21) раскладывал прежний Ритуал без записи — карточка предложила бы их второй раз.
 * Нужны сумма отметки и отсутствие записи разбора/раскладки (`allocationFor`). Месяцы до спрашиваемой
 * «Пришла?» не ищутся, только пока она действительно спрашивается (`salaryAsk`, как у главного): иначе
 * старая неразобранная заслонила бы её. После дня зарплаты «Пришла?» уже не спрашивается — прошлая
 * неразобранная снова здесь (возврат приёмки 2 п. 3: выписку грузят после дня зарплаты, и с 13-го по
 * конец месяца зарплата терялась). Пришедшая раньше срока зарплата следующего месяца (день 1-го, пришла
 * 29-го) — сразу (критик возврата Блока 3). Блок 14: только если по плану того месяца есть что отложить
 * (`planSave` с частями, ревью frontend Б14 Н-1) — у участника без своих целей и фондов (по умолчанию второй,
 * Р-80) карточка вела на план без «Отложить по плану» и висела до конца месяца. Суммы очереди от итогов трат и
 * выписок не зависят (траты плана — `spendPlans`), поэтому план здесь — без них.
 */
export function salaryToAllocate(
  state: MonthPlanState & { spendCategories?: SpendCategory[] },
  me: PersonId | undefined,
  now = today(),
  record?: Payment | null,
): { person: Person; period: string; record: Payment } | null {
  if (!me) return null
  const person = (state.people ?? []).find((p) => alive(p) && p.id === me)
  if (!person) return null
  const payments = state.payments ?? []
  // Пока спрашивается «Пришла?», месяцы до спрашиваемого не ищутся — ни один: у дня зарплаты 1–3
  // окно «Пришла?» октября открыто с 28 сентября, и неразложенные сентябрь и август заслонили бы её
  // (возврат приёмки 3 п. 2) — карточка скакала бы по дням, главный, «Неделя» и «Деньги» расходились.
  const asked = salaryAsk(state, me, now)
  const months = [addMonths(now.key, 1), now.key, addMonths(now.key, -1)].filter((k) => !asked || k > asked.key)
  // Ритм (Б7): приходов в месяце несколько — последняя отметка месяца; раскладка и план — по месяцу (`periodMonth`).
  const found = record ?? months.map((k) => lastSalaryRecord(payments, me, k)).find(Boolean)
  // Ручная тенговая сразу ведёт в план месяца; валютная (B2C-79) — сначала «Обменял» на этой карточке.
  if (!found || found.kind !== 'salary' || found.targetId !== me || (found.source !== 'statement' && !found.foreign) || found.amount <= 0) return null
  const period = periodMonth(found.period)
  if (allocationFor(state.allocations, { source: 'salary', sourceId: me, period })) return null
  const plan = monthPlan(state, { key: period, totals: [], spendCategories: state.spendCategories ?? [], uploads: [] })
  if (!planSave(plan, me)) return null
  return { person, period, record: found }
}

/**
 * Подписки, от которых отказались в месяце (B2C-20 «утечки»): обязательства с надгробием
 * этого месяца (по Алматы) из группы подписок или подписки раздела «быт» (`isSubscription`:
 * d4 с точной суммой — туда же кладёт подписки первый запуск; оценка «быта» — не подписка).
 * Жильё и кредиты не подписки. Для сторис берётся только число.
 */
export function cancelledSubscriptions(obligations: Obligation[], key: string): Obligation[] {
  return (obligations || []).filter((o) => !o.group && !!o.deletedAt && movementMonth(o.deletedAt) === key && (!!o.parentId || isSubscription(o)))
}

/**
 * Итог месяца на двоих (Р-22): что оплатили, что закрыли, сколько отложили и насколько
 * приблизились к желаниям. Считает только записанное, в документ не пишет. Месяц записи
 * оплаты — её `period` (как у отметок), взноса и закрытия долга — дата по Алматы, покупки
 * — `boughtOn`. Надгробия не считаются; двойная отметка — один раз (`countedPayments`).
 * Кредиты — из документа, как у `progressMoments`. Кто платил и вносил — не разрезается.
 */
export function monthSummary(
  state: {
    credits?: Credit[];
    goals?: Goal[];
    payments?: Payment[];
    wishlist?: WishItem[];
    /** Валютная зарплата (B2C-80): тенге месяца — `paidTenge`, не снимок дня прихода. */
    people?: Person[];
    book?: RateBook | null;
    fxExchanges?: FxExchange[];
  },
  key: string,
): MonthSummary {
  // Б7: приход аванса или недели помечен ISO-днём — месяц по `periodMonth`.
  const records = countedPayments(state.payments ?? []).filter((p) => periodMonth(p.period) === key);
  const scheduled = records.filter((p) => p.kind === 'obligation' || p.kind === 'credit');
  const liveIds = new Set(liveCredits(state.credits ?? []).map((c) => c.id));
  const prepays = records.filter((p) => p.kind === 'prepay' && liveIds.has(p.targetId));

  const inMonth = (iso: string) => monthKey(new Date(iso)) === key;
  let toGoals = 0;
  let fromGoals = 0;
  let closest: MonthSummary['closest'] = null;
  let closestHave = -1;
  for (const g of openGoals(state.goals ?? [])) { // Сбылось (PN-13): итог месяца — по активным
    const moves = (g.movements ?? []).filter((m) => inMonth(m.date));
    for (const m of moves) {
      if (m.amount > 0) toGoals += m.amount;
      else fromGoals -= m.amount;
    }
    if (!moves.length || !(g.need > 0)) continue;
    const before = goalHaveBefore(g, key);
    const after = goalHaveBefore(g, addMonths(key, 1));
    const share = Math.min(1, after / g.need);
    if (share > closestHave) {
      closestHave = share;
      const pct = (have: number) => Math.round(Math.min(1, have / g.need) * 100);
      closest = { goalId: g.id, name: g.name, from: pct(before), to: pct(after) };
    }
  }

  const bought = liveWishlist(state.wishlist ?? []).filter((w) => w.bought && boughtMonth(w.boughtOn) === key);

  return {
    key,
    paid: { count: scheduled.length, amount: scheduled.reduce((a, p) => a + p.amount, 0) },
    income: records.filter((p) => p.kind === 'salary').reduce((a, p) => a + paidTenge(state, p.targetId as PersonId, p.period, p), 0),
    closed: progressMoments({ credits: state.credits, payments: state.payments })
      .filter((m): m is Extract<Moment, { kind: 'closed' }> => m.kind === 'closed' && inMonth(m.at))
      .map((m) => ({ creditId: m.creditId, name: m.name })),
    prepaid: {
      count: prepays.length,
      amount: prepays.reduce((a, p) => a + p.amount, 0),
      saved: prepays.reduce((a, p) => a + (p.saved ?? 0), 0),
    },
    toGoals,
    fromGoals,
    closest,
    bought: { count: bought.length, amount: bought.reduce((a, w) => a + w.price, 0) },
  };
}

/** Итог месяца есть что показать: отметки, зарплата, закрытые долги, досрочки, движения целей, покупки. */
export function hasMonthSummary(s: MonthSummary): boolean {
  return !!(s.paid.count || s.income || s.closed.length || s.prepaid.count || s.toGoals || s.fromGoals || s.bought.count);
}

/* ---------------- «История» (пивот 3, Р-35, B2C-44) ---------------- */

/** Строка ленты «Истории»: своя операция выписки, отметка семьи или момент прогресса. */
export type HistoryItem =
  | { kind: 'op'; id: string; at: string; op: Operation }
  | { kind: 'mark'; id: string; at: string; payment: Payment }
  | { kind: 'moment'; id: string; at: string; moment: Moment }
  | { kind: 'record'; id: string; at: string; allocation: Allocation };

/** Записи денег месяца для «Истории» (Р-85): «Отложить по плану» и старые разборы Блока 11. */
const moneyRecords = (list: Allocation[] | undefined) => (list ?? []).filter((a) => !a.deletedAt && (a.kind === 'plan' || a.kind === 'breakdown'))

/** День по Алматы «YYYY-MM-DD» для отметки и момента (их `at` — ISO). */
const isoDay = (iso: string) => {
  const d = today(new Date(iso));
  return `${d.key}-${String(d.day).padStart(2, '0')}`;
};

/**
 * Лента «Истории» по дням за месяцы `months` (новые сверху): свои операции (Р-5: стор отдаёт только
 * свои), отметки семьи (оплата, досрочка, зарплата — `countedPayments`) и моменты «собрали
 * половину» / «закрыт». Момент «не отдадим банку» не повторяется — его несёт строка досрочки.
 * День операции — её дата, отметки и момента — день `at` по Алматы.
 */
export function historyFeed(
  state: { ops: Operation[]; payments?: Payment[]; moments?: Moment[]; allocations?: Allocation[] },
  months: string[],
): { day: string; items: HistoryItem[] }[] {
  const inPeriod = (day: string) => months.includes(day.slice(0, 7));
  const items: (HistoryItem & { day: string })[] = [
    ...state.ops.filter((o) => inPeriod(o.date)).map((op) => ({ kind: 'op' as const, id: op.id, at: `${op.date}T00:00:00`, day: op.date, op })),
    ...countedPayments(state.payments ?? []).map((payment) => ({ kind: 'mark' as const, id: payment.id, at: payment.at, day: isoDay(payment.at), payment })),
    ...(state.moments ?? [])
      .filter((m) => m.kind !== 'saved')
      .map((moment) => ({ kind: 'moment' as const, id: moment.id, at: moment.at, day: isoDay(moment.at), moment })),
    // Записи денег — строкой с частями (план — по целям, старый разбор — по статьям); записи прежней раскладки (без `kind`) не показывались и не показываются (Р-65).
    ...moneyRecords(state.allocations).map((allocation) => ({ kind: 'record' as const, id: allocation.id, at: allocation.at, day: isoDay(allocation.at), allocation })),
  ].filter((x) => inPeriod(x.day));
  const days = new Map<string, HistoryItem[]>();
  for (const x of items.sort((a, b) => b.day.localeCompare(a.day) || b.at.localeCompare(a.at))) {
    const { day, ...item } = x;
    days.set(day, [...(days.get(day) ?? []), item as HistoryItem]);
  }
  return [...days].map(([day, list]) => ({ day, items: list }));
}

/** Самый ранний месяц, за который «Истории» есть что показать (кнопка «Раньше»); null — ничего нет. */
export function historyStart(state: { ops: Operation[]; payments?: Payment[]; moments?: Moment[]; allocations?: Allocation[] }): string | null {
  const months = [
    ...moneyRecords(state.allocations).map((a) => isoDay(a.at).slice(0, 7)),
    ...state.ops.map((o) => o.date.slice(0, 7)),
    ...countedPayments(state.payments ?? []).map((p) => isoDay(p.at).slice(0, 7)),
    ...(state.moments ?? []).filter((m) => m.kind !== 'saved').map((m) => isoDay(m.at).slice(0, 7)),
  ];
  return months.length ? months.sort()[0] : null;
}

/**
 * Разделы трат в своих операциях месяцев `months` — по убыванию суммы (чипы фильтра «Истории»);
 * неразобранное — `UNKNOWN_CATEGORY`. Траты — списания не между своими.
 */
export function historyCategories(ops: Operation[], months: string[]): string[] {
  const sums = new Map<string, number>();
  for (const o of ops) {
    if (o.internal || o.amount >= 0 || !months.includes(o.date.slice(0, 7))) continue;
    const id = o.categoryId ?? UNKNOWN_CATEGORY;
    sums.set(id, (sums.get(id) ?? 0) + spendOf(o));
  }
  return [...sums].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Подсчёт ликвидных средств на картах и счетах. */
export function liquidCash(liquidAccounts: Account[]): number {
  return liveAccounts(liquidAccounts)
    .filter((a) => a.kind === 'card' || a.kind === 'cash' || a.kind === 'envelope')
    .reduce((a, x) => a + x.amount, 0);
}

/** Подушка безопасности в месяцах обязательных расходов. */
export function cushionMonths(liquidAccounts: Account[], monthlyMandatory: number): number {
  if (monthlyMandatory <= 0) return 0;
  return +(liquidCash(liquidAccounts) / monthlyMandatory).toFixed(1);
}

/**
 * Подсчёт серии месяцев регулярных взносов в цели.
 */
/** Месяц взноса — по Алматы (хвост RP, B2C-18): ISO-дата вечером 30-го по Алматы — ещё этот месяц. */
export const movementMonth = (date: string) => (/^\d{4}-\d{2}-\d{2}T/.test(date) ? monthKey(new Date(date)) : date.slice(0, 7))

export function contributionStreak(movements: { date: string; amount: number }[]): number {
  const months = new Set(
    movements.filter((m) => m.amount > 0).map((m) => movementMonth(m.date)),
  )
  if (!months.size) return 0

  let streak = 0
  let cursor = monthKey()
  if (!months.has(cursor)) cursor = addMonths(cursor, -1)

  while (months.has(cursor)) {
    streak++
    cursor = addMonths(cursor, -1)
  }
  return streak
}

/**
 * Темп взносов в цель, ₸ в месяц (PN-09, Р-15): план взноса (`monthly`), а без плана — среднее положительных
 * движений за три последних месяца до `key` включительно (сумма / 3); движений нет — 0.
 */
export function goalPace(goal: { monthly: number; movements?: { date: string; amount: number }[] }, key: string): number {
  if (goal.monthly > 0) return goal.monthly
  const from = addMonths(key, -2)
  const sum = (goal.movements ?? [])
    .filter((m) => m.amount > 0 && movementMonth(m.date) >= from && movementMonth(m.date) <= key)
    .reduce((a, m) => a + m.amount, 0)
  return sum > 0 ? Math.round(sum / 3) : 0
}

/** На сколько дней взнос `amount` приблизил мечту при темпе `pace` в месяц (30,4 дня): целые дни; нет взноса или темпа — null. */
export function closerDays(amount: number, pace: number): number | null {
  if (amount <= 0 || pace <= 0) return null
  return Math.round((amount / pace) * 30.4)
}

/**
 * На сколько месяцев взносов тянет сумма `amount` при темпе `pace` в месяц («Хватит? — нет», владелец Б5: прикидки — в
 * месяцах): меньше одного месяца — 0 («почти не сдвинется»), дальше — округление; нет суммы или темпа — null.
 */
export function paceMonths(amount: number, pace: number): number | null {
  if (amount <= 0 || pace <= 0) return null
  const months = amount / pace
  return months < 1 ? 0 : Math.round(months)
}

/** «Ближе на N дней» под героем «Мечт»: все положительные движения месяца `key` при темпе цели; null — нечего сказать. */
export function closerThisMonth(goal: { monthly: number; movements?: { date: string; amount: number }[] }, key: string): number | null {
  const put = (goal.movements ?? []).filter((m) => m.amount > 0 && movementMonth(m.date) === key).reduce((a, m) => a + m.amount, 0)
  return closerDays(put, goalPace(goal, key))
}

/** Сколько месяцев от `from` до `to` («2026-09» → «2027-05» = 8); отрицательное — 0. */
export function monthsBetween(from: string, to: string): number {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  return Math.max(0, (b.year - a.year) * 12 + (b.month - a.month))
}

/**
 * За сколько месяцев сбылась мечта (PN-13): от месяца первого положительного взноса до месяца `doneAt`; взносов нет —
 * от `seedSetAt`; нет и его — 1. Не меньше 1. Без `doneAt` — до текущего месяца.
 */
export function doneTerm(goal: Pick<Goal, 'doneAt' | 'seedSetAt' | 'movements'>): number {
  const puts = (goal.movements ?? []).filter((m) => m.amount > 0).map((m) => movementMonth(m.date))
  const from = puts.length ? puts.reduce((a, b) => (b < a ? b : a)) : goal.seedSetAt ? movementMonth(goal.seedSetAt) : null
  if (!from) return 1
  return Math.max(1, monthsBetween(from, goal.doneAt ? monthKey(new Date(goal.doneAt)) : monthKey()))
}

/** «за 14 месяцев» — срок сбывшейся словами (момент, экран, карточка). */
export const doneLabel = (months: number) => `за ${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`

export type CloserWish = {
  wish: WishItem
  /** На сколько ближе: сумма покрывает цену целиком (`covers`) или её часть, ₸. */
  closer: number
  covers: boolean
  /** Ежемесячно: через сколько месяцев покупка (сумма ≥ цена — 1). */
  months?: number
}

/**
 * «Это приближает» (B2C-18, Р-9 RP): какое некупленное желание с ценой становится ближе от
 * суммы — разовой (`once`: самое дорогое, что покрывается целиком, иначе самое дешёвое — на
 * его долю) или ежемесячной (`monthly`: самое дешёвое, через `months` месяцев). null — нечего
 * приблизить: сумма 0, желаний с ценой нет или все куплены.
 */
export function closerWish(wishes: WishItem[], amount: number, mode: 'once' | 'monthly'): CloserWish | null {
  if (amount <= 0) return null
  const open = liveWishlist(wishes).filter((w) => !w.bought && w.price > 0).sort((a, b) => a.price - b.price)
  if (!open.length) return null
  if (mode === 'monthly') {
    const wish = open[0]
    return { wish, closer: Math.min(amount, wish.price), covers: amount >= wish.price, months: Math.max(1, Math.ceil(wish.price / amount)) }
  }
  const covered = open.filter((w) => w.price <= amount)
  if (covered.length) {
    const wish = covered[covered.length - 1]
    return { wish, closer: wish.price, covers: true }
  }
  return { wish: open[0], closer: amount, covers: false }
}

/* ---------------- выбранный план «Сначала долги» (PV-14) ---------------- */

/** От чего считается план. Кредиты — производные (геттер стора), как у `openCredits`. */
export type PlanState = {
  goals?: Goal[]
  credits?: Credit[]
  obligations?: Obligation[]
  payments?: Payment[]
}

/** Месяц старта плана по Алматы (Р-16). */
export const planStartMonth = (plan: DebtPlan) => monthKey(new Date(plan.startedAt))

/**
 * Активный план: живой со статусом active. Двое выбрали разные планы офлайн — после
 * слияния активных два, считается поздний по `startedAt` (Р-9; при равенстве — по id,
 * чтобы оба телефона выбрали один); старший отменяет `settlePlans`.
 */
export function activePlan(plans: DebtPlan[] = []): DebtPlan | null {
  let best: DebtPlan | null = null
  for (const p of plans) {
    if (p.deletedAt || p.status !== 'active') continue
    if (!best || p.startedAt > best.startedAt || (p.startedAt === best.startedAt && p.id > best.id)) best = p
  }
  return best
}

/** Цели на паузе ради плана (Р-9): живые, кроме «не останавливать» и подушки. Выводится, а не хранится. */
export const pausedGoals = (plan: DebtPlan, goals: Goal[]) =>
  openGoals(goals).filter((g) => !plan.keptGoalIds.includes(g.id) && g.id !== plan.cushionGoalId) // Сбылось (PN-13): сбывшаяся не стоит на паузе плана

/**
 * Закрытые долги плана, чей платёж уже свободен (Р-5): остаток 0, не удалены и выпали
 * из месяца — закрыты не плановым «Оплатил» этого месяца (`creditMonthPayment`).
 */
const releasedCredits = (plan: DebtPlan, credits: Credit[], payments: Payment[], key: string) =>
  liveCredits(credits).filter(
    (c) => plan.creditIds.includes(c.id) && c.principal <= 0 && creditMonthPayment(c, payments, key) === 0,
  )

/**
 * Сколько освободил закрытый долг в месяце `key`. Закрыт досрочкой этого месяца — ровно
 * то, что его платёж занимал в «Кредитах» до досрочки (последний платёж — остаток с
 * процентами, а не весь платёж): внесённый шаг «Свободно» не меняет. Закрыт раньше —
 * весь платёж. Кредит — производный: досрочки месяца возвращаются к остатку до них.
 */
function releasedPayment(c: Credit, payments: Payment[], key: string): number {
  const body = countedPayments(payments)
    .filter((p) => p.kind === 'prepay' && p.targetId === c.id && p.period === key && afterAnchor(p, c.principalSetAt))
    .reduce((a, p) => a + (p.principal ?? p.amount), 0)
  return body > 0 ? creditDueAmount({ ...c, principal: c.principal + body }) : c.payment
}

/**
 * Сколько план направляет в долги за месяц: взносы целей на паузе и платежи закрытых
 * долгов плана — закрыт самый дорогой, его платёж идёт в следующий (Р-5).
 */
export function planExtra(
  plan: DebtPlan,
  goals: Goal[],
  credits: Credit[],
  payments: Payment[] = [],
  key = monthKey(),
): number {
  return (
    pausedGoals(plan, goals).reduce((a, g) => a + g.monthly, 0) +
    releasedCredits(plan, credits, payments, key).reduce((a, c) => a + releasedPayment(c, payments, key), 0)
  )
}

/**
 * Сколько снять с каждой цели, чтобы вместе вышло `amount`: доля её накопленного, целые
 * тенге (метод наибольшего остатка), не больше накопленного. Σ = min(amount, Σ накопленного).
 */
export function lumpShares(goals: Goal[], amount: number): { goalId: string; amount: number }[] {
  const pool = goals.map((g) => ({ goalId: g.id, have: Math.max(0, Math.round(g.have)) })).filter((g) => g.have > 0)
  const total = pool.reduce((a, g) => a + g.have, 0)
  const take = Math.min(Math.max(0, Math.round(amount)), total)
  if (!take) return []
  const shares = pool.map((g) => {
    const exact = (take * g.have) / total
    return { goalId: g.goalId, amount: Math.floor(exact), rest: exact - Math.floor(exact) }
  })
  let left = take - shares.reduce((a, x) => a + x.amount, 0)
  for (const x of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break
    x.amount++
    left--
  }
  return shares.filter((x) => x.amount > 0).map(({ goalId, amount }) => ({ goalId, amount }))
}

/**
 * «Вложить уже накопленное» при внесении шага (Р-4; клинап Блока 3, вариант (а)): эти деньги
 * лежат в целях на паузе — с них и снимаются, не со счёта. Только в месяц старта и не больше
 * того, что план ещё не снял (движения с его `planId`, и у удалённых целей): «Снять»
 * досрочку и внести заново — второй раз не снимется.
 */
export function planLumpTakes(plan: DebtPlan, goals: Goal[], paid: number, key: string) {
  if (key !== planStartMonth(plan) || plan.lump <= 0) return []
  const taken = goals
    .flatMap((g) => g.movements ?? [])
    .filter((m) => m.planId === plan.id)
    .reduce((a, m) => a - m.amount, 0)
  return lumpShares(pausedGoals(plan, goals), Math.min(paid, plan.lump - taken))
}

/** Сколько из взноса `paid` снимется с целей на паузе (`planLumpTakes`), остальное — со счёта. */
export const planLumpPart = (plan: DebtPlan, goals: Goal[], paid: number, key: string) =>
  planLumpTakes(plan, goals, paid, key).reduce((a, x) => a + x.amount, 0)

/**
 * «Вложить уже накопленное» плана (PV-15): накопленное целей, которые встанут на паузу, —
 * без «не останавливать» и без цели-подушки (она для поломок, а не для долгов), минус
 * буфер галочки «Сначала подушка». Подпись галочки и записанный план — одно число.
 */
export const planLumpOf = (opts: {
  credits: Credit[]
  goals: Goal[]
  obligations: Obligation[]
  key: string
  kept: string[]
  cushionGoalId: string | null
  cushion: boolean
}) =>
  strategyInputs({
    ...opts,
    kept: opts.cushionGoalId ? [...opts.kept, opts.cushionGoalId] : opts.kept,
    useSaved: true,
  }).lump

/**
 * План, который запишет «Выбрать этот план» (Р-4, Р-9): стор его пишет, калькулятор
 * показывает под кнопкой шаг и прогноз — выбранное = записанное. Долги плана —
 * процентные на момент выбора; прогноз (`planForecast`) считает тот, кто пишет.
 */
export function planDraft(opts: {
  id: string
  by: PersonId
  t: string
  keptGoalIds: string[]
  cushionGoalId: string | null
  months: 12 | 24 | 36
  lump: number
  credits: Credit[]
}): DebtPlan {
  return {
    id: opts.id,
    status: 'active',
    by: opts.by,
    startedAt: opts.t,
    endedAt: null,
    keptGoalIds: [...opts.keptGoalIds],
    cushionGoalId: opts.cushionGoalId,
    creditIds: costliestCredits(opts.credits).map((c) => c.id),
    months: opts.months,
    lump: Math.max(0, Math.round(opts.lump)),
    forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null },
    result: null,
    updatedAt: opts.t,
  }
}

/** Сумма месяца плана (Р-4): `planExtra`, а в месяц старта — ещё «вложить уже накопленное». */
export const planMonthSum = (plan: DebtPlan, state: PlanState, key: string) =>
  planExtra(plan, state.goals ?? [], state.credits ?? [], state.payments ?? [], key) +
  (key === planStartMonth(plan) ? plan.lump : 0)

/**
 * Шаг месяца уже внесён (Р-4: одна сумма в месяц) — живая досрочка любого плана за этот
 * месяц: отменили план и выбрали заново, двое выбрали разные планы офлайн — семья не
 * платит шаг месяца второй раз. Итог плана (`planFact`) считает только свои досрочки.
 */
export const planPrepays = (payments: Payment[] = [], period: string) =>
  countedPayments(payments)
    .filter((p) => p.kind === 'prepay' && !!p.planId && p.period === period)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))

export type PlanStep =
  /** Сначала подушка (Р-7): `missing` — сколько не хватает до месяца списаний, `amount` — сколько из плана туда. */
  | { kind: 'cushion'; goalId: string; amount: number; missing: number }
  /**
   * Досрочка месяца в самый дорогой долг. `applied` — месяц закрыт: последняя досрочка
   * плана, `amount` — всё внесённое за месяц, `creditId` — её долг.
   */
  | { kind: 'prepay'; creditId: string; amount: number; period: string; applied: Payment | null }
  /** Долгов с процентами не осталось — план закрывает `settlePlans`. */
  | { kind: 'done' }

/**
 * Шаг-досрочка, который ждёт оплаты: не внесён и не пустой; иначе null. Одно правило
 * для кнопки «Внести по плану», строки кредита, окна досрочки и графика плана.
 */
export const stepDue = (step: PlanStep | null | undefined) =>
  step?.kind === 'prepay' && !step.applied && step.amount > 0 ? step : null

/**
 * Месяц обязательных списаний — как у калькулятора (`strategyInputs`): им меряют
 * подушку и шаг плана (`planStep`).
 */
export const planMandatory = (state: PlanState, key: string) =>
  strategyInputs({
    credits: state.credits ?? [],
    goals: state.goals ?? [],
    obligations: state.obligations ?? [],
    key,
    kept: [],
    cushion: false,
    useSaved: false,
  }).mandatory

/**
 * Шаг плана на месяц `key` (Р-4, Р-7) — одна сумма месяца (`planMonthSum`) и всегда за
 * текущий месяц: пропущенные месяцы не копятся, план считается от факта (остатки —
 * производные). Шаг не больше остатка долга; закрыл долг, а сумма месяца не вся — остаток
 * вторым шагом в следующий по ставке (Р-5), вместе с платежом закрытого долга.
 */
export function planStep(plan: DebtPlan, state: PlanState, key: string): PlanStep {
  const credits = state.credits ?? []
  const costly = costliestCredits(credits)
  if (!costly.length) return { kind: 'done' }
  const target = costly[0]
  const month = planMonthSum(plan, state, key)
  const paid = planPrepays(state.payments, key)
  if (paid.length) {
    const last = paid[paid.length - 1]
    const total = paid.reduce((a, p) => a + p.amount, 0)
    const closed = (credits.find((c) => c.id === last.targetId)?.principal ?? 0) <= 0
    if (closed && month > total) {
      return { kind: 'prepay', creditId: target.id, amount: Math.min(month - total, target.principal), period: key, applied: null }
    }
    return { kind: 'prepay', creditId: last.targetId, amount: total, period: key, applied: last }
  }

  const cushion = openGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId) // Сбылось (PN-13): сбывшаяся — не подушка плана
  if (cushion) {
    const missing = planMandatory(state, key) - Math.max(0, cushion.have)
    const extra = planExtra(plan, state.goals ?? [], credits, state.payments ?? [], key)
    if (missing > 0) return { kind: 'cushion', goalId: cushion.id, amount: Math.min(extra, missing), missing }
  }
  return { kind: 'prepay', creditId: target.id, amount: Math.min(month, target.principal), period: key, applied: null }
}

/**
 * Прогноз плана от факта (Р-6): «Копим как сейчас» против плана на нынешних остатках и
 * целях. Цели плана — «не останавливать» и подушка; освободившиеся платежи закрытых
 * долгов плана — деньги, которые план направляет в долги (без плана они копились бы).
 * Подушку план добирает до месяца списаний, «вложить накопленное» — пока досрочки
 * месяца старта не было. Дата без долгов сдвигается сама.
 */
export function planForecast(plan: DebtPlan, state: PlanState, key: string): PlanForecast {
  const { a, b } = planRuns(plan, state, key)
  // Долг, который не закрывается, копит проценты все 600 месяцев симуляции — разность таких
  // сумм не экономия, а шум (Р-11: «экономию не считаем»).
  const comparable = a.debtFreeMonth !== null && b.debtFreeMonth !== null
  return {
    gain: strategyGain(a, b),
    savedInterest: comparable ? Math.max(0, Math.round(a.interestTotal - b.interestTotal)) : null,
    debtFreeMonth: b.debtFreeMonth === null ? null : addMonths(key, b.debtFreeMonth),
  }
}

/**
 * Переплата банку «без плана» — сумма «переплаты до конца» (`creditOutlook`) открытых долгов при
 * нынешних платежах: то же число, что у карточки «Самая дорогая ставка» (ревью frontend Б9, Н-2).
 * null — какой-то долг при нынешнем платеже не закрывается (Р-11).
 */
export function overpayNoPlan(credits: Credit[]): number | null {
  let total = 0
  for (const c of openCredits(credits)) {
    const o = creditOutlook(c)
    if (!o.closes) return null
    total += o.overpay
  }
  return total
}

/**
 * Прогноз плана одной строкой квадрата «Долги» (пивот 3, Р-34): те же два прогона, что у
 * `planForecast`, — когда закроются долги с планом, на сколько месяцев раньше, чем без него, и
 * переплата банку без плана → с планом (от нынешних остатков, целые тенге). «Без плана» —
 * `overpayNoPlan` (одно число с карточкой ставки), «с планом» — оно минус экономия
 * `planForecast`. null у срока — без плана или с ним долг не закрывается (Р-11).
 */
export function planOutlook(plan: DebtPlan, state: PlanState, key: string) {
  const { a, b } = planRuns(plan, state, key)
  const without = overpayNoPlan(state.credits ?? [])
  const comparable = a.debtFreeMonth !== null && b.debtFreeMonth !== null && without !== null
  // Разница строки «без → с» сходится с экономией `planForecast` до тенге.
  const saved = Math.max(0, Math.round(a.interestTotal - b.interestTotal))
  return {
    debtFreeMonth: b.debtFreeMonth === null ? null : addMonths(key, b.debtFreeMonth),
    monthsSooner: comparable ? Math.max(0, a.debtFreeMonth! - b.debtFreeMonth!) : null,
    overpayWithout: comparable ? without : null,
    overpayWith: comparable ? Math.max(0, without! - saved) : null,
  }
}

export type DebtRow = {
  creditId: string
  name: string
  /** Платёж в месяц по графику. */
  payment: number
  rate: number
  rateUnknown: boolean
  /** Долг человеку (мелочи Р-5): строка без ставки, «Отдал» у строки. */
  person: boolean
  /** Месяц последнего платежа при нынешнем платеже (`creditOutlook`, как «до …» в «Кредитах»); null — не закрывается. */
  endMonth: string | null
  /** Остаток долга. */
  left: number
  /** Погашено с начала учёта, 0…1: тело из отметок / (остаток + оно); null — отметок с телом нет. */
  paidShare: number | null
}

/**
 * Экран «Долги» (Р-110): сумма остатков, «без долгов — к» и кредиты строками. `freeMonth` с активным планом
 * «Сначала долги» — его прогноз (`planForecast`: последний долг с процентами) и графики беспроцентных (план их не
 * гасит досрочно) — что позже; без плана — последний месяц закрытия по графикам. null — долгов нет или какой-то
 * не закрывается. Исходной суммы кредита в документе нет — полоса считает от начала учёта. Кредиты — производные.
 */
export function debtsOverview(state: PlanState & { plans?: DebtPlan[] }, key: string): { total: number; freeMonth: string | null; rows: DebtRow[] } {
  const credits = openCredits(state.credits ?? [])
  const counted = countedPayments(state.payments ?? [])
  const rows = credits.map((c): DebtRow => {
    const out = creditOutlook(c)
    const body = counted
      .filter((p) => p.targetId === c.id && (p.kind === 'credit' || p.kind === 'prepay'))
      .reduce((s, p) => s + (p.principal ?? 0), 0)
    return {
      creditId: c.id,
      name: c.name,
      payment: c.payment,
      rate: c.annualRate,
      rateUnknown: !!c.rateUnknown,
      person: !!c.person,
      endMonth: out.closes ? addMonths(key, out.months) : null,
      left: c.principal,
      paidShare: body > 0 ? body / (c.principal + body) : null,
    }
  })
  const plan = activePlan(state.plans)
  const scheduled = plan ? rows.filter((r) => !(r.rate > 0)) : rows
  const ends = [...scheduled.map((r) => r.endMonth), ...(plan ? [planForecast(plan, state, key).debtFreeMonth] : [])]
  const freeMonth = !rows.length || ends.includes(null) ? null : (ends as string[]).sort().at(-1)!
  return { total: openDebt(credits), freeMonth, rows }
}

/** Два прогона прогноза плана: «копим как сейчас» (`a`) и план (`b`) на нынешних остатках. */
function planRuns(plan: DebtPlan, state: PlanState, key: string) {
  const credits = state.credits ?? []
  const payments = state.payments ?? []
  const inputs = strategyInputs({
    credits,
    goals: state.goals ?? [],
    obligations: state.obligations ?? [],
    key,
    kept: plan.cushionGoalId ? [...plan.keptGoalIds, plan.cushionGoalId] : plan.keptGoalIds,
    cushion: false,
    useSaved: false,
  })
  const cushion = openGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId) // Сбылось (PN-13): сбывшаяся — не подушка плана
  const buffer = cushion ? Math.max(0, inputs.mandatory - Math.max(0, cushion.have)) : 0
  const lump = key === planStartMonth(plan) && !planPrepays(payments, key).length ? plan.lump : 0
  const released = releasedCredits(plan, credits, payments, key).reduce((a, c) => a + c.payment, 0)
  const base = { debts: inputs.debts, saving: inputs.saving + released, keep: inputs.keep, start: inputs.start, months: plan.months }
  const a = simulateStrategy({ ...base, payDebts: false })
  const b = simulateStrategy({ ...base, payDebts: true, lump, buffer })
  return { a, b }
}

/** Факт плана (Р-6): досрочки с его id — сэкономленные проценты и шаги по порядку. */
export function planFact(plan: DebtPlan, payments: Payment[] = [], credits: Credit[] = []) {
  const own = countedPayments(payments)
    .filter((p) => p.kind === 'prepay' && p.planId === plan.id)
    .sort((a, b) => a.at.localeCompare(b.at))
  return {
    // Как счётчик Капитала: у удалённого кредита экономии нет (`prepaySaved`).
    savedInterest: prepaySaved(own, credits),
    steps: own.map((p) => ({ period: p.period, creditId: p.targetId, amount: p.amount })),
  }
}

/** План уходит в историю (Р-5): статус, дата конца и итог по его досрочкам. */
export const endedPlan = (
  p: DebtPlan,
  status: 'done' | 'cancelled',
  payments: Payment[],
  credits: Credit[],
  t: string,
): DebtPlan => ({ ...p, status, endedAt: t, result: { savedInterest: planFact(p, payments, credits).savedInterest }, updatedAt: t })

export type PlanMonth = {
  period: string
  /** Сколько план называл: у внесённого месяца — внесённое, у текущего — шаг, у пропущенного — по нынешним взносам. */
  planned: number
  /** Сколько внесли досрочками плана. */
  fact: number
  /** В какой долг: внесённый или долг шага; null — не было. */
  creditId: string | null
  /**
   * Месяц подушки (Р-7): в подушке было меньше месяца списаний — план клал деньги в неё,
   * досрочек и не ждал. `planned` — сколько в подушку, `fact` — взносы в неё за месяц.
   */
  cushion?: true
}

/** Накопленное цели на начало месяца `period` — по её движениям (не ниже нуля, как `goalHave`). */
const goalHaveBefore = (g: Goal, period: string) =>
  goalHave(g.seed, (g.movements ?? []).filter((m) => monthKey(new Date(m.date)) < period))

/**
 * Сколько положили в цель за месяц `period` — нетто движений месяца, не ниже нуля: снятие «Не отложено» вычитается
 * (одно определение для `put` плана, списка дел `planPuts` и сводки прошлого месяца — ревью frontend Б15, Н-3).
 */
const goalPutIn = (g: Goal, period: string) =>
  Math.max(0, (g.movements ?? []).filter((m) => monthKey(new Date(m.date)) === period).reduce((a, m) => a + m.amount, 0))

/** План и факт по месяцам (Р-6): с месяца старта по `key` включительно. */
export function planMonths(plan: DebtPlan, state: PlanState, key: string): PlanMonth[] {
  const payments = state.payments ?? []
  const start = planStartMonth(plan)
  const steps = planFact(plan, payments).steps
  const step = planStep(plan, state, key)
  const due = stepDue(step)?.amount ?? 0
  const cushion = openGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId) // Сбылось (PN-13): сбывшаяся — не подушка плана
  const rows: PlanMonth[] = []
  for (let period = start; period <= key; period = addMonths(period, 1)) {
    const own = steps.filter((s) => s.period === period)
    const fact = own.reduce((a, s) => a + s.amount, 0)
    const extra = () => planExtra(plan, state.goals ?? [], state.credits ?? [], payments, period)
    // Месяц подушки (Р-7): не пропуск — план клал деньги в подушку (прошлый — по её движениям).
    const short =
      !cushion || fact
        ? 0
        : period === key
          ? step.kind === 'cushion' ? step.missing : 0
          : planMandatory(state, period) - goalHaveBefore(cushion, period)
    if (cushion && short > 0) {
      const planned = period === key && step.kind === 'cushion' ? step.amount : Math.min(extra(), short)
      rows.push({ period, planned, fact: goalPutIn(cushion, period), creditId: null, cushion: true })
      continue
    }
    const current = period === key && step.kind === 'prepay'
    const missed = () => extra() + (period === start ? plan.lump : 0)
    // Текущий месяц: внесённое и шаг, который ещё ждёт (второй — после закрытого долга).
    const planned = current ? (fact + due) || step.amount : fact ? fact : period === key ? 0 : missed()
    rows.push({ period, planned, fact, creditId: own[0]?.creditId ?? (current ? step.creditId : null) })
  }
  return rows
}

/**
 * Что сделать с планами после правки долгов и после слияния (Р-5, Р-9): два активных —
 * старший отменён; долгов с процентами не осталось — активный завершён. Открытый долг без ставки (`rateUnknown`,
 * из выписки) план не закрывает: проценты у него, скорее всего, есть (хвост 958). У закрытого
 * плана — итог по его досрочкам. null — менять нечего. Кредиты — производные.
 */
export function settlePlans(plans: DebtPlan[] = [], credits: Credit[], payments: Payment[], t: string): DebtPlan[] | null {
  const latest = activePlan(plans)
  if (!latest) return null
  const done = costliestCredits(credits).length === 0 && !openCredits(credits).some((c) => c.rateUnknown)
  let changed = false
  const next = plans.map((p): DebtPlan => {
    if (p.deletedAt || p.status !== 'active') return p
    const status = p.id !== latest.id ? 'cancelled' : done ? 'done' : null
    if (!status) return p
    changed = true
    return endedPlan(p, status, payments, credits, t)
  })
  return changed ? next : null
}

/**
 * На сколько месяцев цель на паузе ради плана (PV-17, Р-6): с месяца старта по `key`
 * включительно, у закрытого плана — по месяц конца. Каждый такой месяц взнос шёл в
 * долги, и дата цели сдвигается на столько же. Цель «не останавливать» и подушка — 0.
 */
export function pauseShift(plan: DebtPlan, goal: Goal, key: string): number {
  if (plan.keptGoalIds.includes(goal.id) || plan.cushionGoalId === goal.id) return 0
  const start = planStartMonth(plan)
  const end = plan.endedAt ? monthKey(new Date(plan.endedAt)) : key
  const last = end < key ? end : key
  if (last < start) return 0
  const a = parseMonthKey(start)
  const b = parseMonthKey(last)
  return (b.year - a.year) * 12 + (b.month - a.month) + 1
}

/** Сколько не ушло в цель за паузу: взнос × месяцы паузы (Р-6). */
export const pauseMissed = (plan: DebtPlan, goal: Goal, key: string) => goal.monthly * pauseShift(plan, goal, key)

/**
 * График платежей долга, который план гасит сейчас (PV-17, Р-8): `creditSchedule` с
 * будущими шагами плана — в этом месяце сумма шага (внесённый уже в графике, подушка —
 * ноль), дальше каждый месяц то, что план направляет в долги, пока долг не закроется.
 * Закрылся самый дорогой — график следующего по ставке. null — долгов с процентами нет.
 */
export function planSchedule(
  plan: DebtPlan,
  state: PlanState,
  key: string,
): { creditId: string; rows: ScheduleRow[] } | null {
  const credits = state.credits ?? []
  const payments = state.payments ?? []
  const target = costliestCredits(credits)[0]
  if (!target) return null
  const now = stepDue(planStep(plan, state, key))?.amount ?? 0
  // Дальше — сумма обычного месяца: платёж долга, закрытого в этом, свободен целиком.
  const monthly = planExtra(plan, state.goals ?? [], credits, payments, addMonths(key, 1))
  const extra = [{ period: key, amount: now }]
  // Каждый месяц в долг уходит не меньше шага: дальше закрытия шаги не нужны.
  const months = monthly > 0 ? Math.min(SCHEDULE_CAP, Math.ceil(target.principal / monthly) + 1) : 0
  for (let i = 1; i <= months; i++) extra.push({ period: addMonths(key, i), amount: monthly })
  return { creditId: target.id, rows: creditSchedule(target, payments, { from: key, extra }) }
}

/* ---------------- главный экран «Мечты» (Р-8, B2C-14) ---------------- */

/**
 * Главная мечта — герой главного экрана (Р-84): первая цель очереди (`queueOf`), не фонд и не карточка долга
 * (фонд — и копилка `potGoalId`, поэтому настройки денег). Порядка ещё нет — старая пометка `main` (поздняя)
 * первой, иначе первая живая. null — целей нет.
 */
export function mainGoal(goals: Goal[], order?: QueueOrder | null, settings?: MoneySettings | null): Goal | null {
  return queueOf({ goals, goalOrder: order, moneySettings: settings }).find((x) => x.kind === 'goal')?.goal ?? null
}

/* ---------------- очередь целей, фонды, плательщик (Блок 14, B2C-85) ---------------- */

/** Id карточки «закрыть кредит» в очереди целей (Р-82). */
export const DEBT_CARD = 'debt'

/**
 * Кто платит (Р-80): свой `payer`, иначе `who` обязательства («чей платёж»), иначе первый живой участник.
 * Плательщик, которого в семье нет (удалён), не считается. null — участников нет.
 */
export function payerOf(item: { payer?: PersonId | null; who?: PersonId | null }, people: Person[]): PersonId | null {
  const live = (people ?? []).filter(alive)
  const ok = (id: PersonId | null | undefined): id is PersonId => !!id && live.some((p) => p.id === id)
  if (ok(item.payer)) return item.payer
  if (ok(item.who)) return item.who
  return live[0]?.id ?? null
}

/**
 * Фонды семьи (Р-82): живые цели с `fund`; двое завели один фонд офлайн — первый по id. Отдельной «Подушки»
 * нет — ею считается копилка Блока 11 (`moneySettings.potGoalId`), пока стор не пометит её (`ensureFund`).
 */
export function fundsOf(doc: { goals?: Goal[]; moneySettings?: MoneySettings | null }): { reserve: Goal | null; cushion: Goal | null } {
  const live = openGoals(doc.goals ?? []) // Сбылось (PN-13): сбывшаяся подушка — не фонд семьи
  const first = (kind: 'reserve' | 'cushion') =>
    live.filter((g) => g.fund === kind).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
  const reserve = first('reserve')
  const potId = doc.moneySettings?.potGoalId
  const pot = live.find((g) => g.id === potId && !g.fund) ?? null
  return { reserve, cushion: first('cushion') ?? pot }
}

/** Порог фонда в месяцах трат (Р-82): свой `fundMonths`, иначе умолчание семьи. */
export const fundMonthsOf = (kind: 'reserve' | 'cushion', g: Pick<Goal, 'fundMonths'>, settings: MoneySettings) =>
  g.fundMonths ?? (kind === 'reserve' ? settings.reserveMonths : settings.cushionMonths)

export type QueueItem =
  | { id: string; kind: 'goal'; goal: Goal }
  | { id: string; kind: 'fund'; fund: 'reserve' | 'cushion'; goal: Goal }
  | { id: typeof DEBT_CARD; kind: 'debt'; goal: null }

/**
 * Очередь денег (Р-84): цели, фонды и карточка долга сверху вниз. Порядок — `goalOrder`; живые, которых в нём
 * нет, — в конец в порядке документа (порядка нет вовсе — старая пометка `main`, поздняя, первой: один раз,
 * до первой записи порядка); удалённые выпадают. Карточка долга — пока есть открытый долг с процентами
 * (`costliestCredits`; кредиты — производные, как отдаёт стор); нет в порядке — в конец.
 */
export function queueOf(doc: {
  goals?: Goal[]
  goalOrder?: QueueOrder | null
  credits?: Credit[]
  moneySettings?: MoneySettings | null
}): QueueItem[] {
  const live = openGoals(doc.goals ?? []) // Сбылось (PN-13): в очереди только активные — сбывшаяся не герой и не взнос
  const byId = new Map(live.map((g) => [g.id, g]))
  const debt = costliestCredits(doc.credits ?? []).length > 0
  const ids: string[] = []
  const put = (id: string) => {
    if (ids.includes(id) || (id === DEBT_CARD ? !debt : !byId.has(id))) return
    ids.push(id)
  }
  const order = doc.goalOrder?.ids ?? []
  if (order.length) order.forEach(put)
  else {
    const legacy = live.filter((g) => g.main).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (legacy) put(legacy.id)
  }
  live.forEach((g) => put(g.id))
  put(DEBT_CARD)
  const funds = fundsOf(doc)
  return ids.map((id): QueueItem => {
    if (id === DEBT_CARD) return { id: DEBT_CARD, kind: 'debt', goal: null }
    const goal = byId.get(id)!
    const fund = goal.id === funds.reserve?.id ? 'reserve' : goal.id === funds.cushion?.id ? 'cushion' : goal.fund ?? null
    return fund ? { id, kind: 'fund', fund, goal } : { id, kind: 'goal', goal }
  })
}

/** Карточка «закрыть кредит» с умолчаниями (Р-82): суммы нет — 0, включена, плательщик — по умолчанию. */
export const debtCardOf = (doc: { debtCard?: DebtCard | null }): DebtCard => ({ monthly: 0, pausedAt: null, payer: null, updatedAt: '', ...(doc.debtCard ?? {}) })

/** Порядок «Желаний» (Р-84): `wishOrder`, остальные живые — в конец в порядке документа. */
export function wishQueue(doc: { wishlist?: WishItem[]; wishOrder?: QueueOrder | null }): WishItem[] {
  const live = liveWishlist(doc.wishlist ?? [])
  const byId = new Map(live.map((w) => [w.id, w]))
  const ids = [...new Set((doc.wishOrder?.ids ?? []).filter((id) => byId.has(id)))]
  for (const w of live) if (!ids.includes(w.id)) ids.push(w.id)
  return ids.map((id) => byId.get(id)!)
}

/** Новый порядок: `id` переносится на место `to` (за краями — к краю). Нет `id` в списке — порядок как был. */
export function moveId(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids.slice()
  const out = ids.filter((x) => x !== id)
  out.splice(Math.max(0, Math.min(Math.round(to), out.length)), 0, id)
  return out
}

/**
 * Перенос среди части списка (Р-84: цели — среди целей): `id` встаёт на место `to` внутри `among`, прочие
 * (фонды, карточка долга) остаются на своих местах. Нет `id` в `among` — порядок как был.
 */
export function moveWithin(ids: string[], among: string[], id: string, to: number): string[] {
  const part = ids.filter((x) => among.includes(x))
  if (!part.includes(id)) return ids.slice()
  const next = moveId(part, id, to)
  let k = 0
  return ids.map((x) => (among.includes(x) ? next[k++]! : x))
}

/* ---------------- план месяца (Блок 14, B2C-86) ---------------- */

/** Документ семьи для плана месяца: кредиты — производные (как отдаёт стор), книга курсов и обмены — Р-74. */
export type MonthPlanState = {
  people?: Person[]
  obligations?: Obligation[]
  credits?: Credit[]
  goals?: Goal[]
  payments?: Payment[]
  plans?: DebtPlan[]
  allocations?: Allocation[]
  moneySettings?: MoneySettings | null
  spendPlans?: SpendPlan[]
  goalOrder?: QueueOrder | null
  debtCard?: DebtCard | null
  book?: RateBook | null
  fxExchanges?: FxExchange[]
  planShifts?: PlanShift[]
  /** Итоги находок участников (RZ-01) — вход `reviewFindings`. */
  reviewFinds?: ReviewFind[]
}

export type MonthPlanCtx = {
  /** Месяц плана. */
  key: string
  totals: SpendTotal[]
  spendCategories: SpendCategory[]
  uploads: UploadPeriod[]
  /**
   * Платежи, которые кончатся (прикидка, Блок 5 «понятность»): с месяца `after` прогона очереди `amount` снова
   * свободен. Без поля платежи считаются вечными — даты плана осторожные.
   */
  ends?: { amount: number; after: number }[]
  /**
   * Траты по факту (Р-18, AU-04 — только для метки «мечта сдвинулась»): траты участника = max(план, факт), факта нет —
   * план. Порог фонда считается от плана, как без флага. Без флага — план (экраны).
   */
  byFact?: boolean
}

export type PlanIncome = {
  person: PersonId
  name: string
  /**
   * Тенге месяца: пришла — сколько пришло (`paidTenge`), нет — сколько ждём (`salaryTenge`; плавающая — среднее,
   * Р-6). По ритму (Б7) — сумма приходов: пришедшие фактом, остальные ожиданием.
   */
  amount: number
  /** Пришли все приходы месяца (у месячного ритма — зарплата). */
  came: boolean
  /** Приходы месяца по ритму (Б7): месячный — один. */
  events: IncomeEvent[]
  cameCount: number
  eventCount: number
}

export type PlanDue = MonthDue & { payer: PersonId | null }

export type PlanSpend = {
  by: PersonId
  /** Сумма разделов на месяц (Р-81). */
  plan: number
  /** Факт по выпискам участника за месяц (кроме платежей `plannedElsewhere`); null — выписок за месяц нет. */
  fact: number | null
  rows: { categoryId: string; name: string; plan: number; fact: number | null }[]
}

export type PlanQueueItem = {
  id: string
  kind: 'goal' | 'fund' | 'debt'
  fund?: 'reserve' | 'cushion'
  /** Цель или фонд; у карточки долга — null. */
  goalId: string | null
  /** Долг карточки (самый дорогой с процентами). */
  creditId?: string
  /** Досрочка шагом плана «Сначала долги» (Р-82): сумма карточки — шаг плана. */
  planId?: string
  name: string
  payer: PersonId | null
  /** Сколько просит в этом месяце: взнос (`monthly`), не больше остатка до суммы, порога фонда, долга. */
  want: number
  /** Сколько даёт план (Р-84: сверху вниз из остатка после платежей и трат); выключенная — 0. */
  given: number
  /** Выключена (Р-83): `pausedAt`, у цели — и пауза плана «Сначала долги» (`plan`). */
  paused: false | 'off' | 'plan'
  /** Накоплено на начало месяца (у долга — остаток на начало месяца). */
  have: number
  /** Цель — её сумма, фонд — порог (месяцы × траты месяца), долг — остаток на начало месяца. */
  need: number
  /** Уже отложено в этом месяце (взносы цели за вычетом снятий — `goalPutIn`, досрочки долга). */
  put: number
  /** Месяц, к которому соберём или закроем при той же очереди и суммах; null — не соберём (пауза, взнос 0). */
  doneMonth: string | null
}

export type MonthPlan = {
  key: string
  income: { total: number; byPerson: PlanIncome[] }
  dues: PlanDue[]
  duesTotal: number
  spend: PlanSpend[]
  spendTotal: number
  /** «Потратим» месяца: платежи + траты. */
  outTotal: number
  /** Доход − платежи − траты: что получает очередь; меньше нуля — не хватает. */
  free: number
  queue: PlanQueueItem[]
  queueTotal: number
  /**
   * Уже отложено в этом месяце по очереди (сумма `put`: взносы целей и фондов, досрочки) — «✓ Отложено». Не из
   * частей записи: у старого разбора Блока 11 части — статьи (платежи, жизнь…), не взносы.
   */
  putTotal: number
  /** Что осталось после очереди, ≥ 0. Доход = платежи + траты + очередь + остаток − нехватка. */
  rest: number
  /** Сколько не хватает на платежи и траты, ≥ 0. */
  short: number
  /** Хватает ли каждому (Р-80): зарплата − его платежи − его траты − его цели и фонды; минус — не хватает. */
  byPerson: { person: PersonId; income: number; dues: number; spend: number; queue: number; left: number }[]
  /** Записи «Отложить по плану» (и старого разбора) этого месяца по плательщику — второй раз не пишется. */
  saved: Partial<Record<PersonId, Allocation>>
}

/** Горизонт прогона очереди — как у графика кредита. */
const PLAN_HORIZON = 600

/** `first` — добавка к взносу только в первом месяце прогона (сдвиг месяца `planShifts`, AU-05). */
type RunItem = { on: boolean; cap: number; first?: number; left: number; debt?: { rate: number; payment: number } }

/**
 * Прогон очереди по месяцам (B2C-86 п. 2): каждый месяц — тот же свободный остаток сверху вниз, каждой не
 * больше её взноса и остатка; собранная выпадает — её деньги идут ниже. Долг: сначала платёж по графику
 * (`creditSplit`, проценты до тенге), затем доплата карточки. Ответ — месяц (смещение от первого), когда
 * цель собрана или долг закрыт; null — не в горизонте. Платежи и траты считаются прежними — дата осторожная;
 * только `ends` (прикидка кредита на срок) с месяца `after` возвращает свой платёж в остаток.
 */
function queueRun(items: RunItem[], free: number, ends: { amount: number; after: number }[] = [], firstExtra = 0): (number | null)[] {
  const left = items.map((x) => x.left)
  const done: (number | null)[] = items.map((x, i) => (x.debt ? null : left[i] <= 0 ? 0 : null))
  for (let m = 0; m < PLAN_HORIZON && done.some((d) => d === null); m++) {
    // `firstExtra` — план трат, урезанный сдвигом только этого месяца (AU-05): в следующих месяцах его нет.
    let avail = Math.max(0, free + (m === 0 ? firstExtra : 0) + ends.reduce((s, e) => s + (m >= e.after ? e.amount : 0), 0))
    items.forEach((x, i) => {
      if (done[i] !== null) return
      if (x.debt) left[i] -= creditSplit(left[i], x.debt.rate, x.debt.payment).body
      const give = x.on ? Math.max(0, Math.min(x.cap + (m === 0 ? x.first ?? 0 : 0), left[i], avail)) : 0
      left[i] -= give
      avail -= give
      if (left[i] <= 0) done[i] = m
    })
  }
  return done
}

/** Тело кредита и досрочек этого месяца по долгу — чтобы считать от остатка на начало месяца. */
const creditBodyIn = (c: Credit, payments: Payment[] = [], key: string) =>
  countedPayments(payments)
    .filter((p) => p.targetId === c.id && (p.kind === 'credit' || p.kind === 'prepay') && p.period === key && afterAnchor(p, c.principalSetAt))
    .reduce((s, p) => s + (p.principal ?? 0), 0)

/** Есть ли за месяц хоть одна загрузка выписки — иначе факта нет, а не «потрачено 0». */
const monthUploaded = (key: string, uploads: UploadPeriod[]) => {
  const monthStart = `${key}-01`
  const monthEnd = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`
  return uploads.some((u) => u.period_to >= monthStart && u.period_from <= monthEnd)
}

/** Есть ли у участника выписка, покрывающая хотя бы день месяца. */
const uploadedBy = (by: PersonId, key: string, uploads: UploadPeriod[]) =>
  monthUploaded(key, uploads.filter((u) => u.slot === by))

/**
 * План месяца (Р-78, Р-79): доход обоих → платежи месяца → траты каждого → цели, фонды и карточка долга по
 * очереди (Р-84) из остатка → что осталось. Каждая часть — целые тенге; доход = платежи + траты + очередь +
 * остаток − нехватка. Взносы и пороги считаются от начала месяца: «Отложить по плану» план не меняет.
 *
 * - Доход — зарплаты месяца: пришедшая — `paidTenge`, ещё нет — `salaryTenge` (Р-74).
 * - Платежи — `monthDues` (отметки — суммой отметки, валютные — по курсу дня списания, Р-75); плательщик — Р-80.
 * - Траты — `spendPlans` участника (разделы платежей — `plannedElsewhere` — не планируются, Р-81); факт —
 *   итоги выписок участника за месяц.
 * - Очередь — цель: `monthly`, не больше остатка до суммы; фонд: `monthly`, не больше остатка до порога —
 *   месяцы фонда × (платежи + траты месяца) (Р-82); карточка долга: своя сумма в месяц, не больше остатка долга
 *   после платежа по графику, а с активным планом «Сначала долги» — шаг плана (`planStep`). Выключенная (`pausedAt`)
 *   и цель на паузе плана — 0.
 * - Даты — прогон очереди по месяцам (`queueRun`); выключил цель — даты остальных сдвигаются.
 */
export function monthPlan(state: MonthPlanState, ctx: MonthPlanCtx): MonthPlan {
  const { key } = ctx
  const people = (state.people ?? []).filter(alive)
  const payments = state.payments ?? []
  const settings = moneySettingsOf(state)

  // Доход.
  // Ритм (Б7): сумма приходов месяца — пришедшие фактом, остальные ожиданием; месячный ритм — как раньше.
  const income: PlanIncome[] = people
    .map((p) => {
      const events = incomeEvents(state, p, key)
      const cameCount = events.filter((e) => e.came).length
      const amount = amountTotal(events)
      return { person: p.id, name: p.name, amount, came: events.length > 0 && cameCount === events.length, events, cameCount, eventCount: events.length }
    })
    .filter((x) => x.amount > 0 || x.cameCount > 0)
  const incomeTotal = amountTotal(income)

  // Платежи.
  const dues: PlanDue[] = monthDues(state, key).map((d) => ({
    ...d,
    payer: payerOf(d.kind === 'obligation' ? d.obligation : d.credit, people),
  }))
  const duesTotal = amountTotal(dues)

  // Траты каждого.
  const live = ctx.spendCategories.filter(alive)
  const named = liveSpendCategories(ctx.spendCategories)
  // Сдвиги этого месяца (Р-17): из раздела — только когда у участника есть строка плана этого раздела.
  const planRow = (by: PersonId, categoryId: string) =>
    (state.spendPlans ?? []).some((x) => x.by === by && x.categoryId === categoryId && planSpendOn(x, live))
  const shifts = (state.planShifts ?? []).filter(
    (s) => !s.deletedAt && s.period === key && s.amount > 0 && (s.from === 'rest' || planRow(s.from.spend, s.from.categoryId)),
  )
  let spendCut = 0 // сколько плана трат сдвиги сняли в этом месяце (строка не ниже 0)
  const cutOf = (by: PersonId, categoryId: string, amount: number) => {
    const cut = Math.min(amount, shifts.reduce((a, s) => a + (s.from !== 'rest' && s.from.spend === by && s.from.categoryId === categoryId ? s.amount : 0), 0))
    spendCut += cut
    return amount - cut
  }
  const addOf = (to: { goalId: string } | 'debt') =>
    shifts.reduce((a, s) => a + ((to === 'debt' ? s.to === 'debt' : s.to !== 'debt' && s.to.goalId === to.goalId) ? s.amount : 0), 0)
  const spend: PlanSpend[] = people
    .map((p): PlanSpend => {
      const has = uploadedBy(p.id, key, ctx.uploads)
      const mine = ctx.totals.filter((t) => !t.deletedAt && t.by === p.id && t.kind === 'month' && t.period === key && t.amount > 0)
      // Строка раздела — без разовых, как строка «Трат»; факт участника — с ними (FB-07, Р-5).
      const rowFact = (categoryId: string) => (has ? mine.filter((t) => t.categoryId === categoryId).reduce((s, t) => s + spentOf(t, live), 0) : null)
      const rows = (state.spendPlans ?? [])
        .filter((x) => x.by === p.id && planSpendOn(x, live))
        .map((x) => ({
          categoryId: x.categoryId,
          name: spendCategoryName(named, x.categoryId),
          plan: cutOf(p.id, x.categoryId, x.amount),
          fact: rowFact(x.categoryId),
        }))
      const fact = has
        ? mine.reduce((s, t) => s + factOf(t, live), 0)
        : null
      return { by: p.id, plan: rows.reduce((s, r) => s + r.plan, 0), fact, rows }
    })
    .filter((s) => s.rows.length > 0 || (s.fact ?? 0) > 0)
  const spendPlanned = spend.reduce((s, x) => s + x.plan, 0)
  const spendTotal = ctx.byFact ? spend.reduce((s, x) => s + Math.max(x.plan, x.fact ?? x.plan), 0) : spendPlanned

  const free = incomeTotal - duesTotal - spendTotal
  // Порог фонда — от плана (и при `byFact`: метка меряет деньги месяца, а не новый порог), без сдвигов этого месяца.
  const monthSpend = duesTotal + spendPlanned + spendCut

  // Очередь.
  const plan = activePlan(state.plans ?? [])
  const planPaused = new Set(plan ? pausedGoals(plan, state.goals ?? []).map((g) => g.id) : [])
  const card = debtCardOf(state)
  const target = costliestCredits(state.credits ?? [])[0]
  const step = plan && target ? planStep(plan, state, key) : null
  const shape = queueOf(state).map((q) => {
    if (q.kind === 'debt') {
      const c = plan && step?.kind === 'prepay' ? (state.credits ?? []).find((x) => x.id === step.creditId) ?? target : target
      const start = c.principal + creditBodyIn(c, payments, key)
      const afterRegular = start - creditSplit(start, c.annualRate, c.payment).body
      const base = plan ? (step?.kind === 'prepay' ? Math.min(step.amount, afterRegular) : 0) : Math.min(Math.max(0, card.monthly), afterRegular)
      // Сдвиг в долг (AU-05) — только этот месяц, не больше остатка после платежа по графику.
      const want = Math.max(base, Math.min(base + addOf('debt'), afterRegular))
      const put = countedPayments(payments)
        .filter((p) => p.kind === 'prepay' && p.targetId === c.id && p.period === key)
        .reduce((s, p) => s + p.amount, 0)
      return {
        item: {
          id: q.id, kind: 'debt' as const, goalId: null, creditId: c.id, ...(plan && step?.kind === 'prepay' ? { planId: plan.id } : {}),
          name: c.name, payer: payerOf(card, people), want, paused: card.pausedAt ? ('off' as const) : (false as const), have: start, need: start, put,
        },
        run: { cap: base, first: want - base, left: start, debt: { rate: c.annualRate, payment: c.payment } },
      }
    }
    const g = q.goal
    const have = goalHaveBefore(g, key)
    const need = q.kind === 'fund' ? fundMonthsOf(q.fund, g, settings) * monthSpend : g.need
    const base = Math.min(Math.max(0, g.monthly), Math.max(0, need - have))
    // Сдвиг в цель или фонд (AU-05) — только этот месяц, не больше остатка до суммы или порога.
    const want = Math.max(base, Math.min(base + addOf({ goalId: g.id }), Math.max(0, need - have)))
    const paused = g.pausedAt ? ('off' as const) : planPaused.has(g.id) ? ('plan' as const) : (false as const)
    return {
      item: {
        id: q.id, kind: q.kind, ...(q.kind === 'fund' ? { fund: q.fund } : {}), goalId: g.id,
        name: g.name, payer: payerOf(g, people), want, paused, have, need, put: goalPutIn(g, key),
      },
      run: { cap: base, first: want - base, left: Math.max(0, need - have) },
    }
  })
  let avail = free
  const queue: PlanQueueItem[] = shape.map(({ item }) => {
    const given = item.paused ? 0 : Math.max(0, Math.min(item.want, avail))
    avail -= given
    return { ...item, given, doneMonth: null }
  })
  // Урезанный сдвигами план трат свободен только в первом месяце прогона.
  const done = queueRun(shape.map(({ item, run }) => ({ ...run, on: !item.paused })), free - spendCut, ctx.ends, spendCut)
  queue.forEach((q, i) => {
    // Долг на паузе всё равно закрывается по графику; цель на паузе — нет.
    const d = done[i]
    q.doneMonth = d === null || (q.paused && q.kind !== 'debt') ? null : addMonths(key, d)
  })
  const queueTotal = amountTotal(queue.map((q) => ({ amount: q.given })))

  const byPerson = people.map((p) => {
    const mine = <T extends { payer: PersonId | null }>(xs: T[]) => xs.filter((x) => x.payer === p.id)
    const inc = income.find((x) => x.person === p.id)?.amount ?? 0
    const d = amountTotal(mine(dues))
    const s = spend.find((x) => x.by === p.id)?.plan ?? 0
    const q = mine(queue).reduce((a, x) => a + x.given, 0)
    return { person: p.id, income: inc, dues: d, spend: s, queue: q, left: inc - d - s - q }
  })

  const saved: Partial<Record<PersonId, Allocation>> = {}
  for (const p of people) {
    const rec = allocationFor(state.allocations, { source: 'salary', sourceId: p.id, period: key })
    if (rec) saved[p.id] = rec
  }

  return {
    key,
    income: { total: incomeTotal, byPerson: income },
    dues,
    duesTotal,
    spend,
    spendTotal,
    outTotal: duesTotal + spendTotal,
    free,
    queue,
    queueTotal,
    putTotal: amountTotal(queue.map((q) => ({ amount: q.put }))),
    rest: Math.max(0, free - queueTotal),
    short: Math.max(0, -free),
    byPerson,
    saved,
  }
}

/** Приход строки зарплаты (Б7): `open` — «Пришла» можно отметить сейчас (`salaryOpen` по событию). */
export type SalaryLineEvent = IncomeEvent & { open: boolean }

/** Строка зарплаты месяца (Р-97, Р-108): одна для «Месяца» и карточки «Зарплаты» «Капитала». */
export type SalaryLine = Omit<PlanIncome, 'events'> & {
  /** День зарплаты участника («ждём <дата>»); по ритму (Б7) — день ближайшего непришедшего прихода (все пришли — первого). */
  payday: number
  /** Приходы месяца с `open` (месячный ритм — один). */
  events: SalaryLineEvent[]
  /** Ритм и плавающая сумма — экран выбирает вид строки и листа. */
  rhythm: PayRhythm
  floating: boolean
  /** Приход, который отметит «Пришла» сейчас: первый открытый по дню; нет — null. */
  openPeriod: string | null
  /** «Хватает ли»: зарплата минус свои платежи, траты, цели и фонды (`byPerson.left`). */
  left: number
  /** Оклад месяца в валюте — у пришедшей строка обмена. */
  foreign: boolean
  /**
   * Сумма в валюте оклада — мини-подпись под тенге (владелец на снимках Б16): пришла — сколько пришло (`Payment.foreign`),
   * ждём — оклад месяца в валюте. Тенговый оклад — null.
   */
  fx: { amount: number; currency: Currency } | null
  /** Когда отметили «Пришла» (`Payment.at`); null — не пришла. */
  at: string | null
  /** «Пришла» можно отметить сейчас (`salaryOpen`); своя ли строка — решает экран. */
  open: boolean
}

/** Строки зарплат месяца плана — из `monthPlan` и отметок; экраны их не собирают сами (Р-108). */
export function monthSalaries(plan: MonthPlan, state: { people?: Person[]; payments?: Payment[] }, now = today()): SalaryLine[] {
  const payments = state.payments ?? []
  return plan.income.byPerson.map((inc) => {
    const p = (state.people ?? []).find((x) => x.id === inc.person && !x.deletedAt)
    const own = p ? salaryOf(p, plan.key) : null
    const left = plan.byPerson.find((x) => x.person === inc.person)?.left ?? 0
    const foreign = !!own && own.currency !== 'KZT'
    const events: SalaryLineEvent[] = inc.events.map((e) => ({ ...e, open: !!p && !e.came && salaryOpen(p, payments, e.period, now) }))
    const openPeriod = events.find((e) => e.open)?.period ?? null
    const rhythm = p ? payRhythmOf(p) : 'month'
    const base = { ...inc, events, rhythm, floating: !!p?.floating, openPeriod, left, foreign, open: !!openPeriod }
    if (rhythm === 'month') {
      const record = paidFor(payments, 'salary', inc.person, plan.key)
      const fx =
        record?.foreign && record.currency && record.currency !== 'KZT'
          ? { amount: record.foreign, currency: record.currency }
          : !record && own && own.currency !== 'KZT'
            ? { amount: own.amount, currency: own.currency }
            : null
      return { ...base, payday: p?.payday ?? 1, fx, at: record?.at ?? null }
    }
    // Аванс и неделя (Б7): день — ближайшего непришедшего, валюта — пришедшее + ждём, «пришла» — последняя отметка.
    const records = p ? salaryRecords(payments, p, plan.key) : []
    const next = events.find((e) => !e.came) ?? events[0]
    const inCurrency = p ? payEvents(p, plan.key).reduce((a, e, i) => a + (records[i] ? records[i]!.foreign ?? 0 : e.amount), 0) : 0
    const fx = foreign && own ? { amount: inCurrency, currency: own.currency } : null
    const at = records.reduce<string | null>((a, r) => (r && (!a || r.at > a) ? r.at : a), null)
    return { ...base, payday: next ? Number(next.day.slice(8, 10)) : p?.payday ?? 1, fx, at }
  })
}

/**
 * Ключ отметки «Пришла» (стор `markSalary`): ISO-день и месячный ритм — как есть; месяц у аванса и недели — первый
 * открытый приход месяца, иначе первый неотмеченный, иначе последний (отмечен — `markSalary` вернёт его запись).
 */
export function salaryMarkPeriod(p: Person, payments: Payment[], period: string, now = today()): string {
  if (period.length > 7 || payRhythmOf(p) === 'month') return period
  const events = payEvents(p, period)
  const pick =
    events.find((e) => salaryOpen(p, payments, e.period, now)) ??
    events.find((e) => !paidFor(payments, 'salary', p.id, e.period)) ??
    events[events.length - 1]
  return pick?.period ?? period
}

/* ---------------- Капитал со статистикой (понятность, Блок 2: Р-2, Р-3) ---------------- */

export type CapitalPartKey = 'credits' | 'payments' | 'goals' | 'rest'

/** Доля дохода месяца на плашке Капитала: сумма, доля 0…1 для полоски, целые проценты дохода для строки. */
export type CapitalPart = { key: CapitalPartKey; amount: number; share: number; pct: number }

export type CapitalStats = {
  /** Доход месяца плана (`plan.income.total`). */
  income: number
  /** Доли дохода: кредиты · платежи · в цели · остаётся; пусто без дохода; «кредиты» нет, когда их 0. */
  parts: CapitalPart[]
  /** Не хватает на платежи и траты (`plan.short`) — подпись у «остаётся». */
  short: number
  /** На сколько растёт капитал в месяц: тело платежей по кредитам + досрочка карточки долга + взносы в цели и фонды. */
  growth: number
  /** Когда долги закроются (`debtsOverview.freeMonth`), сколько это месяцев и зарплат; без открытых кредитов — null. */
  debtFree: { month: string | null; months: number | null; salaries: number | null }
  /** Переплата банку по процентным долгам (с планом «Сначала долги» — за вычетом его экономии); null — не закрывается. */
  overpay: { amount: number | null; salaries: number | null }
}

/** Сумма в зарплатах семьи: 450 000 при доходе 300 000 → 1,5 (одна десятая, не деньги); дохода нет — null. Блок 5 использует. */
export function inSalaries(amount: number, income: number): number | null {
  return income > 0 ? round1(amount / income) : null
}

/** Одна десятая — для «1,5 зарплаты», «хватит на 1,2 месяца» (не деньги). */
export const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * Подпись к `inSalaries`: «1,5 зарплаты», «9 зарплат», «1 зарплата» — дробь всегда «зарплаты», целое — по числу.
 * `weekly` — в семье есть недельная зарплата (`hasWeeklyPay`): «зарплата» там читается как неделя, а единица — месячный
 * доход семьи, поэтому «1,5 месяца дохода», «9 месяцев дохода» (`/ux` Б7, ТЗ PN-24 п. 3).
 */
export const salariesLabel = (n: number, weekly = false) =>
  weekly
    ? `${monthsLabel(n)} дохода`
    : `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${Number.isInteger(n) ? plural(n, 'зарплата', 'зарплаты', 'зарплат') : 'зарплаты'}`

/** Есть ли в семье недельная зарплата (Б7) — тогда «в зарплатах» подписывается месяцами дохода (`salariesLabel`). */
export const hasWeeklyPay = (people: Person[]) => people.some((p) => !p.deletedAt && payRhythmOf(p) === 'week')

/**
 * Статистика плашки Капитала (Р-3) — от уже посчитанного плана месяца (`finance.monthPlanOf(key)`), второго прогона
 * очереди нет. Доли дохода: «кредиты» — платежи по кредитам и долгам из графика плюс досрочка карточки долга;
 * «платежи» — остальной график (аренда, коммуналка, подписки, людям); «в цели» — что очередь даёт целям и фондам в
 * этом месяце; «остаётся» — на жизнь (траты планов внутри: владелец видит четыре доли, не пять), не меньше 0.
 * Тождество: кредиты + платежи + в цели + остаётся = max(доход, кредиты + платежи + в цели); `share` — от этой суммы,
 * чтобы полоска при нехватке была заполнена целиком, `pct` — от дохода. Рост капитала — тело кредитов (`creditSplit` от
 * остатка на начало месяца, у отмеченного — то же тело, что в отметке) + досрочка + взносы. Срок — `debtsOverview`,
 * переплата — `overpayNoPlan` открытых долгов (с активным планом — минус `planForecast.savedInterest`);
 * «в зарплатах» — `inSalaries` (ритм — месяц; Блок 7 заменит на число приходов). Ничего не пишется, новых данных нет.
 */
export function capitalStats(plan: MonthPlan, state: PlanState & { plans?: DebtPlan[] }, key: string): CapitalStats {
  const income = plan.income.total
  const creditDues = plan.dues.filter((d): d is PlanDue & { kind: 'credit' } => d.kind === 'credit')
  const debtGiven = plan.queue.filter((q) => q.kind === 'debt').reduce((a, q) => a + q.given, 0)
  const credits = creditDues.reduce((a, d) => a + d.amount, 0) + debtGiven
  const payments = plan.dues.filter((d) => d.kind === 'obligation').reduce((a, d) => a + d.amount, 0)
  const goals = plan.queue.filter((q) => q.kind !== 'debt').reduce((a, q) => a + q.given, 0)
  const rest = Math.max(0, income - credits - payments - goals)
  const total = Math.max(income, credits + payments + goals)
  const part = (k: CapitalPartKey, amount: number): CapitalPart => ({ key: k, amount, share: amount / total, pct: pct(amount, income) })
  const parts = income > 0 ? [...(credits > 0 ? [part('credits', credits)] : []), part('payments', payments), part('goals', goals), part('rest', rest)] : []
  // Тело — от остатка на начало месяца (как карточка долга в `monthPlan`): у отмеченного кредита стор уже вычел тело этого
  // месяца, у закрытого этим платежом остаток 0 — от них тело вышло бы меньше или 0 (критик Блока 2).
  const paid = state.payments ?? []
  const body = creditDues.reduce((a, d) => a + creditSplit(d.credit.principal + creditBodyIn(d.credit, paid, key), d.credit.annualRate, d.amount).body, 0)
  const open = openCredits(state.credits ?? [])
  const month = open.length ? debtsOverview(state, key).freeMonth : null
  const months = month === null ? null : monthsBetween(key, month)
  // То же число, что «без плана» у квадрата «Долги» (`planOutlook`); null — какой-то долг не закрывается, тогда и `month` null.
  let overpay = overpayNoPlan(open)
  const active = activePlan(state.plans)
  if (overpay !== null && active) {
    const saved = planForecast(active, state, key).savedInterest
    if (saved !== null) overpay = Math.max(0, overpay - saved)
  }
  return {
    income,
    parts,
    short: plan.short,
    growth: body + debtGiven + goals,
    debtFree: { month, months, salaries: months },
    overpay: { amount: overpay, salaries: overpay === null ? null : inSalaries(overpay, income) },
  }
}

/* ---------------- Прикинуть (понятность, Блок 5: Р-11) ---------------- */

/** «Прикинуть кредит»: платёж, нагрузка, сдвиг главной мечты, переплата — целые тенге и проценты (зарплаты — одна десятая). */
export type TryCredit = {
  /** Платёж в месяц: аннуитет вверх до тенге (ставка 0 — рассрочка, `ceil(principal / months)`). */
  payment: number
  /** Платежи месяца / доход сейчас, целые проценты; дохода нет — null. */
  loadNowPct: number | null
  /** То же с платежом нового кредита. */
  loadPct: number | null
  /** Главная мечта (первая цель очереди): когда соберём без кредита и с ним; `delayMonths` Infinity — с кредитом не соберём. */
  hero: { name: string; doneBefore: string | null; doneAfter: string | null; delayMonths: number | null } | null
  /** Сверх суммы банку: платёж × срок − сумма; рассрочка — 0. */
  overpay: number
  /** Переплата в зарплатах семьи (`inSalaries`). */
  overpaySalaries: number | null
}

const firstGoal = (plan: MonthPlan) => plan.queue.find((q) => q.kind === 'goal') ?? null

/**
 * «Прикинуть кредит» (PN-16, Р-11) — ничего не пишет. Сдвиг мечты — тот же `monthPlan` с фиктивным кредитом в
 * `credits`: его платёж ложится в платежи месяца, очередь пересчитывается сама (копии формул нет), а через `months`
 * месяцев прогон возвращает платёж в остаток (`ctx.ends`, критик Б5: без этого кредит платился бы вечно — «не
 * соберётся» там, где мечта соберётся после него). Ставка — доля (0,2 = 20 %), 0 — рассрочка.
 */
export function tryCredit(
  state: MonthPlanState,
  ctx: MonthPlanCtx,
  input: { principal: number; months: number; annualRate: number },
): TryCredit {
  const { principal, months, annualRate } = input
  const payment = Math.ceil(annuityPayment(principal, annualRate, months))
  const before = monthPlan(state, ctx)
  const fake: Credit = { id: 'try', name: 'Прикинуть', note: '', principal, annualRate, payment, day: 1, updatedAt: new Date().toISOString() }
  const after = monthPlan({ ...state, credits: [...(state.credits ?? []), fake] }, { ...ctx, ends: [{ amount: payment, after: months }] })
  const income = before.income.total
  const loadOf = (dues: number) => (income > 0 ? Math.round((dues / income) * 100) : null)
  const goal = firstGoal(before)
  const doneBefore = goal?.doneMonth ?? null
  const doneAfter = goal ? after.queue.find((q) => q.goalId === goal.goalId)?.doneMonth ?? null : null
  const overpay = annualRate > 0 ? payment * months - principal : 0
  return {
    payment,
    loadNowPct: loadOf(before.duesTotal),
    loadPct: loadOf(before.duesTotal + payment),
    hero: goal && {
      name: goal.name,
      doneBefore,
      doneAfter,
      delayMonths: doneBefore === null ? null : doneAfter === null ? Infinity : monthsBetween(doneBefore, doneAfter),
    },
    overpay,
    overpaySalaries: inSalaries(overpay, income),
  }
}

/**
 * «Хватит?»: да — сколько останется до зарплаты; нет — сколько не хватает и на сколько месяцев отодвинется главная
 * мечта (`months` 0 — меньше месяца).
 */
export type CanAfford =
  | { ok: true; left: number; inDays: number | null }
  | { ok: false; short: number; goal: string | null; months: number | null }

/**
 * «Хватит?» (PN-16, Р-11) — ничего не пишет. Со счетами — от «до зарплаты» (`untilPayday.shortfall`: на счетах минус
 * платежи до зарплаты); счетов нет — от остатка плана месяца (`rest`). Нехватка — в месяцах взносов главной мечты
 * (`paceMonths` при её темпе `goalPace`, владелец Б5 — не дни); мечты или темпа нет — месяцев нет.
 */
export function canAfford(
  state: Parameters<typeof untilPayday>[0] & MonthPlanState,
  ctx: MonthPlanCtx,
  amount: number,
  now = today(),
): CanAfford {
  const up = untilPayday(state, now)
  const cash = up && up.knowsCash
  const plan = cash ? null : monthPlan(state, ctx)
  const left = (cash ? up.shortfall : plan!.rest) - amount
  if (left >= 0) return { ok: true, left, inDays: cash ? up.inDays : null }
  const item = firstGoal(plan ?? monthPlan(state, ctx))
  const hero = item ? (state.goals ?? []).find((g) => g.id === item.goalId) ?? null : null
  return { ok: false, short: -left, goal: item?.name ?? null, months: hero ? paceMonths(-left, goalPace(hero, ctx.key)) : null }
}

/** Где тесно до зарплаты (Р-7, AU-07): `short` — уйдёт в минус, `tight` — останется меньше 15 % прихода. */
export type AffordWhy = { kind: 'short' | 'tight'; from: { day: number; key: string }; to: { day: number; key: string }; name: string }

/**
 * «Хватит?» с причиной (Р-7, AU-07) — из того же «до зарплаты»: только когда знаем счета. На счетах минус покупка, платежи
 * окна по порядку: первый, после которого баланс ниже нуля, — `short` (окно — от его дня до дня перед зарплатой); иначе,
 * если после всех платежей остаётся меньше `LOW_REST_SHARE` прихода, — `tight` (окно — от дня самого крупного платежа).
 * Иначе — null.
 */
export function affordWhy(state: Parameters<typeof untilPayday>[0], amount: number, now = today()): AffordWhy | null {
  const up = untilPayday(state, now)
  if (!up || !up.knowsCash || !up.due.length) return null
  // День перед зарплатой; зарплата 1-го — последний день прошлого месяца.
  const before = up.day > 1 ? { day: up.day - 1, key: up.key } : { day: daysInMonth(addMonths(up.key, -1)), key: addMonths(up.key, -1) }
  const window = (from: { day: number; when: string }, name: string, kind: AffordWhy['kind']): AffordWhy => {
    const start = { day: from.day, key: from.when }
    // Платёж в сам день зарплаты: окно — один его день.
    const late = start.key > before.key || (start.key === before.key && start.day > before.day)
    return { kind, from: start, to: late ? start : before, name }
  }
  let balance = up.onAccounts - amount
  for (const d of up.due) {
    balance -= d.value
    if (balance < 0) return window(d, d.name, 'short')
  }
  if (balance >= LOW_REST_SHARE * up.income) return null
  const biggest = up.due.reduce((a, d) => (d.value > a.value ? d : a))
  return window(biggest, biggest.name, 'tight')
}

/** Строка под вердиктом: «тесно 20–24-го — Автокредит»; окно через месяц — «тесно с 28-го до 5-го — …»; один день — «тесно 25-го — …». */
export function affordWhyText(why: AffordWhy): string {
  const { from, to } = why
  const span = from.key !== to.key ? `с ${from.day}-го до ${to.day}-го` : from.day === to.day ? `${from.day}-го` : `${from.day}–${to.day}-го`
  return `тесно ${span} — ${why.name}`
}

/**
 * Первый долг (Р-7, AU-07): самый дорогой из открытых с процентами (`costliestCredits`; ставка неизвестна — мимо) — только
 * когда таких хотя бы два (при одном «первый» не нужен). Ставка — в процентах (`ratePercent`).
 */
export function firstDebt(state: { credits?: Credit[] }): { name: string; rate: number } | null {
  const list = costliestCredits(state.credits ?? []).filter((c) => !c.rateUnknown)
  return list.length >= 2 ? { name: list[0]!.name, rate: ratePercent(list[0]!.annualRate) } : null
}

/**
 * Подсказка «всё в долг — закроете к N» (Р-83): все цели и фонды выключены, весь свободный остаток месяца —
 * досрочкой в самый дорогой долг; тот же прогон, что у дат плана. null — долгов с процентами нет, остатка нет
 * или долг так не закрывается в горизонте.
 */
export function allInDebt(
  state: MonthPlanState,
  ctx: MonthPlanCtx,
  plan: MonthPlan = monthPlan(state, ctx),
): { month: string; creditId: string; extra: number } | null {
  const debt = plan.queue.find((q) => q.kind === 'debt')
  const credit = (state.credits ?? []).find((c) => c.id === debt?.creditId)
  if (!debt || !credit || plan.free <= 0) return null
  const [m] = queueRun([{ on: true, cap: plan.free, left: debt.have, debt: { rate: credit.annualRate, payment: credit.payment } }], plan.free)
  return m === null ? null : { month: addMonths(plan.key, m), creditId: credit.id, extra: plan.free }
}

/** Срок цели или фонда (`goalTerm`). */
export type GoalTerm = {
  /** Выключена в плане месяца (`pausedAt`, Р-83): срока нет, строки взносов нет. */
  off: boolean
  /** На паузе плана «Сначала долги»: срок — после плана (`planForecast`). */
  afterPlan: boolean
  /** Цель — её сумма, фонд — порог плана (месяцы × траты месяца, Р-82). */
  need: number
  /** Сколько осталось до `need` от накопленного сейчас, ≥ 0. */
  remaining: number
  /** Месяц, когда соберём; null — не соберём (взнос 0, долги не закрываются). */
  doneMonth: string | null
  /** Сколько взносов осталось (с этим месяцем); Infinity — срока нет. */
  months: number
}

/**
 * Срок цели или фонда — одна функция для «Мечт» (строка и герой) и экрана цели (ревью frontend Б14, Н-2; Р-38):
 * из строки очереди плана месяца (`monthPlan` → `queueRun`: верх получает первым, при нехватке остатка — меньше
 * взноса). Фонд — до порога плана, не до своей суммы. На паузе плана «Сначала долги» — прежний расчёт после плана
 * (`goalDoneMonth` с прогнозом плана). Цели нет в очереди или накопленное сдвинули в этом месяце не взносом — по
 * своему взносу, как до Блока 14.
 */
export function goalTerm(
  item: PlanQueueItem | undefined,
  goal: Pick<Goal, 'need' | 'have' | 'monthly'>,
  key: string,
  forecast?: { debtFreeMonth: string | null },
): GoalTerm {
  const need = item?.need ?? goal.need
  const remaining = Math.max(0, need - Math.max(0, goal.have))
  if (item?.paused === 'off') return { off: true, afterPlan: false, need, remaining, doneMonth: null, months: Infinity }
  // Накопленное правили или снимали в этом месяце (сейчас ≠ начало месяца + взносы) — прогон плана от начала месяца
  // устарел: по своему взносу от того, что есть сейчас, иначе «осталось N взносов» не сходится с остатком.
  const stale = !!item && item.kind !== 'debt' && Math.max(0, goal.have) !== item.have + item.put
  if (!item || item.paused === 'plan' || stale) {
    const months = goalMonths(remaining, goal.monthly)
    const afterPlan = item?.paused === 'plan'
    return { off: false, afterPlan, need, remaining, doneMonth: goalDoneMonth(months, key, afterPlan ? forecast ?? { debtFreeMonth: null } : undefined), months }
  }
  // Собрана сейчас (взнос этого месяца уже лёг) — ваша в этом месяце, хотя план считает от начала месяца.
  const doneMonth = remaining <= 0 ? key : item.doneMonth
  return { off: false, afterPlan: false, need, remaining, doneMonth, months: doneMonth ? monthsBetween(key, doneMonth) + 1 : Infinity }
}

export type CushionCover = {
  /** Порог подушки — из строки очереди плана (`PlanQueueItem.need`), не пересчёт; строки нет — 0. */
  need: number
  /** Накоплено сейчас. */
  have: number
  /** Месяц трат по плану (платежи + траты планов) — `need / monthsNeeded`; строки нет — 0. */
  monthSpend: number
  /** Порог в месяцах: свой `fundMonths` или умолчание семьи. */
  monthsNeeded: number
  /** «Хватит на 1,2 месяца» — одна десятая; трат нет — null. */
  months: number | null
}

/** Подушка (Р-12, PN-19): на сколько месяцев трат хватит накопленного — от строки плана месяца, как «нужно» в «Месяце». */
export function cushionCover(item: PlanQueueItem | undefined, goal: Pick<Goal, 'have' | 'fundMonths'>, settings: MoneySettings): CushionCover {
  const monthsNeeded = fundMonthsOf('cushion', goal, settings)
  const need = item?.need ?? 0
  const have = Math.max(0, goal.have)
  const monthSpend = item && monthsNeeded > 0 ? need / monthsNeeded : 0
  return { need, have, monthSpend, monthsNeeded, months: monthSpend > 0 ? round1(have / monthSpend) : null }
}

/** Подпись к `cushionCover`: «1,2 месяца», «1 месяц», «0 месяцев» — дробь всегда «месяца», целое — по числу. */
export const monthsLabel = (n: number) =>
  `${n.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${Number.isInteger(n) ? plural(n, 'месяц', 'месяца', 'месяцев') : 'месяца'}`

/** Что записывает «Отложить по плану» (Р-78) — стор только исполняет. */
export type PlanSave = {
  record: { source: 'salary'; sourceId: PersonId; period: string }
  /** Зарплата плательщика этого месяца — `total` записи. */
  total: number
  /** Разовые взносы в цели и фонды плательщика. */
  contributions: { goalId: string; amount: number }[]
  /** Досрочка карточки долга, если её вносит плательщик; `planId` — шагом плана «Сначала долги». */
  prepay: { creditId: string; amount: number; planId?: string } | null
  /** Части записи: `goalId` и `prepay:<creditId>`, только ненулевые. */
  parts: AllocationPart[]
  /** Сколько кладётся всего — сумма частей (сумма под кнопкой, «Отложено N»; ревью frontend Б14, Н-5). */
  put: number
}

/** Части записи плана и их сумма — одно место для «Отложить по плану» и прочих источников. */
function planParts(contributions: { goalId: string; amount: number }[], prepay: { creditId: string; amount: number } | null) {
  const parts: AllocationPart[] = [
    ...contributions.map((c) => ({ target: c.goalId, amount: c.amount })),
    ...(prepay ? [{ target: `prepay:${prepay.creditId}`, amount: prepay.amount }] : []),
  ]
  return { parts, put: amountTotal(parts) }
}

/** Факт трат месяца по всем участникам (строка «Траты» — «потрачено N»); null — выписок за месяц нет ни у кого. */
export function spendFact(spend: PlanSpend[]): number | null {
  const known = spend.filter((s) => s.fact !== null)
  return known.length ? amountTotal(known.map((s) => ({ amount: s.fact! }))) : null
}

/**
 * «Потрачено» месяца по разделам (сводка ИИ, Р-3; критик Блока 2 «ИИ») — та же правда, что `spendFact` у `monthPlan`:
 * итоги участников, чьи выписки покрывают месяц (`uploadedBy`), раздел, учтённый платежами, — неотмеченной частью
 * (`spentOf`), разовые — отдельно (`oneOff`, FB-07). Сумма строк, `unknown` («не разобрано») и `oneOff` = `spendFact`;
 * выписок нет — пусто. По убыванию суммы.
 */
export function monthSpendByCategory(
  people: Person[],
  totals: SpendTotal[],
  categories: SpendCategory[],
  key: string,
  uploads: UploadPeriod[],
): { rows: { categoryId: string; name: string; amount: number }[]; unknown: number; oneOff: number } {
  const live = categories.filter(alive)
  const named = liveSpendCategories(categories)
  const sums = new Map<string, number>()
  let oneOff = 0
  for (const p of people.filter(alive)) {
    if (!uploadedBy(p.id, key, uploads)) continue
    for (const t of totals) {
      if (t.deletedAt || t.by !== p.id || t.kind !== 'month' || t.period !== key || t.amount <= 0) continue
      sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + spentOf(t, live))
      oneOff += oneOffOf(t, live)
    }
  }
  const unknown = sums.get(UNKNOWN_CATEGORY) ?? 0
  sums.delete(UNKNOWN_CATEGORY)
  const rows = [...sums]
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([categoryId, amount]) => ({ categoryId, name: spendCategoryName(named, categoryId), amount }))
  return { rows, unknown, oneOff }
}

/* ---------------- траты в сравнении (Р-5, AU-01) ---------------- */

/** Сколько месяцев назад искать полные месяцы для «обычно у вас». */
const USUAL_LOOKBACK = 6

/**
 * Загрузки участника `by` вместе покрывают каждый день месяца `key` («полный» месяц для «обычно»): выписка с 20-го дала
 * бы треть трат и заниженное «обычно». Загрузки встык и внахлёст склеиваются; дыра хоть в день — не полный.
 */
export function monthCovered(key: string, uploads: UploadPeriod[], by: PersonId): boolean {
  const start = `${key}-01`
  const end = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`
  const mine = uploads
    .filter((u) => u.slot === by)
    .map((u) => ({ from: u.period_from.slice(0, 10), to: u.period_to.slice(0, 10) }))
    .filter((u) => u.to >= start && u.from <= end)
    .sort((a, b) => a.from.localeCompare(b.from))
  let next = start // первый ещё не покрытый день
  for (const u of mine) {
    if (u.from > next) return false
    if (u.to >= next) next = addDaysIso(u.to, 1)
    if (next > end) return true
  }
  return false
}

/**
 * Месяцы для «обычно у вас» (Р-5): до `n` последних месяцев строго до `key` (не дальше 6 назад), где итоги месяца есть
 * хотя бы у одного живого участника и у каждого такого выписки покрывают месяц целиком (`monthCovered`). Новые первыми.
 */
export function usualMonths(people: Person[], totals: SpendTotal[], uploads: UploadPeriod[], key: string, n = 3): string[] {
  const live = people.filter(alive)
  const out: string[] = []
  for (let i = 1; i <= USUAL_LOOKBACK && out.length < n; i++) {
    const m = addMonths(key, -i)
    const spent = live.filter((p) => totals.some((t) => !t.deletedAt && t.by === p.id && t.kind === 'month' && t.period === m && t.amount > 0))
    if (spent.length && spent.every((p) => monthCovered(m, uploads, p.id))) out.push(m)
  }
  return out
}

/**
 * «Обычно у вас» по разделам (Р-5): среднее трат семьи за `usualMonths` — та же правда месяца, что `monthSpendByCategory`;
 * раздел без трат в месяце — 0 в этом месяце; целые тенге. Меньше 2 полных месяцев — null («обычно» нет, только план).
 */
export function usualSpend(
  people: Person[],
  totals: SpendTotal[],
  categories: SpendCategory[],
  uploads: UploadPeriod[],
  key: string,
): { months: string[]; amounts: Map<string, number> } | null {
  const months = usualMonths(people, totals, uploads, key)
  if (months.length < 2) return null
  const sums = new Map<string, number>()
  for (const m of months) {
    for (const r of monthSpendByCategory(people, totals, categories, m, uploads).rows) sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + r.amount)
  }
  return { months, amounts: new Map([...sums].map(([id, sum]) => [id, Math.round(sum / months.length)])) }
}

/** Порог точки «больше обычного» (Р-5, дефолт составителя): выше обычного и на 10 %, и на 5 000 ₸ — мелочь не мигает. */
export const OVER_SHARE = 10 // %
export const OVER_MIN = 5_000

/** Трат раздела больше обычного с порогом шума; ровно порог — ещё нет. Одно правило для текущего и прошлых месяцев. */
const spendOver = (amount: number | null, usual: number | null) =>
  usual !== null && usual > 0 && amount !== null && amount - usual > OVER_MIN && (amount - usual) * 100 > usual * OVER_SHARE

/**
 * Разделы «в конце строк, без точки» (Х-3, приёмка Блока 1 на настоящих выписках): переводы людям и наличные — не траты
 * в привычном смысле (в переводах — и между своими счетами), «обычно» у них шумное; первой строкой они заслоняют траты.
 */
export const SPEND_LAST: readonly string[] = ['sc_people', 'sc_cash']

/** Рекомендация раздела: обычно тратите `amount` сверх плана — столько в мечту; `days` — на сколько раньше (нет мечты или темпа — null). */
export type SpendAdvice = { amount: number; goalId: string | null; goalName: string | null; days: number | null }

export type SpendCompareRow = {
  categoryId: string
  name: string
  /** Факт месяца семьи; выписок за месяц нет ни у кого — null. */
  amount: number | null
  /** Сумма планов участников; плана нет — null. */
  plan: number | null
  /** «Обычно у вас»; меньше 2 полных месяцев — null. */
  usual: number | null
  /** % дохода месяца от факта, целые; дохода или факта нет — null. */
  share: number | null
  /** Точка: трат больше обычного (порог `OVER_SHARE` / `OVER_MIN`). */
  over: boolean
  advice: SpendAdvice | null
  /** Группа справки РК; свой раздел — null. */
  group: RkGroup | null
}

/**
 * Траты в сравнении на «Месяце» (Р-5): разделы всей семьи с фактом или планом — кроме разделов платежей
 * (`plannedElsewhere`) и «не разобрано»; по убыванию `amount ?? plan`. Участников не сравниваем: план — сумма планов
 * участников. Рекомендация — когда обычно тратите больше плана: разница — в первую мечту очереди; `days` — насколько
 * раньше её соберём при темпе +N в месяц (`(остаток / темп − остаток / (темп + N)) × 30,4`).
 */
export function spendCompare(
  state: MonthPlanState,
  ctx: MonthPlanCtx,
): { income: number; usualFrom: string[]; rows: SpendCompareRow[]; unknown: number; oneOff: number } {
  const { key } = ctx
  const people = (state.people ?? []).filter(alive)
  const live = ctx.spendCategories.filter(alive)
  const named = liveSpendCategories(ctx.spendCategories)
  const month = monthPlan(state, ctx)
  const income = month.income.total
  const hasFact = people.some((p) => uploadedBy(p.id, key, ctx.uploads))
  const byCategory = monthSpendByCategory(people, ctx.totals, ctx.spendCategories, key, ctx.uploads)
  const facts = new Map(byCategory.rows.map((r) => [r.categoryId, r.amount]))
  // План раздела — строки плана месяца (с урезкой сдвигами `planShifts`, AU-05): строка раздела, «План каждого» и
  // итог «Трат» говорят одно и то же.
  const plans = new Map<string, number>()
  for (const s of month.spend) for (const r of s.rows) plans.set(r.categoryId, (plans.get(r.categoryId) ?? 0) + r.plan)
  const usual = usualSpend(people, ctx.totals, ctx.spendCategories, ctx.uploads, key)
  const goal = mainGoal(state.goals ?? [], state.goalOrder, state.moneySettings)
  const adviceOf = (plan: number | null, usualAmount: number | null): SpendAdvice | null => {
    if (plan === null || usualAmount === null || usualAmount <= plan) return null
    const amount = usualAmount - plan
    return { amount, goalId: goal?.id ?? null, goalName: goal?.name ?? null, days: goal ? earlierDays(goal, key, amount) : null }
  }
  const rows = [...new Set([...facts.keys(), ...plans.keys()])]
    .filter((id) => id !== UNKNOWN_CATEGORY && !plannedElsewhere(id, live))
    .map((categoryId): SpendCompareRow => {
      const amount = hasFact ? facts.get(categoryId) ?? 0 : null
      const plan = plans.get(categoryId) ?? null
      const u = usual ? usual.amounts.get(categoryId) ?? 0 : null
      return {
        categoryId,
        name: spendCategoryName(named, categoryId),
        amount,
        plan,
        usual: u,
        share: amount !== null && income > 0 ? Math.round((amount * 100) / income) : null,
        over: !SPEND_LAST.includes(categoryId) && spendOver(amount, u),
        advice: adviceOf(plan, u),
        group: RK_GROUP_BY_CATEGORY[categoryId] ?? null,
      }
    })
    .filter((r) => (r.amount ?? 0) > 0 || (r.plan ?? 0) > 0)
    .sort(
      (a, b) =>
        Number(SPEND_LAST.includes(a.categoryId)) - Number(SPEND_LAST.includes(b.categoryId)) ||
        (b.amount ?? b.plan ?? 0) - (a.amount ?? a.plan ?? 0) ||
        a.categoryId.localeCompare(b.categoryId),
    )
  // «Не разобрано» (Х-1) и «Разовые» (FB-07): тихие строки внизу «Трат», чтобы строки сходились с «потрачено» заголовка;
  // выписок нет — 0.
  return {
    income,
    usualFrom: usual?.months ?? [],
    rows,
    unknown: hasFact ? byCategory.unknown : 0,
    oneOff: hasFact ? byCategory.oneOff : 0,
  }
}

/**
 * Доля группы РК в тратах семьи за месяц (справка «у вас X % · в Алматы Y %», Р-5): итоги участников с выпиской месяца
 * по разделам с группой — и разделам платежей с группой целиком (коммуналка, аренда, связь). Знаменатель — те же
 * разделы с группой (потребительские траты, как три группы статистики — 97,2 % денежных расходов): кредиты, переводы
 * людям, наличные и «не разобрано» долю не размывают; разовые (FB-07) — тоже. Целые %; выписок или трат с группой нет —
 * null.
 */
export function rkShare(state: MonthPlanState, ctx: MonthPlanCtx, group: RkGroup): number | null {
  const people = (state.people ?? []).filter(alive).filter((p) => uploadedBy(p.id, ctx.key, ctx.uploads))
  const ids = new Set(people.map((p) => p.id))
  const live = ctx.spendCategories.filter(alive)
  const mine = ctx.totals.filter(
    (t) => !t.deletedAt && ids.has(t.by) && t.kind === 'month' && t.period === ctx.key && t.amount > 0 && RK_GROUP_BY_CATEGORY[t.categoryId],
  )
  const amountOf = (t: SpendTotal) => t.amount - oneOffOf(t, live)
  const total = mine.reduce((s, t) => s + amountOf(t), 0)
  if (total <= 0) return null
  const part = mine.filter((t) => RK_GROUP_BY_CATEGORY[t.categoryId] === group).reduce((s, t) => s + amountOf(t), 0)
  return Math.round((part * 100) / total)
}

/**
 * «План каждого» листа раздела (Р-81): строка раздела в `monthPlan().spend` каждого участника; у кого плана нет — 0.
 * Один расчёт для листа «Месяца» и листа сводки прошлого месяца (RZ-13).
 */
export function spendPlansBy(plan: MonthPlan, people: { id: PersonId; name: string }[], categoryId: string): { by: PersonId; name: string; amount: number }[] {
  return people.map((p) => ({ by: p.id, name: p.name, amount: plan.spend.find((s) => s.by === p.id)?.rows.find((r) => r.categoryId === categoryId)?.plan ?? 0 }))
}

/** «на 5 дней» / «на 3 недели» / «на 2 месяца» раньше — подпись `days` рекомендации: < 14 — дни, < 61 — недели, дальше — месяцы. */
export function earlierLabel(days: number): string {
  if (days < 14) return `${days} ${plural(days, 'день', 'дня', 'дней')}`
  if (days < 61) {
    const w = Math.round(days / 7)
    return `${w} ${plural(w, 'неделю', 'недели', 'недель')}`
  }
  const m = Math.round(days / 30.4)
  return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}`
}

/* ---------------- мечта сдвинулась (Р-6, Р-18, AU-04) ---------------- */

/** Снимок плана месяца (`TermSnap` без `Tracked`): цели и фонды очереди (не карточка долга) — `given` и `doneMonth`. */
export function termSnapOf(plan: MonthPlan, at: string): Omit<TermSnap, 'updatedAt' | 'deletedAt'> {
  return {
    id: plan.key,
    at,
    income: plan.income.total,
    dueIds: [...new Set(plan.dues.map((d) => d.targetId))],
    goals: plan.queue.filter((q) => q.kind !== 'debt' && q.goalId).map((q) => ({ goalId: q.goalId!, given: q.given, doneMonth: q.doneMonth })),
  }
}

/** Метка — от недели (Р-18): меньше — не шумим. */
export const SHIFT_MIN_DAYS = 7

/**
 * Причина сдвига (Р-6) — самый крупный вклад в деньгах. Дальше: `spend` — раздел выше плана, `due` — новый платёж,
 * `less` — прочее (доход меньше, взнос меньше). Ближе: `put` — отложили больше, `freed` — платёж ушёл, `income` — доход
 * больше.
 */
export type DreamShiftReason = 'spend' | 'due' | 'less' | 'put' | 'freed' | 'income'

/** Сдвиг срока мечты к снимку: `days` > 0 — дальше, < 0 — ближе; `name` — раздел или платёж причины. */
export type DreamShift = { days: number; reason: DreamShiftReason; name?: string }

/**
 * «Мечта сдвинулась» (Р-6, Р-18): сколько мечта получит в этом месяце сейчас — `max(given по факту, put)`, где `given`
 * — из `monthPlan` с тратами по факту (`byFact`) — против `given` снимка начала месяца; разница переводится в дни
 * темпом цели (`closerDays`). Меньше недели, нет снимка, цели в снимке, темпа; цель на паузе или собрана — null.
 */
export function dreamShift(state: MonthPlanState, ctx: MonthPlanCtx, snap: TermSnap | null | undefined, goalId: string): DreamShift | null {
  if (!snap || snap.deletedAt || snap.id !== ctx.key) return null
  const was = snap.goals.find((g) => g.goalId === goalId)
  const goal = (state.goals ?? []).find((g) => g.id === goalId && !g.deletedAt)
  if (!was || !goal) return null
  const plan = monthPlan(state, { ...ctx, byFact: true })
  const item = plan.queue.find((q) => q.goalId === goalId)
  if (!item || item.paused || item.have >= item.need) return null
  const now = Math.max(item.given, item.put)
  const delta = was.given - now
  const days = closerDays(Math.abs(delta), goalPace(goal, ctx.key))
  if (days === null || days < SHIFT_MIN_DAYS) return null

  const incomeDiff = plan.income.total - snap.income
  if (delta > 0) {
    // Дальше: крупнейший раздел выше плана, крупнейший новый платёж, падение дохода — что больше, то и причина.
    const over = spendCompare(state, ctx)
      .rows.filter((r) => r.amount !== null && r.plan !== null && r.amount > r.plan)
      .map((r) => ({ name: r.name, value: r.amount! - r.plan! }))
      .sort((a, b) => b.value - a.value)[0]
    const known = new Set(snap.dueIds)
    const fresh = plan.dues.filter((d) => !known.has(d.targetId)).sort((a, b) => b.amount - a.amount)[0]
    const options: { reason: DreamShiftReason; value: number; name?: string }[] = [
      { reason: 'spend', value: over?.value ?? 0, name: over?.name },
      { reason: 'due', value: fresh?.amount ?? 0, name: fresh?.name },
      { reason: 'less', value: Math.max(0, -incomeDiff) },
    ]
    const top = options.reduce((a, b) => (b.value > a.value ? b : a))
    return top.value > 0 ? { days, reason: top.reason, ...(top.name ? { name: top.name } : {}) } : { days, reason: 'less' }
  }
  // Ближе: отложили больше, доход больше; остаток — ушедший платёж (сумм ушедших снимок не хранит).
  const putMore = Math.max(0, item.put - was.given)
  const incomeMore = Math.max(0, incomeDiff)
  const current = new Set(plan.dues.map((d) => d.targetId))
  const gone = snap.dueIds.some((id) => !current.has(id))
  const freed = gone ? Math.max(0, -delta - putMore - incomeMore) : 0
  const options: { reason: DreamShiftReason; value: number }[] = [
    { reason: 'put', value: putMore },
    { reason: 'income', value: incomeMore },
    { reason: 'freed', value: freed },
  ]
  return { days: -days, reason: options.reduce((a, b) => (b.value > a.value ? b : a)).reason }
}

/** Слова причин метки (Р-6; финал — `/ux`). `spend` и `due` — с именем раздела или платежа. */
export const SHIFT_REASON_TEXT: Record<DreamShiftReason, (name?: string) => string> = {
  spend: (name) => `${name ? name.charAt(0).toLowerCase() + name.slice(1) : 'траты'} выше плана`,
  due: (name) => (name ? `новый платёж «${name}»` : 'новый платёж'),
  less: () => 'в мечту меньше',
  put: () => 'отложили больше',
  freed: () => 'платёж ушёл',
  income: () => 'доход больше',
}

/**
 * Время метки (Р-18): недели (`round(days / 7)`), от 9 недель — месяцы (`round(days / 30,4)`). Одна шкала для метки,
 * листа «Сделать» и его тоста — чтобы «+2 недели» у мечты и «на … раньше» в листе не расходились.
 */
export function shiftSpan(days: number): string {
  // Число и слово — через неразрывный пробел: метка, лист и тост не рвут «2 / недели» (`/ux` Блока 2).
  const nb = ' '
  // Меньше недели бывает только у листа «Сделать» (метка — от 7 дней): дни, а не «0 недель».
  if (days < SHIFT_MIN_DAYS) return `${days}${nb}${plural(days, 'день', 'дня', 'дней')}`
  const w = Math.round(days / 7)
  if (w < 9) return `${w}${nb}${plural(w, 'неделю', 'недели', 'недель')}`
  const m = Math.round(days / 30.4)
  return `${m}${nb}${plural(m, 'месяц', 'месяца', 'месяцев')}`
}

/* ---------------- «Сделать»: кандидаты сдвига месяца (Р-3, Р-17, AU-05) ---------------- */

/** Суммы кандидатов — вниз до 1 000 ₸, не меньше 5 000 ₸ (мелочь не предлагаем). */
export const STEP_ROUND = 1_000
export const STEP_MIN = 5_000

export type PlanShiftDraft = Pick<PlanShift, 'period' | 'from' | 'to' | 'amount'>

/**
 * Шаг сделан: живой сдвиг того же месяца, в ту же цель (или карточку долга) и из того же источника (остаток или тот же
 * раздел участника). «Вернуть срок» из остатка в ту же мечту — не перенос из раздела (ревью frontend Блока 3, Н-2).
 */
export function shiftMade(shifts: PlanShift[], draft: PlanShiftDraft): boolean {
  const sameFrom = (a: PlanShift['from'], b: PlanShift['from']) =>
    a === 'rest' || b === 'rest' ? a === b : a.spend === b.spend && a.categoryId === b.categoryId
  const sameTo = (a: PlanShift['to'], b: PlanShift['to']) => (a === 'debt' || b === 'debt' ? a === b : a.goalId === b.goalId)
  return shifts.some((s) => !s.deletedAt && s.period === draft.period && sameTo(s.to, draft.to) && sameFrom(s.from, draft.from))
}

/** Эффект кандидата: мечта — на `days` раньше; досрочка — на `months` раньше и `saved` процентов; подушка — хватит на `months`. */
export type StepCandidate =
  | { id: string; kind: 'move'; shift: PlanShiftDraft; effect: { days: number | null } }
  | { id: string; kind: 'prepay'; shift: PlanShiftDraft; effect: { months: number; saved: number } }
  | { id: string; kind: 'cushion'; shift: PlanShiftDraft; effect: { months: number | null } }

const roundStep = (n: number) => Math.floor(n / STEP_ROUND) * STEP_ROUND

/** Запас плана раздела: «обычно» ниже плана — разница с бо́льшим из «обычно» и факта; планы — с учётом сдвигов месяца. */
function spendSlack(state: MonthPlanState, ctx: MonthPlanCtx, plan: MonthPlan) {
  const byCat = (id: string) =>
    plan.spend
      .flatMap((s) => s.rows.filter((r) => r.categoryId === id).map((r) => ({ by: s.by, plan: r.plan })))
      .sort((a, b) => b.plan - a.plan || a.by.localeCompare(b.by))
  return spendCompare(state, ctx)
    .rows.filter((r) => r.usual !== null && r.plan !== null)
    .map((r) => {
      const owners = byCat(r.categoryId)
      const total = owners.reduce((s, o) => s + o.plan, 0)
      return { categoryId: r.categoryId, slack: total - Math.max(r.usual!, r.amount ?? 0), owners }
    })
    .filter((r) => r.slack > 0)
    .sort((a, b) => b.slack - a.slack || a.categoryId.localeCompare(b.categoryId))
}

/** Первая мечта очереди — цель (не фонд, не карточка долга), не на паузе и не собранная. */
const firstDream = (plan: MonthPlan) => plan.queue.find((q) => q.kind === 'goal' && !q.paused && q.goalId && q.have < q.need) ?? null

/**
 * Кандидаты «Сделать» (Р-3) — до трёх, по одному каждого вида; данных нет — кандидата нет:
 * - `move` — раздел, где «обычно» ниже плана: `план − max(обычно, факт)` из плана участника с бо́льшим планом раздела
 *   (не больше его строки) в первую мечту очереди; эффект — `closerDays`;
 * - `prepay` — есть карточка долга и остаток месяца: весь остаток досрочно, эффект — `prepayOutcome(…, 'once')`;
 * - `cushion` — подушка не собрана и есть остаток: `min(остаток, сколько не хватает после взноса плана)`, эффект —
 *   на сколько месяцев хватит после (`cushionCover`).
 */
export function stepCandidates(state: MonthPlanState, ctx: MonthPlanCtx): StepCandidate[] {
  const plan = monthPlan(state, ctx)
  const out: StepCandidate[] = []
  const dream = firstDream(plan)
  const goal = dream ? (state.goals ?? []).find((g) => g.id === dream.goalId) : undefined
  if (dream && goal) {
    // Не больше, чем мечта примет в этом месяце (сдвиг упрётся в остаток до суммы — лишнее ушло бы в остаток).
    const room = dream.need - dream.have - dream.given
    const best = spendSlack(state, ctx, plan)
      .map((r) => ({ ...r, owner: r.owners[0], amount: roundStep(Math.min(r.slack, r.owners[0]?.plan ?? 0, room)) }))
      .filter((r) => r.owner && r.amount >= STEP_MIN)
      .sort((a, b) => b.amount - a.amount || a.categoryId.localeCompare(b.categoryId))[0]
    if (best) {
      out.push({
        id: `move:${best.categoryId}`,
        kind: 'move',
        shift: { period: ctx.key, from: { spend: best.owner.by, categoryId: best.categoryId }, to: { goalId: goal.id }, amount: best.amount },
        effect: { days: closerDays(best.amount, goalPace(goal, ctx.key)) },
      })
    }
  }
  const restStep = roundStep(plan.rest)
  // На паузе строка очереди не получает ничего (`given` 0) — сдвиг в неё остался бы в остатке: кандидата нет.
  const debt = plan.queue.find((q) => q.kind === 'debt' && q.creditId && !q.paused)
  const credit = debt ? (state.credits ?? []).find((c) => c.id === debt.creditId) : undefined
  if (credit && restStep >= STEP_MIN) {
    const o = prepayOutcome(credit, restStep, 'once')
    if (o) {
      out.push({ id: 'prepay', kind: 'prepay', shift: { period: ctx.key, from: 'rest', to: 'debt', amount: restStep }, effect: { months: o.monthsSaved, saved: o.saved } })
    }
  }
  const cushion = fundsOf(state).cushion
  const cItem = cushion ? plan.queue.find((q) => q.goalId === cushion.id) : undefined
  if (cushion && cItem && !cItem.paused) {
    const amount = roundStep(Math.min(plan.rest, cItem.need - cItem.have - cItem.given))
    if (amount >= STEP_MIN) {
      const months = cushionCover(cItem, { ...cushion, have: cushion.have + amount }, moneySettingsOf(state)).months
      out.push({ id: 'cushion', kind: 'cushion', shift: { period: ctx.key, from: 'rest', to: { goalId: cushion.id }, amount }, effect: { months } })
    }
  }
  return out
}

/**
 * «Вернуть срок» (Р-3, AU-05): мечта сдвинулась дальше — вернуть недобор этого месяца (вверх до 1 000 ₸) из остатка,
 * а не хватает — из плана раздела с запасом (как у `move`, участники по убыванию плана). Каждый источник проверяется
 * тем же расчётом, что метка: после сдвига мечта получает не меньше снимка. Ни один не вернул — null (кнопки нет).
 */
export function returnTermShift(state: MonthPlanState, ctx: MonthPlanCtx, snap: TermSnap | null | undefined, goalId: string): StepCandidate | null {
  const shift = dreamShift(state, ctx, snap, goalId)
  const goal = (state.goals ?? []).find((g) => g.id === goalId)
  const was = snap?.goals.find((g) => g.goalId === goalId)
  if (!shift || shift.days <= 0 || !goal || !was) return null
  const gets = (s: MonthPlanState) => {
    const item = monthPlan(s, { ...ctx, byFact: true }).queue.find((q) => q.goalId === goalId)
    return item ? Math.max(item.given, item.put) : 0
  }
  const amount = Math.ceil((was.given - gets(state)) / STEP_ROUND) * STEP_ROUND
  if (amount <= 0) return null
  const plan = monthPlan(state, ctx)
  const sources: PlanShiftDraft['from'][] = [
    'rest',
    ...spendSlack(state, ctx, plan)
      .filter((r) => r.slack >= amount)
      .flatMap((r) => r.owners.filter((o) => o.plan >= amount).map((o) => ({ spend: o.by, categoryId: r.categoryId }))),
  ]
  for (const from of sources) {
    const draft: PlanShiftDraft = { period: ctx.key, from, to: { goalId }, amount }
    const trial: PlanShift = { ...draft, id: '_trial', by: from === 'rest' ? 'a' : from.spend, at: '', updatedAt: '' }
    if (gets({ ...state, planShifts: [...(state.planShifts ?? []), trial] }) >= was.given) {
      return { id: `return:${goalId}`, kind: 'move', shift: draft, effect: { days: closerDays(amount, goalPace(goal, ctx.key)) } }
    }
  }
  return null
}

/** Метка мечты: «+2 недели · кафе выше плана» / «на 3 недели ближе · отложили больше». */
export function shiftLabel(shift: DreamShift): string {
  const why = SHIFT_REASON_TEXT[shift.reason](shift.name)
  if (shift.days > 0) {
    const span = shiftSpan(shift.days)
    // «+2 недели» — именительный: «неделю» → «неделя».
    return `+${span.replace(/^1\sнеделю$/, '1 неделя')} · ${why}`
  }
  return `на ${shiftSpan(-shift.days)} ближе · ${why}`
}

/**
 * Эффект кандидата «Сделать» строкой (Р-3) — одни слова для листа `DoSheet` и для разбора v2 (AU-11, кандидат уходит
 * в модель вместе с ним): «на 2 недели раньше», «на 3 мес. раньше · −41 000 процентов», «подушки хватит на 1,2 месяца».
 * Эффекта нет — пустая строка.
 */
export function stepEffectText(c: StepCandidate): string {
  if (c.kind === 'move') return c.effect.days ? `на ${shiftSpan(c.effect.days)} раньше` : ''
  if (c.kind === 'prepay') {
    return [c.effect.months > 0 ? `на ${c.effect.months} мес. раньше` : '', c.effect.saved > 0 ? `−${plain(c.effect.saved)} процентов` : '']
      .filter(Boolean)
      .join(' · ')
  }
  return c.effect.months !== null ? `подушки хватит на ${monthsLabel(c.effect.months)}` : ''
}

/* ---------------- разбор v2: что изменилось к прошлому месяцу (Р-2, AU-11) ---------------- */

/**
 * Месяц `ctx.key` против прошлого (Р-2: «что изменилось»): доход больше / меньше — оба ≥ 0, одно из них 0; новые
 * платежи — платежи месяца, которых не было в прошлом (по `targetId`; с суммой 0 — не было), крупные первыми; `prevIncome` — доход прошлого.
 */
export function monthChanges(
  state: MonthPlanState,
  ctx: MonthPlanCtx,
  now: MonthPlan = monthPlan(state, ctx),
): { prevIncome: number; incomeMore: number; incomeLess: number; newDues: PlanDue[] } {
  const prev = monthPlan(state, { ...ctx, key: addMonths(ctx.key, -1) })
  const diff = now.income.total - prev.income.total
  // Платёж с версией «с этого месяца» в прошлом месяце стоит с суммой 0 — его там не было.
  const known = new Set(prev.dues.filter((d) => d.amount > 0).map((d) => d.targetId))
  return {
    prevIncome: prev.income.total,
    incomeMore: Math.max(0, diff),
    incomeLess: Math.max(0, -diff),
    // Нулевой сейчас (версия позже, пауза, валюта без курса) — не новый платёж.
    newDues: now.dues.filter((d) => d.amount > 0 && !known.has(d.targetId)).sort((a, b) => b.amount - a.amount),
  }
}

/**
 * Главные разделы трат для разбора (Р-5: 1–2): сначала с точкой «больше обычного» (`over`, по убыванию факта), иначе —
 * крупнейшие сверх плана (по убыванию «факт − план»). Порядок строк `spendCompare` сохраняется внутри групп.
 */
export function reviewSpendRows(rows: SpendCompareRow[], n = 2): SpendCompareRow[] {
  const over = rows.filter((r) => r.over)
  if (over.length) return over.slice(0, n)
  return rows
    .filter((r) => r.amount !== null && r.plan !== null && r.amount > r.plan)
    .sort((a, b) => b.amount! - b.plan! - (a.amount! - a.plan!))
    .slice(0, n)
}

/** Состояние строки очереди «Месяца» — только когда есть что сказать (правило 12); текст — в экране. */
export type QueueStatus =
  | { kind: 'off' }
  | { kind: 'planPause' }
  /** Карточка долга без суммы на месяц при плане «Сначала долги» — сумма идёт шагом плана (Р-82). */
  | { kind: 'debtByPlan' }
  /** Карточка долга без суммы на месяц, плана нет. */
  | { kind: 'debtNoAmount' }
  | { kind: 'collected' }
  | { kind: 'noMonthly' }
  /** План даёт меньше взноса: `amount` — сколько не хватает. */
  | { kind: 'short'; amount: number }
  /** План в этом месяце не даёт ничего. */
  | { kind: 'shortAll' }

export function queueStatus(q: PlanQueueItem, o: { debtPlan: boolean }): QueueStatus | null {
  if (q.paused === 'off') return { kind: 'off' }
  if (q.paused === 'plan') return { kind: 'planPause' }
  if (q.kind === 'debt') {
    if (q.want <= 0) return { kind: o.debtPlan ? 'debtByPlan' : 'debtNoAmount' }
  } else {
    if (q.need - q.have <= 0) return { kind: 'collected' }
    if (q.want <= 0) return { kind: 'noMonthly' }
  }
  if (q.given < q.want) return q.given > 0 ? { kind: 'short', amount: q.want - q.given } : { kind: 'shortAll' }
  return null
}

/**
 * «Отложить по плану» для плательщика (Р-78): его цели, фонды и досрочка — суммами плана месяца, разово. За
 * вычетом уже отложенного в этом месяце (`put`: взнос руками, другая запись) — дважды не кладётся. null — его
 * зарплата месяца не пришла, запись месяца уже есть (в том числе старого разбора Блока 11) или откладывать нечего:
 * за плательщиком нет целей, фондов и досрочки с суммой (ревью frontend Б14, Н-1) — одно условие «есть что
 * отложить» для кнопки плана, «Денег» (`?month=`), карточки «Недели» и листа отметки (`salaryToAllocate`).
 */
export function planSave(plan: MonthPlan, person: PersonId): PlanSave | null {
  const inc = plan.income.byPerson.find((x) => x.person === person)
  if (!inc?.came || plan.saved[person]) return null
  const mine = plan.queue.filter((q) => q.payer === person && !q.paused)
  const amount = (q: PlanQueueItem) => Math.max(0, q.given - q.put)
  const contributions = mine.filter((q) => q.goalId && amount(q) > 0).map((q) => ({ goalId: q.goalId!, amount: amount(q) }))
  const debt = mine.find((q) => q.kind === 'debt' && q.creditId && amount(q) > 0)
  const prepay = debt ? { creditId: debt.creditId!, amount: amount(debt), ...(debt.planId ? { planId: debt.planId } : {}) } : null
  if (!contributions.length && !prepay) return null
  return {
    record: { source: 'salary', sourceId: person, period: plan.key },
    total: inc.amount,
    contributions,
    prepay,
    ...planParts(contributions, prepay),
  }
}

/** Прочие источники (Р-86): остаток месяца, освободившийся платёж, закрытый долг. */
export type PlanSource =
  | { from: 'rest'; amount: number; period: string }
  | { from: 'freed' }
  | { from: 'credit'; creditId: string }

export type PlanFromSource =
  | (Omit<PlanSave, 'record'> & {
      mode: 'once'
      record: { source: 'rest' | 'freed'; sourceId: string; period: string }
      /** Сколько раскладывается. */
      amount: number
      /** Что не поместилось в очередь (всё собрано), ≥ 0. */
      left: number
      recorded: Allocation | null
    })
  | {
      mode: 'monthly'
      record: { source: 'freed'; sourceId: string; period: string }
      amount: number
      /** Первая включённая цель или фонд очереди: её `monthly` растёт на `amount` с месяца освобождения. */
      goalId: string
      name: string
      add: number
      /** Месяц цели без прибавки и с ней (план месяца освобождения). */
      before: string | null
      after: string | null
      recorded: Allocation | null
    }

/**
 * Прочие источники старой раскладки (Р-86) — без отдельного экрана:
 * - «остались деньги?» (`rest`) и «долг закрыт» (`credit`, его платёж — разово; долг активного плана «Сначала
 *   долги» — 0: платёж уже идёт в следующий долг) — разовый взнос по очереди сверху вниз: цель — до суммы, фонд —
 *   до порога, долг — до остатка; выключенные пропускаются;
 * - «освободится N ₸» (`freed`) — +N к взносу первой включённой цели или фонда очереди (не собранной) с месяца,
 *   когда платёж уменьшится; даты «к X, а не к Y» — план того месяца без прибавки и с ней.
 * null — источника нет (снижения впереди нет, долг не закрыт) или класть некуда.
 * `rawCredits` — кредиты документа (база сверки) для «долг закрыт».
 */
export function planFromSource(
  state: MonthPlanState,
  ctx: MonthPlanCtx & { rawCredits?: Credit[] },
  source: PlanSource,
): PlanFromSource | null {
  if (source.from === 'freed') {
    const freed = freedChange(liveObligations(state.obligations ?? []), ctx.key, state.book)
    if (!freed) return null
    const at = { ...ctx, key: freed.change.from }
    const plan = monthPlan(state, at)
    const head = plan.queue.find((q) => q.kind !== 'debt' && !q.paused && q.need - q.have > 0)
    if (!head?.goalId) return null
    const goals = (state.goals ?? []).map((g) => (g.id === head.goalId ? { ...g, monthly: g.monthly + freed.monthly } : g))
    const after = monthPlan({ ...state, goals }, at).queue.find((q) => q.id === head.id)
    const record = { source: 'freed' as const, sourceId: freed.o.id, period: freed.change.from }
    return {
      mode: 'monthly',
      record,
      amount: freed.monthly,
      goalId: head.goalId,
      name: head.name,
      add: freed.monthly,
      before: head.doneMonth,
      after: after?.doneMonth ?? null,
      recorded: allocationFor(state.allocations, record),
    }
  }

  let amount: number
  let record: { source: 'rest' | 'freed'; sourceId: string; period: string }
  if (source.from === 'rest') {
    amount = Math.max(0, Math.round(source.amount))
    record = { source: 'rest', sourceId: source.period, period: source.period }
  } else {
    const m = progressMoments({ credits: ctx.rawCredits ?? state.credits, payments: state.payments }).find(
      (x): x is Extract<Moment, { kind: 'closed' }> => x.kind === 'closed' && x.creditId === source.creditId,
    )
    if (!m) return null
    amount = activePlan(state.plans ?? [])?.creditIds.includes(m.creditId) ? 0 : m.freed
    record = { source: 'freed', sourceId: m.creditId, period: movementMonth(m.at) }
  }

  // Разово — до суммы цели, порога фонда, остатка долга: на сейчас, а не на начало месяца.
  const plan = monthPlan(state, ctx)
  const goals = new Map(liveGoals(state.goals ?? []).map((g) => [g.id, g])) // Сбылось (PN-13): все живые — записи плана могут ссылаться на сбывшуюся
  let left = amount
  const contributions: { goalId: string; amount: number }[] = []
  let prepay: PlanSave['prepay'] = null
  for (const q of plan.queue) {
    if (q.paused || left <= 0) continue
    const room = q.kind === 'debt'
      ? (state.credits ?? []).find((c) => c.id === q.creditId)?.principal ?? 0
      : Math.max(0, q.need - Math.max(0, goals.get(q.goalId!)?.have ?? 0))
    const x = Math.min(room, left)
    if (x <= 0) continue
    left -= x
    if (q.kind === 'debt') prepay = { creditId: q.creditId!, amount: x }
    else contributions.push({ goalId: q.goalId!, amount: x })
  }
  if (!contributions.length && !prepay) return null
  return {
    mode: 'once',
    record,
    amount,
    total: amount,
    left,
    contributions,
    prepay,
    ...planParts(contributions, prepay),
    recorded: allocationFor(state.allocations, record),
  }
}

/* ---------------- «Месяц» — список дел (Блок 15, B2C-94; Р-93, Р-97) ---------------- */

/** Строка подписки для группы: платёж месяца («Месяц») или строка справочника («Деньги»). */
export type SubsItem = { obligation: Obligation; amount: number; paid: boolean; day: number }

/** Подписки одной группой (Р-93): строка «Подписки · N · сумма», раскрытие — подгруппы. */
export type SubsGroup<T> = {
  count: number
  total: number
  /** Сколько подписок оплачено; ✓ у группы — когда все. */
  paid: number
  allPaid: boolean
  /** День первой подписки — место группы в списке по дням. */
  day: number
  /** Сначала подписки без ручной группы (`name` пусто), затем ручные группы (`group` / `parentId`) по имени; внутри — по дню. */
  parts: { groupId: string | null; name: string; rows: T[] }[]
}

/** С какого числа подписок они сворачиваются в группу: одна подписка — обычная строка. */
export const SUBS_GROUP_MIN = 2

/**
 * Группа подписок (Р-93) — одна функция для «Месяца» (с отметками) и справочника «Денег»: число, сумма, сколько
 * оплачено, подгруппы ручных групп. `items` — уже подписки (`isSubscription`); `all` — обязательства семьи (имена
 * ручных групп). Меньше `SUBS_GROUP_MIN` — null: сворачивать нечего.
 */
export function subscriptionGroup<T extends SubsItem>(items: T[], all: Obligation[]): SubsGroup<T> | null {
  return items.length < SUBS_GROUP_MIN ? null : rowsGroup(items, all)
}

/**
 * Платежи людям одной строкой «Людям · N · сумма» в «Долгах» (мелочи Р-6) — как `subscriptionGroup`, но с **одного**
 * платежа: строка нужна всегда, когда есть хоть один. `items` — уже платежи людям (`isPeoplePayment`). Пусто — null.
 */
export function peopleGroup<T extends SubsItem>(items: T[], all: Obligation[]): SubsGroup<T> | null {
  return items.length ? rowsGroup(items, all) : null
}

function rowsGroup<T extends SubsItem>(items: T[], all: Obligation[]): SubsGroup<T> {
  const groups = liveGroups(all)
  const parts = new Map<string, { groupId: string | null; name: string; rows: T[] }>()
  for (const x of items.slice().sort((a, b) => a.day - b.day || a.obligation.name.localeCompare(b.obligation.name))) {
    const g = groups.find((y) => y.id === x.obligation.parentId) ?? null
    const part = parts.get(g?.id ?? '') ?? { groupId: g?.id ?? null, name: g?.name ?? '', rows: [] }
    part.rows.push(x)
    parts.set(g?.id ?? '', part)
  }
  const paid = items.filter((x) => x.paid).length
  return {
    count: items.length,
    total: amountTotal(items),
    paid,
    allPaid: paid === items.length,
    day: Math.min(...items.map((x) => x.day)),
    parts: [...parts.values()].sort((a, b) => Number(!!a.groupId) - Number(!!b.groupId) || a.name.localeCompare(b.name)),
  }
}

/** Часть «Подписок» по «чья» (Р-7 «понятность», PN-27): `'all'` — «Общие», иначе участник. */
export type SubsWhoPart<T> = { who: PersonId | 'all'; name: string; group: SubsGroup<T> }

/**
 * «Подписки · N» по «чья» (Р-7, хвост 1024): «Общие» (`who` пусто или участника больше нет), затем участники в порядке
 * `people`; части без подписок нет. Внутри части — те же подгруппы, что у `subscriptionGroup`. Ручной пакет не рвётся:
 * у всех его подписок один `who` — пакет в части этого участника, разные — целиком в «Общих». Одна часть — экран
 * подзаголовков не рисует.
 */
export function subscriptionsByWho<T extends SubsItem>(items: T[], all: Obligation[], people: Person[]): SubsWhoPart<T>[] {
  const known = new Set(people.map((p) => p.id))
  const whoOf = (o: Obligation): PersonId | 'all' => (o.who && known.has(o.who) ? o.who : 'all')
  const groupIds = new Set(liveGroups(all).map((g) => g.id))
  const packWho = new Map<string, PersonId | 'all'>()
  for (const x of items) {
    const id = x.obligation.parentId
    if (!id || !groupIds.has(id)) continue
    const w = whoOf(x.obligation)
    packWho.set(id, packWho.has(id) && packWho.get(id) !== w ? 'all' : w)
  }
  const keyOf = (x: T) => {
    const id = x.obligation.parentId
    return id && packWho.has(id) ? packWho.get(id)! : whoOf(x.obligation)
  }
  const order: { who: PersonId | 'all'; name: string }[] = [
    { who: 'all', name: 'Общие' },
    ...people.map((p) => ({ who: p.id, name: p.name })),
  ]
  return order.flatMap(({ who, name }) => {
    const rows = items.filter((x) => keyOf(x) === who)
    return rows.length ? [{ who, name, group: rowsGroup(rows, all) }] : []
  })
}

/**
 * Платежи месяца для списка (Р-93): подписки — группой, остальные — строками как были; `byWho` — та же группа по
 * «чья» (PN-27; `people` не дали — одна часть «Общие»).
 */
export function monthSubscriptions<T extends MonthDue>(
  dues: T[],
  all: Obligation[],
  people: Person[] = [],
): { rest: T[]; subs: SubsGroup<Extract<T, { kind: 'obligation' }>> | null; byWho: SubsWhoPart<Extract<T, { kind: 'obligation' }>>[] } {
  const isSub = (d: T): d is Extract<T, { kind: 'obligation' }> => d.kind === 'obligation' && isSubscription(d.obligation)
  const items = dues.filter(isSub)
  const subs = subscriptionGroup(items, all)
  return subs
    ? { rest: dues.filter((d) => !isSub(d)), subs, byWho: subscriptionsByWho(items, all, people) }
    : { rest: dues, subs: null, byWho: [] }
}

/** Дело «отложить» месяца (Р-97, ворота B2C-91): строка очереди как пункт списка — «Отложил» ✓. */
export type PlanPut = {
  /** id строки очереди. */
  id: string
  kind: PlanQueueItem['kind']
  goalId: string | null
  creditId?: string
  planId?: string
  name: string
  payer: PersonId | null
  /** Сколько даёт план в этом месяце (`given`), > 0. */
  amount: number
  /** Отложено в этом месяце с учётом снятий, ≥ 0. */
  put: number
  /** Осталось отложить: `amount − put`, ≥ 0. */
  left: number
  /** ✓ — сумма плана отложена вся. */
  done: boolean
  /** Зарплата плательщика пришла — строка ждёт «Отложил» (точка, «Отложил всё»). */
  ready: boolean
  /** Сколько снимет «Не отложено»: положенное в цель записями плана этого месяца, не больше `put`; 0 — снимать нечего. */
  undo: number
}

/**
 * Список дел «отложить» (Р-97): строки очереди, которым план даёт сумму в этом месяце. Отложено — `goalPutIn`, нетто
 * движений цели за месяц (снятие «Не отложено» возвращает строку в дела), у долга — досрочки месяца. План считает от
 * начала месяца — отметка сумму строки не меняет.
 */
export function planPuts(state: MonthPlanState, plan: MonthPlan): PlanPut[] {
  const goals = new Map(liveGoals(state.goals ?? []).map((g) => [g.id, g])) // Сбылось (PN-13): все живые — записи плана могут ссылаться на сбывшуюся
  const came = new Set(plan.income.byPerson.filter((x) => x.came).map((x) => x.person))
  const records = (state.allocations ?? []).filter((a) => !a.deletedAt && a.kind === 'plan' && a.source === 'salary' && a.period === plan.key)
  const recorded = (target: string) => records.reduce((s, a) => s + a.parts.filter((p) => p.target === target).reduce((x, p) => x + p.amount, 0), 0)
  return plan.queue
    .filter((q) => !q.paused && q.given > 0)
    .map((q): PlanPut => {
      const g = q.goalId ? goals.get(q.goalId) : undefined
      const put = g ? goalPutIn(g, plan.key) : q.put
      const left = Math.max(0, q.given - put)
      return {
        id: q.id, kind: q.kind, goalId: q.goalId, ...(q.creditId ? { creditId: q.creditId } : {}), ...(q.planId ? { planId: q.planId } : {}),
        name: q.name, payer: q.payer, amount: q.given, put, left, done: left <= 0,
        ready: !!q.payer && came.has(q.payer),
        undo: q.goalId ? Math.min(put, recorded(q.goalId)) : 0,
      }
    })
}

/** Что ждёт «Отложил» прямо сейчас: зарплата плательщика пришла, сумма плана не отложена. */
export const pendingPuts = (puts: PlanPut[]) => puts.filter((p) => p.ready && !p.done)

/** Сколько осталось отложить по строкам — сумма на «Отложил всё», ровно то, что запишет `planPutSaves` (остатки `left`). */
export const putsLeft = (puts: PlanPut[]) => amountTotal(puts.map((p) => ({ amount: p.left })))

/**
 * Что записать по строкам списка дел («Отложил» у цели, «Отложил всё»): по записи на плательщика — его взносы и
 * досрочка остатком до суммы плана (`left`), источник — его зарплата месяца. Уже отложенные строки пропускаются.
 */
export function planPutSaves(plan: MonthPlan, puts: PlanPut[]): PlanSave[] {
  const todo = puts.filter((p) => p.left > 0 && p.payer)
  return [...new Set(todo.map((p) => p.payer!))].map((person) => {
    const mine = todo.filter((p) => p.payer === person)
    const contributions = mine.filter((p) => p.goalId).map((p) => ({ goalId: p.goalId!, amount: p.left }))
    const debt = mine.find((p) => p.kind === 'debt' && p.creditId)
    const prepay = debt ? { creditId: debt.creditId!, amount: debt.left, ...(debt.planId ? { planId: debt.planId } : {}) } : null
    return {
      record: { source: 'salary' as const, sourceId: person, period: plan.key },
      total: plan.income.byPerson.find((x) => x.person === person)?.amount ?? 0,
      contributions,
      prepay,
      ...planParts(contributions, prepay),
    }
  })
}

/** Деньги сверх плана у своего предмета (Р-86, Р-97): «освободится» — у платежа, «долг закрыт» — у целей. */
export type PlanExtras = {
  /** Платёж уменьшится: +N в месяц первой цели очереди; запись ещё не сделана. */
  freed: (Extract<PlanFromSource, { mode: 'monthly' }> & { obligationId: string }) | null
  /** Долг закрыт в этом месяце: его платёж — разово по очереди; запись ещё не сделана. */
  closed: (Extract<PlanFromSource, { mode: 'once' }> & { name: string }) | null
}

/** Прочие источники месяца, которые ещё ждут решения (`planFromSource` без записи) — одно место для экрана и точки. */
export function planExtras(state: MonthPlanState, ctx: MonthPlanCtx & { rawCredits?: Credit[] }): PlanExtras {
  const f = planFromSource(state, ctx, { from: 'freed' })
  const freed = f?.mode === 'monthly' && !f.recorded ? { ...f, obligationId: f.record.sourceId } : null
  const moment = progressMoments({ credits: ctx.rawCredits ?? state.credits, payments: state.payments }).find(
    (m): m is Extract<Moment, { kind: 'closed' }> => m.kind === 'closed' && movementMonth(m.at) === ctx.key,
  )
  const c = moment ? planFromSource(state, ctx, { from: 'credit', creditId: moment.creditId }) : null
  const closed = moment && c?.mode === 'once' && !c.recorded && c.amount > 0 ? { ...c, name: moment.name } : null
  return { freed, closed }
}

/** Сводка прошлого месяца (Р-85) — только из записей, только чтение. */
export type MonthPlanPast = {
  key: string
  /** Пришло зарплат, тенге (`paidTenge`), и по участникам. */
  came: number
  cameBy: { person: PersonId; amount: number }[]
  /** Оплачено по графику (обязательства и кредиты) — суммы отметок. */
  paid: number
  /** Отложено: взносы в цели и фонды месяца и досрочки. */
  saved: number
  prepaid: number
  /** Отложили всего: взносы + досрочки (дуга «отложили», Н-5). */
  put: number
  /** Потрачено по выпискам (кроме платежей `plannedElsewhere`); null — итогов за месяц нет. */
  spent: number | null
  /** Осталось: пришло − оплачено − потрачено − отложено − досрочки (может быть меньше нуля). */
  left: number
  /** Отложено по целям и фондам месяца — в порядке очереди, только ненулевые. */
  goals: { goalId: string; name: string; amount: number }[]
  /** Записи месяца: «Отложить по плану», разборы Блока 11, прежние раскладки — как были. */
  records: Allocation[]
}

/** Прошлый месяц сводкой (Р-85): пришло, оплачено, отложено, потрачено — из отметок, взносов и итогов выписок. */
export function monthPlanPast(
  state: MonthPlanState & { spendTotals?: SpendTotal[]; spendCategories?: SpendCategory[] },
  key: string,
): MonthPlanPast {
  // Б7: приходы аванса и недели помечены ISO-днём — месяц по `periodMonth`; у участника одна строка — сумма приходов.
  const counted = countedPayments(state.payments ?? []).filter((p) => periodMonth(p.period) === key)
  const cameBy: { person: PersonId; amount: number }[] = []
  for (const p of counted.filter((x) => x.kind === 'salary')) {
    const amount = paidTenge(state, p.targetId as PersonId, p.period, p)
    const row = cameBy.find((x) => x.person === p.targetId)
    if (row) row.amount += amount
    else cameBy.push({ person: p.targetId as PersonId, amount })
  }
  const totals = (state.spendTotals ?? []).filter((t) => !t.deletedAt && t.kind === 'month' && t.period === key && t.amount > 0)
  const live = (state.spendCategories ?? []).filter(alive)
  const goals = queueOf(state)
    .flatMap((q) => (q.goal ? [{ goalId: q.goal.id, name: q.goal.name, amount: goalPutIn(q.goal, key) }] : []))
    .filter((g) => g.amount > 0)
  const came = amountTotal(cameBy)
  const paid = amountTotal(counted.filter((p) => p.kind === 'obligation' || p.kind === 'credit'))
  const saved = amountTotal(goals)
  const prepaid = amountTotal(counted.filter((p) => p.kind === 'prepay'))
  const spent = totals.length
    ? totals.reduce((s, t) => s + factOf(t, live), 0)
    : null
  return {
    key,
    came,
    cameBy,
    paid,
    saved,
    prepaid,
    put: saved + prepaid,
    spent,
    left: came - paid - (spent ?? 0) - saved - prepaid,
    goals,
    records: (state.allocations ?? []).filter((a) => !a.deletedAt && a.period === key).sort((a, b) => a.at.localeCompare(b.at)),
  }
}

/**
 * Месяцы «Истории» (Р-111): от прошлого месяца назад, не раньше первого месяца данных (`historyStart` — свои
 * операции, отметки, моменты, записи), не больше `max`. «осталось» и «+отложили» — `monthPlanPast`, одна функция со
 * сводкой «Месяца» того же месяца.
 */
export function historyMonths(
  state: MonthPlanState & { spendTotals?: SpendTotal[]; spendCategories?: SpendCategory[]; ops?: Operation[]; moments?: Moment[] },
  key: string,
  max = 12,
): { key: string; left: number; put: number }[] {
  const start = historyStart({ ops: state.ops ?? [], payments: state.payments, moments: state.moments, allocations: state.allocations })
  const out: { key: string; left: number; put: number }[] = []
  for (let m = addMonths(key, -1); start && m >= start && out.length < max; m = addMonths(m, -1)) {
    const past = monthPlanPast(state, m)
    out.push({ key: m, left: past.left, put: past.put })
  }
  return out
}

export type WeekPictureRow = {
  categoryId: string
  name: string
  /** Сумма обоих участников за неделю, целые тенге. */
  amount: number
  /** Доля от трат недели, 0…1. */
  share: number
  /** Токен цвета раздела (`spendColor`). */
  color: string
}

/** Загрузка выписки, как её отдаёт сервер: чья и за какой период (`created_at` — когда загрузили). */
export type UploadPeriod = { slot: string; period_from: string; period_to: string; created_at?: string }

/** Выписка за неделю есть, если её период перекрывает неделю хотя бы днём (строка загрузки «Недели», `startWeek`). */
const coversWeek = (u: UploadPeriod, range: { from: string; to: string }) => u.period_to >= range.from && u.period_from <= range.to

/**
 * Живые разделы трат семьи по `order`; пока семья их не завела — стартовый словарь. Один
 * список для «куда отнести?», чипов «Истории» и «Недели» (ревью frontend Б9, Н-3).
 */
export function liveSpendCategories(list: SpendCategory[] | undefined): Omit<SpendCategory, 'updatedAt'>[] {
  const live = list?.filter((c) => !c.deletedAt)
  return (live?.length ? live : DEFAULT_SPEND_CATEGORIES).slice().sort((a, b) => a.order - b.order)
}

/** Имя раздела трат: как назвала семья, иначе из словаря, иначе «Прочее». */
export function spendCategoryName(categories: Pick<SpendCategory, 'id' | 'name'>[], id: string): string {
  if (id === UNKNOWN_CATEGORY) return 'Не разобрано'
  return categories.find((c) => c.id === id)?.name ?? DEFAULT_SPEND_CATEGORIES.find((c) => c.id === id)?.name ?? 'Прочее'
}

export type SpendRows = { total: number; rows: WeekPictureRow[]; unknown: number; unknownShare: number }

/**
 * Строки картины по разделам из итогов `spendTotals` за период — неделя или месяц, все
 * участники или один (`by`): суммы, доли от общей, «не разобрано» отдельно. Ядро картины недели
 * и картины месяца первого запуска (`Start`): экраны сами не суммируют.
 */
export function spendRows(
  totals: SpendTotal[],
  categories: SpendCategory[],
  where: { kind: 'week' | 'month'; period: string; by?: PersonId },
): SpendRows {
  const sums = new Map<string, number>()
  for (const t of totals) {
    if (t.deletedAt || t.kind !== where.kind || t.period !== where.period || t.amount <= 0) continue
    if (where.by && t.by !== where.by) continue
    sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount)
  }
  const unknown = sums.get(UNKNOWN_CATEGORY) ?? 0
  sums.delete(UNKNOWN_CATEGORY)
  const total = unknown + [...sums.values()].reduce((a, x) => a + x, 0)
  const live = categories.filter(alive)
  const rows: WeekPictureRow[] = [...sums]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([categoryId, amount]) => {
      const cat = live.find((c) => c.id === categoryId) ?? DEFAULT_SPEND_CATEGORIES.find((c) => c.id === categoryId) ?? null
      return {
        categoryId,
        name: spendCategoryName(live, categoryId),
        amount,
        share: total > 0 ? amount / total : 0,
        color: spendColor(cat),
      }
    })
  return { total, rows, unknown, unknownShare: total > 0 ? unknown / total : 0 }
}

/** Строка карточки «Выписки» (Р-62): загружена ли выписка за неделю и в какой день — последняя загрузка; нет — null. */
export type WeekUploadRow = { person: Person; day: string | null }

/** Кто загрузил выписку за неделю (Р-62; строка загрузки «Недели», Р-96) — по живым участникам, перекрытие периода с неделей — `coversWeek`. */
export function weekUploads(people: Person[], week: string, uploads: UploadPeriod[] = []): WeekUploadRow[] {
  const range = weekRange(week)
  return people.filter(alive).map((person) => {
    const mine = uploads.filter((u) => u.slot === person.id && coversWeek(u, range))
    const last = mine.map((u) => u.created_at ?? '').sort().at(-1)
    return { person, day: mine.length ? weekdayShort(last) : null }
  })
}

/* ---------------- «Неделя» — мои траты (Блок 15, B2C-92; Р-95, Р-98, Р-101) ---------------- */

/** Остаток раздела «мало»: меньше этой доли плана месяца (или уже сверх плана) — строка красится `--warn`. */
export const LOW_REST_SHARE = 0.15

/** Стрелка к прошлой неделе: больше / меньше / столько же; null — на этой неделе трат нет. */
export type WeekArrow = 'up' | 'down' | 'same' | null

const weekArrow = (now: number, prev: number): WeekArrow => (now <= 0 ? null : now > prev ? 'up' : now < prev ? 'down' : 'same')

/** Прошлая ISO-неделя. */
export const prevWeekKey = (week: string) => weekKey(addDaysIso(weekRange(week).from, -7))

/** Раздел участника за неделю (`myWeek`). */
export type MyWeekRow = {
  categoryId: string
  name: string
  /** Токен цвета раздела (`spendColor`). */
  color: string
  /** Потрачено за неделю, целые тенге. */
  amount: number
  /** Потрачено за прошлую неделю. */
  prev: number
  /** К прошлой неделе: `amount − prev`. */
  delta: number
  arrow: WeekArrow
  /** Сумма раздела на месяц недели (`spendPlans`, Р-81); null — раздел вне плана. */
  plan: number | null
  /** Факт месяца на конец недели (для текущей — на сегодня); null — раздел вне плана. */
  spent: number | null
  /** Остаток до конца месяца: план − факт; меньше нуля — сверх плана; null — раздел вне плана. */
  rest: number | null
  /** Остатка мало (`LOW_REST_SHARE`) или уже сверх плана. */
  low: boolean
}

export type MyWeek = {
  week: string
  /** Понедельник и воскресенье недели, `YYYY-MM-DD`. */
  range: { from: string; to: string }
  /** Месяц плана для остатков: по последнему дню недели, не позже сегодня (неделя на стыке месяцев). */
  month: string
  /** Мои траты за неделю, включая не разобранное. */
  total: number
  /** Мои траты за прошлую неделю. */
  prev: number
  delta: number
  /** На сколько процентов больше или меньше прошлой недели, целое ≥ 0; null — прошлой недели нет. */
  pct: number | null
  /** Разделы: с тратами за неделю и разделы плана; от большего к меньшему. */
  rows: MyWeekRow[]
}

/** Мои траты недели по разделам из итогов выписок — без платежей (`plannedElsewhere`), как факт трат в `monthPlan`. */
function mySpendOf(totals: SpendTotal[], live: SpendCategory[], by: PersonId, week: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of totals) {
    if (t.deletedAt || t.by !== by || t.kind !== 'week' || t.period !== week || t.amount <= 0) continue
    const spent = factOf(t, live)
    if (spent > 0) out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + spent)
  }
  return out
}

const mapTotal = (m: Map<string, number>) => [...m.values()].reduce((s, x) => s + x, 0)

/**
 * «Неделя» — только мои траты (Р-95, Р-98): разделы участника за ISO-неделю (потрачено, стрелка к прошлой),
 * у разделов плана — остаток до конца месяца; сумма недели и сравнение с прошлой. Платежи (`plannedElsewhere`)
 * на «Неделе» не показываются (Р-94) — то же правило, что у факта трат плана месяца.
 *
 * Остаток — одна дорога с «Месяцем»: строка трат участника из `monthPlan` (план и факт месяца) минус свои
 * операции месяца после конца недели (`ops` — своя копия операций); у текущей недели таких нет — остаток равен
 * «Месяцу» до тенге. Месяц — по последнему дню недели, не позже сегодня (`today`, `YYYY-MM-DD`).
 */
export function myWeek(
  state: MonthPlanState,
  ctx: Omit<MonthPlanCtx, 'key'> & { by: PersonId; week: string; ops?: Operation[]; today?: string },
): MyWeek {
  const { by, week } = ctx
  const range = weekRange(week)
  const day = ctx.today ?? todayIso()
  const end = range.to < day ? range.to : day
  const month = end.slice(0, 7)
  const live = ctx.spendCategories.filter(alive)
  const named = liveSpendCategories(ctx.spendCategories)

  const now = mySpendOf(ctx.totals, live, by, week)
  const before = mySpendOf(ctx.totals, live, by, prevWeekKey(week))
  const planned = monthPlan(state, { ...ctx, key: month }).spend.find((s) => s.by === by)?.rows ?? []
  // Свои траты месяца после конца недели: у прошлой недели остаток — на её конец.
  const later = new Map<string, number>()
  for (const op of ctx.ops ?? []) {
    if (!isSpend(op) || op.date <= end || op.date.slice(0, 7) !== month) continue
    const id = op.categoryId ?? UNKNOWN_CATEGORY
    later.set(id, (later.get(id) ?? 0) + spendOf(op))
  }

  const ids = [...new Set([...now.keys(), ...planned.map((r) => r.categoryId)])]
  const rows = ids
    .map((categoryId): MyWeekRow => {
      const amount = now.get(categoryId) ?? 0
      const prev = before.get(categoryId) ?? 0
      const row = planned.find((r) => r.categoryId === categoryId)
      const spent = row ? Math.max(0, (row.fact ?? 0) - (later.get(categoryId) ?? 0)) : null
      const rest = row && spent !== null ? row.plan - spent : null
      const cat = categoryId === UNKNOWN_CATEGORY ? null : named.find((c) => c.id === categoryId) ?? null
      return {
        categoryId,
        name: spendCategoryName(named, categoryId),
        color: spendColor(cat),
        amount,
        prev,
        delta: amount - prev,
        arrow: weekArrow(amount, prev),
        plan: row?.plan ?? null,
        spent,
        rest,
        low: !!row && rest !== null && rest < row.plan * LOW_REST_SHARE,
      }
    })
    .sort((a, b) => b.amount - a.amount || (b.plan ?? 0) - (a.plan ?? 0) || a.name.localeCompare(b.name))

  const total = mapTotal(now)
  const prev = mapTotal(before)
  return { week, range, month, total, prev, delta: total - prev, pct: prev > 0 ? Math.round((Math.abs(total - prev) / prev) * 100) : null, rows }
}

/**
 * С какой недели открывается «Неделя» (Р-102): текущая, если за неё уже есть своя выписка или траты; иначе прошлая,
 * если они есть за неё (выписку за неделю грузят в начале следующей); нет ни там, ни там — текущая (ждёт загрузки).
 */
export function startWeek(totals: SpendTotal[], uploads: UploadPeriod[], by: PersonId, now: string = weekKey()): string {
  const has = (week: string) => {
    const range = weekRange(week)
    return (
      uploads.some((u) => u.slot === by && coversWeek(u, range)) ||
      totals.some((t) => !t.deletedAt && t.by === by && t.kind === 'week' && t.period === week && t.amount > 0)
    )
  }
  const prev = prevWeekKey(now)
  return has(now) || !has(prev) ? now : prev
}

/** Самая ранняя неделя со своими тратами — дальше неё «‹» не листает; null — трат ещё нет. */
export function firstWeek(totals: SpendTotal[], by: PersonId): string | null {
  const weeks = totals.filter((t) => !t.deletedAt && t.by === by && t.kind === 'week' && t.amount > 0).map((t) => t.period)
  return weeks.length ? weeks.sort()[0]! : null
}

/** Раздел за неделю из своих операций (`sectionWeek`, Р-101). */
export type SectionWeek = {
  /** Сумма и число трат раздела за неделю. */
  total: number
  count: number
  /** Топ продавцов: имя, число операций, сумма — по убыванию суммы. */
  tops: { name: string; count: number; amount: number }[]
  /**
   * Операции по дням, свежие сверху — первые `limit`; `hand` — вписана руками, её можно поправить (бэклог «Ручная трата»,
   * Р-2); `amount` — `spendOf`, `refund` — сколько вернули (FB-04, Р-12), `oneOff` — «Разовая» (FB-08, метка).
   */
  days: { date: string; ops: { id: string; name: string; amount: number; hand: boolean; refund?: number; oneOff?: true; recurring?: RecurringPrefill }[] }[]
  /** Хвост «Ещё N · сумма»: что не поместилось; null — показано всё. */
  more: { count: number; amount: number } | null
}

/** Сколько продавцов в топе раздела и сколько операций листа до «Ещё N». */
export const SECTION_TOPS = 3
export const SECTION_OPS = 5

/**
 * Лист раздела (Р-101): свои траты раздела за неделю — топ продавцов и операции по дням. Отбор — тот же, что у
 * итогов выписок (`isSpend`: списания, без переводов между своими); раздел `UNKNOWN_CATEGORY` — не разобранное. Имя —
 * продавец коротко (`shortMerchant`) или получатель, как в ленте и листе операции.
 */
export function sectionWeek(
  ops: Operation[],
  where: { week: string; categoryId: string; limit?: number; tops?: number; recurring?: (op: Operation) => RecurringPrefill | null },
): SectionWeek {
  const list = ops
    .filter((op) => isSpend(op) && (op.categoryId ?? UNKNOWN_CATEGORY) === where.categoryId && weekKey(op.date) === where.week)
    .map((op) => ({ id: op.id, date: op.date, name: op.counterparty ?? (isHand(op) ? op.merchant : shortMerchant(op.merchant)), amount: spendOf(op), hand: isHand(op), refund: op.refund?.amount, oneOff: !!op.oneOff, recurring: !isHand(op) && where.recurring ? where.recurring(op) : null, key: op.counterparty ? `c:${normalizeCounterparty(op.counterparty)}` : `m:${normalizeMerchant(op.merchant)}` }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount || a.id.localeCompare(b.id))

  const groups = new Map<string, { name: string; count: number; amount: number }>()
  for (const op of list) {
    const g = groups.get(op.key) ?? { name: op.name, count: 0, amount: 0 }
    g.count += 1
    g.amount += op.amount
    groups.set(op.key, g)
  }
  const tops = [...groups.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, where.tops ?? SECTION_TOPS)

  const shown = list.slice(0, where.limit ?? SECTION_OPS)
  const days: SectionWeek['days'] = []
  for (const op of shown) {
    const last = days.at(-1)
    const item = { id: op.id, name: op.name, amount: op.amount, hand: op.hand, ...(op.refund ? { refund: op.refund } : {}), ...(op.oneOff ? { oneOff: true as const } : {}), ...(op.recurring ? { recurring: op.recurring } : {}) }
    if (last?.date === op.date) last.ops.push(item)
    else days.push({ date: op.date, ops: [item] })
  }
  const rest = list.slice(shown.length)
  return {
    total: amountTotal(list),
    count: list.length,
    tops,
    days,
    more: rest.length ? { count: rest.length, amount: amountTotal(rest) } : null,
  }
}

/** Лист раздела «Месяца» (FB-05, Р-14): свои операции раздела за месяц по дням — как у недели, без топа продавцов. */
export type SectionMonth = Omit<SectionWeek, 'tops'>

/**
 * Свои операции раздела за месяц `YYYY-MM` (FB-05, Р-4, Р-14) — для листа раздела «Месяца»: отбор — как у факта
 * раздела (`isSpend`; у разделов платежей — только строки без отметки `marked`, как `weekFeed` и итоги `unmarked`),
 * сумма строки — `spendOf` (с «вернули»), дни свежими сверху, первые `limit` и «Ещё N · сумма». Сумма всех строк —
 * своя часть факта раздела: разовые (FB-07) — не в разделе, а в листе «Разовые» (`oneOff: true` — все свои разовые
 * месяца, `categoryId` не смотрится; в разделах платежей разовая — обычная строка, как в `oneOffOf`). Топа продавцов
 * нет: в месяце он у находок.
 */
export function sectionMonth(
  ops: Operation[],
  where: {
    month: string
    /** Раздел; не нужен при `oneOff`. */
    categoryId?: string
    oneOff?: boolean
    limit?: number
    marked?: ReadonlySet<string>
    categories?: Pick<SpendCategory, 'id' | 'plannedElsewhere'>[]
  },
): SectionMonth {
  const categories = where.categories ?? []
  const isOneOff = (op: Operation) => !!op.oneOff && !(op.categoryId && plannedElsewhere(op.categoryId, categories))
  const planned = !!where.categoryId && plannedElsewhere(where.categoryId, categories)
  const list = ops
    .filter(
      (op) =>
        isSpend(op) &&
        op.date.slice(0, 7) === where.month &&
        (where.oneOff
          ? isOneOff(op)
          : (op.categoryId ?? UNKNOWN_CATEGORY) === where.categoryId &&
            !isOneOff(op) &&
            (!planned || (!!where.marked && !where.marked.has(op.id)))),
    )
    .map((op) => ({ id: op.id, date: op.date, name: op.counterparty ?? (isHand(op) ? op.merchant : shortMerchant(op.merchant)), amount: spendOf(op), hand: isHand(op), refund: op.refund?.amount, oneOff: !!op.oneOff && !where.oneOff }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount || a.id.localeCompare(b.id))
  const shown = list.slice(0, where.limit ?? SECTION_OPS)
  const days: SectionMonth['days'] = []
  for (const op of shown) {
    const last = days.at(-1)
    const item = { id: op.id, name: op.name, amount: op.amount, hand: op.hand, ...(op.refund ? { refund: op.refund } : {}), ...(op.oneOff ? { oneOff: true as const } : {}) }
    if (last?.date === op.date) last.ops.push(item)
    else days.push({ date: op.date, ops: [item] })
  }
  const rest = list.slice(shown.length)
  return { total: amountTotal(list), count: list.length, days, more: rest.length ? { count: rest.length, amount: amountTotal(rest) } : null }
}

/** Трата ленты недели (`weekFeed`). */
export type WeekFeedOp = {
  id: string
  /** Продавец коротко (`shortMerchant`) или получатель перевода. */
  name: string
  /** Целые тенге, больше нуля. */
  amount: number
  /** Раздел; `UNKNOWN_CATEGORY` — не разобрано. */
  categoryId: string
  /** Пришла с телефона (касание Apple Pay или пуш банка); нет — строка выписки. */
  phone: boolean
  /** Вписана руками (бэклог «Ручная трата», Р-2): нажатие — лист правки «Трата», а не лист операции. */
  hand: boolean
  /** «Мне вернули» (FB-04, Р-12): сколько вернули; `amount` — уже за вычетом (`spendOf`). */
  refund?: number
  /** «Разовая» (FB-08, Р-16): в ленте — метка «разовая»; в неделю входит. */
  oneOff?: true
}

/**
 * Лента трат недели (бэклог «Лента недели», Р-1): свои траты ISO-недели по дням, свежие сверху, — и с телефона, и из
 * выписки. Отбор — тот же, что у суммы недели (`myWeek` ← итоги `spendTotals` → `spentOf`): списания без переводов между
 * своими; у разделов платежей (`plannedElsewhere`) — только строки без отметки (`marked`; нет набора — ни одной, как у
 * `spendTotals` без отметок): отмеченная — платёж, а не трата (Р-94). Сумма ленты равна сумме недели. В дне: сначала
 * с телефона — свежие сверху, потом выписка — крупные сверху.
 */
export function weekFeed(
  ops: Operation[],
  where: { week: string; marked?: ReadonlySet<string>; categories?: Pick<SpendCategory, 'id' | 'plannedElsewhere'>[] },
): { count: number; total: number; days: { date: string; ops: WeekFeedOp[] }[] } {
  const list = ops
    .filter(
      (op) =>
        isSpend(op) &&
        weekKey(op.date) === where.week &&
        (!op.categoryId || !plannedElsewhere(op.categoryId, where.categories ?? []) || (!!where.marked && !where.marked.has(op.id))),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? '') || a.amount - b.amount || a.id.localeCompare(b.id))
  const days: { date: string; ops: WeekFeedOp[] }[] = []
  for (const op of list) {
    const item: WeekFeedOp = {
      id: op.id,
      // Ручная — подпись как вписал человек (заметка или раздел), без сокращения продавца выписки.
      name: op.counterparty ?? (isHand(op) ? op.merchant : shortMerchant(op.merchant)),
      amount: spendOf(op),
      categoryId: op.categoryId ?? UNKNOWN_CATEGORY,
      phone: !!op.source,
      hand: isHand(op),
      ...(op.refund ? { refund: op.refund.amount } : {}),
      ...(op.oneOff ? { oneOff: true as const } : {}),
    }
    const last = days.at(-1)
    if (last?.date === op.date) last.ops.push(item)
    else days.push({ date: op.date, ops: [item] })
  }
  return { count: list.length, total: amountTotal(days.flatMap((d) => d.ops)), days }
}

/** Тренд (Р-98): мои суммы недель по порядку, текущая — последняя; недели без трат — 0. */
export function weekTrend(
  totals: SpendTotal[],
  spendCategories: SpendCategory[],
  by: PersonId,
  week: string,
  n = 8,
): { week: string; from: string; amount: number }[] {
  const live = spendCategories.filter(alive)
  const out: { week: string; from: string; amount: number }[] = []
  let key = week
  for (let i = 0; i < n; i++) {
    out.unshift({ week: key, from: weekRange(key).from, amount: mapTotal(mySpendOf(totals, live, by, key)) })
    key = prevWeekKey(key)
  }
  return out
}

/** Подписка за год для карточки «оставить?»: годовая — как есть, ежемесячная — ×12. */
export const subscriptionYearly = (o: Obligation, key: string, book?: RateBook | null) => amountAt(o, key, book) * (o.every === 'year' ? 1 : 12)

/**
 * Карточка «Оставить подписку?» (DESIGN.md §6) — одна в очереди «Недели» (`decisionQueue`).
 * Годовая — цена продления (`nextObligationDue`: новая версия с месяца продления, а не текущая)
 * и его день; продления впереди нет — сумма года как есть. Ежемесячная — сумма месяца, за год ×12.
 * «За год — X · это N % пути до <главная мечта>» (остаток мечты `goalRemaining`; мечты нет или
 * она собрана — без хвоста).
 */
export function keepCard(
  keep: Obligation,
  goals: Goal[],
  payments: Payment[],
  now: { day: number; key: string } = today(),
  book?: RateBook | null,
  queue?: { goalOrder?: QueueOrder | null; moneySettings?: MoneySettings | null },
): KeepCard {
  const renewal = keep.every === 'year' ? nextObligationDue(keep, payments, now, book) : null
  const yearly = renewal ? renewal.amount : subscriptionYearly(keep, now.key, book)
  const goal = mainGoal(goals, queue?.goalOrder, queue?.moneySettings)
  const remaining = goal ? goalRemaining(goal) : 0
  const pathPct = remaining > 0 ? Math.round((yearly / remaining) * 100) : 0
  const meta = renewal
    ? `${money(renewal.amount)} · в год · продлится ${dayLabel(renewal.day, renewal.period)}`
    : keep.every === 'year'
      ? `${money(yearly)} · в год`
      : `${money(amountAt(keep, now.key, book))} · каждый месяц`
  return {
    question: `Оставить подписку ${keep.name}?`,
    meta,
    inner: `За год — ${money(yearly)}${goal && pathPct > 0 ? ` · это ${pathPct} % пути до ${goal.name}` : ''}`,
    actions: { primary: 'Оставить', secondary: 'Отписаться', ghost: 'Подумать' },
    cancel: KEEP_CANCEL,
  }
}

/** Шаг «Отписаться» карточки подписки — одинаково на главном и в «Неделе» (ревью Блока 3, Н-4). */
const KEEP_CANCEL = {
  inner: 'Подписка уйдёт из бюджета и планов у вас обоих. Отключить её в самом сервисе нужно отдельно.',
  actions: { primary: 'Отменить подписку', ghost: 'Не сейчас' },
}

/** Карточка «оставить подписку?» (`keepCard`): вопрос, детали, ответы и шаг отмены. */
export type KeepCard = {
  question: string
  meta: string
  inner: string
  actions: { primary: string; secondary: string; ghost: string }
  cancel: { inner: string; actions: { primary: string; ghost: string } }
}

/**
 * «Остались деньги?» (Р-19) — тексты карточки конца месяца `key`, одни на главном и в «Неделе»
 * (ревью Блока 3, Н-4; в DESIGN §6 их нет — вариант главного).
 */
export const monthEndCard = (key: string) => ({
  question: `Остались деньги с ${monthFrom(key, false)}?`,
  meta: 'Месяц заканчивается — отложим остаток по очереди целей',
  actions: { primary: 'Отложить', ghost: 'Не сейчас' },
})

export type FreeByFact = {
  /** «Свободно до конца месяца», целые тенге; может быть меньше нуля. */
  amount: number
  /** true — по факту выписок; false — по плану (за месяц ни одной загрузки). */
  byFact: boolean
  income: number
  /** Обязательства и кредиты месяца по плану (с учётом отметок). */
  dues: number
  /** Взносы в цели по плану (и досрочки по плану «Сначала долги»). */
  goals: number
  /** Траты по выпискам обоих за месяц, кроме разделов, уже учтённых планом. */
  spent: number
  /** Доля свободного от дохода, 0…1 — полоса карточки. */
  share: number
}

/**
 * «Свободно до конца месяца» по факту выписок обоих (Р-8): доход месяца − обязательства и
 * кредиты по плану (`monthDues`, отметки учтены один раз — сумма из отметки) − взносы в
 * цели по плану и разложенное сверх плана (`allocatedBeyondPlan`, хвост 951) − траты по выпискам за месяц,
 * кроме разделов `plannedElsewhere` (кредиты, коммуналка, аренда, подписки — они уже в `monthDues`). Ни одной
 * загрузки за месяц — план (`budgetAmounts.free`) за вычетом разложенного сверх плана, с `byFact: false`.
 */
export function freeByFact(
  state: {
    categories?: Category[]
    obligations?: Obligation[]
    credits?: Credit[]
    goals?: Goal[]
    people?: Person[]
    payments?: Payment[]
    plans?: DebtPlan[]
    moneyArticles?: MoneyArticle[]
    spendPlans?: SpendPlan[]
    spendCategories?: SpendCategory[]
    book?: RateBook | null
    fxExchanges?: FxExchange[]
    /** Раскладки (хвост 951): разовые взносы и досрочка сверх плана уменьшают «Свободно» (`allocatedBeyondPlan`). */
    allocations?: Allocation[]
  },
  totals: SpendTotal[],
  spendCategories: SpendCategory[],
  key: string,
  uploads: UploadPeriod[] = [],
): FreeByFact {
  const income = totalIncome(state.people ?? [], key, salaryCtxOf(state))
  const share = (amount: number) => (income > 0 ? Math.max(0, Math.min(1, amount / income)) : 0)
  const amounts = budgetAmounts(state)
  const beyond = allocatedBeyondPlan(state, key, amounts.planExtra)
  const goals = amounts.d3 + amounts.planExtra + beyond
  const spent = monthSpentByFact(totals, spendCategories, key, uploads)
  if (spent === null) {
    const amount = amounts.d5 - beyond
    return { amount, byFact: false, income, dues: amounts.d1 + amounts.d2, goals, spent: 0, share: share(amount) }
  }
  const dues = duesTotal(monthDues(state, key))
  const amount = income - dues - goals - spent
  return { amount, byFact: true, income, dues, goals, spent, share: share(amount) }
}

/** Статьи разбора, которые «Свободно» уже считает: платежи — `dues`, «Жизнь» и «Траты» — траты, «Мечты» — взносы целей. */
const COUNTED_ARTICLES: readonly string[] = ['must', 'life', 'spend', 'dreams'] satisfies ArticleKey[]

/**
 * Сколько разложено в месяце `key` сверх плана (хвост 951) — «Свободно» уменьшается на эту сумму. Берутся живые
 * раскладки зарплаты и остатка месяца (`freed` — нет: он уже в плане прибавкой к взносу). Правило учёта, без двойного
 * счёта с плановым взносом:
 * - часть в цель — сколько по всем записям месяца легло в цель сверх её взноса в плане (`monthly`; цель на паузе
 *   плана «Сначала долги» — 0): «Отложить по плану» кладёт не больше взноса и ничего не добавляет;
 * - досрочка (`prepay:<id>`) — сверх «Досрочно по плану» (`planExtra`); без плана — вся;
 * - статья разбора (старые записи Блока 11) — кроме уже посчитанных (`COUNTED_ARTICLES`).
 * Запись не-плана одного источника — последняя (`allocationFor`); записей плана за месяц бывает несколько — все.
 */
export function allocatedBeyondPlan(
  state: { allocations?: Allocation[]; goals?: Goal[]; plans?: DebtPlan[] },
  key: string,
  planExtra: number,
): number {
  const month = (state.allocations ?? []).filter((a) => !a.deletedAt && a.period === key && (a.source === 'salary' || a.source === 'rest'))
  // Последняя — среди записей не-плана: запись плана того же источника позже её не вытесняет (критик ML-02).
  const loose = month.filter((a) => a.kind !== 'plan')
  const records = month.filter((a) => a.kind === 'plan' || allocationFor(loose, a) === a)
  const goals = new Map(liveGoals(state.goals ?? []).map((g) => [g.id, g])) // Сбылось (PN-13): все живые — записи истории могут ссылаться на сбывшуюся
  const plan = activePlan(state.plans ?? [])
  const paused = new Set(plan ? pausedGoals(plan, state.goals ?? []).map((g) => g.id) : [])
  const toGoal = new Map<string, number>()
  let prepay = 0
  let articles = 0
  for (const a of records) {
    for (const p of a.parts) {
      if (p.target.startsWith('prepay:')) prepay += p.amount
      else if (a.kind === 'breakdown') articles += COUNTED_ARTICLES.includes(p.target) ? 0 : p.amount
      else if (goals.has(p.target)) toGoal.set(p.target, (toGoal.get(p.target) ?? 0) + p.amount)
    }
  }
  let beyond = Math.max(0, prepay - planExtra) + articles
  for (const [id, put] of toGoal) beyond += Math.max(0, put - (paused.has(id) ? 0 : goals.get(id)!.monthly))
  return beyond
}

/**
 * Траты месяца по выпискам обоих, кроме разделов, уже учтённых планом (`plannedElsewhere`:
 * кредиты, коммуналка, аренда, подписки живут в `monthDues`). Вызывает её `freeByFact` — вычитает из плана
 * (виджета «Траты» в «Деньгах» больше нет, Блок 15).
 * `null` — за месяц ни одной загрузки: факта нет, а не «потрачено 0».
 */
export function monthSpentByFact(totals: SpendTotal[], spendCategories: SpendCategory[], key: string, uploads: UploadPeriod[] = []): number | null {
  if (!monthUploaded(key, uploads)) return null
  const live = spendCategories.filter(alive)
  return totals
    .filter((t) => !t.deletedAt && t.kind === 'month' && t.period === key && t.amount > 0)
    .reduce((a, t) => a + factOf(t, live), 0)
}

export type DecisionKind = 'match' | 'unknownBatch' | 'keep' | 'monthEnd'

/** Вопрос листа «! N» «Недели» (`decisionQueue`): тексты DESIGN.md §6, ключ и данные для ответа на месте. */
export type Decision = {
  kind: DecisionKind
  /** Ключ вопроса — «Потом» откладывает его до следующего открытия, «N из M» считает по нему. */
  key: string
  question: string
  meta: string
  /** Строка внутренней карточки (детали) — если есть. */
  inner?: string
  actions: { primary?: string; secondary?: string; ghost?: string }
  /** Шаг «Отписаться» вопроса «оставить?» (`keepCard`). */
  cancel?: KeepCard['cancel']
  /** Подписка вопроса «оставить?». */
  obligation?: Obligation
  /** Ждущее сопоставление операции с отметкой (Р-6). */
  match?: MatchCandidate
  /** Незнакомые продавцы пачкой (Р-58) — по сумме, сначала крупные. */
  groups?: UnknownGroup[]
}

/**
 * Вопросы «Недели» за «! N» (Р-97) — отбор и порядок: «то же самое?» — сопоставления (по одному на каждое ждущее) →
 * незнакомые продавцы — одной пачкой (Р-58; группы ищет экран по своим операциям) → «оставить подписку?»
 * (`keepQuestions`) → «остались деньги?» (`monthEndAsk`, пока остаток месяца не отложен). «Пришла зарплата»,
 * «пришла?» и «освободится N ₸» — не вопросы «Недели»: это дела «Месяца» (✓ у зарплаты, «Отложил» у целей —
 * `planPuts`, подсказка у платежа — `planExtras`). Отложенные («Потом») убирает экран. Viewer (`canEdit` false)
 * вопросов не видит (Р-50).
 */
export function decisionQueue(
  state: DecisionState,
  ctx: {
    canEdit?: boolean
    matches?: MatchCandidate[]
    unknown?: UnknownGroup[]
    answeredMonthEnd?: string | null
    now?: { day: number; key: string }
    /** Неделя пачки «Без раздела» (FB-01, Р-15 а): ключ `unknownBatch:<неделя>` — «Потом» новой недели не прячет. */
    week?: string
  },
): Decision[] {
  if (ctx.canEdit === false) return []
  const now = ctx.now ?? today()
  const payments = state.payments ?? []
  const out: Decision[] = []

  for (const c of ctx.matches ?? []) {
    out.push({
      kind: 'match',
      key: `match:${c.kind}:${c.targetId}:${c.period}`,
      question: c.question,
      meta: c.meta,
      actions: c.kind === 'salary' ? { primary: 'Да, зарплата', secondary: 'Нет', ghost: 'Потом' } : { primary: 'Да, отметить', secondary: 'Нет, это другое', ghost: 'Потом' },
      match: c,
    })
  }

  // Все незнакомые — одно решение-пачка (Р-58): ключ — с неделей (FB-01): «Потом» откладывает пачку этой недели, «N из M»
  // считает её одной.
  const unknown = [...(ctx.unknown ?? [])].sort((a, b) => b.amount - a.amount)
  if (unknown.length) {
    out.push({
      kind: 'unknownBatch',
      key: ctx.week ? `unknownBatch:${ctx.week}` : 'unknownBatch',
      question: `Без раздела · ${unknown.length}`,
      meta: money(amountTotal(unknown)),
      actions: { ghost: 'Потом' },
      groups: unknown,
    })
  }

  const { year, month } = parseMonthKey(now.key)
  for (const o of keepQuestions(state.obligations ?? [], new Date(Date.UTC(year, month, now.day, 12)), state.book)) {
    out.push({ kind: 'keep', key: `keep:${o.id}`, ...keepCard(o, state.goals ?? [], payments, now, state.book, state), obligation: o })
  }

  // Ответ — до конца месяца на устройстве (`answeredMonthEnd`); отложенный остаток — ответ семьи: партнёр второй раз не спрашивается.
  const restDone = allocationFor(state.allocations, { source: 'rest', sourceId: now.key, period: now.key })
  if (!restDone && monthEndAsk(ctx.answeredMonthEnd ?? null, now)) {
    out.push({ kind: 'monthEnd', key: `monthEnd:${now.key}`, ...monthEndCard(now.key) })
  }

  return out
}

/* ---------------- вопросы «Недели»: состояние; старые записи разбора (Блок 11, Р-85) ---------------- */

/** Документ семьи для вопросов «Недели» и листа отметки зарплаты; кредиты — производные остатки, как их отдаёт стор. */
export type DecisionState = {
  people?: Person[]
  obligations?: Obligation[]
  credits?: Credit[]
  goals?: Goal[]
  payments?: Payment[]
  plans?: DebtPlan[]
  allocations?: Allocation[]
  moneySettings?: MoneySettings | null
  /** Очередь денег (Р-84): герой карточки «оставить подписку?» — первая цель очереди. */
  goalOrder?: QueueOrder | null
  /** Книга курсов и обмены (Р-74): тенге валютных зарплат — `salaryTenge`. */
  book?: RateBook | null
  fxExchanges?: FxExchange[]
  /** План месяца для «Пришла зарплата» (`salaryToAllocate`, ревью frontend Б14 Н-1): траты каждого, карточка долга, разделы. */
  spendPlans?: SpendPlan[]
  debtCard?: DebtCard | null
  spendCategories?: SpendCategory[]
}

/**
 * Старая запись разбора по статьям (Блок 11) — для «Истории» как была (Р-85): части статей в постоянном порядке
 * статей и остаток записи. Записи плана месяца (`kind: 'plan'`) делятся по целям — не здесь.
 */
export function articleParts(rec: Pick<Allocation, 'parts' | 'total'>) {
  const parts = ARTICLE_ORDER.map((key) => ({ key, amount: rec.parts.filter((p) => p.target === key).reduce((s, p) => s + p.amount, 0) })).filter(
    (p) => p.amount > 0,
  )
  return { parts, rest: Math.max(0, rec.total - parts.reduce((s, p) => s + p.amount, 0)) }
}

/* ---------------- Поездка с бюджетом (понятность, Блок 9: Р-14) ---------------- */

export type TripStatus = 'none' | 'before' | 'during' | 'after'

/** Где поездка относительно дня `today` (`YYYY-MM-DD`): даты включительно; нет обеих дат — `none` (копим как обычно). */
export function tripStatus(goal: Pick<Goal, 'from' | 'to'>, today: string = todayIso()): TripStatus {
  if (!goal.from || !goal.to) return 'none'
  if (today < goal.from) return 'before'
  return today > goal.to ? 'after' : 'during'
}

/**
 * Свои траты поездки: списания (не переводы между своими, `isSpend`) с `from` по `to` включительно, кроме платежей и
 * подписок по отметкам (`marked` — `markedOps`) и снятых с поездки (`excluded`). Новые первыми.
 */
export function tripOps(
  ops: Operation[],
  goal: Pick<Goal, 'from' | 'to'>,
  marked: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): Operation[] {
  const { from, to } = goal
  if (!from || !to) return []
  return ops
    .filter((op) => isSpend(op) && op.date >= from && op.date <= to && !marked.has(op.id) && !excluded.has(op.id))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

/** Сумма трат (положительная, целые тенге) и число строк. */
export function tripTotal(ops: Pick<Operation, 'amount' | 'refund'>[]): { amount: number; ops: number } {
  return { amount: ops.reduce((s, op) => s + Math.round(spendOf(op)), 0), ops: ops.length }
}

export type TripSpent = {
  total: number
  /** У кого есть траты, в порядке участников семьи. */
  byPerson: { person: PersonId; name: string; amount: number }[]
  budget: number
}

/** Итог поездки семьи из записей `tripSpends` (каждый телефон — своя); бюджет — `budget`, пусто — сумма мечты. */
export function tripSpent(goal: Pick<Goal, 'id' | 'need' | 'budget'>, tripSpends: TripSpend[] | undefined, people: Person[]): TripSpent {
  const mine = (tripSpends ?? []).filter((t) => t.goalId === goal.id && !t.deletedAt)
  const byPerson = people
    .filter(alive)
    .map((p) => ({ person: p.id, name: p.name, amount: mine.filter((t) => t.by === p.id).reduce((s, t) => s + t.amount, 0) }))
    .filter((x) => x.amount > 0)
  return { total: mine.reduce((s, t) => s + t.amount, 0), byPerson, budget: goal.budget ?? goal.need }
}

/* ---------------- образы трат (Р-24…Р-31, AU-28) ---------------- */

/** Перенос «в мечту» — доля привычки (Р-27, дефолт AU-28), вниз до 1 000 ₸. */
export const IMAGE_MOVE_SHARE: Partial<Record<HabitId, number>> = { delivery: 50, lunch: 40, marketplace: 50 }
/** «Окупится» — не дольше (Р-30). */
export const PAYBACK_MAX_MONTHS = 12
/** Привычка — в каждом из стольких закрытых месяцев подряд (Р-30). */
export const IMAGE_MONTHS = 3

/** Как привычка называется в строке и в «Как посчитали». */
export const HABIT_NAMES: Record<HabitId, string> = {
  taxi: 'Такси', coffee: 'Кофе навынос', delivery: 'Доставка', lunch: 'Обеды в будни', marketplace: 'Мелкие покупки',
}

/** Цена образа: своя мечта / желание семьи (Р-26) или мерка справочника. */
export type ImagePrice =
  | { from: 'goal'; goalId: string; name: string; price: number }
  | { from: 'wish'; wishId: string; name: string; price: number }
  | { from: 'ref'; id: PriceId; name: string; price: number }

export type ImageAction =
  | { kind: 'goal'; name: string; need: number; monthly: number; template: string }
  | { kind: 'wish'; name: string; price: number }
  | { kind: 'move'; categoryId: string; goalId: string; goalName: string; amount: number; days: number | null }
  | { kind: 'faster' }

export type HabitImage = {
  habit: HabitId
  categoryId: string
  /** Сумма семьи за месяц — среднее 3 закрытых месяцев, целые ₸. */
  monthly: number
  /** Операций в месяц — среднее, целое. */
  count: number
  /** `save` — накопить без кредита (Р-25), `payback` — окупится, `dream` — сумма за год образом. */
  kind: 'save' | 'payback' | 'dream'
  /** Цена; `dream` без мечты и без мерки дешевле суммы за год — null (строка — сумма). */
  price: ImagePrice | null
  /** `save`: сколько собрать (цена или остаток своей мечты «Машина»). */
  left: number | null
  /** `save` — месяцев накопления; `payback` — месяцев окупаемости. */
  months: number | null
  /** `payback`: расход дома в месяц (зерно, молоко) и экономия в месяц. */
  cost: number | null
  saving: number | null
  /** `dream`: сумма за год и доля мечты семьи, целые %. */
  yearly: number | null
  share: number | null
  action: ImageAction | null
  /** «Перенести в мечту» уже сделан на эту мечту (запись `imageMoves`, Х-9) — сколько в месяц; кнопки тогда нет. */
  moved: number | null
}

export type InterestImage = { yearly: number; perMonth: number; price: ImagePrice | null; action: { kind: 'faster' } }

type ImageState = {
  people?: Person[]
  goals?: Goal[]
  wishlist?: WishItem[]
  habitTotals?: HabitTotal[]
  imageMoves?: ImageMove[]
  goalOrder?: QueueOrder | null
  moneySettings?: MoneySettings | null
}

/** Мерка справочника — самая дорогая, что по карману сумме `amount`; дешевле суммы нет — null. */
export function measureFor(amount: number): ImagePrice | null {
  const fit = MEASURES.map((id) => PRICES[id]).filter((p) => p.price <= amount).sort((a, b) => b.price - a.price)[0]
  return fit ? { from: 'ref', id: fit.id, name: fit.name, price: fit.price } : null
}

/** Расход кофемашины на чашку, целые ₸ (зерно + молоко, `COFFEE_CUP`). */
export function coffeeCupCost(): number {
  const c = COFFEE_CUP
  return Math.round((c.beansPerKg * c.beansGrams) / 1000 + (c.milkPerLiter * c.milkMl) / 1000)
}

/** На сколько дней раньше соберём мечту при темпе +`amount` в месяц — рекомендация «Трат» (AU-01) и перенос образа (AU-29). */
export function earlierDays(goal: Goal, key: string, amount: number): number | null {
  const pace = goalPace(goal, key)
  const remaining = goalRemaining(goal)
  return pace > 0 && remaining > 0 && amount > 0 ? Math.round((remaining / pace - remaining / (pace + amount)) * 30.4) : null
}

/**
 * Образы трат семьи (Р-24, AU-28): по разделу один — самый крупный по сумме. Привычка — только при итоге семьи в каждом
 * из 3 закрытых месяцев до `key` (Р-30); сумма — среднее этих месяцев. Такси → накопить на машину (мечта «Машина» семьи
 * или `car_used`; без кредита, Р-25); кофе → кофемашина окупится (> 12 месяцев или расход ≥ трат — образа нет); доставка,
 * обеды, покупки → сумма за год долей первой мечты очереди или меркой; перенос — доля привычки (`IMAGE_MOVE_SHARE`).
 */
export function habitImages(state: ImageState, key: string): HabitImage[] {
  const live = new Set((state.people ?? []).filter(alive).map((p) => p.id))
  const months = Array.from({ length: IMAGE_MONTHS }, (_, i) => addMonths(key, -(i + 1)))
  const totals = (state.habitTotals ?? []).filter((t) => !t.deletedAt && live.has(t.by) && t.count > 0 && t.amount > 0 && months.includes(t.period))
  const goals = openGoals(state.goals ?? []).filter((g) => !g.fund)
  const main = mainGoal(state.goals ?? [], state.goalOrder, state.moneySettings)
  const images: HabitImage[] = []
  for (const h of HABITS) {
    const mine = totals.filter((t) => t.habit === h.id)
    if (!months.every((m) => mine.some((t) => t.period === m))) continue
    const monthly = Math.round(mine.reduce((s, t) => s + t.amount, 0) / IMAGE_MONTHS)
    const count = Math.round(mine.reduce((s, t) => s + t.count, 0) / IMAGE_MONTHS)
    const base = { habit: h.id, categoryId: h.categoryId, monthly, count, left: null, months: null, cost: null, saving: null, yearly: null, share: null, moved: null }
    if (h.id === 'taxi') {
      const car = goals.find((g) => g.need > 0 && (templateById(g.template)?.type === 'car' || /машин|авто/i.test(g.name)))
      const price: ImagePrice = car
        ? { from: 'goal', goalId: car.id, name: car.name, price: car.need }
        : { from: 'ref', id: 'car_used', name: PRICES.car_used.name, price: PRICES.car_used.price }
      const left = car ? goalRemaining(car) : price.price
      if (left <= 0) continue
      const action: ImageAction | null = car ? null : { kind: 'goal', name: 'Машина', need: price.price, monthly, template: 'car' }
      images.push({ ...base, kind: 'save', price, left, months: Math.ceil(left / monthly), action })
    } else if (h.id === 'coffee') {
      const wish = (state.wishlist ?? []).find((w) => alive(w) && !w.bought && w.price > 0 && /кофемашин/i.test(w.name))
      const price: ImagePrice = wish
        ? { from: 'wish', wishId: wish.id, name: wish.name, price: wish.price }
        : { from: 'ref', id: 'coffee_machine', name: PRICES.coffee_machine.name, price: PRICES.coffee_machine.price }
      const cost = count * coffeeCupCost()
      const saving = monthly - cost
      if (saving <= 0) continue
      const payback = Math.ceil(price.price / saving)
      if (payback > PAYBACK_MAX_MONTHS) continue
      const action: ImageAction | null = wish ? null : { kind: 'wish', name: 'Кофемашина', price: price.price }
      images.push({ ...base, kind: 'payback', price, months: payback, cost, saving, action })
    } else {
      const yearly = monthly * 12
      const dream = main && main.need > 0 ? main : null
      const price: ImagePrice | null = dream ? { from: 'goal', goalId: dream.id, name: dream.name, price: dream.need } : measureFor(yearly)
      const amount = Math.floor((monthly * (IMAGE_MOVE_SHARE[h.id] ?? 0)) / 100 / 1000) * 1000
      // Перенос на эту мечту уже сделан (Х-9) — вместо кнопки «✓ N в мечту»; новая мечта первой — кнопка снова. Два
      // телефона до синка перенесли оба — урезано дважды, ✓ показывает сумму.
      const done = dream ? (state.imageMoves ?? []).filter((m) => !m.deletedAt && m.categoryId === h.categoryId && m.goalId === dream.id) : []
      const moved = done.reduce((s, m) => s + m.amount, 0)
      const action: ImageAction | null =
        dream && amount >= 1000 && !moved
          ? { kind: 'move', categoryId: h.categoryId, goalId: dream.id, goalName: dream.name, amount, days: earlierDays(dream, key, amount) }
          : null
      images.push({ ...base, kind: 'dream', price, yearly, share: dream ? Math.round((yearly * 100) / dream.need) : null, action, moved: moved || null })
    }
  }
  // Один образ на раздел — самый крупный по сумме.
  const best = new Map<string, HabitImage>()
  for (const img of images) if ((best.get(img.categoryId)?.monthly ?? -1) < img.monthly) best.set(img.categoryId, img)
  return [...best.values()].sort((a, b) => b.monthly - a.monthly)
}

/**
 * «Перенести в мечту» каждый месяц (Р-27, AU-29): откуда урезать — постоянный план раздела участника с бо́льшим планом
 * (`SpendPlan`, не сдвиги месяца); новый план — не ниже 0. Плана раздела нет ни у кого — null (только взнос).
 */
export function imageMoveFrom(
  state: { people?: Person[]; spendPlans?: SpendPlan[] },
  categoryId: string,
  amount: number,
): { by: PersonId; plan: number; next: number } | null {
  const live = new Set((state.people ?? []).filter(alive).map((p) => p.id))
  const top = (state.spendPlans ?? [])
    .filter((s) => !s.deletedAt && live.has(s.by) && s.categoryId === categoryId && s.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.by.localeCompare(b.by))[0]
  return top ? { by: top.by, plan: top.amount, next: Math.max(0, top.amount - amount) } : null
}

/** Проценты банку за год (Р-24): `budgetInterest × 12` → мерка; процентных долгов нет — null. Кредиты — производные. */
export function interestImage(state: { credits?: Credit[] }): InterestImage | null {
  const perMonth = budgetInterest(state.credits ?? [])
  if (perMonth <= 0) return null
  const yearly = perMonth * 12
  return { yearly, perMonth, price: measureFor(yearly), action: { kind: 'faster' } }
}

/** «4 года 4 месяца» / «9 месяцев» / «2 года». */
export function yearsMonths(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  const ys = y ? `${y} ${plural(y, 'год', 'года', 'лет')}` : ''
  const ms = m ? `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')}` : ''
  return [ys, ms].filter(Boolean).join(' ') || '0 месяцев'
}

/** Строка-образ (черновик слов, финал — `/ux`); `goalName: false` — «N % мечты» без имени (в плашке, где мечта названа, Х-10). */
export function imageLine(image: HabitImage | InterestImage, { goalName = true } = {}): string {
  if (!('habit' in image)) return `За год банку уходит ${image.price ? image.price.name : money(image.yearly)}`
  const name = HABIT_NAMES[image.habit]
  const p = image.price
  if (image.kind === 'save') {
    return `${name} за ${yearsMonths(image.months!)} — ${p?.from === 'goal' ? `мечта «${p.name}»` : 'своя машина'} без долга`
  }
  if (image.kind === 'payback') return `${p?.from === 'wish' ? p.name : 'Кофемашина'} окупится за ${yearsMonths(image.months!)}`
  if (p?.from === 'goal') return `${name} за год — ${image.share} % мечты${goalName ? ` «${p.name}»` : ''}`
  return `${name} за год — ${p ? p.name : money(image.yearly!)}`
}

/** «Как посчитали» (Р-31): цена с источником и датой (или «из вашей мечты») и арифметика 2–3 строками. */
export type ImageMath = { item: string; source: { name: string; url: string } | null; checkedAt: string | null; lines: string[] }

export function imageMath(image: HabitImage | InterestImage): ImageMath {
  const p = image.price
  const ref = p?.from === 'ref' ? PRICES[p.id] : null
  const own = p && p.from !== 'ref' ? `цена из ${p.from === 'goal' ? 'вашей мечты' : 'ваших желаний'} «${p.name}» — ${money(p.price)}` : ''
  const item = ref ? `${ref.model} — ${money(ref.price)}` : own
  const out = (lines: string[]): ImageMath => ({ item, source: ref ? { name: ref.source, url: ref.url } : null, checkedAt: ref?.checkedAt ?? null, lines })
  const n = plain
  if (!('habit' in image)) {
    const lines = [`проценты в месяц: ${money(image.perMonth)} · за год: ${n(image.perMonth)} × 12 = ${money(image.yearly)}`]
    if (p) lines.push(`${n(image.yearly)} ≥ ${n(p.price)} — ${p.name}`)
    return out(lines)
  }
  const head = `${HABIT_NAMES[image.habit].toLowerCase()}: ${money(image.monthly)} в месяц, среднее за ${IMAGE_MONTHS} месяца`
  if (image.kind === 'save') {
    const left = p?.from === 'goal' ? `осталось ${n(image.left!)}` : n(image.left!)
    return out([head, `${left} ÷ ${n(image.monthly)} = ${image.months} ${plural(image.months!, 'месяц', 'месяца', 'месяцев')} — ${yearsMonths(image.months!)}`])
  }
  if (image.kind === 'payback') {
    const ratio = (p!.price / image.saving!).toFixed(1).replace('.', ',')
    return out([
      head,
      `дома: ${image.count} × ${n(coffeeCupCost())} = ${money(image.cost!)} (зерно ${COFFEE_CUP.beansGrams} г и молоко ${COFFEE_CUP.milkMl} мл на чашку)`,
      `${n(image.monthly)} − ${n(image.cost!)} = ${money(image.saving!)} в месяц · ${n(p!.price)} ÷ ${n(image.saving!)} = ${ratio} → ${yearsMonths(image.months!)}`,
    ])
  }
  const lines = [`${head} · за год: ${n(image.monthly)} × 12 = ${money(image.yearly!)}`]
  if (p?.from === 'goal') lines.push(`${n(image.yearly!)} ÷ ${n(p.price)} = ${image.share} % мечты «${p.name}»`)
  else if (p) lines.push(`${n(image.yearly!)} ≥ ${n(p.price)} — ${p.name}`)
  const a = image.action
  if (a?.kind === 'move') lines.push(`в мечту — ${IMAGE_MOVE_SHARE[image.habit]} % привычки: ${money(a.amount)} в месяц`)
  return out(lines)
}

/* ---------------- находки разбора v3 (бэклог «Разбор», Р-5, Р-13, Р-14, Р-19, Р-20, RZ-02) ---------------- */

/** Находок семьи в разборе — не больше (Р-14). */
export const REVIEW_FINDINGS_MAX = 12
/** Утечек семьи — не больше; продавец — с утечкой в ≥ 2 из 3 закрытых месяцев (Р-14). */
const LEAKS_MAX = 5
const LEAK_MONTHS = 3
const LEAK_MIN_MONTHS = 2
/** «Чаще»: операций раздела ≥ ×1,3 среднего по месяцам «обычно» (в десятых — без дробей). */
const OFTEN_TENTHS = 13
/**
 * Месяц находок — текущий, когда выписка хоть у кого-то дошла до 7-го числа; иначе прошлый: разбор 1-го числа говорит о
 * закрытом месяце, а не о дне нового (уточнение исполнителя RZ-02, Handoff).
 */
const FIND_MONTH_MIN_DAY = 7

/** Образ находки: доля месячного взноса в главную мечту или мерка справочника (`measureFor`). */
export type FindImage = { kind: 'dream'; goalId: string; name: string; share: number } | { kind: 'measure'; name: string; price: number }

/**
 * Находка семьи (Р-5): всё в целых тенге; `monthly` — цена в месяц (бэклог «Фидбек», Р-8, Р-19,
 * `memory/decisions/fb-review-monthly.md`): утечка — среднее за месяц, «раздуло» — прирост месяца, новое списание —
 * сумма, подорожание — разница (у годовой подписки — `every: 'year'`, разница раз в год — `amount − was`, а `monthly` —
 * её двенадцатая часть), двойное — лишние списания.
 */
export type ReviewFinding =
  | { kind: 'leak'; key: string; name: string; categoryId: string | null; monthly: number; count: number; months: number; image: FindImage | null }
  | {
      kind: 'grew'
      categoryId: string
      name: string
      amount: number
      usual: number
      growth: number
      monthly: number
      why: { kind: 'purchases'; items: { name: string; amount: number }[] } | { kind: 'often'; count: number; usualCount: number }
    }
  | { kind: 'recurring'; key: string; name: string; categoryId: string | null; amount: number; count: number; monthly: number }
  | { kind: 'pricier'; key: string; name: string; obligationId: string; amount: number; was: number; monthly: number; every?: 'year' }
  | { kind: 'double'; key: string; name: string; categoryId: string | null; amount: number; count: number; monthly: number }

/** Ключ находки участника — продавец или раздел после `участник:месяц:вид:`. */
export const findKey = (f: Pick<ReviewFind, 'id' | 'by' | 'period' | 'kind'>) => f.id.slice(f.by.length + f.period.length + f.kind.length + 3)

/** Месяц, о котором находки разбора месяца `ctx.key` (`FIND_MONTH_MIN_DAY`). */
export function findMonth(ctx: Pick<MonthPlanCtx, 'key' | 'uploads'>): string {
  const from = `${ctx.key}-01`
  const day = `${ctx.key}-${String(FIND_MONTH_MIN_DAY).padStart(2, '0')}`
  return ctx.uploads.some((u) => u.period_from.slice(0, 10) <= day && u.period_to.slice(0, 10) >= day && u.period_to.slice(0, 10) >= from)
    ? ctx.key
    : addMonths(ctx.key, -1)
}

/** Живые итоги находок живых участников с суммой. */
const liveFinds = (state: MonthPlanState) => {
  const people = new Set((state.people ?? []).filter(alive).map((p) => p.id))
  return (state.reviewFinds ?? []).filter((f) => !f.deletedAt && people.has(f.by) && f.count > 0 && f.amount > 0)
}

/** Самая крупная по `pick` запись на ключ (продавец двух участников — одна находка). */
function bestBy<T>(list: T[], key: (x: T) => string, pick: (x: T) => number): T[] {
  const out = new Map<string, T>()
  for (const x of list) {
    const prev = out.get(key(x))
    if (!prev || pick(x) > pick(prev)) out.set(key(x), x)
  }
  return [...out.values()]
}

/**
 * Находки семьи (Р-5, Р-14) по итогам участников в документе: утечки — по 3 закрытым месяцам до `ctx.key`; «что
 * раздуло», новые и подорожавшие списания, двойные — за месяц находок (`findMonth`). Все вместе — до 12: «раздуло» по
 * приросту, затем остальные по цене в месяц.
 */
export function reviewFindings(state: MonthPlanState, ctx: MonthPlanCtx): ReviewFinding[] {
  const finds = liveFinds(state)
  const people = (state.people ?? []).filter(alive)
  const named = liveSpendCategories(ctx.spendCategories)
  const main = mainGoal(state.goals ?? [], state.goalOrder, state.moneySettings)
  // Образ утечки — доля месячного взноса в главную мечту (темп `goalPace`); нет темпа — мерка по месячной сумме.
  const pace = main && main.need > 0 ? goalPace(main, ctx.key) : 0
  const dream = main && pace > 0 ? main : null

  // Утечки: продавец с записью в ≥ 2 из 3 закрытых месяцев; среднее по месяцам с записью.
  const closed = Array.from({ length: LEAK_MONTHS }, (_, i) => addMonths(ctx.key, -(i + 1)))
  const leakGroups = new Map<string, ReviewFind[]>()
  for (const f of finds) {
    if (f.kind !== 'leak' || !closed.includes(f.period)) continue
    const k = findKey(f)
    leakGroups.set(k, [...(leakGroups.get(k) ?? []), f])
  }
  const leaks: ReviewFinding[] = []
  for (const [key, list] of leakGroups) {
    const months = new Set(list.map((f) => f.period)).size
    if (months < LEAK_MIN_MONTHS) continue
    const monthly = Math.round(list.reduce((s, f) => s + f.amount, 0) / months)
    const count = Math.round(list.reduce((s, f) => s + f.count, 0) / months)
    const last = list.reduce((a, b) => (b.period > a.period ? b : a))
    const measure = dream ? null : measureFor(monthly)
    const image: FindImage | null = dream
      ? { kind: 'dream', goalId: dream.id, name: dream.name, share: Math.round((monthly * 100) / pace) }
      : measure
        ? { kind: 'measure', name: measure.name, price: measure.price }
        : null
    leaks.push({ kind: 'leak', key, name: last.name, categoryId: last.categoryId, monthly, count, months, image })
  }
  leaks.sort((a, b) => b.monthly - a.monthly)

  // «Что раздуло»: раздел выше обычного и почему — 1–2 крупные покупки или частота; без причины — не находка (Р-1).
  const month = findMonth(ctx)
  const mctx = { ...ctx, key: month }
  const grew: Extract<ReviewFinding, { kind: 'grew' }>[] = []
  const usualOf = usualMonths(people, ctx.totals, ctx.uploads, month)
  const opsOf = (categoryId: string, period: string) =>
    ctx.totals
      .filter((t) => !t.deletedAt && t.kind === 'month' && t.period === period && t.categoryId === categoryId && people.some((p) => p.id === t.by))
      .reduce((s, t) => s + t.ops, 0)
  for (const r of spendCompare(state, mctx).rows) {
    if (!r.over || SPEND_LAST.includes(r.categoryId) || r.amount === null || r.usual === null) continue
    const growth = r.amount - r.usual
    const items = finds
      .filter((f) => f.kind === 'top' && f.period === month && f.categoryId === r.categoryId)
      .flatMap((f) => f.top ?? [])
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
    const picked = items.slice(0, items[0] && items[0].amount * 2 >= growth ? 1 : 2)
    let why: Extract<ReviewFinding, { kind: 'grew' }>['why'] | null = null
    if (picked.length && picked.reduce((s, i) => s + i.amount, 0) * 2 >= growth) why = { kind: 'purchases', items: picked }
    else if (usualOf.length) {
      const count = opsOf(r.categoryId, month)
      const usualCount = Math.round(usualOf.reduce((s, m) => s + opsOf(r.categoryId, m), 0) / usualOf.length)
      if (usualCount > 0 && count * 10 >= usualCount * OFTEN_TENTHS) why = { kind: 'often', count, usualCount }
    }
    if (why) grew.push({ kind: 'grew', categoryId: r.categoryId, name: spendCategoryName(named, r.categoryId), amount: r.amount, usual: r.usual, growth, monthly: growth, why })
  }
  grew.sort((a, b) => b.growth - a.growth)

  // Списания месяца находок: по продавцу одна (большая сумма); новое регулярное того же продавца, что в плане, — мимо.
  const obligations = (state.obligations ?? []).filter(alive)
  const planned = new Set([...obligations, ...(state.credits ?? []).filter(alive)].map((x) => normalizeMerchant(x.name)))
  const dues: ReviewFinding[] = []
  const ofMonth = (kind: ReviewFind['kind']) =>
    bestBy(
      finds.filter((f) => f.kind === kind && f.period === month),
      findKey,
      (f) => f.amount,
    )
  for (const f of ofMonth('recurring')) {
    const key = findKey(f)
    if (planned.has(key) || planned.has(normalizeMerchant(f.name))) continue
    dues.push({ kind: 'recurring', key, name: f.name, categoryId: f.categoryId, amount: f.amount, count: f.count, monthly: f.amount })
  }
  for (const f of ofMonth('pricier')) {
    const o = obligations.find((x) => x.id === f.targetId)
    // Оценка («сумма плавает») — не цена: и запись телефона, который ещё не знает, что платёж стал оценкой.
    if (!o || o.estimate || f.was === undefined || f.amount <= f.was) continue
    // Годовая подписка: разница — раз в год (факт и подпись), в месяц — её двенадцатая часть (`yearShare`, как у
    // `plannedChange`): иначе сортировка и счётчик «в месяц» брали бы годовую разницу за месячную (критик FB-13).
    const diff = f.amount - f.was
    const yearly = o.every === 'year'
    dues.push({ kind: 'pricier', key: findKey(f), name: o.name, obligationId: o.id, amount: f.amount, was: f.was, monthly: yearly ? yearShare(diff) : diff, ...(yearly ? { every: 'year' as const } : {}) })
  }
  for (const f of ofMonth('double')) {
    if (f.count < 2) continue
    dues.push({ kind: 'double', key: findKey(f), name: f.name, categoryId: f.categoryId, amount: f.amount, count: f.count, monthly: f.amount * (f.count - 1) })
  }

  const rest = [...leaks.slice(0, LEAKS_MAX), ...dues].sort((a, b) => b.monthly - a.monthly)
  return [...grew, ...rest].slice(0, REVIEW_FINDINGS_MAX)
}

/** Сценарий «если… — мечта раньше» (Р-5 (4)): мечта — на сколько дней раньше; иначе долг — на сколько месяцев и процентов. */
export type ReviewScenario =
  | { finding: ReviewFinding; monthly: number; days: number; goalId: string; goalName: string }
  | { finding: ReviewFinding; monthly: number; months: number; saved: number; creditId: string; creditName: string }

/** Разделы, трату которых «убрать» нельзя — платёж кредита, аренда, коммуналка: сценария по ним нет (замер RZ-06). */
const SCENARIO_NOT: readonly string[] = ['sc_credit', 'sc_rent', 'sc_utilities']

/**
 * Сценарий по находке с наибольшей ценой в месяц среди утечек, новых и двойных списаний (кроме кредитов, аренды и
 * коммуналки): её `monthly` в главную мечту с темпом (`earlierDays`), иначе досрочкой в самый дорогой
 * процентный долг (`prepayOutcome`); иначе null.
 */
export function reviewScenario(state: MonthPlanState, ctx: MonthPlanCtx, findings: ReviewFinding[]): ReviewScenario | null {
  const finding = findings
    .filter((f) => (f.kind === 'leak' || f.kind === 'recurring' || f.kind === 'double') && !(f.categoryId && SCENARIO_NOT.includes(f.categoryId)))
    .sort((a, b) => b.monthly - a.monthly)[0]
  if (!finding) return null
  const monthly = finding.monthly
  const goal = mainGoal(state.goals ?? [], state.goalOrder, state.moneySettings)
  const days = goal ? earlierDays(goal, ctx.key, monthly) : null
  if (goal && days && days > 0) return { finding, monthly, days, goalId: goal.id, goalName: goal.name }
  const credit = costliestCredits(state.credits ?? [])[0]
  const out = credit ? prepayOutcome(credit, monthly, 'monthly') : null
  if (credit && out && (out.monthsSaved > 0 || out.saved > 0)) {
    return { finding, monthly, months: out.monthsSaved, saved: out.saved, creditId: credit.id, creditName: credit.name }
  }
  return null
}

/**
 * Счётчик работы ИИ (Р-8, Р-19): `ops` — операций всех участников за `ctx.key` и до 3 месяцев «обычно»; `found` — находок
 * семьи; `monthly` — сумма цен в месяц у находок советов (`used`, каждая один раз; бэклог «Фидбек», Р-19).
 */
export function reviewWork(
  state: MonthPlanState,
  ctx: MonthPlanCtx,
  findings: ReviewFinding[],
  used: ReviewFinding[] = findings,
): { ops: number; found: number; monthly: number } {
  const people = (state.people ?? []).filter(alive)
  const months = new Set([ctx.key, ...usualMonths(people, ctx.totals, ctx.uploads, ctx.key, 3)])
  const ops = ctx.totals
    .filter((t) => !t.deletedAt && t.kind === 'month' && months.has(t.period) && people.some((p) => p.id === t.by))
    .reduce((s, t) => s + t.ops, 0)
  return { ops, found: findings.length, monthly: [...new Set(used)].reduce((s, f) => s + f.monthly, 0) }
}

/** ₸ в месяц счётчика сохранённого разбора: разборы до «Фидбек» Р-19 хранят ₸ в год (`yearly`) — не переписываются. */
export function reviewWorkMonthly(work: { monthly?: number; yearly?: number }): number {
  return work.monthly ?? Math.round((work.yearly ?? 0) / 12)
}

/**
 * Строка «Куда ушло» (Р-4): раздел, факт, «обычно», план, доля полосы 0…1 от самой длинной полосы картинки, места рисок
 * «обычно» и плана на той же шкале (`usualShare`, `planShare`; нет числа или 0 — null) и `over` — выше обычного по тому же
 * порогу, что точка раздела на «Месяце» (`spendCompare`; полоса — `--warn`, RZ-08).
 */
export type WhereRow = {
  categoryId: string
  name: string
  amount: number
  usual: number | null
  plan: number | null
  share: number
  usualShare: number | null
  planShare: number | null
  over: boolean
}

/**
 * «Куда ушло» (Р-4) за месяц находок (`findMonth`): разделы `spendCompare` с фактом, без переводов людям и наличных, по
 * убыванию факта — до `n`; `share` — доля полосы от наибольшего из фактов, «обычно» и планов всех строк (геометрия, не
 * деньги). Текста нет — его пишет модель.
 */
export function whereRows(state: MonthPlanState, ctx: MonthPlanCtx, n = 5): WhereRow[] {
  const rows = spendCompare(state, { ...ctx, key: findMonth(ctx) })
    .rows.filter((r) => !SPEND_LAST.includes(r.categoryId) && r.amount !== null && r.amount > 0)
    .sort((a, b) => b.amount! - a.amount! || a.categoryId.localeCompare(b.categoryId))
  const max = Math.max(0, ...rows.flatMap((r) => [r.amount!, r.usual ?? 0, r.plan ?? 0]))
  const at = (v: number | null) => (v === null || max <= 0 ? null : v / max)
  return rows.slice(0, n).map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    amount: r.amount!,
    usual: r.usual,
    plan: r.plan,
    share: at(r.amount)!,
    // «Обычно» 0 (раздел новый) и план 0 — без риски: у левого края она читалась сбоем (`/ux` Блока 2).
    usualShare: r.usual ? at(r.usual) : null,
    planShare: r.plan ? at(r.plan) : null,
    over: r.over,
  }))
}

/** Итог прошлого месяца (Р-10, Р-20): советы «Сделать» — сделан / нет, разделы советов к «обычно», срок главной мечты. */
export type ReviewOutcome = {
  done: { title: string; done: boolean }[]
  sections: { categoryId: string; name: string; amount: number; usual: number | null }[]
  /** `was` / `now` — строки от одного месяца «сейчас»; `wasMonth` / `nowMonth` — ключи `YYYY-MM` для сравнения. */
  dream: { name: string; was: string; now: string | null; wasMonth: string; nowMonth: string | null } | null
}

/**
 * Итог прошлого месяца по его разбору v3 (Р-20): «Сделать» — `shiftMade` за тот месяц; разделы советов «Открыть»
 * (`cat`) — траты того месяца (`monthSpendByCategory`) и «обычно» на сегодня (`usualSpend`); главная мечта — срок из
 * присланного тогда факта «главная мечта … — срок» (`raw`) и сейчас (`goalTerm`), оба — от `ctx.key` (разбор декабря →
 * итог января: тот же срок — одна строка). Имя мечты в факте прошло `nm` (без «») и `maskNames` — сверка тем же путём.
 * Нет v3-разбора прошлого месяца — null.
 */
export function reviewOutcome(state: MonthPlanState, ctx: MonthPlanCtx, prev: AiReview | null): ReviewOutcome | null {
  if (!prev || prev.v !== 3 || prev.month !== addMonths(ctx.key, -1)) return null
  const advices = prev.advices ?? []
  const done = advices.flatMap((a) =>
    a.action.kind === 'do' ? [{ title: a.title, done: shiftMade(state.planShifts ?? [], { ...a.action.candidate.shift, period: prev.month }) }] : [],
  )
  const people = (state.people ?? []).filter(alive)
  const named = liveSpendCategories(ctx.spendCategories)
  const spent = monthSpendByCategory(people, ctx.totals, ctx.spendCategories, prev.month, ctx.uploads).rows
  const usual = usualSpend(people, ctx.totals, ctx.spendCategories, ctx.uploads, ctx.key)
  const cats = [...new Set(advices.flatMap((a) => (a.action.kind === 'open' && a.action.target.kind === 'cat' ? [a.action.target.id] : [])))]
  const sections = cats.map((id) => ({
    categoryId: id,
    name: spendCategoryName(named, id),
    amount: spent.find((r) => r.categoryId === id)?.amount ?? 0,
    usual: usual ? usual.amounts.get(id) ?? 0 : null,
  }))
  const goal = mainGoal(state.goals ?? [], state.goalOrder, state.moneySettings)
  const sent = prev.sent && 'facts' in prev.sent ? prev.sent.facts : []
  const asSent = goal ? maskNames(goal.name.replace(/[«»]/g, '').trim(), state.people ?? []).slice(0, 30) : ''
  const was = goal
    ? sent.find((f) => f.about.startsWith('главная мечта') && f.about.includes(asSent) && typeof f.raw === 'string' && /^\d{4}-\d{2}$/.test(f.raw))
    : undefined
  let dream: ReviewOutcome['dream'] = null
  if (goal && was) {
    const item = monthPlan(state, ctx).queue.find((q) => q.goalId === goal.id)
    const term = goalTerm(item, goal, ctx.key)
    const wasMonth = was.raw as string
    const nowMonth = term.doneMonth ?? null
    dream = { name: goal.name, was: monthBy(wasMonth, ctx.key), now: nowMonth ? monthBy(nowMonth, ctx.key) : null, wasMonth, nowMonth }
  }
  return { done, sections, dream }
}
