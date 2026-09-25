import type { Account, Category, Credit, Goal, Obligation, Payment, Person, WishItem } from '@/types/finance'
import { addMonths, daysInMonth, monthKey, parseMonthKey, today } from '@/lib/dates'
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

/** Во сколько месяцев расходов обходится накопленная подушка. */
export function emergencyCoverage(saved: number, mandatoryMonthly: number): number {
  if (!mandatoryMonthly) return 0
  return saved / mandatoryMonthly
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

export type CreditOutlook = { closes: boolean; months: number; overpay: number }

/**
 * Что станет с долгом при нынешнем платеже — выводы модалки кредита (React
 * `CreditDialog`): сколько платежей осталось (вверх до целого) и сколько уйдёт банку
 * сверх остатка (до тенге). Платёж не покрывает проценты — `closes: false`, чисел нет.
 */
export function creditOutlook(c: { principal: number; annualRate: number; payment: number }): CreditOutlook {
  const cost = debtCost(c.principal, c.annualRate, c.payment)
  return cost.closes
    ? { closes: true, months: Math.ceil(cost.months), overpay: Math.round(cost.overpay) }
    : { closes: false, months: Infinity, overpay: Infinity }
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
}

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
 * показывается как сумма. null — считать нечего: взноса нет, долга нет или
 * платёж не покрывает проценты (срока, который сохранять, не существует).
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
  const n = annuityMonths(debt, annualRate, payment)
  if (debt <= 0 || paid <= 0 || !Number.isFinite(n)) return null
  const left = debt - paid
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
    interestFree: credits.filter((c) => c.annualRate === 0 && c.principal > 0),
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
 * Открытые кредиты — живые, по которым ещё есть что платить. Закрытый отметками
 * (остаток 0, строка остаётся с «долг закрыт») не входит ни в бюджет, ни в
 * стратегию, ни в Ритуал.
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

/** Валюта в тенге по курсу — целые тенге. Единственное место, где сумма умножается на курс. */
export const fxToTenge = (foreignAmount: number, rate: number) => Math.round(foreignAmount * rate);

/** Сумма обязательства, действующая в указанном месяце. */
export function amountAt(o: Obligation, key = monthKey()): number {
  const versions = o.versions || [];
  const active = versions.filter((v) => v.from <= key).sort((a, b) => a.from.localeCompare(b.from));
  return active.length ? active[active.length - 1].amount : 0;
}

/** Сколько этот платёж занимает в плане месяца (годовые делятся на 12). */
export function monthlyAmount(o: Obligation, key = monthKey()): number {
  const full = amountAt(o, key);
  return o.every === 'year' ? full / 12 : full;
}

/** Сколько годовой платёж занимает в плане месяца — до тенге (подсказки формы). */
export const yearShare = (yearly: number) => Math.round(yearly / 12);

/**
 * Запланированная смена суммы обязательства: насколько платёж изменится в месяц и
 * за год. Новой суммы нет — изменения нет.
 */
export function plannedChange(current: number, planned: number) {
  const monthly = planned > 0 ? Math.round(planned - current) : 0;
  return { monthly, yearly: monthly * 12 };
}

/** Списывается ли этот платёж в указанном месяце. Группа подписок не списывается никогда. */
export function dueIn(o: Obligation, key = monthKey()): boolean {
  if (o.group) return false;
  if (o.every !== 'year') return true;
  return (o.month ?? 1) === Number(key.split('-')[1]);
}

/** Ближайшее будущее изменение суммы. */
export function nextChange(o: Obligation, key = monthKey()) {
  const versions = o.versions || [];
  const future = versions.filter((v) => v.from > key).sort((a, b) => a.from.localeCompare(b.from));
  if (!future.length) return null;
  const current = amountAt(o, key);
  return { ...future[0], delta: future[0].amount - current };
}

/* ---------------- группы подписок и «оставить?» (RP-09) ---------------- */

/** Подписки группы — живые обязательства, лежащие в ней. */
export const groupChildren = (group: Obligation, list: Obligation[]) =>
  liveObligations(list).filter((o) => o.parentId === group.id);

/** Итог группы за месяц — сумма её подписок; годовые — долей, как в плане месяца. */
export function groupTotal(group: Obligation, list: Obligation[], key = monthKey()): number {
  return Math.round(groupChildren(group, list).reduce((a, o) => a + monthlyAmount(o, key), 0));
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
export function keepQuestions(list: Obligation[], now = new Date()): Obligation[] {
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
    .sort((a, b) => a.wait - b.wait || amountAt(b.o, t.key) - amountAt(a.o, t.key))
    .map((x) => x.o);
}

/** Оклад, действующий в указанном месяце. */
export function salaryAt(p: Person, key = monthKey()): number {
  const v = (p.salaryVersions ?? [])
    .filter((x) => x.from <= key)
    .sort((a, b) => a.from.localeCompare(b.from));
  return v.length ? v[v.length - 1].amount : p.salary;
}

/** Ближайшее запланированное изменение оклада. */
export function nextSalaryChange(p: Person, key = monthKey()) {
  const future = (p.salaryVersions ?? [])
    .filter((x) => x.from > key)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (!future.length) return null;
  return { ...future[0], delta: future[0].amount - salaryAt(p, key) };
}

/** Совокупный доход участников. */
export const totalIncome = (people: Person[], key = monthKey()) =>
  (people || []).filter(alive).reduce((a, p) => a + salaryAt(p, key), 0);

/** Обязательные базовые расходы в месяц (d1 + d2 + d4). */
export const mandatoryMonthly = (categories: Category[]) =>
  (categories || [])
    .filter((c) => c.key === 'd1' || c.key === 'd2' || c.key === 'd4')
    .reduce((a, c) => a + c.amount, 0);

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
    people.some((p) => salaryAt(p) > 0) ||
    liveObligations(obligations).length > 0 ||
    liveCredits(credits).length > 0 ||
    liveGoals(goals).length > 0 ||
    liveAccounts(accounts).length > 0
  );
}

/**
 * Суммы по 5 разделам бюджета. Кредиты — производные (геттер стора): платёж
 * закрытого кредита в «Кредиты» не входит и освобождает «Свободно».
 */
export function budgetAmounts(state: {
  categories?: Category[];
  obligations?: Obligation[];
  credits?: Credit[];
  goals?: Goal[];
  people?: Person[];
}) {
  const key = monthKey();
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const goalsList = state.goals || [];
  const people = state.people || [];
  const categories = state.categories || [];

  const housing = liveObligations(obligations)
    .filter((o) => o.category === 'd1')
    .reduce((a, o) => a + monthlyAmount(o, key), 0);
  const other = liveObligations(obligations)
    .filter((o) => o.category !== 'd1' && o.category !== 'd2')
    .reduce((a, o) => a + monthlyAmount(o, key), 0);
  const debts =
    openCredits(credits).reduce((a, c) => a + c.payment, 0) +
    liveObligations(obligations)
      .filter((o) => o.category === 'd2')
      .reduce((a, o) => a + monthlyAmount(o, key), 0);
  const goals = liveGoals(goalsList).reduce((a, g) => a + g.monthly, 0);
  const living = (categories.find((c) => c.key === 'd4')?.amount ?? 0) + other;
  const income = totalIncome(people, key);
  const free = income - housing - debts - goals - living;

  return { d1: housing, d2: debts, d3: goals, d4: living, d5: free, income };
}

export const goalSavings = (goals: Goal[]) =>
  liveGoals(goals)
    .filter((g) => !g.accountId)
    .reduce((a, g) => a + Math.max(0, g.have), 0);

export const netWorth = (accounts: Account[], credits: Credit[], goals: Goal[] = []) =>
  liveAccounts(accounts).reduce((a, x) => a + x.amount, 0) +
  goalSavings(goals) -
  liveCredits(credits).reduce((a, c) => a + c.principal, 0);

/* ---------------- отметки оплат и остатки из них (RP-06) ---------------- */

/** Что можно отметить по графику. Досрочка — не платёж графика, а отдельный взнос. */
export type ScheduledKind = 'obligation' | 'credit'

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
 * показывается оплаченным. Одно правило для Бюджета, Обзора и «до зарплаты».
 */
export const creditDueIn = (c: Credit, payments: Payment[], key: string) =>
  !!paidFor(payments, 'credit', c.id, key) || creditDueAmount(c) > 0

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
  kind: ScheduledKind,
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
export const afterAnchor = (p: Payment, anchor?: string | null) => !anchor || p.at >= anchor

/** Остаток счёта: база минус списания по отметкам после сверки. */
export function accountBalance(a: Account, payments: Payment[] = []): number {
  return countedPayments(payments)
    .filter((p) => p.accountId === a.id && afterAnchor(p, a.amountSetAt))
    .reduce((left, p) => left - p.amount, a.amount)
}

/**
 * Новая база счёта, когда остаток сдвигают на сумму (взнос в цель со счёта,
 * снятие с цели, внеплановый доход). Это не сверка с банком: база меняется на ту
 * же дельту, якорь остаётся прежним — иначе отметки до этого момента (снятая по
 * ошибке, офлайн-отметка партнёра) перестали бы двигать остаток. Видимый остаток
 * ниже нуля не уводится — как раньше у взноса в цель.
 */
export function shiftedBase(a: Account, payments: Payment[], delta: number): number {
  const visible = accountBalance(a, payments)
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
export function nextObligationDue(o: Obligation, payments: Payment[] = [], now = today()): Due | null {
  for (let i = 0; i < DUE_HORIZON; i++) {
    const period = addMonths(now.key, i)
    const amount = amountAt(o, period)
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
 * «Впереди» на Обзоре. Обязательства, что списываются в этом месяце (группа
 * подписок — нет), и кредиты, ждущие платежа (закрытый — только в месяц, когда его
 * закрыли). Кредиты — с остатками из отметок, как их отдаёт стор. Сумма
 * отмеченного — из отметки, как в строке «Оплатил»: итог сходится со строками.
 * Порядок — обязательства, затем кредиты; сортирует экран.
 */
export function monthDues(
  state: { obligations?: Obligation[]; credits?: Credit[]; payments?: Payment[] },
  key: string,
): MonthDue[] {
  const payments = state.payments || []
  const obligations: MonthDue[] = liveObligations(state.obligations || [])
    .filter((o) => dueIn(o, key))
    .map((o) => {
      const paid = paidFor(payments, 'obligation', o.id, key)
      const amount = paid ? paid.amount : amountAt(o, key)
      return { kind: 'obligation', obligation: o, targetId: o.id, name: o.name, day: o.day, amount, paid: !!paid }
    })
  const credits: MonthDue[] = liveCredits(state.credits || [])
    .filter((c) => creditDueIn(c, payments, key))
    .map((c) => {
      const paid = paidFor(payments, 'credit', c.id, key)
      const amount = paid ? paid.amount : creditDueAmount(c)
      return { kind: 'credit', credit: c, targetId: c.id, name: c.name, day: c.day, amount, paid: !!paid }
    })
  return [...obligations, ...credits]
}

/** Итог платежей месяца — сумма строк. */
export const duesTotal = (dues: MonthDue[]) => dues.reduce((a, d) => a + d.amount, 0)

/**
 * До зарплаты: когда придут деньги и что нужно заплатить до этого.
 *
 * Счета и кредиты — с остатками из отметок (стор отдаёт такие). Отмеченное в своём
 * месяце в «заплатить» не входит: деньги уже ушли со счёта, иначе вычлись бы
 * дважды (Р-5, честный остаток). Оно возвращается отдельно (`paid`, сумма — из
 * отметки), чтобы экран показал его оплаченным, а не молча потерял. Закрытый
 * кредит платежа не ждёт.
 */
export function untilPayday(
  state: {
    people?: Person[];
    obligations?: Obligation[];
    credits?: Credit[];
    accounts?: Account[];
    payments?: Payment[];
  },
  now = today(),
) {
  const people = state.people || [];
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const accountsList = state.accounts || [];
  const payments = state.payments || [];

  const key = now.key;
  const days = daysInMonth(key);

  const ahead = people
    .filter((p) => p.payday >= now.day)
    .sort((a, b) => a.payday - b.payday)[0];
  const wrapped = [...people].sort((a, b) => a.payday - b.payday)[0];
  const who = ahead ?? wrapped;
  if (!who) return null;

  const nextKey = ahead ? key : addMonths(key, 1);
  const inDays = ahead ? who.payday - now.day : days - now.day + who.payday;

  const itemsOf = (k: string) =>
    monthDues({ obligations, credits, payments }, k).map((d) => ({
      id: d.targetId,
      targetId: d.targetId,
      kind: d.kind,
      name: d.name,
      day: d.day,
      value: d.amount,
      when: k,
      paid: d.paid,
    }));

  const inWindow = ahead
    ? itemsOf(key).filter((x) => x.day >= now.day && x.day <= who.payday)
    : [
        ...itemsOf(key).filter((x) => x.day >= now.day),
        ...itemsOf(nextKey)
          .filter((x) => x.day <= who.payday)
          .map((x) => ({ ...x, id: x.id + '@next' })),
      ];
  inWindow.sort((a, b) => a.when.localeCompare(b.when) || a.day - b.day);
  const due = inWindow.filter((x) => !x.paid);
  const paid = inWindow.filter((x) => x.paid);

  const accounts = liveAccounts(accountsList).filter((a) => a.kind !== 'deposit');
  const onAccounts = accounts.reduce((a, x) => a + x.amount, 0);
  const dueTotal = due.reduce((a, x) => a + x.value, 0);

  return {
    who,
    income: salaryAt(who, nextKey),
    inDays,
    day: who.payday,
    key: nextKey,
    due,
    paid,
    dueTotal,
    knowsCash: accounts.length > 0,
    onAccounts,
    shortfall: onAccounts - dueTotal,
  };
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
export function contributionStreak(movements: { date: string; amount: number }[]): number {
  const months = new Set(
    movements.filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7)),
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
