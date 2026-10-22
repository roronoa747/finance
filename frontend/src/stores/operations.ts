import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useEventsStore } from './events'
import { useFxStore } from '@/stores/fx'
import { OPERATIONS_STORAGE_KEYS, readStorage, writeStorage } from '@/lib/storage'
import { creditDueAmount, lastAccountFor, openGoals, phoneOpTenge, tripOps, tripStatus, tripTotal } from '@/lib/finance'
import { addDaysIso, todayIso } from '@/lib/dates'
import {
  applyRules,
  isHand,
  isPhoneStub,
  liveOpEdits,
  refundCandidates,
  withEdits,
  withPhoneCounterparty,
  pairInternalTransfers,
  periodsOf,
  ruleFor,
  ruleMatchOf,
  seedSpendCategories,
  spendTotals,
} from '@/lib/statements/model'
import { declineKey, isDeclined, markedOps, matchCandidates, operationAt, paymentFits, recentOperations, releasedOps, type MatchCandidate } from '@/lib/statements/matching'
import { habitKeepFrom, habitTotals } from '@/lib/statements/habits'
import { replacementPairs } from '@/lib/statements/phone'
import { findKeepFrom, reviewFinds, sameFind } from '@/lib/statements/finds'
import type { HabitTotal, MerchantRule, Operation, ParsedStatement, ReviewFind, SpendTotal } from '@/lib/statements/types'
import type { OperationWire, StatementUploadResponse } from '@/types/api'
import type { Goal, PersonId, TripSpend } from '@/types/finance'

// Операции выписок (B2C-07): личная копия своих операций, очередь неотправленного, записи
// загрузок семьи и черновик разбора. Файл выписки разбирается на телефоне и никуда не уходит
// (Р-4): на сервер идут только записи загрузок и операции без ФИО и номеров (Р-23).
// Сопоставление с отметками (Р-6, B2C-15): предложения — `matchCandidates`, «да» — запись
// `payments` с источником «выписка» и правило «это платёж по …», «нет» — на месяц на устройстве.

const { ops: KEY_OPS, cursor: KEY_CURSOR, pending: KEY_PENDING, demoUploads: KEY_DEMO_UPLOADS, declined: KEY_DECLINED } = OPERATIONS_STORAGE_KEYS
const KEYS = Object.values(OPERATIONS_STORAGE_KEYS)

/**
 * Сколько висит тост «Загружено N · Отменить» (Р-97): отправка выписки ждёт столько — удаления загрузки на сервере
 * нет, поэтому «Отменить» работает до отправки.
 */
export const UPLOAD_HOLD_MS = 6_000

/** Итог тот же: сумма, строки, сумма без отметки и разовые — запись не нужна. */
const sameTotal = (a: SpendTotal | undefined, b: SpendTotal) =>
  !!a &&
  !a.deletedAt &&
  a.amount === b.amount &&
  a.ops === b.ops &&
  (a.unmarked ?? 0) === (b.unmarked ?? 0) &&
  (a.oneOff ?? 0) === (b.oneOff ?? 0)

/** Операций в одном POST /api/operations/batch (сервер принимает до 2000). */
export const BATCH_SIZE = 500
/** Страница GET /api/operations. */
export const PULL_LIMIT = 2000
/**
 * Курсор — `updated_at` = начало транзакции на сервере: загрузка, начатая раньше, может
 * закоммититься позже соседней и встать «за» курсор. Первый запрос берёт с запасом; повтор
 * строк безвреден — копия пишется по id.
 */
export const CURSOR_OVERLAP_MS = 60_000
/** Возврат в приложение подтягивает траты с телефона не чаще раза в столько (Р-19). */
export const PHONE_PULL_MS = 30_000

export type UploadInput = { bank: string; period_from: string; period_to: string; ops_count: number }

/** Неотправленное: запись загрузки (если есть) и её операции; уходит кусками по BATCH_SIZE. */
export interface PendingJob {
  key: string
  upload?: UploadInput
  uploadId?: string
  ops: Operation[]
  /** Надгробия: траты с телефона, которые заменила выписка (Р-16). */
  deleted?: true
}

export interface DraftFile {
  name: string
  parsed: ParsedStatement
}

export interface Draft {
  files: DraftFile[]
  /**
   * Файлы, которые не удалось разобрать: имя и спокойное объяснение; `detail` — этап и текст
   * технической ошибки (консоли на телефоне нет — причину видно на скриншоте).
   */
  errors: { name: string; message: string; detail?: string }[]
}

export function toWire(op: Operation): OperationWire {
  return {
    id: op.id,
    bank: op.bank,
    date: op.date,
    amount: op.amount,
    kind: op.kind,
    merchant: op.merchant,
    // Получатель операции с телефона — вывод клиента из продавца (`withPhoneCounterparty`, FB-01): на сервер не уходит.
    counterparty: op.source ? null : (op.counterparty ?? null),
    note: op.note ?? null,
    category_id: op.categoryId,
    internal: op.internal,
    upload_id: op.uploadId ?? null,
    // source, at и fx пишет только сервер (Р-14): батч их не шлёт.
  }
}

/** Надгробие операции с телефона (Р-16): выписка её заменила — уходит тем же батчем, сервер не воскрешает. */
export const tombstoneWire = (op: Operation): OperationWire => ({ ...toWire(op), deleted: true })

export function fromWire(w: OperationWire): Operation {
  return withPhoneCounterparty({
    id: w.id,
    bank: w.bank as Operation['bank'],
    date: w.date,
    amount: w.amount,
    kind: w.kind as Operation['kind'],
    merchant: w.merchant,
    ...(w.counterparty ? { counterparty: w.counterparty } : {}),
    ...(w.note ? { note: w.note } : {}),
    categoryId: w.category_id ?? null,
    internal: w.internal,
    ...(w.upload_id ? { uploadId: w.upload_id } : {}),
    ...(w.source === 'tap' || w.source === 'push' ? { source: w.source } : {}),
    ...(w.occurred_at ? { at: w.occurred_at } : {}),
    ...(w.fx_currency && w.fx_amount ? { fx: { currency: w.fx_currency, amount: w.fx_amount } } : {}),
  })
}

const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false
const newKey = () => Math.random().toString(36).slice(2, 10)

export const useOperationsStore = defineStore('operations', () => {
  const auth = useAuthStore()
  const finance = useFinanceStore()

  // Копия принадлежит человеку в семье документа: другая семья, другой вход или выход —
  // всё стирается (операции личные, Р-5: на общем телефоне партнёр их не увидит).
  const ownerKey = () => (finance.docHousehold && auth.user ? `${finance.docHousehold}:${auth.user.id}` : null)
  const saved = readStorage<{ owner: string | null; ops: Record<string, Operation> }>(KEY_OPS, { owner: null, ops: {} })
  const owner = ref<string | null>(ownerKey())
  const fresh = saved.owner !== null && saved.owner === owner.value
  // Копия до FB-01 хранила пуш-переводы без выведенного получателя — выводится при чтении с диска.
  const ops = ref<Record<string, Operation>>(fresh ? Object.fromEntries(Object.entries(saved.ops).map(([id, o]) => [id, withPhoneCounterparty(o)])) : {})
  const cursor = ref<string | null>(fresh ? readStorage<string | null>(KEY_CURSOR, null) : null)
  const pending = ref<PendingJob[]>(fresh ? readStorage<PendingJob[]>(KEY_PENDING, []) : [])
  const demoUploads = ref<StatementUploadResponse[]>(fresh ? readStorage<StatementUploadResponse[]>(KEY_DEMO_UPLOADS, []) : [])
  const declined = ref<string[]>(fresh ? readStorage<string[]>(KEY_DECLINED, []) : [])
  const serverUploads = ref<StatementUploadResponse[]>([])
  const status = ref<'idle' | 'sending' | 'offline' | 'error'>('idle')
  const lastError = ref<string | null>(null)
  const draft = ref<Draft | null>(null)
  /** Выписка выбрана и показана, отправка ждёт тост «Отменить» (`upload`). */
  const held = ref(false)
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  /** Сколько строк последней отправки отметилось по правилам («Отмечено по выписке: N»). */
  const lastAutoMarked = ref(0)
  let flushing: Promise<void> | null = null
  let pulling: Promise<unknown> = Promise.resolve()
  let lastPullAt = 0

  const demo = computed(() => auth.isDemo || finance.isDemo)
  const me = (): PersonId => auth.slot ?? 'a'
  const uploads = computed(() => (demo.value ? demoUploads.value : serverUploads.value))
  /** Сырая копия — то, что лежит на устройстве и уходит на сервер (`toWire`). */
  const raw = computed(() => Object.values(ops.value))
  /** Свои операции с правками личного документа (FB-02, Р-11: заметка, «Мне вернули», приход-возврат `internal`) — для чтения. */
  const all = computed(() => withEdits(raw.value, finance.opEdits))
  const pendingCount = computed(() => pending.value.reduce((n, j) => n + j.ops.length, 0))

  /* ---------- сопоставление с отметками (B2C-15) ---------- */
  // Обмены и книга — тенге валютной зарплаты (B2C-80, `salaryTenge`) и зачисления обменов.
  const matchState = () => ({ obligations: finance.obligations, credits: finance.credits, people: finance.people, payments: finance.payments, fxExchanges: finance.fxExchanges, book: useFxStore().book })
  /** Все предложения по своим операциям этого и прошлого месяца, кроме отклонённых «нет» на этом устройстве. */
  const openMatches = computed<MatchCandidate[]>(() =>
    auth.isViewer
      ? []
      : matchCandidates(recentOperations(all.value), matchState(), finance.merchantRules, me()).filter((c) => !isDeclined(c, declined.value)),
  )
  /** Предложения, что ждут ответа (вопросы «Недели»). */
  const pendingMatches = computed<MatchCandidate[]>(() => openMatches.value.filter((c) => c.confidence !== 'rule'))
  /**
   * «Пришла?» у зарплаты (бэклог «Apple Pay», Блок 2, Р-22): приход из пуша, который `matchCandidates` считает зарплатой
   * своей неотмеченной строки — те же допуски и окна, что у выписки, новых порогов нет; по правилу семьи тоже (отметки
   * с телефона сами не ставятся — их ставит человек). Точка у «Пришла» этой зарплаты; «Пришла» отмечает приход так же,
   * как «Да» в вопросе «Недели» (`acceptMatch`). «Нет» в вопросе снимает и точку. Viewer — пусто.
   */
  const salaryArrivals = computed(() =>
    openMatches.value.flatMap((c) => {
      const op = ops.value[c.opId]
      return c.kind === 'salary' && op?.source === 'push' ? [{ candidate: c, op }] : []
    }),
  )
  /** Приход из пуша для зарплаты `person` за `period` (месяц или ключ аванса/недели) — или null. */
  const salaryArrival = (person: PersonId, period: string) =>
    salaryArrivals.value.find((a) => a.candidate.targetId === person && a.candidate.period === period) ?? null
  /** Операции со снятой отметкой из выписки (у себя или у партнёра): правило платежа им раздел не ставит. */
  const released = computed(() => releasedOps(finance.payments))
  /**
   * Правила семьи к операциям: снятым отметкам — без правила платежа, плановый раздел — только
   * «таким» строкам правила платежа (знак и сумма в допуске, `paymentFits`).
   */
  const reapply = (list: Operation[]) => applyRules(list, finance.merchantRules, undefined, released.value, paymentFits(matchState()))
  /** Строки черновика, которые отметятся сами при отправке — по правилам семьи. */
  const draftAutoMatches = computed(() => matchCandidates(draftOps.value, matchState(), finance.merchantRules, me()).filter((c) => c.confidence === 'rule'))

  /**
   * Запись отметки по строке выписки: сумма операции, «не списывать» — выписка уже факт (Р-6);
   * момент — день операции (`operationAt`): платёж до сверки остатка его второй раз не уменьшает.
   * `accountId` — «Пришла» по пушу банка (Apple Pay Б2): зарплата зачисляется, как обычной «Пришла».
   */
  function markByOperation(c: MatchCandidate, op: Operation, accountId: string | null = null) {
    const opts = { period: c.period, amount: Math.abs(op.amount), accountId, source: 'statement' as const, opId: op.id, at: operationAt(op.date) }
    return c.kind === 'salary' ? finance.markSalary(c.targetId as PersonId, opts) : finance.markPaid(c.kind, c.targetId, me(), opts)
  }

  /**
   * «Да, отметить»: запись + правило «это платёж по …» по продавцу или получателю (раздел — плановый).
   * Остальные строки того же продавца этого и прошлого месяца по новому правилу стали «rule» — из
   * вопросов они ушли, поэтому отмечаются сразу (те, что прошли проверку суммы правила); сколько —
   * прибавляется к «Отмечено по выписке». Правило пишется до первого ожидания в `recategorize`, так
   * что отметка не ждёт сети. `accountId` — счёт зачисления («Пришла» по пушу, `useSalaryTap`); не задан —
   * зарплата из пуша (вопрос «Недели» «Да, зарплата») зачисляется на счёт прошлой зарплаты, как «Пришла»
   * (`/ux` Б2, вопрос 3, владелец 2026-10-19: одна отметка — один результат); строка выписки — «не зачислять».
   */
  async function acceptMatch(c: MatchCandidate, client: ApiClient = apiClient, accountId?: string | null) {
    const op = ops.value[c.opId]
    if (!op) return
    const account =
      accountId !== undefined
        ? accountId
        : c.kind === 'salary' && op.source === 'push'
          ? (lastAccountFor(finance.payments, c.targetId, finance.accounts) ?? null)
          : null
    markByOperation(c, op, account)
    const match = ruleMatchOf(op)
    const saving = recategorize(match, { payment: { kind: c.kind, targetId: c.targetId, categoryId: c.categoryId } }, client)
    const same = recentOperations(all.value).filter((o) => {
      const m = ruleMatchOf(o)
      return m.merchant === match.merchant && m.counterparty === match.counterparty
    })
    const n = autoMark(same)
    if (n) lastAutoMarked.value += n
    // Отмеченные строки уходят из трат сразу, не дожидаясь наблюдателя отметок (хвосты 952/967).
    writeTotals(periodsOf([op, ...same]))
    await saving
  }

  /** «Нет, это другое»: операция больше не предлагается ни одной цели — на устройстве (FB-01), правилом не становится. */
  function declineMatch(c: MatchCandidate) {
    const k = declineKey(c)
    if (!declined.value.includes(k)) declined.value = [...declined.value, k]
    save()
    // Строка не платёж — в раздел платежей она теперь трата (`markedOps`, хвосты 952/967).
    const op = ops.value[c.opId]
    if (op) writeTotals(periodsOf([op]))
  }

  /**
   * Автоотметка по правилам среди только что отправленных строк; сколько отметилось. Операции с телефона — нет: отметки
   * сами ставит выписка (Р-2 «выписка — истина»), вопрос «это платёж?» по ним задаётся как по любым.
   */
  function autoMark(list: Operation[]): number {
    let n = 0
    for (const c of matchCandidates(list.filter((o) => !o.source), matchState(), finance.merchantRules, me())) {
      if (c.confidence !== 'rule') continue
      const op = list.find((o) => o.id === c.opId)
      if (op && markByOperation(c, op)) n += 1
    }
    return n
  }

  function save() {
    writeStorage(KEY_OPS, { owner: owner.value, ops: ops.value })
    writeStorage(KEY_CURSOR, cursor.value)
    writeStorage(KEY_PENDING, pending.value)
    writeStorage(KEY_DEMO_UPLOADS, demoUploads.value)
    writeStorage(KEY_DECLINED, declined.value)
  }

  function clear(key: string | null = null) {
    owner.value = key
    ops.value = {}
    cursor.value = null
    pending.value = []
    demoUploads.value = []
    declined.value = []
    serverUploads.value = []
    dropHold()
    draft.value = null
    lastAutoMarked.value = 0
    status.value = 'idle'
    lastError.value = null
    try {
      if (typeof localStorage !== 'undefined') for (const k of KEYS) localStorage.removeItem(k)
    } catch {
      // хранилище недоступно — в памяти уже пусто
    }
  }

  watch(ownerKey, (key) => {
    if (key !== owner.value) clear(key)
  })

  /**
   * Черновик разбора: операции с правилами семьи и парами внутренних переводов. Пересекающиеся
   * выписки одного банка дают общие операции с одинаковыми id — каждая считается один раз.
   */
  const draftOps = computed<Operation[]>(() => {
    if (!draft.value) return []
    const byId = new Map<string, Operation>()
    for (const f of draft.value.files) for (const o of f.parsed.operations) if (!byId.has(o.id)) byId.set(o.id, o)
    const fresh = [...byId.values()]
    const ids = new Set(byId.keys())
    const withRules = reapply(fresh)
    const others = raw.value.filter((o) => !ids.has(o.id))
    return pairInternalTransfers([...withRules, ...others]).slice(0, withRules.length)
  })

  function setDraft(files: DraftFile[], errors: Draft['errors'] = []) {
    draft.value = { files, errors }
  }

  function cancelDraft() {
    draft.value = null
  }

  /* ---------- «сразу готово» (Р-97): показать сразу, отправить после тоста ---------- */
  function dropHold() {
    if (holdTimer) clearTimeout(holdTimer)
    holdTimer = null
    held.value = false
  }

  /**
   * Выписка выбрана — «Неделя» показывает её сразу (`shown`, `shownTotals`, `shownUploads`), а запись и отправка
   * (`send`) ждут `UPLOAD_HOLD_MS`: пока висит тост, «Отменить» (`undoUpload`) возвращает как было — ни операций,
   * ни итогов, ни очереди. Прошлая выписка ещё ждёт — сначала отправляется она: двойная загрузка её не теряет.
   */
  async function upload(files: DraftFile[], client: ApiClient = apiClient) {
    await commitUpload(client)
    if (!files.length) return
    setDraft(files)
    held.value = true
    holdTimer = setTimeout(() => void commitUpload(client), UPLOAD_HOLD_MS)
  }

  /**
   * Тост ушёл, экран закрыли или вкладку скрыли — отправка сразу; ждать нечего — ничего не делает. Все операции выписки
   * уже были («Эти N операций уже были») — новых данных нет: ни второй записи загрузки, ни отправки (ревью Б15, Н-5).
   */
  async function commitUpload(client: ApiClient = apiClient) {
    if (!held.value) return
    dropHold()
    const fresh = draftOps.value
    if (fresh.length && fresh.every((o) => o.id in ops.value)) return cancelDraft()
    await send(client)
  }

  /** «Отменить» в тосте: выписка не записана и не отправлена. */
  function undoUpload() {
    if (!held.value) return
    dropHold()
    cancelDraft()
  }

  /** Траты с телефона, которые заменит выписка черновика (Р-16), → строка выписки (фантом — null). */
  const draftPairs = computed<Map<string, string | null>>(() => {
    if (!draft.value) return new Map()
    const phone = raw.value.filter((o) => o.source)
    if (!phone.length) return new Map()
    const spans = draft.value.files.map((f) => ({ bank: f.parsed.bank, from: f.parsed.from, to: f.parsed.to }))
    // Строки прошлой выписки (перекрытие периодов) свою пару уже взяли — второй раз не сопоставляются (критик Б1):
    // иначе та же строка уберёт ещё одно касание, которого в выписке нет. Фантомы — по периодам, как прежде.
    return replacementPairs(draftOps.value.filter((o) => !(o.id in ops.value)), phone, spans)
  })
  /** Траты с телефона, которые заменит выписка черновика (Р-16), — `send` уберёт их надгробиями. */
  const draftReplaced = computed<Operation[]>(() => raw.value.filter((o) => draftPairs.value.has(o.id)))

  /** Свои операции вместе с выпиской, которая ещё ждёт тост, — без трат с телефона, которые она заменит. */
  const shown = computed<Operation[]>(() => {
    if (!held.value) return all.value
    const ids = new Set([...draftOps.value, ...draftReplaced.value].map((o) => o.id))
    // Та же выписка второй раз — строки черновика с правками, что уже есть (FB-02).
    return [...all.value.filter((o) => !ids.has(o.id)), ...withEdits(draftOps.value, finance.opEdits)]
  })
  /** Итоги семьи, где свои периоды ждущей выписки пересчитаны с ней — тем же `spendTotals`, что запишет `send`. */
  const shownTotals = computed(() => {
    const base = finance.householdDoc.spendTotals ?? []
    if (!held.value) return base
    const by = me()
    const periods = periodsOf([...draftOps.value, ...draftReplaced.value])
    const marks = totalMarks(shown.value)
    const touched = (t: { by: PersonId; kind: string; period: string }) => t.by === by && periods.some((p) => p.kind === t.kind && p.period === t.period)
    return [...base.filter((t) => !touched(t)), ...periods.flatMap(({ kind, period }) => spendTotals(shown.value, by, kind, period, undefined, marks))]
  })
  /** Загрузки семьи вместе с ждущей — ✓ «загрузил за неделю» появляется сразу. */
  const shownUploads = computed<StatementUploadResponse[]>(() => {
    if (!held.value || !draft.value) return uploads.value
    const now = new Date().toISOString()
    const mine = draft.value.files.map((f, i): StatementUploadResponse => ({
      id: `held-${i}`, slot: me(), bank: f.parsed.bank, period_from: f.parsed.from, period_to: f.parsed.to, ops_count: f.parsed.operations.length, created_at: now,
    }))
    return [...mine, ...uploads.value]
  })

  /** Ответ на вопрос разбора — правило в личный документ (Р-22); черновик пересчитается сам. */
  function answer(match: MerchantRule['match'], to: MerchantRule['to']) {
    answerAll([match], to)
  }
  /** Один ответ нескольким продавцам (пачка, Р-58) — правила одной правкой. */
  function answerAll(matches: MerchantRule['match'][], to: MerchantRule['to']) {
    finance.addMerchantRules(matches.map((match) => ({ match, to })), me())
  }

  /**
   * Итоги по разделам в общий документ (Р-21) — из **всех** своих операций периода, записи по
   * id заменяются целиком. Раздел, из которого ушли все траты, обнуляется, а не удаляется:
   * надгробие навсегда закрыло бы этот id.
   */
  function writeTotals(periods: ReturnType<typeof periodsOf>) {
    if (!periods.length) return
    const by = me()
    const at = new Date().toISOString()
    const marks = totalMarks(all.value)
    const byId = new Map((finance.householdDoc.spendTotals ?? []).map((t) => [t.id, t]))
    const writes: SpendTotal[] = []
    for (const { kind, period } of periods) {
      const next = spendTotals(all.value, by, kind, period, at, marks)
      const ids = new Set(next.map((t) => t.id))
      for (const t of byId.values()) {
        if (t.by === by && t.kind === kind && t.period === period && !ids.has(t.id) && (t.amount || t.ops)) {
          const { unmarked: _gone, oneOff: _oneOff, ...rest } = t
          writes.push({ ...rest, amount: 0, ops: 0, updatedAt: at })
        }
      }
      // Тот же итог второй раз не пишется: наблюдатель отметок будит пересчёт, а запись — синк.
      for (const t of next) if (!sameTotal(byId.get(t.id), t)) writes.push(t)
    }
    // Поездка — из тех же операций и отметок (PN-30): где пересчитываются итоги, там и она.
    writeTripTotals()
    const months = periods.filter((p) => p.kind === 'month').map((p) => p.period)
    writeHabitTotals(months)
    writeReviewFinds(months)
    if (!writes.length) return
    finance.mutateHouseholdDoc((doc) => {
      const merged = new Map((doc.spendTotals ?? []).map((t) => [t.id, t]))
      for (const t of writes) merged.set(t.id, t)
      doc.spendTotals = [...merged.values()]
    })
  }

  /**
   * Итоги привычек участника (AU-27, Р-24) — те же месяцы, что итоги разделов, из всех своих операций месяца. Привычка
   * ниже порога обнуляется (надгробие закрыло бы id навсегда); месяцы старше `HABIT_KEEP_MONTHS` от последнего своего —
   * не пишутся, прежние становятся надгробиями. Тот же итог второй раз не пишется (B2C-25: открытие ревизию не растит).
   */
  function writeHabitTotals(months: string[]) {
    if (!months.length) return
    const by = me()
    const at = new Date().toISOString()
    const list = finance.householdDoc.habitTotals ?? []
    const mine = list.filter((t) => t.by === by && !t.deletedAt)
    const from = habitKeepFrom([...mine.map((t) => t.period), ...months])!
    const byId = new Map(list.map((t) => [t.id, t]))
    const writes: HabitTotal[] = []
    for (const period of months.filter((m) => m >= from)) {
      const next = habitTotals(all.value, by, period, at)
      const ids = new Set(next.map((t) => t.id))
      for (const t of mine) if (t.period === period && !ids.has(t.id) && (t.count || t.amount)) writes.push({ ...t, count: 0, amount: 0, updatedAt: at })
      for (const t of next) {
        const prev = byId.get(t.id)
        if (!prev || prev.deletedAt || prev.count !== t.count || prev.amount !== t.amount) writes.push(t)
      }
    }
    for (const t of mine) if (t.period < from) writes.push({ ...t, count: 0, amount: 0, deletedAt: at, updatedAt: at })
    if (!writes.length) return
    finance.mutateHouseholdDoc((doc) => {
      const merged = new Map((doc.habitTotals ?? []).map((t) => [t.id, t]))
      for (const t of writes) merged.set(t.id, t)
      doc.habitTotals = [...merged.values()]
    })
  }

  /**
   * Итоги находок участника (бэклог «Разбор», Р-13, RZ-01) — по схеме итогов привычек: те же месяцы, из всех своих
   * операций; пропавшая находка обнуляется, месяцы старше окна — надгробия, тот же итог второй раз не пишется. Правила —
   * личный документ, обязательства и кредиты — общий, курсы — книга (как `amountAt` в сторе).
   */
  function writeReviewFinds(months: string[]) {
    if (!months.length) return
    const by = me()
    const at = new Date().toISOString()
    const list = finance.householdDoc.reviewFinds ?? []
    const mine = list.filter((t) => t.by === by && !t.deletedAt)
    const from = findKeepFrom([...mine.map((t) => t.period), ...months])!
    const byId = new Map(list.map((t) => [t.id, t]))
    const ctx = {
      rules: finance.merchantRules,
      obligations: finance.obligations,
      credits: finance.credits,
      book: useFxStore().book,
      categories: finance.householdDoc.spendCategories ?? [],
    }
    const writes: ReviewFind[] = []
    for (const period of months.filter((m) => m >= from)) {
      const next = reviewFinds(all.value, by, period, ctx, at)
      const ids = new Set(next.map((t) => t.id))
      for (const t of mine) if (t.period === period && !ids.has(t.id) && (t.count || t.amount)) writes.push({ ...t, count: 0, amount: 0, updatedAt: at })
      for (const t of next) if (!sameFind(byId.get(t.id), t)) writes.push(t)
    }
    for (const t of mine) if (t.period < from) writes.push({ ...t, count: 0, amount: 0, deletedAt: at, updatedAt: at })
    if (!writes.length) return
    finance.mutateHouseholdDoc((doc) => {
      const merged = new Map((doc.reviewFinds ?? []).map((t) => [t.id, t]))
      for (const t of writes) merged.set(t.id, t)
      doc.reviewFinds = [...merged.values()]
    })
  }

  /**
   * Месяцы своих операций в окне находок, по которым у участника нет ни одной записи, — досчитываются из всех своих
   * операций (хотфикс RZ-HF3): итоги находок пишет только пересчёт итогов (загрузка, отметки, правки), стартовый `pull`
   * — нет, а выписки владельца загружены до Блока 1 → у семьи ни утечек, ни верхушек, ни регулярных за закрытые месяцы
   * (наблюдатели отметок берут лишь этот и прошлый месяц). Зовёт движок синка после подтянутого документа — правила,
   * обязательства и разделы уже свежие; до `pull` операций на новом телефоне — нечего считать. Месяц с записью (хоть
   * нулевой) считан — не трогаем; месяц без находок записи не получает и проверяется снова (пусто — дёшево).
   */
  function settleFinds() {
    if (auth.isViewer || demo.value || !all.value.length) return
    const by = me()
    const months = [...new Set(all.value.map((o) => o.date.slice(0, 7)))]
    const from = findKeepFrom(months)!
    const have = new Set((finance.householdDoc.reviewFinds ?? []).filter((f) => f.by === by).map((f) => f.period))
    const missing = months.filter((m) => m >= from && !have.has(m))
    if (missing.length) writeReviewFinds(missing)
  }

  /** Снятые с поездки операции этого телефона (личный документ) — по цели. */
  const tripExcludedOf = (goalId: string) => new Set(finance.tripExcluded.filter((x) => x.goalId === goalId).map((x) => x.id))

  /**
   * Свои строки поездки (PN-31): `ops` — в итоге (`tripOps`, те же, что пишет `writeTripTotals`), `excluded` — снятые
   * «Убрать» и всё ещё свои за даты; `marked` — платежи по отметкам один раз на оба списка.
   */
  function tripLists(goal: Pick<Goal, 'id' | 'from' | 'to'>, marked = totalMarks(all.value).marked): { ops: Operation[]; excluded: Operation[] } {
    const excludedIds = tripExcludedOf(goal.id)
    return {
      ops: tripOps(all.value, goal, marked, excludedIds),
      excluded: tripOps(all.value, goal, marked, new Set()).filter((o) => excludedIds.has(o.id)),
    }
  }

  /**
   * Итог поездки этого участника (PN-30, Р-14) — запись `tripSpends` `<цель>:<я>` из своих операций за даты поездки
   * (`tripOps`: без отметок платежей и снятых). Поездки с датами, кроме ещё не начавшихся; сбывшаяся цель не
   * пересчитывается (запись остаётся). Тот же итог второй раз не пишется; пустой итог без прежней записи — тоже.
   */
  function writeTripTotals() {
    if (auth.isViewer) return
    const by = me()
    const today = todayIso()
    const trips = openGoals(finance.goals).filter((g) => {
      const s = tripStatus(g, today)
      return s === 'during' || s === 'after'
    })
    // На телефоне ещё нет своих операций (новый вход до `pull`) — записи не трогаем: ноль затёр бы итог с другого устройства.
    if (!trips.length || !all.value.length) return
    const at = new Date().toISOString()
    const marked = totalMarks(all.value).marked
    const byId = new Map((finance.householdDoc.tripSpends ?? []).map((t) => [t.id, t]))
    const writes: TripSpend[] = []
    for (const g of trips) {
      const id = `${g.id}:${by}`
      const { amount, ops: n } = tripTotal(tripLists(g, marked).ops)
      const prev = byId.get(id)
      if (prev && !prev.deletedAt ? prev.amount === amount && prev.ops === n : !amount && !n) continue
      writes.push({ id, goalId: g.id, by, amount, ops: n, updatedAt: at })
    }
    if (!writes.length) return
    finance.mutateHouseholdDoc((doc) => {
      const merged = new Map((doc.tripSpends ?? []).map((t) => [t.id, t]))
      for (const t of writes) merged.set(t.id, t)
      doc.tripSpends = [...merged.values()]
    })
  }

  /** Отмеченные строки (`markedOps`) и разделы — итоги разделов платежей пишут сумму без отметки (хвосты 952/967). */
  function totalMarks(list: Operation[]) {
    return { marked: markedOps(list, matchState(), finance.merchantRules, me(), declined.value), categories: finance.householdDoc.spendCategories ?? [] }
  }

  function remember(list: Operation[]) {
    for (const op of list) ops.value[op.id] = { ...op, uploadId: op.uploadId ?? ops.value[op.id]?.uploadId }
  }

  /**
   * «Отправить» (B2C-07): операции — в свою копию, итоги — в общий документ, записи загрузок и операции — в очередь,
   * всё на диск — до первого ожидания сети (тост «Загружено» ушёл, вкладку закрыли — выписка уже на устройстве);
   * затем очередь — на сервер и свои операции со второго устройства.
   */
  async function send(client: ApiClient = apiClient) {
    const d = draft.value
    if (!d) return
    if (!finance.householdDoc.spendCategories?.length) finance.mutateHouseholdDoc((doc) => void seedSpendCategories(doc))

    const fresh = draftOps.value
    // Выписка — истина (Р-16): траты с телефона, которые она заменила, уходят из копии и итогов, на сервер — надгробием.
    const replaced = draftReplaced.value
    // «Нет, это другое» по операции с телефона переходит к строке выписки, что её заменила (FB-01): иначе тот же
    // перевод спросили бы ещё раз — уже строкой выписки.
    const pairs = draftPairs.value
    const carried = declined.value.flatMap((k) => {
      const [opId, pair] = k.split('|')
      const to = pair ? pairs.get(opId) : null
      return to ? [`${to}|${pair}`] : []
    })
    if (carried.length) declined.value = [...new Set([...declined.value, ...carried])]
    // Правки операции с телефона (заметка, «Мне вернули») — тоже к её строке (личный документ, критик Блока 1).
    finance.carryOpEdits(pairs)
    for (const o of replaced) delete ops.value[o.id]
    const ids = new Set(fresh.map((o) => o.id))
    // Пара с операцией прошлой выписки другого банка делает внутренней и её — она тоже уходит.
    const paired = pairInternalTransfers([...fresh, ...raw.value.filter((o) => !ids.has(o.id))])
    const changed = paired.slice(fresh.length).filter((o) => o.internal !== ops.value[o.id]?.internal)
    remember([...fresh, ...changed])
    const periods = periodsOf([...fresh, ...changed, ...replaced])
    // Правила «это платёж по …» отмечают платежи сами (Р-6); отмеченный месяц второй записи не получает.
    // Отметки — раньше итогов: отмеченные строки разделов платежей не траты (`unmarked`, хвосты 952/967).
    lastAutoMarked.value = autoMark(fresh)
    writeTotals(periods)

    if (demo.value) {
      for (const f of d.files) {
        demoUploads.value.unshift({
          id: newKey(), slot: me(), bank: f.parsed.bank, period_from: f.parsed.from, period_to: f.parsed.to,
          ops_count: f.parsed.operations.length, created_at: new Date().toISOString(),
        })
      }
    } else {
      // Операция общая для нескольких файлов уходит один раз — с первой загрузкой, где встретилась.
      const queued = new Set<string>()
      for (const f of d.files) {
        const own = new Set(f.parsed.operations.map((o) => o.id))
        pending.value.push({
          key: newKey(),
          upload: { bank: f.parsed.bank, period_from: f.parsed.from, period_to: f.parsed.to, ops_count: own.size },
          ops: fresh.filter((o) => own.has(o.id) && !queued.has(o.id)),
        })
        for (const id of own) queued.add(id)
      }
      if (changed.length) pending.value.push({ key: newKey(), ops: changed })
      if (replaced.length) pending.value.push({ key: newKey(), ops: replaced, deleted: true })
    }
    draft.value = null
    save()
    // Итоги — из всех своих операций периода: загруженное со второго устройства (`pull` сначала досылает очередь)
    // дописывает их ещё раз, иначе устаревшая копия оставила бы неполные итоги (LWW по id).
    // Неделя разобрана — выписка отправлена (B2C-28: «финиша недели» после решений больше нет, Блок 15).
    if (!demo.value) useEventsStore().track('week_done')
    const sent = new Set([...fresh, ...changed, ...replaced].map((o) => o.id))
    const got = await pull(client)
    if (got.some((id) => !sent.has(id))) writeTotals(periods)
  }

  /**
   * Правка своей операции (FB-02, Р-11): заметка, «Мне вернули» — в личный документ; итоги периодов траты пересчитываются
   * (сумма — `spendOf`), на сервер ничего не уходит. Приход-возврат и прежний приход снятого возврата — только в чтении.
   */
  function editOp(id: string, patch: Parameters<typeof finance.setOpEdit>[1]) {
    const op = ops.value[id]
    if (!op || auth.isViewer) return
    finance.setOpEdit(id, patch)
    writeTotals(periodsOf([op]))
  }

  /** Приходы, которыми могли вернуть трату (`refundCandidates`): без отмеченных зарплатой и уже взятых другим возвратом. */
  function refundsFor(op: Operation): Operation[] {
    const linked = new Set(finance.payments.filter((p) => !p.deletedAt && p.opId).map((p) => p.opId!))
    return refundCandidates(op, all.value, linked)
  }

  /** Смена раздела задним числом: правило + пересчёт своих операций и итогов их периодов. */
  async function recategorize(match: MerchantRule['match'], to: MerchantRule['to'], client: ApiClient = apiClient) {
    return recategorizeAll([match], to, client)
  }
  /**
   * Пачкой (Р-58): все правила, один пересчёт, одни итоги и одна отправка. Заглушка пуша («Перевод» без получателя,
   * `isPhoneStub`) — ответ только её строкам, без правила семьи (`/ux` Б2, вопрос 5, владелец 2026-10-19); правило
   * пишется, если тем же «продавцом» назван кто-то ещё (строка выписки), — заглушку оно всё равно не тронет.
   */
  async function recategorizeAll(matches: MerchantRule['match'][], to: MerchantRule['to'], client: ApiClient = apiClient) {
    const same = (o: Operation, m: MerchantRule['match']) => {
      const r = ruleMatchOf(o)
      return r.merchant === m.merchant && r.counterparty === m.counterparty
    }
    const direct = !('payment' in to)
    const onlyStubs = (m: MerchantRule['match']) => {
      const hit = raw.value.filter((o) => same(o, m))
      return direct && hit.length > 0 && hit.every(isPhoneStub)
    }
    const ruled = matches.filter((m) => !onlyStubs(m))
    if (ruled.length) answerAll(ruled, to)
    const answer = (o: Operation): Operation => {
      if (!direct || !isPhoneStub(o) || o.amount >= 0 || o.internal || o.categoryId !== null || !matches.some((m) => same(o, m))) return o
      if ('internal' in to) return { ...o, internal: true, categoryId: null }
      return { ...o, categoryId: 'categoryId' in to ? to.categoryId : 'sc_people' }
    }
    const list = raw.value
    const next = reapply(list.map(answer))
    const changed = next.filter((o, i) => o !== list[i])
    if (!changed.length) return
    remember(changed)
    writeTotals(periodsOf(changed))
    if (!demo.value) pending.value.push({ key: newKey(), ops: changed })
    save()
    await flush(client)
  }

  /**
   * Снять правило (B2C-21): свои операции пересчитываются без него; после правила «между своими»
   * признак `internal` берётся заново от пар переводов (`categorize` без правила его не трогает).
   */
  async function forgetRule(rule: MerchantRule, client: ApiClient = apiClient) {
    finance.removeMerchantRule(rule.id)
    const hit = new Set(
      raw.value
        .filter((o) => {
          const m = ruleMatchOf(o)
          return m.merchant === rule.match.merchant && m.counterparty === rule.match.counterparty
        })
        .map((o) => o.id),
    )
    if (!hit.size) return
    const list = raw.value
    const base = 'internal' in rule.to ? list.map((o) => (hit.has(o.id) ? { ...o, internal: false } : o)) : list
    const next = reapply(pairInternalTransfers(base))
    const changed = next.filter((o, i) => o.categoryId !== list[i].categoryId || o.internal !== list[i].internal)
    if (!changed.length) return
    remember(changed)
    writeTotals(periodsOf(changed))
    if (!demo.value) pending.value.push({ key: newKey(), ops: changed })
    save()
    await flush(client)
  }

  /**
   * Снятая отметка из выписки — здесь или у партнёра, пришла синком (B2C-15 п. 3): операция
   * возвращается в траты — раздел без правила платежа, итоги её периодов переписываются, копия на
   * сервере — тоже; месяц отметили снова — обратно в плановый раздел. `ids` — операции, чей признак
   * мог измениться.
   */
  async function settleReleased(ids: Set<string>, client: ApiClient = apiClient) {
    const list = raw.value.filter((o) => ids.has(o.id))
    if (!list.length) return
    const next = reapply(list)
    const changed = next.filter((o, i) => o !== list[i])
    if (!changed.length) return
    remember(changed)
    writeTotals(periodsOf(changed))
    if (!demo.value) pending.value.push({ key: newKey(), ops: changed })
    save()
    await flush(client)
  }

  /**
   * Ручная трата (бэклог «Ручная трата», Р-1, Р-2): новая или правка своей ручной — в копию, итоги периодов (при смене
   * даты — и старого) в общий документ, на сервер — тем же батчем, что строки выписки. Партнёр видит только итог
   * раздела (`writeTotals` → `SpendTotal`). Разделов в документе ещё нет (выписок не было) — засеваются, как при
   * первой загрузке. Строку выписки или с телефона этим не поправить.
   */
  async function saveHand(op: Operation, client: ApiClient = apiClient) {
    const prev = ops.value[op.id]
    if (!isHand(op) || (prev && !isHand(prev))) return
    if (!finance.householdDoc.spendCategories?.length) finance.mutateHouseholdDoc((doc) => void seedSpendCategories(doc))
    remember([op])
    writeTotals(periodsOf(prev ? [prev, op] : [op]))
    if (!demo.value) pending.value.push({ key: newKey(), ops: [op] })
    save()
    await flush(client)
  }

  /** Удалить свою ручную трату: из копии и итогов, на сервер — надгробием (`deleted`). Выписку так не удалить. */
  async function removeHand(id: string, client: ApiClient = apiClient) {
    const op = ops.value[id]
    if (!op || !isHand(op)) return
    delete ops.value[id]
    writeTotals(periodsOf([op]))
    if (!demo.value) pending.value.push({ key: newKey(), ops: [op], deleted: true })
    save()
    await flush(client)
  }

  /** Досылает очередь: запись загрузки, затем операции кусками; после каждого шага — на диск. */
  async function flush(client: ApiClient = apiClient): Promise<void> {
    if (demo.value || !pending.value.length) return
    if (flushing) return flushing
    if (offline()) {
      status.value = 'offline'
      return
    }
    flushing = (async () => {
      status.value = 'sending'
      try {
        while (pending.value.length) {
          const job = pending.value[0]
          if (job.upload && !job.uploadId) {
            job.uploadId = (await client.createStatementUpload(job.upload)).id
            for (const op of job.ops) if (ops.value[op.id]) ops.value[op.id].uploadId = job.uploadId
            save()
          }
          while (job.ops.length) {
            const chunk = job.ops.slice(0, BATCH_SIZE)
            await client.upsertOperations(chunk.map((o) => (job.deleted ? tombstoneWire(o) : toWire({ ...o, uploadId: job.uploadId ?? o.uploadId }))))
            job.ops = job.ops.slice(chunk.length)
            save()
          }
          pending.value.shift()
          save()
        }
        status.value = 'idle'
        lastError.value = null
        await loadUploads(client)
      } catch (err) {
        status.value = err instanceof ApiError ? 'error' : 'offline'
        lastError.value = err instanceof Error ? err.message : String(err)
      } finally {
        flushing = null
      }
    })()
    return flushing
  }

  /**
   * Свои операции с сервера по курсору (правки со второго устройства); сначала — очередь. Отдаёт id полученных.
   * Подтягивания идут по очереди (старт и «Неделя» зовут разом): медленное старое не вернёт в копию трату с телефона,
   * которую выписка уже убрала надгробием (критик Б1).
   */
  function pull(client: ApiClient = apiClient): Promise<string[]> {
    if (demo.value || !auth.isMember) return Promise.resolve([])
    lastPullAt = Date.now()
    const run = pulling.then(() => pullOnce(client))
    pulling = run.catch(() => [])
    return run
  }

  async function pullOnce(client: ApiClient): Promise<string[]> {
    const got: string[] = []
    if (demo.value || !auth.isMember) return got
    await flush(client)
    if (offline() || pending.value.length) return got
    try {
      // Строка, давшая курсор, попадает в запас — значит, next непустой страницы не раньше
      // курсора; пустая страница курсор не двигает (назад он не уезжает).
      let since = cursor.value
      let from = since && new Date(Date.parse(since) - CURSOR_OVERLAP_MS).toISOString()
      // Apple Pay (Р-14, Р-16): операции с телефона — на раскладку; надгробия — прочь из копии, их периоды — в итоги.
      const phone = new Set<string>()
      const gone: Operation[] = []
      for (;;) {
        const page = await client.listOperations(from, PULL_LIMIT)
        // Выписка убрала трату, пока страница шла (надгробие ещё в очереди), — живая копия с сервера её не вернёт.
        const buried = new Set(pending.value.filter((j) => j.deleted).flatMap((j) => j.ops.map((o) => o.id)))
        for (const w of page.operations) {
          got.push(w.id)
          if (buried.has(w.id) && !w.deleted) continue
          if (w.deleted) {
            const prev = ops.value[w.id]
            if (prev) gone.push(prev)
            delete ops.value[w.id]
            continue
          }
          ops.value[w.id] = fromWire(w)
          if (w.source === 'tap' || w.source === 'push') phone.add(w.id)
        }
        if (page.next) since = from = page.next
        if (page.operations.length < PULL_LIMIT) break
      }
      cursor.value = since
      save()
      // Копия на сервере старше снятия отметки (снял партнёр, пока этот телефон спал; новый вход) —
      // наблюдатель `released` уже отработал на пустом списке: такие операции снова трата (критик возврата).
      const stale = new Set(got.filter((id) => released.value.has(id)))
      if (stale.size) await settleReleased(stale, client)
      await settlePhone(phone, gone, client)
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
    return got
  }

  /**
   * Раскладка операций с телефона (Р-2, Р-15): пришедшие без раздела и все свои в валюте без тенге (курса не было) —
   * курс дня (`phoneOpTenge`), раздел и «между своими» по правилам; изменённые — на сервер; итоги периодов всех
   * пришедших и надгробий `gone` — в общий документ. Пришедшая с разделом уже разложена другим устройством (правила
   * этого могут отставать — раздел откатился бы); строки выписок `pull` не трогает.
   */
  async function settlePhone(arrived: Set<string>, gone: Operation[], client: ApiClient) {
    let list = raw.value.filter((o) => (arrived.has(o.id) && o.categoryId === null) || (o.fx && o.amount === 0))
    let settled = raw.value.filter((o) => arrived.has(o.id) && !list.includes(o))
    if (!list.length && !settled.length && !gone.length) return
    const waiting = list.filter((o) => o.fx && o.amount === 0)
    if (waiting.length) {
      const days = waiting.map((o) => o.date).sort()
      // Неделя запаса: в выходные курс — пятничный (`rateOn`).
      await useFxStore().ensureRates([...new Set(waiting.map((o) => o.fx!.currency))], addDaysIso(days[0], -7), days[days.length - 1], client)
      // Пока ждали курс, выписка могла убрать трату надгробием (`send`) — список из текущей копии: убранная не
      // воскреснет (`remember`), остальные разложатся (ревью frontend Н-3).
      const ids = new Set(list.map((o) => o.id))
      const kept = new Set(settled.map((o) => o.id))
      list = raw.value.filter((o) => ids.has(o.id))
      settled = raw.value.filter((o) => kept.has(o.id))
    }
    const book = useFxStore().book
    const priced = list.map((o) => {
      if (!o.fx || o.amount !== 0) return o
      const tenge = phoneOpTenge(o, book)
      return tenge === null ? o : { ...o, amount: tenge }
    })
    const next = reapply(priced)
    const changed = next.filter((o) => {
      const prev = ops.value[o.id]
      return o.amount !== prev.amount || o.categoryId !== prev.categoryId || o.internal !== prev.internal
    })
    remember(changed)
    writeTotals(periodsOf([...next, ...settled, ...gone]))
    if (changed.length) pending.value.push({ key: newKey(), ops: changed })
    save()
    if (changed.length) await flush(client)
  }

  /** Возврат в приложение (Р-19): подтянуть траты с телефона, не чаще раза в `PHONE_PULL_MS`. */
  function pullOnReturn(client: ApiClient = apiClient) {
    if (demo.value || !auth.isMember || Date.now() - lastPullAt < PHONE_PULL_MS) return
    void pull(client)
  }

  /** Демо-пример (B2C-19 п. 4): записи загрузок обоих, чтобы главный показывал картину недели. */
  function seedDemoUploads(list: StatementUploadResponse[]) {
    if (!demo.value) return
    demoUploads.value = list
    save()
  }

  /**
   * Демо-пример (пивот 3, B2C-45): свои операции для «Истории» — только в демо, на сервер не уходят. Итоги
   * недель и месяцев — из них же, тем же `writeTotals`, что при «Отправить» (B2C-52, Р-50): «Неделя» и
   * «История» демо сходятся.
   */
  function seedDemoOperations(list: Operation[]) {
    if (!demo.value) return
    remember(list)
    writeTotals(periodsOf(list))
    save()
  }

  async function loadUploads(client: ApiClient = apiClient) {
    if (demo.value) return
    try {
      serverUploads.value = (await client.listStatementUploads()).uploads
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  // Сразу при старте — и операции, отметку которых сняли до этой правки (или пока телефон спал).
  watch(
    () => [...released.value].sort().join(' '),
    (now, before) => void settleReleased(new Set([...now.split(' '), ...(before ?? '').split(' ')].filter(Boolean))),
    { immediate: true },
  )

  /*
   * Отметки по строкам выписки (свои и партнёра — синком): «Да, отметить», ручной «Оплатил», снятие — сумма без
   * отметки у итогов разделов платежей меняется (хвосты 952/967), итоги свежих периодов переписываются (`sameTotal`
   * не пишет неизменённые). Подпись — строкой: синк документа без новых отметок пересчёт не будит.
   */
  watch(
    () => (finance.payments ?? []).filter((p) => !p.deletedAt && p.kind !== 'prepay').map((p) => p.opId ?? `${p.kind}:${p.targetId}:${p.period}`).sort().join(' '),
    () => writeTotals(periodsOf(recentOperations(all.value))),
  )

  /*
   * Правки операций (FB-02) пришли со второго своего телефона — «Мне вернули», «Разовая»: итоги их периодов переписываются
   * из копии с правками (`editOp` пишет их на том телефоне, где правили; здесь копия могла посчитать итоги до прихода
   * правки). Подпись — без заметки: заметка итоги не меняет.
   */
  watch(
    () => liveOpEdits(finance.opEdits).map((e) => `${e.id}:${e.refund?.amount ?? ''}:${e.refund?.opId ?? ''}:${e.oneOff ? 1 : ''}`).sort().join(' '),
    (now, before) => {
      const a = new Set(now.split(' ').filter(Boolean))
      const b = new Set((before ?? '').split(' ').filter(Boolean))
      const ids = new Set([...a, ...b].filter((x) => !(a.has(x) && b.has(x))).map((x) => x.split(':')[0]))
      const list = raw.value.filter((o) => ids.has(o.id))
      if (list.length && !auth.isViewer) writeTotals(periodsOf(list))
    },
  )

  /*
   * Цели платежей изменились (хвост 966): обязательство удалено в «Капитале», «Отменить подписку», сумма или день
   * исправлены — у себя или синком партнёра. Строки правил платежа пересчитываются тем же путём, что снятые отметки
   * (`reapply` — плановый раздел только «таким»), итоги свежих периодов переписываются (`markedOps`: строка цели,
   * которой больше нет, — трата). Подпись — строкой из полей сопоставления: имя, заметка и синк без правок не будят.
   */
  watch(
    () => [
      ...finance.obligations.map((o) => [o.id, o.deletedAt ? '×' : '', o.category, o.day, o.every ?? '', o.month ?? '', o.estimate ? 1 : 0, JSON.stringify(o.versions)].join(':')),
      ...finance.credits.map((c) => [c.id, c.deletedAt ? '×' : '', c.day, c.payment, creditDueAmount(c)].join(':')),
    ].sort().join(' '),
    () => {
      // Смена цели касается только строк с правилом «это платёж по …».
      const byPayment = all.value.filter((o) => {
        const rule = ruleFor(o, finance.merchantRules)
        return !!rule && 'payment' in rule.to
      })
      void settleReleased(new Set(byPayment.map((o) => o.id)))
      writeTotals(periodsOf(recentOperations(all.value)))
    },
  )

  /*
   * Поездки (PN-30): даты, «Сбылось» или снятые операции изменились — у себя или синком партнёра (даты), со второго
   * своего телефона (снятые) — итог переписывается. Подпись — строкой: прочие правки целей не будят.
   */
  watch(
    () => [
      ...finance.goals.filter((g) => g.from || g.to).map((g) => [g.id, g.from ?? '', g.to ?? '', g.deletedAt ? '×' : '', g.doneAt ? '✓' : ''].join(':')),
      ...finance.tripExcluded.map((x) => `${x.goalId}:${x.id}`),
    ].sort().join(' '),
    () => writeTripTotals(),
    { immediate: true },
  )

  return {
    ops,
    all,
    cursor,
    pending,
    pendingCount,
    uploads,
    status,
    lastError,
    draft,
    held,
    shown,
    shownTotals,
    shownUploads,
    upload,
    commitUpload,
    undoUpload,
    draftOps,
    pendingMatches,
    salaryArrivals,
    salaryArrival,
    draftAutoMatches,
    lastAutoMarked,
    acceptMatch,
    declineMatch,
    setDraft,
    cancelDraft,
    answer,
    answerAll,
    send,
    recategorize,
    editOp,
    refundsFor,
    recategorizeAll,
    totalMarks,
    forgetRule,
    settleReleased,
    saveHand,
    removeHand,
    flush,
    pull,
    pullOnReturn,
    loadUploads,
    seedDemoUploads,
    seedDemoOperations,
    writeTripTotals,
    settleFinds,
    tripLists,
    clear,
  }
})
