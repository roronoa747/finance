import { addDaysIso, todayIso, weekKey } from '@/lib/dates'
import type { Person, PersonId, SyncDoc } from '@/types/finance'
import { DEFAULT_SPEND_CATEGORIES, DICTIONARY, KIND_CATEGORY, UNKNOWN_CATEGORY, plannedElsewhere } from './dictionary'
import type { MerchantRule, OpEdit, Operation, PaymentRule, SpendCategory, SpendTotal } from './types'

// Модель операций выписки (B2C-02): чистые функции, деньги — целые тенге.

const PATRONYMIC = '(?:вич|вна|ична|ұлы|улы|қызы|кызы|оглы)'
/** «Фамилия Имя Отчество» (Freedom печатает у переводов) — и заглавными; фамилия бывает двойной. */
const FULL_NAME = new RegExp(
  `(?<![\\p{L}-])(\\p{Lu}\\p{Ll}+(?:-\\p{Lu}\\p{Ll}+)?) (\\p{Lu}\\p{Ll}+) \\p{Lu}\\p{Ll}+${PATRONYMIC}(?!\\p{L})` +
    `|(?<![\\p{L}-])(\\p{Lu}{2,}(?:-\\p{Lu}{2,})?) (\\p{Lu}{2,}) \\p{Lu}{2,}${PATRONYMIC.toUpperCase()}(?!\\p{L})`,
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
 * Управляющие символы (pdf.js отдаёт их на неизвестных глифах) — первыми: пробельные становятся
 * пробелом, остальные удаляются — номер, разорванный NUL, склеивается и уходит целиком.
 */
export function sanitize(text: string): string {
  const printable = text.replace(/\p{Cc}/gu, (c) => (/\s/.test(c) ? ' ' : ''))
  const numbers = printable.replace(/KZ[0-9A-Z]{18}/g, '').replace(/\d{6,}/g, '')
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

/**
 * Короткое имя продавца для слов разбора и его показа (хвост Х-2 бэклога «Разбор»): правовая форма в начале и город /
 * страна в конце снимаются, как в `normalizeMerchant`, но регистр и знаки внутри названия — как напечатал банк. Код
 * терминала с цифрами — только перед городом («… AST1 ALMATY KZ»): цифры в конце без города — часть имени («Fitness
 * Lab 24»). «MAGNUM ASTANA Q. KZ» → «MAGNUM», «YANDEX.GO ALMATY KZ» → «YANDEX.GO», «Кофейня G.ASTANA» → «Кофейня».
 */
export function shortMerchant(raw: string): string {
  const words = sanitize(raw).split(' ').filter(Boolean)
  const parts = (w: string) => w.toLowerCase().split(/[.,;:"'«»()*/\\]+/).filter(Boolean)
  while (words.length > 1 && LEGAL_FORMS.has(parts(words[0]).join(''))) words.shift()
  let place = false
  while (words.length > 1) {
    const last = parts(words[words.length - 1])
    if (last.every((p) => PLACE_TAILS.has(p))) place = true
    else if (!place || !last.every((p) => PLACE_TAILS.has(p) || /\d/.test(p))) break
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
  /** Правило «это платёж по …» (B2C-15): строка отмечает платёж сама. */
  payment?: PaymentRule
}

const liveRules = (rules: MerchantRule[]) => rules.filter((r) => !r.deletedAt)

/** Из нескольких правил на одно совпадение — последнее по правке. */
function latest(rules: MerchantRule[]): MerchantRule | undefined {
  return rules.reduce<MerchantRule | undefined>((best, r) => (!best || r.updatedAt > best.updatedAt ? r : best), undefined)
}

/**
 * Строка — «такая» для правила платежа (`matching.ts` `paymentFits`: знак и сумма в допуске).
 * Без проверки плановый раздел получает каждая строка продавца.
 */
export type PaymentFits = (op: Operation, payment: PaymentRule) => boolean

/**
 * Раздел из правила; правило платежа без раздела — null: раздел берётся по словарю, как без
 * правила. Строка не «такая» для правила платежа (`fits`, возврат приёмки 2 п. 2) — раздел
 * «остальных» строк `restCategoryId` (ответ «куда отнести?» о том же продавце), нет его — null.
 */
function fromRule(rule: MerchantRule, op: Operation, fits?: PaymentFits): Categorized | null {
  const to = rule.to
  if ('internal' in to) return { categoryId: null, internal: true }
  if ('person' in to) return { categoryId: 'sc_people', internal: false, personLabel: to.person }
  if ('payment' in to) {
    const p = to.payment
    if (fits && !fits(op, p)) return p.restCategoryId ? { categoryId: p.restCategoryId, internal: false, payment: p } : null
    return p.categoryId ? { categoryId: p.categoryId, internal: false, payment: p } : null
  }
  return { categoryId: to.categoryId, internal: false }
}

/** Правило семьи для операции: по получателю, затем по продавцу; последнее по правке. */
export function ruleFor(op: Pick<Operation, 'merchant' | 'counterparty'>, rules: MerchantRule[]): MerchantRule | undefined {
  const live = liveRules(rules)
  if (op.counterparty) {
    const who = normalizeCounterparty(op.counterparty)
    const rule = latest(live.filter((r) => r.match.counterparty === who))
    if (rule) return rule
  }
  const merchant = normalizeMerchant(op.merchant)
  return latest(live.filter((r) => r.match.merchant === merchant))
}

/** Заглушки разбора пуша вместо продавца (сервер, `applepay.Placeholder`): пуш не назвал ни продавца, ни получателя. */
const PHONE_STUBS = ['Покупка', 'Перевод', 'Пополнение', 'Зарплата']
let phoneStubs: Set<string> | null = null

/**
 * Операция пуша с заглушкой вместо продавца («Перевод» без получателя, «Покупка»). Правило семьи по такому «продавцу»
 * било бы по всем таким операциям (ответ «Разное» снимал бы `internal` у будущих пар «перевод себе», «Между своими» —
 * делал своими переводы на чужие карты), поэтому ответ на вопрос «Без раздела» ставится только этой строке
 * (`/ux` Б2, вопрос 5, владелец 2026-10-19): правила семьи — кроме правила платежа — её не трогают.
 */
export function isPhoneStub(op: Pick<Operation, 'source' | 'merchant' | 'counterparty'>): boolean {
  phoneStubs ??= new Set(PHONE_STUBS.map(normalizeMerchant))
  return op.source === 'push' && !op.counterparty && phoneStubs.has(normalizeMerchant(op.merchant))
}

/** «Перевод Айгерим С.» — продавец пуша о переводе человеку (`applepay` сервера): имя и инициал, как у выписки Kaspi. */
const PHONE_PERSON = /^Перевод (\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)? \p{Lu}\.)$/u

/**
 * Получатель перевода с телефона (FB-01, Р-15 б): пуш приходит продавцом «Перевод Имя Ф.» без `counterparty` (Р-23
 * Apple Pay), строка выписки о том же переводе — с `counterparty` «Имя Ф.». Выведенный получатель даёт им один ключ
 * правила (`ruleMatchOf`), раздел «Переводы людям» и «Кому → что», как у выписки. Вывод клиента — на сервер не уходит
 * (`toWire`). «Перевод» без имени — заглушка (`isPhoneStub`), получателя нет. Ничего не выводится — та же операция.
 */
export function withPhoneCounterparty<T extends Pick<Operation, 'source' | 'kind' | 'merchant' | 'counterparty'>>(op: T): T {
  if (!op.source || op.counterparty || (op.kind !== 'transfer-out' && op.kind !== 'transfer-in')) return op
  const who = PHONE_PERSON.exec(op.merchant.trim())?.[1]
  return who ? { ...op, counterparty: who } : op
}

/**
 * Трата, вписанная руками (бэклог «Ручная трата», Р-1, Р-2): обычная личная операция, банк `hand`. Раздел выбрал
 * человек — правила семьи и словарь его не меняют (`categorize`), вопросом «это платёж по …?» она не становится
 * (`matchCandidates`), выписка её не заменяет (`replacedByStatement` берёт только операции с телефона того же банка).
 */
export const isHand = (op: Pick<Operation, 'bank'>) => op.bank === 'hand'

/** Id ручной траты: 16 hex-знаков случайно (сервер принимает `^[0-9a-f]{8,32}$`). */
export function handId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Ручная трата из формы: сумма — целые тенге больше нуля (списание — минус), раздел, дата, заметка «что / где» —
 * без длинных цифр и полных ФИО (`sanitize`, Р-23: сервер строку с номером отверг бы, очередь встала бы). Подпись
 * строки (`merchant`) — заметка, пусто — имя раздела (сервер не берёт покупку без продавца).
 */
export function handOperation(
  input: { id: string; amount: number; categoryId: string; date: string; note: string },
  categoryName: string,
): Operation {
  const note = sanitize(input.note)
  return {
    id: input.id,
    bank: 'hand',
    date: input.date,
    amount: -Math.abs(Math.round(input.amount)),
    kind: 'purchase',
    merchant: note || categoryName,
    ...(note ? { note } : {}),
    categoryId: input.categoryId,
    internal: false,
  }
}

/** Совпадение для правила по операции: получатель, если он есть, иначе продавец. */
export function ruleMatchOf(op: Pick<Operation, 'merchant' | 'counterparty'>): MerchantRule['match'] {
  return op.counterparty ? { counterparty: normalizeCounterparty(op.counterparty) } : { merchant: normalizeMerchant(op.merchant) }
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
  fits?: PaymentFits,
): Categorized {
  // Ручная трата: раздел выбрал человек (Р-1) — ни правило, ни словарь его не трогают.
  if (isHand(op)) return { categoryId: op.categoryId, internal: false }
  const stub = isPhoneStub(op)
  // Заглушка пуша: свой ответ этой строки (`isPhoneStub`) сильнее разбора; правила семьи — только правило платежа.
  if (stub && op.categoryId && op.amount < 0 && !op.internal) return { categoryId: op.categoryId, internal: false }
  const rule = ruleFor(op, stub ? rules.filter((r) => 'payment' in r.to) : rules)
  const byRule = rule ? fromRule(rule, op, fits) : null
  if (byRule) return byRule
  const payment = rule && 'payment' in rule.to ? { payment: rule.to.payment } : {}

  // Приходы и внутренние в траты не входят — раскладывать нечего.
  if (op.amount >= 0 || op.internal) return { categoryId: null, internal: op.internal, ...payment }
  if (op.kind === 'transfer-out' && op.counterparty) return { categoryId: 'sc_people', internal: false, ...payment }
  const byKind = KIND_CATEGORY[op.kind]
  if (byKind) return { categoryId: byKind, internal: false, ...payment }
  const merchant = normalizeMerchant(op.merchant)
  const hit = dictionary.find((d) => d.test.test(merchant))
  return { categoryId: hit?.categoryId ?? null, internal: false, ...payment }
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Пересчёт всех операций после нового правила. `released` — операции, чья отметка из выписки
 * снята (`releasedOps`, B2C-15 п. 3): правило «это платёж по …» им раздел не ставит — операция
 * возвращается в траты (раздел по словарю или виду), само правило остаётся для новых строк.
 * `fits` — плановый раздел правила платежа только «таким» строкам (`paymentFits`).
 */
export function applyRules(
  ops: Operation[],
  rules: MerchantRule[],
  dictionary = DICTIONARY,
  released: ReadonlySet<string> = NONE,
  fits?: PaymentFits,
): Operation[] {
  const unpaid = released.size ? rules.filter((r) => !('payment' in r.to)) : rules
  return ops.map((op) => {
    const { categoryId, internal } = categorize(op, released.has(op.id) ? unpaid : rules, dictionary, fits)
    return categoryId === op.categoryId && internal === op.internal ? op : { ...op, categoryId, internal }
  })
}

const DAY_MS = 86_400_000
/** Дата `YYYY-MM-DD` → номер дня (UTC): разность — расстояние в днях. */
export const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS

/**
 * Переводы между своими банками (Р-5): списание без получателя в одном банке и приход без
 * отправителя в другом — равная сумма, даты ±1 день → обе операции внутренние. Каждая
 * операция — не больше чем в одной паре; ближайшая по дате пара побеждает. Переводы людям
 * (есть `counterparty`) и пары внутри одного банка сюда не попадают: «пополнил Kaspi со
 * своей карты и тут же перевёл другу» — это трата, а не внутренний перевод. Операции с телефона
 * (Apple Pay Блок 2) — тоже нет: получатель пуша живёт в продавце («Перевод Айгерим С.»,
 * `counterparty` пуст, Р-23), их пары ставит сервер (10 минут, без получателя с обеих сторон);
 * выписка своего банка заменит такую операцию строкой, и пара сложится из строк выписок.
 */
export function pairInternalTransfers(ops: Operation[]): Operation[] {
  const candidate = (o: Operation, kind: Operation['kind']) => o.kind === kind && !o.internal && !o.counterparty && !o.source
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

/** Трата выписки: списание, не перевод между своими — одно правило итогов (`spendTotals`) и «Недели» (B2C-92). */
export const isSpend = (op: Pick<Operation, 'amount' | 'internal'>) => op.amount < 0 && !op.internal

/**
 * Сумма траты (FB-02, Р-12): списание минус «Мне вернули», целые тенге, не ниже 0 — одна функция для итогов, ленты,
 * листов, находок, привычек и поездки. Отбор трат — `isSpend` (без изменений): трата с полным возвратом остаётся
 * строкой с суммой 0.
 */
export const spendOf = (op: Pick<Operation, 'amount' | 'refund'>) => Math.max(0, -op.amount - (op.refund?.amount ?? 0))

/** Правки операций (`opEdits` личного документа), что что-то меняют: снятые поля — `null`, запись без полей — нет правки. */
export const liveOpEdits = (edits: OpEdit[]) => edits.filter((e) => !e.deletedAt && (e.memo || e.oneOff || e.refund))

/**
 * Копия операций с наложенными правками (FB-02, Р-11): заметка, «Разовая», «Мне вернули» — на операции; приход, которым
 * вернули (`refund.opId`), — `internal` (не доход, не вопрос «это зарплата?», не «История»). Только для чтения: копия,
 * очередь на сервер и `toWire` работают с сырыми операциями. Без правки — та же операция (тот же объект).
 */
export function withEdits(ops: Operation[], edits: OpEdit[]): Operation[] {
  const live = liveOpEdits(edits)
  if (!live.length) return ops
  const byId = new Map(live.map((e) => [e.id, e]))
  const incomes = new Set(live.map((e) => e.refund?.opId).filter((id): id is string => !!id))
  return ops.map((op) => {
    const e = byId.get(op.id)
    const income = incomes.has(op.id) && op.amount > 0
    if (!e && !income) return op
    return {
      ...op,
      ...(e?.memo ? { memo: e.memo } : {}),
      ...(e?.oneOff ? { oneOff: true } : {}),
      ...(e?.refund && op.amount < 0 ? { refund: { amount: Math.min(e.refund.amount, -op.amount), ...(e.refund.opId ? { opId: e.refund.opId } : {}) } } : {}),
      ...(income ? { internal: true } : {}),
    }
  })
}

/** Окно «Вернули переводом» (Р-12): приход ±14 дней от траты. */
export const REFUND_WINDOW_DAYS = 14

/**
 * Приходы, которыми могли вернуть трату (Р-12): свои `transfer-in` / `income` с суммой не больше траты, ±14 дней, не
 * между своими, не отмеченные зарплатой (`linked` — id операций отметок), не взятые возвратом другой траты; ближайшие по
 * дате первыми. `ops` — копия с правками (`withEdits`).
 */
export function refundCandidates(op: Operation, ops: Operation[], linked: ReadonlySet<string> = new Set()): Operation[] {
  const taken = new Set(ops.filter((o) => o.id !== op.id && o.refund?.opId).map((o) => o.refund!.opId!))
  const day = dayNumber(op.date)
  return ops
    .filter(
      (o) =>
        o.amount > 0 &&
        (o.kind === 'transfer-in' || o.kind === 'income') &&
        (!o.internal || o.id === op.refund?.opId) &&
        !linked.has(o.id) &&
        !taken.has(o.id) &&
        o.amount <= -op.amount &&
        Math.abs(dayNumber(o.date) - day) <= REFUND_WINDOW_DAYS,
    )
    .sort((a, b) => Math.abs(dayNumber(a.date) - day) - Math.abs(dayNumber(b.date) - day) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
}

/**
 * Итоги по разделам за период (Р-21): только списания, внутренние не входят; незнакомое —
 * `_unknown`. Суммы положительные, целые. Считаются из **всех** операций периода. `marks` — у разделов
 * платежей (`plannedElsewhere`) сумма строк без отметки (`unmarked`, хвосты 952/967).
 */
export function spendTotals(
  ops: Operation[],
  by: PersonId,
  kind: SpendTotal['kind'],
  period: string,
  at = new Date().toISOString(),
  marks?: { marked: ReadonlySet<string>; categories: Pick<SpendCategory, 'id' | 'plannedElsewhere'>[] },
): SpendTotal[] {
  const out = new Map<string, SpendTotal>()
  for (const op of ops) {
    if (!isSpend(op) || periodOf(op.date, kind) !== period) continue
    const categoryId = op.categoryId ?? UNKNOWN_CATEGORY
    const id = `${by}:${kind}:${period}:${categoryId}`
    const total = out.get(id) ?? { id, by, kind, period, categoryId, amount: 0, ops: 0, updatedAt: at }
    total.amount += spendOf(op)
    total.ops += 1
    if (marks && !marks.marked.has(op.id) && op.categoryId && plannedElsewhere(op.categoryId, marks.categories)) {
      total.unmarked = (total.unmarked ?? 0) + spendOf(op)
    }
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
    g.amount += spendOf(op)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
}

/** Сколько названий уходит в одном запросе предложений ИИ и какой длины (ручка AI-11 берёт 1…50 по ≤ 80 знаков). */
export const AI_SELLERS_MAX = 50
const AI_SELLER_NAME_MAX = 80

/**
 * Что из пачки «Без раздела» спросить у ИИ (бэклог «ИИ», Р-5): только продавцы — переводы людям (`counterparty`)
 * не уходят; без чисел 6+ (номера карт и счетов); без «ИП + фамилия» (`entrepreneurName`) — человека модель не
 * угадает (B2C-08), а фамилия — чужое имя. Не больше 50 по сумме, одинаковые названия — один раз. `name` — то, что
 * уходит и с чем приходит ответ; `match` — продавец пачки, к которому относится предложение.
 */
export function aiSellerNames(groups: UnknownGroup[]): { name: string; match: MerchantRule['match'] }[] {
  const out: { name: string; match: MerchantRule['match'] }[] = []
  const seen = new Set<string>()
  for (const g of [...groups].sort((a, b) => b.amount - a.amount)) {
    if (!g.match.merchant) continue
    const name = g.label.trim().slice(0, AI_SELLER_NAME_MAX).trim()
    if (!name || /\d{6,}/.test(name) || entrepreneurName(name) || seen.has(name)) continue
    seen.add(name)
    out.push({ name, match: g.match })
    if (out.length === AI_SELLERS_MAX) break
  }
  return out
}

/** Латинское отчество — `sanitize` сокращает полное ФИО только кириллицей. */
const LATIN_PATRONYMIC = /(vich|vna|uly|kyzy|ogly)$/

/**
 * «ИП Абенова», «IP SERIKBAEV A.A. ASTANA KZ», «ИП Дана К.»: ИП и фамилия без цифр. Полное ФИО телефон уже сократил
 * до «Имя Ф.» (`sanitize`), поэтому человек — это одно-два слова после ИП, инициалы и город в конце не в счёт (и три
 * с латинским отчеством). «ИП Сулейменов Аптека Плюс» — три слова: название дела, уходит.
 */
export function entrepreneurName(name: string): boolean {
  const first = name.toLowerCase().replace(/[.,;:"'«»()*/\\]+/g, ' ').trim().split(' ')[0]
  if ((first !== 'ип' && first !== 'ip') || /\d/.test(name)) return false
  const words = normalizeMerchant(name)
    .split(' ')
    .filter((w) => w.length > 1)
  return words.length <= 2 || (words.length === 3 && LATIN_PATRONYMIC.test(words[2]))
}

/** Привычка «часто и по мелочи» (AI-19): окно, сколько покупок и какой средний чек — пороги замера AI-18. */
export const HABIT_DAYS = 90
export const HABIT_MIN_COUNT = 4
export const HABIT_MAX_AVG = 5_000

/**
 * «ИП + фамилия» по привычке (AI-19, решение владельца после замера AI-18: 9 из 9 верно): ИИ их не спрашивают, а
 * частый ИП с мелким чеком — магазин у дома. Своих покупок за 90 дней (окно замера, шире пачки) ≥ 4 и средний чек
 * ≤ 5 000 ₸ → «Продукты»; остальные — без подсказки. Средний — без деления: сумма ≤ 5 000 × покупок. Ключ — `merchant`.
 */
export function habitHints(groups: UnknownGroup[], ops: Operation[], today = todayIso()): Map<string, string> {
  const ips = new Set(groups.filter((g) => g.match.merchant && entrepreneurName(g.label)).map((g) => g.match.merchant!))
  const out = new Map<string, string>()
  if (!ips.size) return out
  const from = addDaysIso(today, -HABIT_DAYS)
  const habit = new Map<string, { count: number; amount: number }>()
  for (const op of ops) {
    if (op.amount >= 0 || op.internal || op.counterparty || op.date < from || op.date > today) continue
    const m = normalizeMerchant(op.merchant)
    if (!ips.has(m)) continue
    const h = habit.get(m) ?? { count: 0, amount: 0 }
    h.count += 1
    h.amount += -op.amount
    habit.set(m, h)
  }
  for (const [m, h] of habit) if (h.count >= HABIT_MIN_COUNT && h.amount <= HABIT_MAX_AVG * h.count) out.set(m, 'sc_food')
  return out
}

