import type { Account, Category, Credit, Goal, Obligation, Person, WishItem } from '@/types/finance'
import { addMonths, daysInMonth, monthKey, today } from '@/lib/dates'
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
 * Второй режим — «сокращать платёж» — срок не меняется, экономия меньше;
 * его добавим, когда появится реальный график из банка.
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


/* ---------------- производные величины и расчеты бюджетов ---------------- */

const alive = <T extends { deletedAt?: string | null }>(x: T) => !x.deletedAt;

export const liveGoals = (goals: Goal[]) => (goals || []).filter(alive);
export const liveObligations = (list: Obligation[]) => (list || []).filter(alive);
export const liveCredits = (list: Credit[]) => (list || []).filter(alive);
export const liveAccounts = (list: Account[]) => (list || []).filter(alive);
export const liveWishlist = (list: WishItem[]) => (list || []).filter(alive);

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

/** Списывается ли этот платёж в указанном месяце. */
export function dueIn(o: Obligation, key = monthKey()): boolean {
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

/** Суммы по 5 разделам бюджета. */
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
    liveCredits(credits).reduce((a, c) => a + c.payment, 0) +
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

/** До зарплаты: когда придут деньги и что нужно заплатить до этого. */
export function untilPayday(
  state: {
    people?: Person[];
    obligations?: Obligation[];
    credits?: Credit[];
    accounts?: Account[];
  },
  now = today(),
) {
  const people = state.people || [];
  const obligations = state.obligations || [];
  const credits = state.credits || [];
  const accountsList = state.accounts || [];

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

  const itemsOf = (k: string) => [
    ...liveObligations(obligations)
      .filter((o) => dueIn(o, k))
      .map((o) => ({ id: o.id, name: o.name, day: o.day, value: amountAt(o, k), when: k })),
    ...liveCredits(credits)
      .map((c) => ({ id: c.id, name: c.name, day: c.day, value: c.payment, when: k })),
  ];

  const due = ahead
    ? itemsOf(key).filter((x) => x.day >= now.day && x.day <= who.payday)
    : [
        ...itemsOf(key).filter((x) => x.day >= now.day),
        ...itemsOf(nextKey)
          .filter((x) => x.day <= who.payday)
          .map((x) => ({ ...x, id: x.id + '@next' })),
      ];
  due.sort((a, b) => a.when.localeCompare(b.when) || a.day - b.day);

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
