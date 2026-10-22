import { addDaysIso, addMonths, daysInMonth, weekKey, weekRange } from '@/lib/dates'
import { amountAt, SPEND_LAST } from '@/lib/finance'
import type { Credit, Obligation, PersonId, RateBook } from '@/types/finance'
import { UNKNOWN_CATEGORY, plannedElsewhere } from './dictionary'
import { detectRecurring } from './firstRun'
import { habitKeepFrom, habitOf } from './habits'
import { dayNumber, entrepreneurName, isSpend, normalizeMerchant, ruleFor, spendOf } from './model'
import type { MerchantRule, Operation, ReviewFind, SpendCategory } from './types'

// Находки по операциям (бэклог «Разбор», Р-13, Р-14, RZ-01): каждый телефон ищет их по своим операциям — операции
// личные и есть только у участника. В общий документ уходят итоги месяца: продавец (как печатает банк после `sanitize`,
// ≤ 40 знаков), раздел, счётчик, сумма, у подорожания — «было». Не уходят: даты операций, переводы людям
// (`counterparty`, разделы «Переводы людям» и «Наличные»), внутренние, «ИП + фамилия» (`entrepreneurName`) и названия с
// 6+ цифрами. Находки семьи, цену в год,
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
 * Продавец, которого можно назвать в документе и модели: трата, не перевод человеку (ни `counterparty`, ни раздел
 * «Переводы людям» / «Наличные» — `SPEND_LAST`: семья сама отнесла строку к людям), не внутренний, без 6+ цифр, не
 * «ИП + фамилия», не разовая (FB-07, Р-16: автошкола — не находка); `categories` — ещё и раздел не из плана (кредиты,
 * аренда, подписки — для утечек и верхушек).
 */
export function sellerOk(op: Operation, categories?: Categories): boolean {
  if (!isSpend(op) || op.counterparty || op.internal || op.oneOff) return false
  if (op.categoryId && SPEND_LAST.includes(op.categoryId)) return false
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
  // Возврат на всю сумму (`spendOf` 0, FB-02) — не трата продавца.
  const mine = ops.filter((op) => inMonth(op, period) && sellerOk(op, categories) && habitOf(op) === null && spendOf(op) > 0)
  const out: ReviewFind[] = []
  for (const [key, list] of bySeller(mine)) {
    const amount = list.reduce((s, op) => s + spendOf(op), 0)
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
    // Разовая (FB-07) — не в сумме раздела: верхушка сходится со строкой «Трат» без разовых.
    if (!inMonth(op, period) || !isSpend(op) || !op.categoryId || !spendOf(op) || op.oneOff) continue
    const c = op.categoryId
    if (c === UNKNOWN_CATEGORY || SPEND_LAST.includes(c) || plannedElsewhere(c, categories)) continue
    const list = groups.get(c)
    if (list) list.push(op)
    else groups.set(c, [op])
  }
  const out: ReviewFind[] = []
  for (const [categoryId, list] of groups) {
    const amount = list.reduce((s, op) => s + spendOf(op), 0)
    // В покупки — только те, что можно назвать (без людей и ИП); в сумму и счётчик — все траты раздела.
    const top = list
      .filter((op) => sellerOk(op))
      .sort((a, b) => spendOf(b) - spendOf(a) || a.date.localeCompare(b.date))
      .slice(0, 2)
      .map((op) => ({ name: clipName(op.merchant), amount: spendOf(op) }))
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
  // Возврат на всю сумму (`spendOf` 0, FB-02) — не списание: двойное, которое банк вернул, — не находка (критик Блока 1).
  const window = ops.filter((op) => op.date.slice(0, 7) >= from && op.date.slice(0, 7) <= period && sellerOk(op) && spendOf(op) > 0)
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

  // Подорожания: строка месяца по правилу платежа обязательства дороже плана месяца. У оценки («сумма плавает»,
  // коммуналка) план — не цена: зимний счёт выше оценки — не подорожание.
  const pricier = new Map<string, ReviewFind>()
  for (const op of window) {
    if (!inMonth(op, period)) continue
    const p = paymentOf(op, ctx.rules)
    if (p?.kind !== 'obligation') continue
    const o = ctx.obligations.find((x) => x.id === p.targetId && !x.deletedAt)
    if (!o || o.estimate) continue
    const was = amountAt(o, period, ctx.book)
    const paid = spendOf(op)
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

/* ---------------- находки v4 по своим операциям (бэклог «Фидбек», Р-23, Р-24, FB-15) ---------------- */

// Считаются на телефоне хозяина при открытии отчёта и в документ не пишутся (Р-27): имя человека — только в `top`
// переводов людям, для строки карточки на своём экране. Разовые (`oneOff`) и возвращённое целиком (`spendOf` 0) — мимо.
// Пороги — константы, владелец правит числом; доли от факта месяца проверяет `reviewCards` (`finance.ts`).

/** «Не разобрано» — карточка от 10 % своего факта месяца, первой. */
export const UNKNOWN_SHARE = 10
/** «Переводы людям» — от 20 % факта; «Наличные» — от 10 %. */
export const PEOPLE_SHARE = 20
export const CASH_SHARE = 10
/** «Похоже на разовую»: покупка от 20 000 ₸ и от 5 % факта у продавца без операций за 3 прошлых месяца; до 2. */
export const ONE_OFF_MIN = 20_000
export const ONE_OFF_SHARE = 5
export const ONE_OFF_MAX = 2
const ONE_OFF_MONTHS = 3
/** «Дорогая неделя»: неделя месяца от 130 % средней из 4 прошлых полных недель. */
export const WEEK_DEAR_PCT = 130
export const WEEK_BASE = 4
/** «Мелочь»: покупки дешевле 2 000 ₸ — карточка от 10 % факта. */
export const SMALL_MAX = 2_000
export const SMALL_SHARE = 10

const spendIn = (ops: Operation[], period: string) => ops.filter((op) => inMonth(op, period) && isSpend(op) && !op.oneOff && spendOf(op) > 0)
const sumOf = (list: Operation[]) => list.reduce((s, op) => s + spendOf(op), 0)

/**
 * Свободная трата — то, что человек выбирает сам: не разовая, не возвращённая целиком, не перевод людям и не наличные
 * (`SPEND_LAST`), не раздел платежей (`plannedElsewhere`). Её считают «Похоже на разовую», «Дорогая неделя», «Мелочь» и
 * выходные.
 */
function freeOk(op: Operation, categories: Categories): boolean {
  if (!isSpend(op) || op.oneOff || spendOf(op) <= 0) return false
  const c = op.categoryId
  return !(c && (SPEND_LAST.includes(c) || plannedElsewhere(c, categories)))
}

/** Сумма, число и id своих трат месяца в разделе. */
export type ShareFind = { amount: number; count: number; opIds: string[] }

function shareIn(ops: Operation[], period: string, categoryId: string): ShareFind {
  const list = spendIn(ops, period).filter((op) => (op.categoryId ?? UNKNOWN_CATEGORY) === categoryId)
  return { amount: sumOf(list), count: list.length, opIds: list.map((op) => op.id) }
}

/**
 * Переводы людям месяца — раздел `sc_people` (ответ «Кому → что» перенёс перевод в другой раздел — уже не здесь); `top` —
 * получатель с наибольшей суммой (имя только для строки карточки на телефоне хозяина).
 */
export function peopleShare(ops: Operation[], period: string): ShareFind & { top: string | null } {
  const share = shareIn(ops, period, 'sc_people')
  const sums = new Map<string, number>()
  for (const op of spendIn(ops, period)) {
    if (op.categoryId !== 'sc_people' || !op.counterparty) continue
    sums.set(op.counterparty, (sums.get(op.counterparty) ?? 0) + spendOf(op))
  }
  const top = [...sums].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return { ...share, top: top ? top[0] : null }
}

/** Наличные месяца — раздел `sc_cash`; `bare` — снятий без заметки (их и просит «На что?»). */
export function cashShare(ops: Operation[], period: string): ShareFind & { bare: number } {
  const share = shareIn(ops, period, 'sc_cash')
  const bare = spendIn(ops, period).filter((op) => op.categoryId === 'sc_cash' && !op.memo).length
  return { ...share, bare }
}

/** «Не разобрано» месяца — траты без раздела (`UNKNOWN_CATEGORY`, как в итогах). */
export const unknownShare = (ops: Operation[], period: string): ShareFind => shareIn(ops, period, UNKNOWN_CATEGORY)

/**
 * Похоже на разовую: свободная покупка от `ONE_OFF_MIN` и от `ONE_OFF_SHARE` % факта `fact`, у продавца без операций за
 * 3 прошлых месяца; до `ONE_OFF_MAX` по сумме. Без своих операций раньше месяца — пусто: «новым» был бы каждый продавец.
 * Трата без раздела — мимо: её сначала разбирают карточкой «Не разобрано» (одна операция — одна карточка).
 */
export function oneOffLike(ops: Operation[], period: string, fact: number, categories: Categories = []): { opId: string; name: string; amount: number }[] {
  const from = addMonths(period, -ONE_OFF_MONTHS)
  const before = ops.filter((op) => op.date.slice(0, 7) >= from && op.date.slice(0, 7) < period && isSpend(op))
  if (!before.length || fact <= 0) return []
  const seen = new Set(before.map(keyOf))
  return ops
    .filter((op) => inMonth(op, period) && !!op.categoryId && op.categoryId !== UNKNOWN_CATEGORY && freeOk(op, categories) && sellerOk(op) && !seen.has(keyOf(op)))
    .filter((op) => spendOf(op) >= ONE_OFF_MIN && spendOf(op) * 100 >= fact * ONE_OFF_SHARE)
    .sort((a, b) => spendOf(b) - spendOf(a) || a.id.localeCompare(b.id))
    .slice(0, ONE_OFF_MAX)
    .map((op) => ({ opId: op.id, name: clipName(op.merchant), amount: spendOf(op) }))
}

/**
 * Неделя месяца дороже обычной: ISO-неделя с понедельником в месяце, целиком в своих операциях (от первой до последней
 * даты), чьи свободные траты — от `WEEK_DEAR_PCT` % средней из `WEEK_BASE` полных недель перед ней; из таких — с
 * наибольшим ростом. `pct` — на сколько процентов выше средней; `opId` — самая крупная свободная трата недели.
 */
export function dearerWeek(ops: Operation[], period: string, categories: Categories = []): { week: string; amount: number; usual: number; pct: number; opId: string } | null {
  const free = ops.filter((op) => freeOk(op, categories))
  const dates = ops.map((op) => op.date).sort()
  if (!free.length || !dates.length) return null
  const [first, last] = [dates[0], dates[dates.length - 1]]
  const inWeek = (from: string, to: string) => free.filter((op) => op.date >= from && op.date <= to)
  let best: { week: string; amount: number; usual: number; pct: number; opId: string } | null = null
  for (let day = `${period}-01`; day.slice(0, 7) === period; day = addDaysIso(day, 1)) {
    const week = weekKey(day)
    const r = weekRange(week)
    if (r.from !== day || r.to > last) continue
    const base = Array.from({ length: WEEK_BASE }, (_, i) => weekRange(weekKey(addDaysIso(r.from, -7 * (i + 1)))))
    if (base[WEEK_BASE - 1].from < first) continue
    const usual = Math.round(base.reduce((s, b) => s + sumOf(inWeek(b.from, b.to)), 0) / WEEK_BASE)
    const list = inWeek(r.from, r.to)
    const amount = sumOf(list)
    if (usual <= 0 || amount * 100 < usual * WEEK_DEAR_PCT) continue
    const pct = Math.round((amount * 100) / usual) - 100
    if (best && best.pct >= pct) continue
    const top = list.reduce((a, b) => (spendOf(b) > spendOf(a) || (spendOf(b) === spendOf(a) && b.id < a.id) ? b : a))
    best = { week, amount, usual, pct, opId: top.id }
  }
  return best
}

/** Мелкие свободные покупки месяца — дешевле `SMALL_MAX`: число и сумма. */
export function smallBuys(ops: Operation[], period: string, categories: Categories = []): { count: number; amount: number } {
  const list = ops.filter((op) => inMonth(op, period) && freeOk(op, categories) && op.kind === 'purchase' && spendOf(op) < SMALL_MAX)
  return { count: list.length, amount: sumOf(list) }
}

/**
 * Выходные месяца: доля свободных трат в сб–вс (`share`, целые %) и доля таких дней в месяце (`days`, целые %); трат нет
 * — null. Картинка «Куда ушло» (Р-25), без кнопки.
 */
export function weekendShare(ops: Operation[], period: string, categories: Categories = []): { share: number; days: number } | null {
  const list = ops.filter((op) => inMonth(op, period) && freeOk(op, categories))
  const total = sumOf(list)
  if (total <= 0) return null
  const weekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())
  const part = sumOf(list.filter((op) => weekend(op.date)))
  const length = daysInMonth(period)
  const days = Array.from({ length }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`).filter(weekend).length
  return { share: Math.round((part * 100) / total), days: Math.round((days * 100) / length) }
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
