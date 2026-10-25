// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { declineKey } from '../src/lib/statements/matching'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAiStore } from '../src/stores/ai'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { T0 } from '../src/test/planFamily'
import { leadFor } from '../src/test/reviewV4'
import OpSheet from '../src/components/OpSheet.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakePrivate, fakeServer, fakeStatements, privateFor, screen, statementsFor, type FakePrivate, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 3 «Хвосты» (TL-07…TL-09): сценарии сверх e2e исполнителя — Freedom-возврат с подписью «Возврат» и кешбэк
 * «+» того же продавца; обновление телефона со старыми ключами устройства (ответы до TL-08); выписки не пришли — разбора
 * нет. Семья на фейковом сервере, пятница 23 октября 2026.
 */
let app: App | null = null
const storage = new Map<string, string>()
let server: FakeServer
let st: FakeStatements
let pv: FakePrivate

type Phone = { pinia: ReturnType<typeof createPinia>; client: ApiClient; store: ReturnType<typeof useFinanceStore> }
const op = (date: string, amount: number, merchant: string, categoryId: string | null, p: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false, ...p,
})
const statement = (ops: Omit<Operation, 'id'>[], bank: Operation['bank'] = 'kaspi'): ParsedStatement => ({ bank, from: '2026-09-01', to: '2026-10-22', skipped: 0, operations: assignIds(ops) })

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
  vi.useFakeTimers()
  at('2026-10-23T07:00:00Z')
  server = fakeServer({
    ...defaultSyncDoc(),
    people: [{ id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 }],
    setupDoneAt: T0,
  })
  st = fakeStatements()
  pv = fakePrivate()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Запуск телефона Ильяса на текущем диске (`storage`): документы, выписки, операции. */
async function launch(over: Partial<ApiClient> = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't-u-a', user: { id: 'u-a', email: 'u-a@family.kz', created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, 'u-a', 'a'), ...privateFor(pv, 'u-a'), ...over } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await store.pullPrivateDoc(client)
  await useOperationsStore().loadUploads(client).catch(() => undefined)
  await useOperationsStore().pull(client)
  return { pinia, client, store }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const press = async (el: HTMLElement | null) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}

/**
 * TL-07 (Р-4), Freedom: такси YANDEX. GO 3 000 (10 октября), «Возврат. Отмена покупки YANDEX. GO» 3 000 (12-го), кешбэк
 * банка «+» тем же продавцом 30 (заметка «Кешбэк»), возврат другого магазина 3 000. В «Мне вернули» — только возврат такси,
 * подпись «Возврат · 12 октября · 3 000»; выбор → «вернули 3 000», возврат — между своими.
 */
describe('приёмка / Хвосты Блок 3 — «Мне вернули» на Freedom (TL-07)', () => {
  it('возврат «Отмена покупки» того же продавца — первым с подписью «Возврат»; кешбэк и чужой возврат — нет', async () => {
    const A = await launch()
    const ops = useOperationsStore()
    await ops.upload([{ name: 'f.pdf', parsed: statement([
      op('2026-10-10', -3_000, 'YANDEX. GO', 'sc_transport', { bank: 'freedom' }),
      op('2026-10-12', 3_000, 'Возврат. Отмена покупки YANDEX. GO', null, { bank: 'freedom' }),
      op('2026-10-11', 30, 'YANDEX. GO', null, { bank: 'freedom', note: 'Кешбэк' }),
      op('2026-10-11', 3_000, 'Возврат. Отмена покупки SULPAK', null, { bank: 'freedom' }),
    ], 'freedom') }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)

    const buy = ops.all.find((o) => o.amount === -3_000)!
    const back = ops.all.find((o) => o.merchant.includes('YANDEX') && o.amount === 3_000)!
    const opId = ref<string | null>(buy.id)
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp({ render: () => h(OpSheet, { opId: opId.value, onClose: () => (opId.value = null) }) })
    app.use(A.pinia)
    app.mount(root)
    await flush()

    await press(q('[role="dialog"] [data-op-refund]'))
    const rows = all('[role="dialog"] [data-op-income]')
    expect(rows.map((el) => el.dataset.opIncome)).toEqual([back.id])
    expect(txt(rows[0]!)).toBe('Возврат · 12 октября · 3 000 ₸') // Р-12 «Figma»: «₸» у суммы
    await press(rows[0]!)
    expect(txt(q('[role="dialog"] [data-op-meta]'))).toContain('вернули 3 000')
    expect(ops.all.find((o) => o.id === back.id)?.internal).toBe(true)
  })
})

/**
 * TL-08 (Р-5), обновление: у семьи платежи «Коммуналка» 30 000 и «Интернет» 9 000 14-го; у Ильяса в выписке оба списания.
 * На телефоне старой версии он ответил «Нет, это другое» (Коммуналка) и «Потом» (Интернет) — ответы лежат только в ключах
 * устройства. Обновился: ответы переехали в документ, ключи стёрты, вопросов нет — и на втором телефоне тоже. Через сутки
 * «Интернет» спрашивается снова, «Коммуналка» — никогда.
 */
describe('приёмка / Хвосты Блок 3 — ответы со старого телефона не потерялись (TL-08)', () => {
  beforeEach(() => {
    server.data.obligations = [
      { id: 'o1', name: 'Коммуналка', note: '', day: 14, category: 'd1', versions: [{ from: '2000-01', amount: 30_000 }], updatedAt: T0 },
      { id: 'o2', name: 'Интернет', note: '', day: 14, category: 'd1', versions: [{ from: '2000-01', amount: 9_000 }], updatedAt: T0 },
    ]
  })
  const asks = async (p: Phone) => (await screen(p.pinia, Week, '/week')).includes('data-bang')
  const pending = (p: Phone) => {
    setActivePinia(p.pinia)
    return useOperationsStore().pendingMatches.map((c) => c.targetId).sort()
  }

  it('старые ключи устройства → после обновления в личном документе; ни этот, ни второй телефон не спрашивают', async () => {
    const old = await launch()
    await useOperationsStore().upload([{ name: 'x.pdf', parsed: statement([
      op('2026-10-14', -30_000, 'ТОО Алсеко', 'sc_utilities'),
      op('2026-10-14', -9_000, 'Казахтелеком', 'sc_telecom'),
    ]) }], old.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    expect(pending(old)).toEqual(['o1', 'o2'])
    const [rent, net] = ['o1', 'o2'].map((t) => useOperationsStore().pendingMatches.find((c) => c.targetId === t)!)
    // Так их записывала версия до TL-08 — только на устройстве.
    storage.set('ff_match_declined', JSON.stringify([declineKey(rent!)]))
    storage.set('ff_decisions_deferred', JSON.stringify({ [`match:${net!.kind}:${net!.targetId}:${net!.period}`]: '2026-10-24T07:00:00.000Z' }))
    expect(pv.docs.get('u-a')?.data.answers ?? []).toEqual([])

    // Обновление: тот же диск, новая сборка.
    const fresh = await launch()
    await flush()
    expect(storage.has('ff_match_declined')).toBe(false)
    expect(storage.has('ff_decisions_deferred')).toBe(false)
    const doc = (pv.docs.get('u-a')?.data.answers ?? []) as { id: string; kind: string }[]
    expect(doc.map((a) => a.kind).sort()).toEqual(['declined', 'deferred'])
    expect(pending(fresh)).toEqual(['o2'])
    expect(await asks(fresh)).toBe(false)

    // Второй телефон — чистый диск, тот же человек.
    storage.clear()
    const two = await launch()
    expect(pending(two)).toEqual(['o2'])
    expect(await asks(two)).toBe(false)
    at('2026-10-24T08:00:00Z')
    expect(await asks(two)).toBe(true)
    expect(pending(two)).toEqual(['o2'])
  })
})

/**
 * TL-09 (Р-6): ИИ включён, выписка загружена раньше; на новом запуске `GET /api/statements` падает. Разбор не уходит, попытка
 * не записана (следующий круг попробует снова), на экране ничего нового.
 */
describe('приёмка / Хвосты Блок 3 — выписки не пришли, разбора нет (TL-09)', () => {
  it('ошибка списка выписок → autoReview молча null, запроса к ИИ нет, ff_ai_auto не записан', async () => {
    const A = await launch()
    await useOperationsStore().upload([{ name: 'x.pdf', parsed: statement([
      op('2026-10-03', -12_000, 'Magnum', 'sc_food'),
      op('2026-10-15', -5_000, 'SHOP X', null),
    ]) }], A.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await A.store.syncHousehold(A.client)

    storage.clear()
    pv.docs.set('u-a', { rev: (pv.docs.get('u-a')?.rev ?? 0) + 1, data: { ...(pv.docs.get('u-a')?.data ?? {}), aiConsent: { on: true, at: T0, v: 3 } } })
    const aiReview = vi.fn(async (body: unknown) => leadFor(body))
    const broken = vi.fn(() => Promise.reject(new Error('502')))
    const B = await launch({ listStatementUploads: broken, aiReview } as unknown as Partial<ApiClient>)
    useAuthStore().ai = true
    const review = await useAiStore().autoReview(B.client)
    expect(broken).toHaveBeenCalled()
    expect(review).toBeNull()
    expect(aiReview).not.toHaveBeenCalled()
    expect(storage.get('ff_ai_auto')).toBeUndefined()
  })
})
