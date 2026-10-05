import type { Account, Category, Credit, DebtPlan, Goal, Obligation, Payment, Person, PersonId, PlanForecast, WishItem, Allocation, AllocationPart, ArticleKey, MoneyArticle, MoneySettings, Currency, RateBook, FxExchange, ObligationVersion, QueueOrder, SpendPlan, DebtCard } from '@/types/finance'
import type { MatchCandidate } from '@/lib/statements/matching'
import type { UnknownGroup } from '@/lib/statements/model'
import { isSpend, normalizeCounterparty, normalizeMerchant } from '@/lib/statements/model'
import type { Operation, SpendCategory, SpendTotal } from '@/lib/statements/types'
import { DEFAULT_SPEND_CATEGORIES, UNKNOWN_CATEGORY, plannedElsewhere } from '@/lib/statements/dictionary'
import { STAT_NORMS } from '@/lib/statements/norms'
import { addDaysIso, addMonths, dayLabel, daysInMonth, isoIn, monthFrom, monthKey, parseMonthKey, today, todayIso, weekdayShort, weekKey, weekRange } from '@/lib/dates'
import { spendColor } from '@/lib/palette'
import { money, pct } from '@/lib/money'
/**
 * Расчётное ядро. Чистые функции: ни сети, ни состояния, ни ИИ.
 *
 * Все числа в приложении считаются ЗДЕСЬ. ИИ-советник, когда появится,
 * получает готовые результаты и только объясняет их словами — модель,
 * которой позволили считать аннуитет самой, ошибается, а ошибка в деньгах
 * стоит доверия ко всему приложению.
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
  const goals = liveGoals(opts.goals)
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
 * плавает. Аренду, кредиты и коммуналку «оставить?» не спрашиваем.
 */
export const isSubscription = (o: Obligation) => !o.group && o.category === 'd4' && !o.estimate;

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

/**
 * Оклад месяца в тенге (Р-70, Р-72). Тенговый — как записан. Валютный — по курсу Нацбанка на
 * день зарплаты месяца из книги (выходной — пятница; день ещё не наступил — последний курс
 * книги); книги или дня в ней нет — по курсу версии на момент ввода. Это оклад (форма, подписи);
 * тенге зарплаты месяца с обменами — `salaryTenge` (Р-74).
 */
export function salaryAt(p: Person, key = monthKey(), book?: RateBook | null): number {
  const s = salaryOf(p, key);
  if (s.currency === 'KZT') return s.amount;
  const rate = rateOn(book, s.currency, paydayIso(p, key), s.rate);
  return rate ? fxToTenge(s.amount, rate) : 0;
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
  const rateNow = rateOn(book, s.currency, paydayIso(p, key), s.rate);
  const rate = rateOn(book, s.currency, paydayIso(p, otherKey));
  if (!rateNow || !rate) return null;
  return {
    currency: s.currency,
    rateNow,
    rate,
    perUnit: Math.round(rate - rateNow),
    tenge: fxToTenge(s.amount, rate) - fxToTenge(s.amount, rateNow),
  };
}

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
    if (d) out.push({ key: k, day: paydayIso(p, k), rate: d.rate, tenge: d.tenge });
  }
  return out;
}

/** Ближайшее запланированное изменение оклада; `delta` — в тенге (валютный — по книге). */
export function nextSalaryChange(p: Person, key = monthKey(), book?: RateBook | null) {
  const future = (p.salaryVersions ?? [])
    .filter((x) => x.from > key)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!future.length) return null;
  return { ...future[0], currency: future[0].currency ?? 'KZT', delta: salaryAt(p, future[0].from, book) - salaryAt(p, key, book) };
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
    liveGoals(goals).length > 0 ||
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
  const goals = liveGoals(goalsList)
    .filter((g) => !paused.has(g.id))
    .reduce((a, g) => a + g.monthly, 0);
  const extra = plan ? planExtra(plan, goalsList, credits, payments, key) : 0;
  const living = livingPlan({ categories, moneyArticles: state.moneyArticles, spendPlans: state.spendPlans, spendCategories: state.spendCategories, people }) + other;
  const income = totalIncome(people, key, salaryCtxOf(state));
  const free = income - housing - debts - goals - living - extra;

  return { d1: housing, d2: debts, d3: goals, d4: living, d5: free, income, planExtra: extra };
}

export const goalSavings = (goals: Goal[]) =>
  liveGoals(goals)
    .filter((g) => !g.accountId)
    .reduce((a, g) => a + Math.max(0, g.have), 0);

/** Сумма строк с `amount` в тенге: живые счета (итог «Счетов»), досрочки месяца и т. п. — одно правило. */
export const amountTotal = (list: { amount: number }[]) => list.reduce((a, x) => a + x.amount, 0);

export const netWorth = (accounts: Account[], credits: Credit[], goals: Goal[] = []) =>
  amountTotal(liveAccounts(accounts)) +
  goalSavings(goals) -
  liveCredits(credits).reduce((a, c) => a + c.principal, 0);

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
  return p ? salaryTenge(p, period, salaryCtxOf(state)).tenge : record.amount;
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
 * «Что гасить первым» (квадрат «План», пивот 3, Р-34; бывшая секция Капитала): долги с процентами
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
  const dayIn = (k: string, p: Person) => Math.min(p.payday, daysInMonth(k));

  // Ближайшая непришедшая зарплата: этого месяца — с сегодняшнего дня, затем следующих.
  const slots: { p: Person; k: string; inDays: number; day: number }[] = [];
  let passed = daysInMonth(key) - now.day;
  for (let i = 0; i <= PAYDAY_HORIZON; i++) {
    const k = addMonths(key, i);
    for (const p of people) {
      const day = dayIn(k, p);
      if (i === 0) {
        if (day >= now.day) slots.push({ p, k, inDays: day - now.day, day });
      } else {
        slots.push({ p, k, inDays: passed + day, day });
      }
    }
    if (i > 0) passed += daysInMonth(k);
  }
  slots.sort((a, b) => a.inDays - b.inDays);
  const slot = slots.find((s) => !paidFor(payments, 'salary', s.p.id, s.k));
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
    income: salaryTenge(who, nextKey, salaryCtxOf(state)).tenge,
    inDays,
    day: slot.day,
    key: nextKey,
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
  if (salaryOf(p, period).amount <= 0 || paidFor(payments, 'salary', p.id, period)) return false;
  const day = Math.min(p.payday, daysInMonth(period));
  if (period === now.key) return now.day >= day - SALARY_EARLY_DAYS;
  if (period === addMonths(now.key, 1)) return daysInMonth(now.key) - now.day + day <= SALARY_EARLY_DAYS;
  return false;
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
  return near && near.who.id === me && salaryOpen(near.who, state.payments ?? [], near.key, now) ? near : null;
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

  for (const g of liveGoals(state.goals ?? [])) {
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
  const found = record ?? months.map((k) => paidFor(payments, 'salary', me, k)).find(Boolean)
  // Ручная тенговая сразу ведёт в план месяца; валютная (B2C-79) — сначала «Обменял» на этой карточке.
  if (!found || found.kind !== 'salary' || found.targetId !== me || (found.source !== 'statement' && !found.foreign) || found.amount <= 0) return null
  if (allocationFor(state.allocations, { source: 'salary', sourceId: me, period: found.period })) return null
  const plan = monthPlan(state, { key: found.period, totals: [], spendCategories: state.spendCategories ?? [], uploads: [] })
  if (!planSave(plan, me)) return null
  return { person, period: found.period, record: found }
}

/**
 * «Пришла зарплата <имя>?» (RP-10) — тексты карточки ближайшей зарплаты (`salaryAsk`), одни на
 * главном и в «Неделе» (ревью Блока 3, Н-23).
 */
export const salaryCard = (near: { who: Person; income: number; day: number; key: string }) => ({
  question: `Пришла зарплата ${near.who.name}?`,
  meta: `${money(near.income)} · ${dayLabel(near.day, near.key)}`,
})

/** «Освободится N ₸ в месяц» — один текст для очереди «Недели» и карточки «Денег» (ревью Блока 10, Н-4). */
export const freedQuestion = (freed: Pick<FreedChange, 'monthly'>) => `Освободится ${money(freed.monthly)} в месяц`

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
  const records = countedPayments(state.payments ?? []).filter((p) => p.period === key);
  const scheduled = records.filter((p) => p.kind === 'obligation' || p.kind === 'credit');
  const liveIds = new Set(liveCredits(state.credits ?? []).map((c) => c.id));
  const prepays = records.filter((p) => p.kind === 'prepay' && liveIds.has(p.targetId));

  const inMonth = (iso: string) => monthKey(new Date(iso)) === key;
  let toGoals = 0;
  let fromGoals = 0;
  let closest: MonthSummary['closest'] = null;
  let closestHave = -1;
  for (const g of liveGoals(state.goals ?? [])) {
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
    income: records.filter((p) => p.kind === 'salary').reduce((a, p) => a + paidTenge(state, p.targetId as PersonId, key, p), 0),
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
    sums.set(id, (sums.get(id) ?? 0) - o.amount);
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

/** Сколько месяцев от `from` до `to` («2026-09» → «2027-05» = 8); отрицательное — 0. */
export function monthsBetween(from: string, to: string): number {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  return Math.max(0, (b.year - a.year) * 12 + (b.month - a.month))
}

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
  liveGoals(goals).filter((g) => !plan.keptGoalIds.includes(g.id) && g.id !== plan.cushionGoalId)

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

  const cushion = liveGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId)
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
 * Прогноз плана одной строкой квадрата «План» (пивот 3, Р-34): те же два прогона, что у
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
  const cushion = liveGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId)
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

/** Сколько положили в цель за месяц `period`. */
const goalPutIn = (g: Goal, period: string) =>
  (g.movements ?? [])
    .filter((m) => m.amount > 0 && monthKey(new Date(m.date)) === period)
    .reduce((a, m) => a + m.amount, 0)

/** План и факт по месяцам (Р-6): с месяца старта по `key` включительно. */
export function planMonths(plan: DebtPlan, state: PlanState, key: string): PlanMonth[] {
  const payments = state.payments ?? []
  const start = planStartMonth(plan)
  const steps = planFact(plan, payments).steps
  const step = planStep(plan, state, key)
  const due = stepDue(step)?.amount ?? 0
  const cushion = liveGoals(state.goals ?? []).find((g) => g.id === plan.cushionGoalId)
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
 * старший отменён; долгов с процентами не осталось — активный завершён. У закрытого
 * плана — итог по его досрочкам. null — менять нечего. Кредиты — производные.
 */
export function settlePlans(plans: DebtPlan[] = [], credits: Credit[], payments: Payment[], t: string): DebtPlan[] | null {
  const latest = activePlan(plans)
  if (!latest) return null
  const done = costliestCredits(credits).length === 0
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
  const live = liveGoals(doc.goals ?? [])
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
  const live = liveGoals(doc.goals ?? [])
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
}

export type MonthPlanCtx = {
  /** Месяц плана. */
  key: string
  totals: SpendTotal[]
  spendCategories: SpendCategory[]
  uploads: UploadPeriod[]
}

export type PlanIncome = {
  person: PersonId
  name: string
  /** Тенге месяца: пришла — сколько пришло (`paidTenge`), нет — сколько ждём (`salaryTenge`). */
  amount: number
  came: boolean
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
  /** Уже отложено в этом месяце (взносы цели, досрочки долга). */
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

type RunItem = { on: boolean; cap: number; left: number; debt?: { rate: number; payment: number } }

/**
 * Прогон очереди по месяцам (B2C-86 п. 2): каждый месяц — тот же свободный остаток сверху вниз, каждой не
 * больше её взноса и остатка; собранная выпадает — её деньги идут ниже. Долг: сначала платёж по графику
 * (`creditSplit`, проценты до тенге), затем доплата карточки. Ответ — месяц (смещение от первого), когда
 * цель собрана или долг закрыт; null — не в горизонте. Платежи и траты считаются прежними — дата осторожная.
 */
function queueRun(items: RunItem[], free: number): (number | null)[] {
  const left = items.map((x) => x.left)
  const done: (number | null)[] = items.map((x, i) => (x.debt ? null : left[i] <= 0 ? 0 : null))
  for (let m = 0; m < PLAN_HORIZON && done.some((d) => d === null); m++) {
    let avail = Math.max(0, free)
    items.forEach((x, i) => {
      if (done[i] !== null) return
      if (x.debt) left[i] -= creditSplit(left[i], x.debt.rate, x.debt.payment).body
      const give = x.on ? Math.max(0, Math.min(x.cap, left[i], avail)) : 0
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
  const salaryCtx = salaryCtxOf(state)
  const settings = moneySettingsOf(state)

  // Доход.
  const income: PlanIncome[] = people
    .map((p) => {
      const rec = paidFor(payments, 'salary', p.id, key)
      const amount = rec ? paidTenge(state, p.id, key, rec) : salaryTenge(p, key, salaryCtx).tenge
      return { person: p.id, name: p.name, amount, came: !!rec }
    })
    .filter((x) => x.amount > 0 || x.came)
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
  const spend: PlanSpend[] = people
    .map((p): PlanSpend => {
      const has = uploadedBy(p.id, key, ctx.uploads)
      const mine = ctx.totals.filter((t) => !t.deletedAt && t.by === p.id && t.kind === 'month' && t.period === key && t.amount > 0)
      const factOf = (categoryId: string) => (has ? mine.filter((t) => t.categoryId === categoryId).reduce((s, t) => s + t.amount, 0) : null)
      const rows = (state.spendPlans ?? [])
        .filter((x) => x.by === p.id && planSpendOn(x, live))
        .map((x) => ({ categoryId: x.categoryId, name: spendCategoryName(named, x.categoryId), plan: x.amount, fact: factOf(x.categoryId) }))
      const fact = has
        ? mine.filter((t) => t.categoryId === UNKNOWN_CATEGORY || !plannedElsewhere(t.categoryId, live)).reduce((s, t) => s + t.amount, 0)
        : null
      return { by: p.id, plan: rows.reduce((s, r) => s + r.plan, 0), fact, rows }
    })
    .filter((s) => s.rows.length > 0 || (s.fact ?? 0) > 0)
  const spendTotal = spend.reduce((s, x) => s + x.plan, 0)

  const free = incomeTotal - duesTotal - spendTotal
  const monthSpend = duesTotal + spendTotal

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
      const want = plan ? (step?.kind === 'prepay' ? Math.min(step.amount, afterRegular) : 0) : Math.min(Math.max(0, card.monthly), afterRegular)
      const put = countedPayments(payments)
        .filter((p) => p.kind === 'prepay' && p.targetId === c.id && p.period === key)
        .reduce((s, p) => s + p.amount, 0)
      return {
        item: {
          id: q.id, kind: 'debt' as const, goalId: null, creditId: c.id, ...(plan && step?.kind === 'prepay' ? { planId: plan.id } : {}),
          name: c.name, payer: payerOf(card, people), want, paused: card.pausedAt ? ('off' as const) : (false as const), have: start, need: start, put,
        },
        run: { cap: want, left: start, debt: { rate: c.annualRate, payment: c.payment } },
      }
    }
    const g = q.goal
    const have = goalHaveBefore(g, key)
    const need = q.kind === 'fund' ? fundMonthsOf(q.fund, g, settings) * monthSpend : g.need
    const want = Math.min(Math.max(0, g.monthly), Math.max(0, need - have))
    const paused = g.pausedAt ? ('off' as const) : planPaused.has(g.id) ? ('plan' as const) : (false as const)
    return {
      item: {
        id: q.id, kind: q.kind, ...(q.kind === 'fund' ? { fund: q.fund } : {}), goalId: g.id,
        name: g.name, payer: payerOf(g, people), want, paused, have, need, put: goalPutIn(g, key),
      },
      run: { cap: want, left: Math.max(0, need - have) },
    }
  })
  let avail = free
  const queue: PlanQueueItem[] = shape.map(({ item }) => {
    const given = item.paused ? 0 : Math.max(0, Math.min(item.want, avail))
    avail -= given
    return { ...item, given, doneMonth: null }
  })
  const done = queueRun(shape.map(({ item, run }) => ({ ...run, on: !item.paused })), free)
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
    outTotal: monthSpend,
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
  const goals = new Map(liveGoals(state.goals ?? []).map((g) => [g.id, g]))
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
  if (items.length < SUBS_GROUP_MIN) return null
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

/** Платежи месяца для списка (Р-93): подписки — группой, остальные — строками как были. */
export function monthSubscriptions<T extends MonthDue>(dues: T[], all: Obligation[]): { rest: T[]; subs: SubsGroup<Extract<T, { kind: 'obligation' }>> | null } {
  const isSub = (d: T): d is Extract<T, { kind: 'obligation' }> => d.kind === 'obligation' && isSubscription(d.obligation)
  const subs = subscriptionGroup(dues.filter(isSub), all)
  return subs ? { rest: dues.filter((d) => !isSub(d)), subs } : { rest: dues, subs: null }
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
 * Список дел «отложить» (Р-97): строки очереди, которым план даёт сумму в этом месяце. Отложено — движения цели
 * за месяц со знаком (снятие «Не отложено» возвращает строку в дела; `put` плана месяца считает только взносы и
 * не меняется), у долга — досрочки месяца. План считает от начала месяца — отметка сумму строки не меняет.
 */
export function planPuts(state: MonthPlanState, plan: MonthPlan): PlanPut[] {
  const goals = new Map(liveGoals(state.goals ?? []).map((g) => [g.id, g]))
  const came = new Set(plan.income.byPerson.filter((x) => x.came).map((x) => x.person))
  const records = (state.allocations ?? []).filter((a) => !a.deletedAt && a.kind === 'plan' && a.source === 'salary' && a.period === plan.key)
  const recorded = (target: string) => records.reduce((s, a) => s + a.parts.filter((p) => p.target === target).reduce((x, p) => x + p.amount, 0), 0)
  return plan.queue
    .filter((q) => !q.paused && q.given > 0)
    .map((q): PlanPut => {
      const g = q.goalId ? goals.get(q.goalId) : undefined
      const put = g
        ? Math.max(0, (g.movements ?? []).filter((m) => monthKey(new Date(m.date)) === plan.key).reduce((s, m) => s + m.amount, 0))
        : q.put
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
  const counted = countedPayments(state.payments ?? []).filter((p) => p.period === key)
  const cameBy = counted
    .filter((p) => p.kind === 'salary')
    .map((p) => ({ person: p.targetId as PersonId, amount: paidTenge(state, p.targetId as PersonId, key, p) }))
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
    ? totals.filter((t) => t.categoryId === UNKNOWN_CATEGORY || !plannedElsewhere(t.categoryId, live)).reduce((s, t) => s + t.amount, 0)
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

export type WeekPicture = {
  /** Понедельник и воскресенье недели, `YYYY-MM-DD`. */
  range: { from: string; to: string }
  /** Траты обоих за неделю, включая не разобранное. */
  total: number
  /** Разделы по убыванию суммы, без «не разобрано». */
  rows: WeekPictureRow[]
  unknown: number
  unknownShare: number
  /** Кто загрузил выписку, покрывающую неделю, и кто нет. */
  uploaded: Person[]
  missing: Person[]
}

/** Загрузка выписки, как её отдаёт сервер: чья и за какой период (`created_at` — когда загрузили). */
export type UploadPeriod = { slot: string; period_from: string; period_to: string; created_at?: string }

/** Выписка за неделю есть, если её период перекрывает неделю хотя бы днём (`weekPicture`, «Выписки»). */
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
 * участники или один (`by`): суммы, доли от общей, «не разобрано» отдельно. Ядро `weekPicture`
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

/**
 * Картина недели (Р-8): траты обоих по разделам за ISO-неделю `week` — сумма недельных
 * итогов всех участников (`spendTotals`), доли от общей суммы; «не разобрано» — отдельно.
 * Кто без выписки — по загрузкам семьи, покрывающим хотя бы день недели.
 */
export function weekPicture(
  totals: SpendTotal[],
  categories: SpendCategory[],
  people: Person[],
  week: string,
  uploads: UploadPeriod[] = [],
): WeekPicture {
  const range = weekRange(week)
  const { total, rows, unknown, unknownShare } = spendRows(totals, categories, { kind: 'week', period: week })
  const alivePeople = people.filter(alive)
  const uploaded = alivePeople.filter((p) => uploads.some((u) => u.slot === p.id && coversWeek(u, range)))
  const missing = alivePeople.filter((p) => !uploaded.includes(p))
  return { range, total, rows, unknown, unknownShare, uploaded, missing }
}

/**
 * Тег картины недели (главный и «Неделя» — один текст): кто-то загрузил, а кто-то нет —
 * «без выписки <имена>»; загрузили все — «по выпискам обоих» (один участник — «по выписке»);
 * никто — null. `peopleCount` — живые участники семьи.
 */
export function weekTag(pic: Pick<WeekPicture, 'uploaded' | 'missing'>, peopleCount: number): { text: string; tone: 'ok' | 'warn' } | null {
  if (pic.missing.length && pic.uploaded.length) return { text: `без выписки ${pic.missing.map((p) => p.name).join(' и ')}`, tone: 'warn' }
  if (pic.uploaded.length) return { text: peopleCount > 1 ? 'по выпискам обоих' : 'по выписке', tone: 'ok' }
  return null
}

/** Строка карточки «Выписки» (Р-62): загружена ли выписка за неделю и в какой день — последняя загрузка; нет — null. */
export type WeekUploadRow = { person: Person; day: string | null }

/** Карточка «Выписки · неделя» (Р-62) — по живым участникам, то же перекрытие периода с неделей, что `weekPicture`. */
export function weekUploads(people: Person[], week: string, uploads: UploadPeriod[] = []): WeekUploadRow[] {
  const range = weekRange(week)
  return people.filter(alive).map((person) => {
    const mine = uploads.filter((u) => u.slot === person.id && coversWeek(u, range))
    const last = mine.map((u) => u.created_at ?? '').sort().at(-1)
    return { person, day: mine.length ? weekdayShort(last) : null }
  })
}

/** Итог недели против прошлой (DESIGN.md §6 «на N % меньше/больше прошлой»), целый процент; null — одной из недель нет. */
export function weekVersusPrev(totals: SpendTotal[], week: string, prevWeek: string): { delta: number } | null {
  const sum = (key: string) => spendRows(totals, [], { kind: 'week', period: key }).total
  const now = sum(week)
  const prev = sum(prevWeek)
  if (!prev || !now) return null
  return { delta: Math.round(((now - prev) / prev) * 100) }
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
    if (t.categoryId !== UNKNOWN_CATEGORY && plannedElsewhere(t.categoryId, live)) continue
    out.set(t.categoryId, (out.get(t.categoryId) ?? 0) + t.amount)
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
    later.set(id, (later.get(id) ?? 0) - op.amount)
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

/** Раздел за неделю из своих операций (`sectionWeek`, Р-101). */
export type SectionWeek = {
  /** Сумма и число трат раздела за неделю. */
  total: number
  count: number
  /** Топ продавцов: имя, число операций, сумма — по убыванию суммы. */
  tops: { name: string; count: number; amount: number }[]
  /** Операции по дням, свежие сверху — первые `limit`. */
  days: { date: string; ops: { id: string; name: string; amount: number }[] }[]
  /** Хвост «Ещё N · сумма»: что не поместилось; null — показано всё. */
  more: { count: number; amount: number } | null
}

/** Сколько продавцов в топе раздела и сколько операций листа до «Ещё N». */
export const SECTION_TOPS = 3
export const SECTION_OPS = 5

/**
 * Лист раздела (Р-101): свои траты раздела за неделю — топ продавцов и операции по дням. Отбор — тот же, что у
 * итогов выписок (`isSpend`: списания, без переводов между своими); раздел `UNKNOWN_CATEGORY` — не разобранное.
 */
export function sectionWeek(
  ops: Operation[],
  where: { week: string; categoryId: string; limit?: number; tops?: number },
): SectionWeek {
  const list = ops
    .filter((op) => isSpend(op) && (op.categoryId ?? UNKNOWN_CATEGORY) === where.categoryId && weekKey(op.date) === where.week)
    .map((op) => ({ id: op.id, date: op.date, name: op.counterparty ?? op.merchant, amount: -op.amount, key: op.counterparty ? `c:${normalizeCounterparty(op.counterparty)}` : `m:${normalizeMerchant(op.merchant)}` }))
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
    const item = { id: op.id, name: op.name, amount: op.amount }
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
 * цели по плану − траты по выпискам за месяц, кроме разделов `plannedElsewhere` (кредиты,
 * коммуналка, аренда, подписки — они уже в `monthDues`). Ни одной загрузки за месяц —
 * план (`budgetAmounts.free`) с `byFact: false`.
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
  },
  totals: SpendTotal[],
  spendCategories: SpendCategory[],
  key: string,
  uploads: UploadPeriod[] = [],
): FreeByFact {
  const income = totalIncome(state.people ?? [], key, salaryCtxOf(state))
  const share = (amount: number) => (income > 0 ? Math.max(0, Math.min(1, amount / income)) : 0)
  const amounts = budgetAmounts(state)
  const spent = monthSpentByFact(totals, spendCategories, key, uploads)
  if (spent === null) {
    return { amount: amounts.d5, byFact: false, income, dues: amounts.d1 + amounts.d2, goals: amounts.d3 + amounts.planExtra, spent: 0, share: share(amounts.d5) }
  }
  const dues = duesTotal(monthDues(state, key))
  const goals = amounts.d3 + amounts.planExtra
  const amount = income - dues - goals - spent
  return { amount, byFact: true, income, dues, goals, spent, share: share(amount) }
}

/**
 * Траты месяца по выпискам обоих, кроме разделов, уже учтённых планом (`plannedElsewhere`:
 * кредиты, коммуналка, аренда, подписки живут в `monthDues`). Одна функция на два места (Р-38):
 * `freeByFact` вычитает её из плана, виджет «Траты» в «Деньгах» показывает её фактом.
 * `null` — за месяц ни одной загрузки: факта нет, а не «потрачено 0».
 */
export function monthSpentByFact(totals: SpendTotal[], spendCategories: SpendCategory[], key: string, uploads: UploadPeriod[] = []): number | null {
  if (!monthUploaded(key, uploads)) return null
  const live = spendCategories.filter(alive)
  return totals
    .filter((t) => !t.deletedAt && t.kind === 'month' && t.period === key && t.amount > 0)
    .filter((t) => t.categoryId === UNKNOWN_CATEGORY || !plannedElsewhere(t.categoryId, live))
    .reduce((a, t) => a + t.amount, 0)
}

export type IncomePartKey = 'must' | 'dreams' | 'living' | 'free'

/**
 * Виджет «Доход» в «Деньгах» (Р-33): доли дохода — обязательное (жильё и кредиты), мечты
 * (взносы и досрочка по плану), траты (раздел d4), свободно (не меньше 0) — и нагрузка: доля жилья и
 * кредитов в доходе (формула «вместе с жильём» прежнего Бюджета). `share` — доля 0…1 для полосы,
 * `pct` — те же проценты, что печатал Бюджет. `overplanned` — на сколько расписано больше дохода.
 */
export function incomeSplit(a: Pick<ReturnType<typeof budgetAmounts>, 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'income' | 'planExtra'>) {
  const parts: { key: IncomePartKey; amount: number }[] = [
    { key: 'must', amount: a.d1 + a.d2 },
    { key: 'dreams', amount: a.d3 + a.planExtra },
    { key: 'living', amount: a.d4 },
    { key: 'free', amount: Math.max(0, a.d5) },
  ]
  return {
    income: a.income,
    load: pct(a.d1 + a.d2, a.income),
    parts: parts.map((p) => ({ ...p, pct: pct(p.amount, a.income), share: a.income > 0 ? p.amount / a.income : 0 })),
    overplanned: Math.max(0, -a.d5),
  }
}

/**
 * Виджет «Траты» (Р-33; бывший «Еда и быт»): план — `livingPlan` (траты плана месяца, иначе статьи «Жизнь» + «Траты», B2C-59; без
 * статей — база раздела d4, как раньше), факт — `monthSpentByFact` (`null` — за месяц нет загрузок). `pct` —
 * факт от плана, `share` — для полосы 0…1, `over` — перерасход.
 */
export function livingPlanFact(
  doc: Parameters<typeof livingPlan>[0],
  totals: SpendTotal[],
  spendCategories: SpendCategory[],
  key: string,
  uploads: UploadPeriod[] = [],
) {
  const plan = livingPlan(doc)
  const spent = monthSpentByFact(totals, spendCategories, key, uploads)
  return {
    plan,
    spent,
    pct: spent !== null && plan > 0 ? pct(spent, plan) : null,
    share: spent !== null && plan > 0 ? Math.min(1, spent / plan) : 0,
    over: spent !== null && spent > plan,
  }
}

/**
 * Виджет «Долги» (Р-33): остаток живых кредитов (сумма `principal`, как итог долгов Капитала) и
 * «в <месяце> оплачено N из M» — платежи кредитов месяца из `monthDues` (Р-38). `open` — есть ли
 * незакрытый долг (нет — «Долгов нет»). Кредиты — производные остатки, как их отдаёт стор.
 */
export function debtsSummary(state: { credits?: Credit[]; payments?: Payment[] }, key: string) {
  const credits = liveCredits(state.credits ?? [])
  const dues = monthDues({ credits: state.credits, payments: state.payments }, key).filter((d) => d.kind === 'credit')
  return {
    total: credits.reduce((a, c) => a + c.principal, 0),
    open: credits.some((c) => c.principal > 0),
    paid: dues.filter((d) => d.paid).length,
    count: dues.length,
  }
}

/* ---------------- строки-статусы виджетов «Денег» и доли трат (B2C-59, Р-57, Р-59) ---------------- */

export type StatusTag = { text: string; tone: 'ok' | 'neutral' | 'warn' }

/**
 * Нагрузка словом (тег «Дохода»): доля жилья и кредитов в доходе, целые проценты (`incomeSplit().load`).
 * Пороги — дефолт составителя: до 29 % — низкая, 30–50 % — средняя, от 51 % — высокая.
 */
export const LOAD_LEVELS: { upTo: number; text: string; tone: StatusTag['tone'] }[] = [
  { upTo: 29, text: 'нагрузка низкая', tone: 'ok' },
  { upTo: 50, text: 'нагрузка средняя', tone: 'neutral' },
  { upTo: Infinity, text: 'нагрузка высокая', tone: 'warn' },
]
export const loadTag = (load: number): StatusTag => {
  const l = LOAD_LEVELS.find((x) => load <= x.upTo)!
  return { text: l.text, tone: l.tone }
}

/** «N из M оплачено» (тег «Платежей»): платежи месяца (`monthDues`) и их отметки; платежей нет — null. */
export function duesTag(dues: Pick<MonthDue, 'paid'>[]): StatusTag | null {
  if (!dues.length) return null
  const paid = dues.filter((d) => d.paid).length
  return { text: `${paid} из ${dues.length} оплачено`, tone: paid === dues.length ? 'ok' : 'neutral' }
}

/**
 * Суммы платежей месяца (B2C-70, первая строка «Платежей»): `total` — все платежи месяца, `left` — ещё не
 * оплаченные. Только сложение строк `monthDues` (у отмеченного сумма — из отметки, итог сходится со
 * строками), новых правил нет; платежей нет — null.
 */
export function duesTotals(dues: Pick<MonthDue, 'amount' | 'paid'>[]): { total: number; left: number } | null {
  if (!dues.length) return null
  return dues.reduce((acc, d) => ({ total: acc.total + d.amount, left: acc.left + (d.paid ? 0 : d.amount) }), { total: 0, left: 0 })
}

export type SpendShare = { categoryId: string; amount: number; share: number }

/**
 * Доли разделов месяца (лист «Траты»): сумма раздела от трат месяца по выпискам обоих (`monthSpentByFact`:
 * без разделов, учтённых планом; «не разобрано» — в базе, но строкой не идёт). Целые проценты, по убыванию;
 * округление не выводит сумму за 100 (лишний процент снимается с самой большой доли). null — загрузок нет.
 */
export function spendShares(totals: SpendTotal[], spendCategories: SpendCategory[], key: string, uploads: UploadPeriod[] = []): SpendShare[] | null {
  const base = monthSpentByFact(totals, spendCategories, key, uploads)
  if (base === null) return null
  const live = spendCategories.filter(alive)
  const by = new Map<string, number>()
  for (const t of totals) {
    if (t.deletedAt || t.kind !== 'month' || t.period !== key || t.amount <= 0) continue
    if (t.categoryId === UNKNOWN_CATEGORY || plannedElsewhere(t.categoryId, live)) continue
    by.set(t.categoryId, (by.get(t.categoryId) ?? 0) + t.amount)
  }
  const rows = [...by]
    .map(([categoryId, amount]) => ({ categoryId, amount, share: pct(amount, base) }))
    .sort((a, b) => b.amount - a.amount)
  let over = rows.reduce((a, r) => a + r.share, 0) - 100
  for (let i = 0; over > 0 && i < rows.length; i++) {
    const take = Math.min(over, rows[i].share)
    rows[i].share -= take
    over -= take
  }
  return rows
}

/** Месяц покрыт выписками целиком: есть загрузка на его первый и на последний день. */
const monthCovered = (key: string, uploads: UploadPeriod[]) => {
  const first = `${key}-01`
  const last = `${key}-${String(daysInMonth(key)).padStart(2, '0')}`
  return uploads.some((u) => u.period_from <= first && u.period_to >= first) && uploads.some((u) => u.period_from <= last && u.period_to >= last)
}

/** Сколько полных месяцев выписок нужно, чтобы ориентиром стало своё среднее (Р-57). */
export const OWN_NORM_MONTHS = 3

/**
 * Ориентир долей (Р-57): после трёх полных месяцев с выписками перед `key` — своё среднее долей разделов
 * за эти месяцы (раздел, которого в месяце не было, — 0 %; целые проценты, нулевые — без черты), иначе
 * — таблица статистики РК (`STAT_NORMS`).
 */
export function spendNorms(
  totals: SpendTotal[],
  spendCategories: SpendCategory[],
  uploads: UploadPeriod[],
  key: string,
): { from: 'own' | 'stat'; norms: Record<string, number> } {
  const months = Array.from({ length: OWN_NORM_MONTHS }, (_, i) => addMonths(key, -(i + 1)))
  if (!months.every((m) => monthCovered(m, uploads))) return { from: 'stat', norms: STAT_NORMS }
  const sums = new Map<string, number>()
  for (const m of months) for (const r of spendShares(totals, spendCategories, m, uploads) ?? []) sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + r.share)
  const norms = Object.fromEntries([...sums].map(([id, s]) => [id, Math.round(s / months.length)] as const).filter(([, s]) => s > 0))
  return { from: 'own', norms }
}

/** Насколько доля должна превысить ориентир, чтобы раздел считался «выше нормы» (п. п., дефолт исполнителя). */
export const NORM_SLACK = 3

/**
 * Тег «Трат»: раздел с наибольшим превышением ориентира — «продукты выше нормы» (превышение — больше
 * `NORM_SLACK` п. п.), иначе «в норме»; без выписок за месяц — null. `worst` — для строки под суммой
 * (макет: «Продукты 31 %, обычно ~22 %»).
 */
export function spendStatus(
  shares: SpendShare[] | null,
  norms: Record<string, number>,
  spendCategories: Pick<SpendCategory, 'id' | 'name'>[],
): (StatusTag & { worst?: { name: string; share: number; norm: number } }) | null {
  if (!shares) return null
  const worst = shares
    .filter((r) => r.categoryId in norms)
    .map((r) => ({ id: r.categoryId, over: r.share - norms[r.categoryId] }))
    .filter((x) => x.over > NORM_SLACK)
    .sort((a, b) => b.over - a.over)[0]
  if (!worst) return { text: 'в норме', tone: 'ok' }
  const name = spendCategoryName(spendCategories, worst.id)
  const share = shares.find((r) => r.categoryId === worst.id)!.share
  return { text: `${name.toLowerCase()} выше нормы`, tone: 'warn', worst: { name, share, norm: norms[worst.id] } }
}

export type DecisionKind = 'match' | 'unknownBatch' | 'keep' | 'allocate' | 'salary' | 'freed' | 'monthEnd'

/** Решение очереди «Недели» (`decisionQueue`): тексты DESIGN.md §6, ключ и данные для ответа на месте. */
export type Decision = {
  kind: DecisionKind
  /** Ключ решения — «Потом» откладывает его до следующего открытия, «N из M» считает по нему. */
  key: string
  question: string
  meta: string
  /** Строка внутренней карточки (детали) — если есть. */
  inner?: string
  /** Куда ведёт главное действие; null — ответ на месте (стор). */
  to: string | null
  actions: { primary?: string; secondary?: string; ghost?: string }
  /** Шаг «Отписаться» вопроса «оставить?» (`keepCard`). */
  cancel?: KeepCard['cancel']
  /** Подписка вопроса «оставить?». */
  obligation?: Obligation
  /** Участник и месяц зарплаты «пришла?» / «Пришла зарплата». */
  salary?: { person: Person; period: string }
  /** Ждущее сопоставление операции с отметкой (Р-6). */
  match?: MatchCandidate
  /** Незнакомые продавцы пачкой (Р-58) — по сумме, сначала крупные. */
  groups?: UnknownGroup[]
  /** Снижение обязательства «освободится N ₸». */
  freed?: FreedChange
  /** Сумма пришедшей зарплаты карточки «Пришла зарплата». */
  amount?: number
}

/**
 * Очередь решений «Недели» (Р-43) — одна на экран: сопоставления (по одному на каждое ждущее) →
 * незнакомые продавцы — одной пачкой (Р-58; группы ищет экран — месяц или черновик) → «оставить подписку?» (`keepQuestions`) → зарплата: «Пришла зарплата»
 * (`salaryToAllocate` — «К плану месяца», Р-78), иначе «пришла?» (`salaryAsk`) — одна карточка о зарплате за раз →
 * «освободится N ₸» (`freedChange`, пока его запись не сделана — тоже в план, Р-86) → «остались деньги?»
 * (`monthEndAsk`, пока остаток месяца не отложен). Шаг плана долгов — в квадрате «План» (Р-34), не здесь.
 * Отложенные («Потом») убирает экран. Viewer (`canEdit` false) решений не видит (Р-50); без своего слота (`me`)
 * нет только решений о своей зарплате — как было у «Недели».
 */
export function decisionQueue(
  state: DecisionState,
  ctx: {
    me: PersonId | undefined
    canEdit?: boolean
    matches?: MatchCandidate[]
    unknown?: UnknownGroup[]
    answeredMonthEnd?: string | null
    now?: { day: number; key: string }
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
      to: null,
      actions: c.kind === 'salary' ? { primary: 'Да, зарплата', secondary: 'Нет', ghost: 'Потом' } : { primary: 'Да, отметить', secondary: 'Нет, это другое', ghost: 'Потом' },
      match: c,
    })
  }

  // Все незнакомые — одно решение-пачка (Р-58): ключ постоянный — «Потом» откладывает всю пачку, «N из M» считает её одной.
  const unknown = [...(ctx.unknown ?? [])].sort((a, b) => b.amount - a.amount)
  if (unknown.length) {
    out.push({
      kind: 'unknownBatch',
      key: 'unknownBatch',
      question: `Без раздела · ${unknown.length}`,
      meta: money(amountTotal(unknown)),
      to: null,
      actions: { ghost: 'Потом' },
      groups: unknown,
    })
  }

  const { year, month } = parseMonthKey(now.key)
  for (const o of keepQuestions(state.obligations ?? [], new Date(Date.UTC(year, month, now.day, 12)), state.book)) {
    out.push({ kind: 'keep', key: `keep:${o.id}`, ...keepCard(o, state.goals ?? [], payments, now, state.book, state), to: null, obligation: o })
  }

  // Зарплата пришла и не отложена — «Пришла зарплата» → план месяца (Р-78); иначе «пришла?» (возврат приёмки 2 п. 3: одна о зарплате).
  const unallocated = salaryToAllocate(state, ctx.me, now)
  const near = unallocated ? null : salaryAsk(state, ctx.me, now)
  if (unallocated) {
    const { person, period, record } = unallocated
    out.push({
      kind: 'allocate',
      key: `allocate:${person.id}:${period}`,
      question: `Пришла зарплата · ${person.name}`,
      meta: '',
      // План того месяца, чья зарплата: пришла 1-го или подтверждена по выписке позже — не текущий месяц.
      to: period === now.key ? '/month' : `/month?month=${period}`,
      actions: { primary: 'К плану месяца', ghost: 'Потом' },
      salary: { person, period },
      amount: paidTenge(state, person.id, period, record),
    })
  } else if (near) {
    // «Пришла» и лист «ещё» — `SalaryRow` на месте (RP-10).
    out.push({ kind: 'salary', key: `salary:${near.who.id}:${near.key}`, ...salaryCard(near), to: null, actions: {}, salary: { person: near.who, period: near.key } })
  }

  // «Освободится N ₸» — карточка плана месяца (Р-86); запись сделана (`source: 'freed'`) — уже решено.
  const freed = freedChange(liveObligations(state.obligations ?? []), now.key, state.book)
  if (freed && !allocationFor(state.allocations, { source: 'freed', sourceId: freed.o.id, period: freed.change.from })) {
    out.push({
      kind: 'freed',
      key: `freed:${freed.o.id}:${freed.change.from}`,
      question: freedQuestion(freed),
      meta: `${freed.o.name} · с ${monthFrom(freed.change.from, false)}`,
      to: '/month',
      actions: { primary: 'К плану месяца', ghost: 'Потом' },
      freed,
    })
  }

  // Ответ — до конца месяца на устройстве (`answeredMonthEnd`); отложенный остаток — ответ семьи: партнёр второй раз не спрашивается.
  const restDone = allocationFor(state.allocations, { source: 'rest', sourceId: now.key, period: now.key })
  if (!restDone && monthEndAsk(ctx.answeredMonthEnd ?? null, now)) {
    out.push({ kind: 'monthEnd', key: `monthEnd:${now.key}`, ...monthEndCard(now.key), to: null })
  }

  return out
}

/* ---------------- очередь «Недели»: состояние; старые записи разбора (Блок 11, Р-85) ---------------- */

/** Документ семьи для очереди решений «Недели»; кредиты — производные остатки, как их отдаёт стор. */
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
