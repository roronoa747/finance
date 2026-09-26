import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { apiClient, type ApiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import {
  applyRules,
  pairInternalTransfers,
  periodsOf,
  seedSpendCategories,
  spendTotals,
} from '@/lib/statements/model'
import type { MerchantRule, Operation, ParsedStatement } from '@/lib/statements/types'
import type { OperationWire, StatementUploadResponse } from '@/types/api'
import type { PersonId } from '@/types/finance'

// Операции выписок (B2C-07): личная копия своих операций, очередь неотправленного, записи
// загрузок семьи и черновик разбора. Файл выписки разбирается на телефоне и никуда не уходит
// (Р-4): на сервер идут только записи загрузок и операции без ФИО и номеров (Р-23).

const KEY_OPS = 'ff_operations'
const KEY_CURSOR = 'ff_operations_cursor'
const KEY_PENDING = 'ff_operations_pending'
const KEY_DEMO_UPLOADS = 'ff_statement_uploads_demo'
const KEYS = [KEY_OPS, KEY_CURSOR, KEY_PENDING, KEY_DEMO_UPLOADS]

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
  /** Файлы, которые не удалось разобрать: имя и спокойное объяснение. */
  errors: { name: string; message: string }[]
}

function read<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error('Ошибка записи операций:', e)
  }
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
  const saved = read<{ owner: string | null; ops: Record<string, Operation> }>(KEY_OPS, { owner: null, ops: {} })
  const owner = ref<string | null>(ownerKey())
  const fresh = saved.owner !== null && saved.owner === owner.value
  const ops = ref<Record<string, Operation>>(fresh ? saved.ops : {})
  const cursor = ref<string | null>(fresh ? read<string | null>(KEY_CURSOR, null) : null)
  const pending = ref<PendingJob[]>(fresh ? read<PendingJob[]>(KEY_PENDING, []) : [])
  const demoUploads = ref<StatementUploadResponse[]>(fresh ? read<StatementUploadResponse[]>(KEY_DEMO_UPLOADS, []) : [])
  const serverUploads = ref<StatementUploadResponse[]>([])
  const status = ref<'idle' | 'sending' | 'offline' | 'error'>('idle')
  const lastError = ref<string | null>(null)
  const draft = ref<Draft | null>(null)
  let flushing: Promise<void> | null = null

  const demo = computed(() => auth.isDemo || finance.isDemo)
  const me = (): PersonId => auth.slot ?? 'a'
  const uploads = computed(() => (demo.value ? demoUploads.value : serverUploads.value))
  const all = computed(() => Object.values(ops.value))
  const pendingCount = computed(() => pending.value.reduce((n, j) => n + j.ops.length, 0))

  function save() {
    write(KEY_OPS, { owner: owner.value, ops: ops.value })
    write(KEY_CURSOR, cursor.value)
    write(KEY_PENDING, pending.value)
    write(KEY_DEMO_UPLOADS, demoUploads.value)
  }

  function clear(key: string | null = null) {
    owner.value = key
    ops.value = {}
    cursor.value = null
    pending.value = []
    demoUploads.value = []
    serverUploads.value = []
    draft.value = null
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

  /** Черновик разбора: операции с правилами семьи и парами внутренних переводов. */
  const draftOps = computed<Operation[]>(() => {
    if (!draft.value) return []
    const raw = draft.value.files.flatMap((f) => f.parsed.operations)
    const ids = new Set(raw.map((o) => o.id))
    const withRules = applyRules(raw, finance.merchantRules)
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

    if (demo.value) {
      for (const f of d.files) {
        demoUploads.value.unshift({
          id: newKey(), slot: me(), bank: f.parsed.bank, period_from: f.parsed.from, period_to: f.parsed.to,
          ops_count: f.parsed.operations.length, created_at: new Date().toISOString(),
        })
      }
    } else {
      for (const f of d.files) {
        const own = new Set(f.parsed.operations.map((o) => o.id))
        pending.value.push({
          key: newKey(),
          upload: { bank: f.parsed.bank, period_from: f.parsed.from, period_to: f.parsed.to, ops_count: own.size },
          ops: fresh.filter((o) => own.has(o.id)),
        })
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
    const next = applyRules(all.value, finance.merchantRules)
    const changed = next.filter((o, i) => o !== all.value[i])
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
      for (;;) {
        const page = await client.listOperations(from, PULL_LIMIT)
        for (const w of page.operations) ops.value[w.id] = fromWire(w)
        if (page.next) since = from = page.next
        if (page.operations.length < PULL_LIMIT) break
      }
      cursor.value = since
      save()
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadUploads(client: ApiClient = apiClient) {
    if (demo.value) return
    try {
      serverUploads.value = (await client.listStatementUploads()).uploads
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    }
  }

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
    setDraft,
    cancelDraft,
    answer,
    send,
    recategorize,
    flush,
    pull,
    loadUploads,
    clear,
  }
})
