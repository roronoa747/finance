import { weekKey } from '@/lib/dates'
import type { Person, PersonId, SyncDoc } from '@/types/finance'
import { DEFAULT_SPEND_CATEGORIES, DICTIONARY, KIND_CATEGORY, UNKNOWN_CATEGORY } from './dictionary'
import type { MerchantRule, Operation, SpendTotal } from './types'

// Модель операций выписки (B2C-02): чистые функции, деньги — целые тенге.

const PATRONYMIC = '(?:вич|вна|ұлы|улы|қызы|кызы|оглы)'
/** «Фамилия Имя Отчество» (Freedom печатает у переводов) — и заглавными. */
const FULL_NAME = new RegExp(
  `(?<!\\p{L})(\\p{Lu}\\p{Ll}+) (\\p{Lu}\\p{Ll}+) \\p{Lu}\\p{Ll}+${PATRONYMIC}(?!\\p{L})` +
    `|(?<!\\p{L})(\\p{Lu}{2,}) (\\p{Lu}{2,}) \\p{Lu}{2,}${PATRONYMIC.toUpperCase()}(?!\\p{L})`,
  'gu',
)

/** Полное ФИО → «Имя Ф.», как банк печатает получателя (Р-23). */
export function shortenFullNames(text: string): string {
  return text.replace(FULL_NAME, (_, s: string, f: string, S: string, F: string) =>
    s ? `${f} ${s[0]}.` : `${F[0]}${F.slice(1).toLowerCase()} ${S[0]}.`,
  )
}

/**
 * Приватность текста выписки (Р-23): IBAN целиком и длинные цифры (номера карт, счетов, ИИН,
 * договоров) убираются, полные ФИО сокращаются до «Имя Ф.»; пробелы схлопнуты, ≤ 120 знаков.
 */
export function sanitize(text: string): string {
  const numbers = text.replace(/KZ[0-9A-Z]{18}/g, '').replace(/\d{6,}/g, '')
  return shortenFullNames(numbers).replace(/\s+/g, ' ').trim().slice(0, 120).trim()
}

/** Правовая форма в начале названия: «ТОО», «ИП», «IP»… — шум для сравнения. */
const LEGAL_FORMS = new Set(['too', 'тоо', 'ao', 'ао', 'ип', 'ip', 'llp', 'ооо', 'ooo'])

/**
 * Хвосты «город / страна / отметка города» в конце названия: Freedom печатает
 * «YANDEX.GO ALMATY KZ», «… ASTANA Q. KZ», «G.ASTANA». Слова по одному — многословные
 * города («mountain view», «khanh hoa») снимаются по словам с конца.
 */
const PLACE_TAILS = new Set([
  'kz', 'kaz', 'rk', 'q', 'g', 'p',
  'almaty', 'алматы', 'astana', 'астана', 'nur-sultan', 'nur', 'sultan', 'нур-султан', 'shymkent',
  'шымкент', 'karaganda', 'караганда', 'aktobe', 'актобе', 'taraz', 'тараз', 'pavlodar', 'павлодар',
  'kostanay', 'костанай', 'semey', 'семей', 'atyrau', 'атырау', 'oral', 'uralsk', 'уральск', 'aktau',
  'актау', 'kyzylorda', 'кызылорда', 'petropavl', 'петропавловск', 'turkestan', 'туркестан',
  'oskemen', 'ust-kamenogorsk', 'усть-каменогорск', 'kokshetau', 'кокшетау', 'taldykorgan',
  'талдыкорган', 'ekibastuz', 'temirtau', 'zhezkazgan',
  'us', 'usa', 'nl', 'ie', 'se', 'sg', 'fi', 'vn', 'ae', 'tr', 'ru', 'gb', 'de', 'cy', 'lu', 'kg',
  'uz', 'cn', 'amsterdam', 'cork', 'dublin', 'helsinki', 'singapore', 'stockholm', 'london',
  'mountain', 'view', 'bellevue', 'dubai', 'istanbul', 'moscow', 'bishkek', 'tashkent', 'khanh',
  'hoa', 'ha', 'noi', 'hcm', 'bac',
])

/**
 * Название продавца для сравнения и словаря: `sanitize`, нижний регистр, без точек и
 * кавычек, без правовой формы в начале и без города/страны/кода терминала в конце.
 * «MAGNUM ALMATY KZ» и «Magnum» → «magnum».
 */
export function normalizeMerchant(raw: string): string {
  const words = sanitize(raw)
    .toLowerCase()
    .replace(/[.,;:"'«»()*/\\]+/g, ' ')
    .split(' ')
    .filter(Boolean)
  while (words.length > 1 && LEGAL_FORMS.has(words[0])) words.shift()
  while (words.length > 1 && (PLACE_TAILS.has(words[words.length - 1]) || /\d/.test(words[words.length - 1]))) {
    words.pop()
  }
  return words.join(' ')
}

/** Имя получателя для правил «кому → что»: «Дана К.» → «дана к.». */
export function normalizeCounterparty(raw: string): string {
  return sanitize(raw).toLowerCase()
}

/** cyrb53 — 53-битный хеш без зависимостей. */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

type FingerprintSource = Pick<Operation, 'bank' | 'date' | 'amount' | 'merchant'>

/**
 * Отпечаток операции (Р-5): одна и та же строка выписки в повторной загрузке — тот же id.
 * `ordinal` — номер среди одинаковых операций того же дня в той же выписке: две
 * одинаковые покупки за день — разные id. 14 hex-знаков.
 */
export function fingerprint(op: FingerprintSource, ordinal: number): string {
  const key = `${op.bank}|${op.date}|${op.amount}|${normalizeMerchant(op.merchant)}|${ordinal}`
  return cyrb53(key).toString(16).padStart(14, '0')
}

/** Проставляет id по порядку строк выписки (ordinal — внутри дня, общий для обоих банков). */
export function assignIds(ops: Omit<Operation, 'id'>[]): Operation[] {
  const seen = new Map<string, number>()
  return ops.map((op) => {
    const key = `${op.bank}|${op.date}|${op.amount}|${normalizeMerchant(op.merchant)}`
    const ordinal = seen.get(key) ?? 0
    seen.set(key, ordinal + 1)
    return { ...op, id: fingerprint(op, ordinal) }
  })
}

export interface Categorized {
  categoryId: string | null
  internal: boolean
  /** «Кому → что»: подпись перевода человеку из правила. */
  personLabel?: string
}

const liveRules = (rules: MerchantRule[]) => rules.filter((r) => !r.deletedAt)

/** Из нескольких правил на одно совпадение — последнее по правке. */
function latest(rules: MerchantRule[]): MerchantRule | undefined {
  return rules.reduce<MerchantRule | undefined>((best, r) => (!best || r.updatedAt > best.updatedAt ? r : best), undefined)
}

function fromRule(rule: MerchantRule): Categorized {
  const to = rule.to
  if ('internal' in to) return { categoryId: null, internal: true }
  if ('person' in to) return { categoryId: 'sc_people', internal: false, personLabel: to.person }
  return { categoryId: to.categoryId, internal: false }
}

/**
 * Раздел операции. Порядок: правило семьи по получателю → правило по продавцу →
 * словарь (вид операции, перевод человеку, слова названия) → null (незнакомое).
 * Решение семьи сильнее разбора: правило снимает и ставит `internal`. Без правила
 * `internal` остаётся, как его поставили разбор и `pairInternalTransfers`.
 */
export function categorize(
  op: Operation,
  rules: MerchantRule[],
  dictionary = DICTIONARY,
): Categorized {
  const live = liveRules(rules)
  if (op.counterparty) {
    const who = normalizeCounterparty(op.counterparty)
    const rule = latest(live.filter((r) => r.match.counterparty === who))
    if (rule) return fromRule(rule)
  }
  const merchant = normalizeMerchant(op.merchant)
  const rule = latest(live.filter((r) => r.match.merchant === merchant))
  if (rule) return fromRule(rule)

  // Приходы и внутренние в траты не входят — раскладывать нечего.
  if (op.amount >= 0 || op.internal) return { categoryId: null, internal: op.internal }
  if (op.kind === 'transfer-out' && op.counterparty) return { categoryId: 'sc_people', internal: false }
  const byKind = KIND_CATEGORY[op.kind]
  if (byKind) return { categoryId: byKind, internal: false }
  const hit = dictionary.find((d) => d.test.test(merchant))
  return { categoryId: hit?.categoryId ?? null, internal: false }
}

/** Пересчёт всех операций после нового правила. */
export function applyRules(ops: Operation[], rules: MerchantRule[], dictionary = DICTIONARY): Operation[] {
  return ops.map((op) => {
    const { categoryId, internal } = categorize(op, rules, dictionary)
    return categoryId === op.categoryId && internal === op.internal ? op : { ...op, categoryId, internal }
  })
}

const DAY_MS = 86_400_000
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS

/**
 * Переводы между своими банками (Р-5): списание без получателя в одном банке и приход без
 * отправителя в другом — равная сумма, даты ±1 день → обе операции внутренние. Каждая
 * операция — не больше чем в одной паре; ближайшая по дате пара побеждает. Переводы людям
 * (есть `counterparty`) и пары внутри одного банка сюда не попадают: «пополнил Kaspi со
 * своей карты и тут же перевёл другу» — это трата, а не внутренний перевод.
 */
export function pairInternalTransfers(ops: Operation[]): Operation[] {
  const candidate = (o: Operation, kind: Operation['kind']) => o.kind === kind && !o.internal && !o.counterparty
  const outs = ops.filter((o) => candidate(o, 'transfer-out')).sort((a, b) => a.date.localeCompare(b.date))
  const ins = ops.filter((o) => candidate(o, 'transfer-in'))
  const paired = new Set<string>()
  for (const out of outs) {
    let best: Operation | undefined
    let bestGap = Infinity
    for (const inc of ins) {
      if (paired.has(inc.id) || inc.bank === out.bank || inc.amount !== -out.amount) continue
      const gap = Math.abs(dayNumber(inc.date) - dayNumber(out.date))
      if (gap <= 1 && gap < bestGap) {
        best = inc
        bestGap = gap
      }
    }
    if (best) {
      paired.add(out.id)
      paired.add(best.id)
    }
  }
  return ops.map((o) => (paired.has(o.id) ? { ...o, internal: true } : o))
}

/**
 * Участник семьи, чьё имя совпадает с получателем («Дана К.» ↔ «Дана»): точное совпадение
 * первого слова. Для подсказки «это перевод партнёру?» (правило `{ internal: true }`).
 */
export function matchPerson(counterparty: string | undefined, people: Person[]): PersonId | null {
  const first = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  if (!counterparty) return null
  const who = first(counterparty)
  if (!who) return null
  return people.find((p) => !p.deletedAt && first(p.name) === who)?.id ?? null
}

/** Период операции: ISO-неделя или месяц по дате выписки. */
export function periodOf(date: string, kind: SpendTotal['kind']): string {
  return kind === 'week' ? weekKey(date) : date.slice(0, 7)
}

/**
 * Итоги по разделам за период (Р-21): только списания, внутренние не входят; незнакомое —
 * `_unknown`. Суммы положительные, целые. Считаются из **всех** операций периода.
 */
export function spendTotals(
  ops: Operation[],
  by: PersonId,
  kind: SpendTotal['kind'],
  period: string,
  at = new Date().toISOString(),
): SpendTotal[] {
  const out = new Map<string, SpendTotal>()
  for (const op of ops) {
    if (op.amount >= 0 || op.internal || periodOf(op.date, kind) !== period) continue
    const categoryId = op.categoryId ?? UNKNOWN_CATEGORY
    const id = `${by}:${kind}:${period}:${categoryId}`
    const total = out.get(id) ?? { id, by, kind, period, categoryId, amount: 0, ops: 0, updatedAt: at }
    total.amount += -op.amount
    total.ops += 1
    out.set(id, total)
  }
  return [...out.values()].sort((a, b) => a.categoryId.localeCompare(b.categoryId))
}

/** Разделы трат в общем документе — дефолтный набор при первой загрузке (Р-22). */
export function seedSpendCategories(doc: SyncDoc, at = new Date().toISOString()): boolean {
  if (doc.spendCategories?.length) return false
  doc.spendCategories = DEFAULT_SPEND_CATEGORIES.map((c) => ({ ...c, updatedAt: at }))
  return true
}

/** Недели и месяцы, которых касаются операции, — их итоги пересчитываются (Р-21). */
export function periodsOf(ops: Operation[]): { kind: SpendTotal['kind']; period: string }[] {
  const out = new Map<string, { kind: SpendTotal['kind']; period: string }>()
  for (const op of ops) {
    for (const kind of ['week', 'month'] as const) {
      const period = periodOf(op.date, kind)
      out.set(`${kind}:${period}`, { kind, period })
    }
  }
  return [...out.values()]
}

/** Итоги предпросмотра: сколько операций, сколько уже было, списания, поступления, внутренние. */
export function draftSummary(ops: Operation[], known: (id: string) => boolean) {
  let spent = 0
  let received = 0
  let internal = 0
  for (const op of ops) {
    if (op.internal) internal += Math.abs(op.amount)
    else if (op.amount < 0) spent += -op.amount
    else received += op.amount
  }
  return { total: ops.length, already: ops.filter((op) => known(op.id)).length, spent, received, internal }
}

export interface UnknownGroup {
  /** Совпадение для правила — продавец или получатель, нормализованный. */
  match: MerchantRule['match']
  /** Как напечатал банк (первая операция группы). */
  label: string
  count: number
  amount: number
}

/**
 * Траты раздела (по умолчанию — незнакомые, раздел не узнан), сгруппированные по продавцу
 * или получателю, — по сумме. Для вопросов разбора и смены раздела задним числом.
 */
export function unknownGroups(ops: Operation[], categoryId: string | null = null): UnknownGroup[] {
  const groups = new Map<string, UnknownGroup>()
  for (const op of ops) {
    if (op.amount >= 0 || op.internal || op.categoryId !== categoryId) continue
    const match = op.counterparty
      ? { counterparty: normalizeCounterparty(op.counterparty) }
      : { merchant: normalizeMerchant(op.merchant) }
    const key = JSON.stringify(match)
    const g = groups.get(key) ?? { match, label: op.counterparty ?? op.merchant, count: 0, amount: 0 }
    g.count += 1
    g.amount += -op.amount
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
}

/**
 * «Это перевод партнёру?» (Р-5): получатели и отправители, чьё имя совпадает с другим
 * участником семьи, пока правила о них нет.
 */
export function partnerHints(
  ops: Operation[],
  people: Person[],
  me: PersonId,
  rules: MerchantRule[],
): { counterparty: string; label: string; person: PersonId }[] {
  const out = new Map<string, { counterparty: string; label: string; person: PersonId }>()
  const others = people.filter((p) => p.id !== me)
  for (const op of ops) {
    if (!op.counterparty || op.internal) continue
    const who = normalizeCounterparty(op.counterparty)
    if (out.has(who) || rules.some((r) => !r.deletedAt && r.match.counterparty === who)) continue
    const person = matchPerson(op.counterparty, others)
    if (person) out.set(who, { counterparty: who, label: op.counterparty, person })
  }
  return [...out.values()]
}

export interface PictureRow {
  categoryId: string
  week: number
  month: number
}

/**
 * Простая картина (B2C-07): траты семьи по разделам за неделю и месяц — сумма итогов всех
 * участников. Порядок — по сумме месяца; нулевые строки не показываются.
 */
export function picture(totals: SpendTotal[], week: string, month: string): PictureRow[] {
  const rows = new Map<string, PictureRow>()
  for (const t of totals) {
    if (t.deletedAt || !t.amount) continue
    const inWeek = t.kind === 'week' && t.period === week
    const inMonth = t.kind === 'month' && t.period === month
    if (!inWeek && !inMonth) continue
    const row = rows.get(t.categoryId) ?? { categoryId: t.categoryId, week: 0, month: 0 }
    if (inWeek) row.week += t.amount
    else row.month += t.amount
    rows.set(t.categoryId, row)
  }
  return [...rows.values()].sort((a, b) => b.month - a.month || b.week - a.week)
}
