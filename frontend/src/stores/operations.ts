import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { OPERATIONS_STORAGE_KEYS, readStorage, writeStorage } from '@/lib/storage'
import {
  applyRules,
  pairInternalTransfers,
  periodsOf,
  ruleMatchOf,
  seedSpendCategories,
  spendTotals,
} from '@/lib/statements/model'
import { matchCandidates, matchKey, operationAt, paymentFits, recentOperations, releasedOps, type MatchCandidate } from '@/lib/statements/matching'
import type { MerchantRule, Operation, ParsedStatement } from '@/lib/statements/types'
import type { OperationWire, StatementUploadResponse } from '@/types/api'
import type { PersonId } from '@/types/finance'

// Операции выписок (B2C-07): личная копия своих операций, очередь неотправленного, записи
// загрузок семьи и черновик разбора. Файл выписки разбирается на телефоне и никуда не уходит
// (Р-4): на сервер идут только записи загрузок и операции без ФИО и номеров (Р-23).
// Сопоставление с отметками (Р-6, B2C-15): предложения — `matchCandidates`, «да» — запись
// `payments` с источником «выписка» и правило «это платёж по …», «нет» — на месяц на устройстве.

const { ops: KEY_OPS, cursor: KEY_CURSOR, pending: KEY_PENDING, demoUploads: KEY_DEMO_UPLOADS, declined: KEY_DECLINED } = OPERATIONS_STORAGE_KEYS
const KEYS = Object.values(OPERATIONS_STORAGE_KEYS)

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

export type UploadInput = { bank: string; period_from: string; period_to: string; ops_count: number }

/** Неотправленное: запись загрузки (если есть) и её операции; уходит кусками по BATCH_SIZE. */
export interface PendingJob {
  key: string
  upload?: UploadInput
  uploadId?: string
  ops: Operation[]
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
    counterparty: op.counterparty ?? null,
    note: op.note ?? null,
    category_id: op.categoryId,
    internal: op.internal,
    upload_id: op.uploadId ?? null,
  }
}

export function fromWire(w: OperationWire): Operation {
  return {
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
  }
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
  const ops = ref<Record<string, Operation>>(fresh ? saved.ops : {})
  const cursor = ref<string | null>(fresh ? readStorage<string | null>(KEY_CURSOR, null) : null)
  const pending = ref<PendingJob[]>(fresh ? readStorage<PendingJob[]>(KEY_PENDING, []) : [])
  const demoUploads = ref<StatementUploadResponse[]>(fresh ? readStorage<StatementUploadResponse[]>(KEY_DEMO_UPLOADS, []) : [])
  const declined = ref<string[]>(fresh ? readStorage<string[]>(KEY_DECLINED, []) : [])
  const serverUploads = ref<StatementUploadResponse[]>([])
  const status = ref<'idle' | 'sending' | 'offline' | 'error'>('idle')
  const lastError = ref<string | null>(null)
  const draft = ref<Draft | null>(null)
  /** Сколько строк последней отправки отметилось по правилам («Отмечено по выписке: N»). */
  const lastAutoMarked = ref(0)
  let flushing: Promise<void> | null = null

  const demo = computed(() => auth.isDemo || finance.isDemo)
  const me = (): PersonId => auth.slot ?? 'a'
  const uploads = computed(() => (demo.value ? demoUploads.value : serverUploads.value))
  const all = computed(() => Object.values(ops.value))
  const pendingCount = computed(() => pending.value.reduce((n, j) => n + j.ops.length, 0))

  /* ---------- сопоставление с отметками (B2C-15) ---------- */
  const matchState = () => ({ obligations: finance.obligations, credits: finance.credits, people: finance.people, payments: finance.payments })
  /** Предложения по своим операциям этого и прошлого месяца — только те, что ждут ответа. */
  const pendingMatches = computed<MatchCandidate[]>(() =>
    auth.isViewer
      ? []
      : matchCandidates(recentOperations(all.value), matchState(), finance.merchantRules, me()).filter(
          (c) => c.confidence !== 'rule' && !declined.value.includes(matchKey(c)),
        ),
  )
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
   */
  function markByOperation(c: MatchCandidate, op: Operation) {
    const opts = { period: c.period, amount: Math.abs(op.amount), accountId: null, source: 'statement' as const, opId: op.id, at: operationAt(op.date) }
    return c.kind === 'salary' ? finance.markSalary(c.targetId as PersonId, opts) : finance.markPaid(c.kind, c.targetId, me(), opts)
  }

  /**
   * «Да, отметить»: запись + правило «это платёж по …» по продавцу или получателю (раздел — плановый).
   * Остальные строки того же продавца этого и прошлого месяца по новому правилу стали «rule» — из
   * вопросов они ушли, поэтому отмечаются сразу (те, что прошли проверку суммы правила); сколько —
   * прибавляется к «Отмечено по выписке». Правило пишется до первого ожидания в `recategorize`, так
   * что отметка не ждёт сети.
   */
  async function acceptMatch(c: MatchCandidate, client: ApiClient = apiClient) {
    const op = ops.value[c.opId]
    if (!op) return
    markByOperation(c, op)
    const match = ruleMatchOf(op)
    const saving = recategorize(match, { payment: { kind: c.kind, targetId: c.targetId, categoryId: c.categoryId } }, client)
    const same = recentOperations(all.value).filter((o) => {
      const m = ruleMatchOf(o)
      return m.merchant === match.merchant && m.counterparty === match.counterparty
    })
    const n = autoMark(same)
    if (n) lastAutoMarked.value += n
    await saving
  }

  /** «Нет, это другое»: помнится на этот месяц на устройстве, правилом не становится. */
  function declineMatch(c: MatchCandidate) {
    const k = matchKey(c)
    if (!declined.value.includes(k)) declined.value = [...declined.value, k]
    save()
  }

  /** Автоотметка по правилам среди только что отправленных строк; сколько отметилось. */
  function autoMark(list: Operation[]): number {
    let n = 0
    for (const c of matchCandidates(list, matchState(), finance.merchantRules, me())) {
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
    const raw = [...byId.values()]
    const ids = new Set(byId.keys())
    const withRules = reapply(raw)
    const others = all.value.filter((o) => !ids.has(o.id))
    return pairInternalTransfers([...withRules, ...others]).slice(0, withRules.length)
  })

  function setDraft(files: DraftFile[], errors: Draft['errors'] = []) {
    draft.value = { files, errors }
  }

  function cancelDraft() {
    draft.value = null
  }

  /** Ответ на вопрос разбора — правило в личный документ (Р-22); черновик пересчитается сам. */
  function answer(match: MerchantRule['match'], to: MerchantRule['to']) {
    finance.addMerchantRule({ match, to }, me())
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
    finance.mutateHouseholdDoc((doc) => {
      const byId = new Map((doc.spendTotals ?? []).map((t) => [t.id, t]))
      for (const { kind, period } of periods) {
        const next = spendTotals(all.value, by, kind, period, at)
        const ids = new Set(next.map((t) => t.id))
        for (const t of byId.values()) {
          if (t.by === by && t.kind === kind && t.period === period && !ids.has(t.id) && (t.amount || t.ops)) {
            byId.set(t.id, { ...t, amount: 0, ops: 0, updatedAt: at })
          }
        }
        for (const t of next) byId.set(t.id, t)
      }
      doc.spendTotals = [...byId.values()]
    })
  }

  function remember(list: Operation[]) {
    for (const op of list) ops.value[op.id] = { ...op, uploadId: op.uploadId ?? ops.value[op.id]?.uploadId }
  }

  /**
   * «Отправить» (B2C-07): операции — в свою копию, итоги — в общий документ сразу (в том
   * числе без сети), записи загрузок и операции — в очередь, очередь — на сервер.
   */
  async function send(client: ApiClient = apiClient) {
    const d = draft.value
    if (!d) return
    // Итоги — из всех своих операций периода: сначала забрать загруженное со второго
    // устройства, иначе устаревшая копия затрёт полные итоги (LWW по id). Без сети — что есть.
    await pull(client)
    if (draft.value !== d) return // второе нажатие, пока ждали сеть
    if (!finance.householdDoc.spendCategories?.length) finance.mutateHouseholdDoc((doc) => void seedSpendCategories(doc))

    const fresh = draftOps.value
    const ids = new Set(fresh.map((o) => o.id))
    // Пара с операцией прошлой выписки другого банка делает внутренней и её — она тоже уходит.
    const paired = pairInternalTransfers([...fresh, ...all.value.filter((o) => !ids.has(o.id))])
    const changed = paired.slice(fresh.length).filter((o) => o.internal !== ops.value[o.id]?.internal)
    remember([...fresh, ...changed])
    writeTotals(periodsOf([...fresh, ...changed]))
    // Правила «это платёж по …» отмечают платежи сами (Р-6); отмеченный месяц второй записи не получает.
    lastAutoMarked.value = autoMark(fresh)

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
    }
    draft.value = null
    save()
    await flush(client)
  }

  /** Смена раздела задним числом: правило + пересчёт своих операций и итогов их периодов. */
  async function recategorize(match: MerchantRule['match'], to: MerchantRule['to'], client: ApiClient = apiClient) {
    answer(match, to)
    const next = reapply(all.value)
    const changed = next.filter((o, i) => o !== all.value[i])
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
      all.value
        .filter((o) => {
          const m = ruleMatchOf(o)
          return m.merchant === rule.match.merchant && m.counterparty === rule.match.counterparty
        })
        .map((o) => o.id),
    )
    if (!hit.size) return
    const base = 'internal' in rule.to ? all.value.map((o) => (hit.has(o.id) ? { ...o, internal: false } : o)) : all.value
    const next = reapply(pairInternalTransfers(base))
    const changed = next.filter((o, i) => o.categoryId !== all.value[i].categoryId || o.internal !== all.value[i].internal)
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
    const list = all.value.filter((o) => ids.has(o.id))
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
            await client.upsertOperations(chunk.map((o) => toWire({ ...o, uploadId: job.uploadId ?? o.uploadId })))
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

  /** Свои операции с сервера по курсору (правки со второго устройства); сначала — очередь. */
  async function pull(client: ApiClient = apiClient) {
    if (demo.value || !auth.isMember) return
    await flush(client)
    if (offline() || pending.value.length) return
    try {
      // Строка, давшая курсор, попадает в запас — значит, next непустой страницы не раньше
      // курсора; пустая страница курсор не двигает (назад он не уезжает).
      let since = cursor.value
      let from = since && new Date(Date.parse(since) - CURSOR_OVERLAP_MS).toISOString()
      const got: string[] = []
      for (;;) {
        const page = await client.listOperations(from, PULL_LIMIT)
        for (const w of page.operations) {
          ops.value[w.id] = fromWire(w)
          got.push(w.id)
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
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
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
    draftOps,
    pendingMatches,
    draftAutoMatches,
    lastAutoMarked,
    acceptMatch,
    declineMatch,
    setDraft,
    cancelDraft,
    answer,
    send,
    recategorize,
    forgetRule,
    settleReleased,
    flush,
    pull,
    loadUploads,
    seedDemoUploads,
    seedDemoOperations,
    clear,
  }
})
