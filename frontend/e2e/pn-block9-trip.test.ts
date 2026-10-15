import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import type { Goal } from '../src/types/finance'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

vi.mock('../src/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * Блок 9 «понятность» (PN-30…PN-32, Р-14): поездка с бюджетом на двух телефонах и viewer, фейковый сервер документа и
 * выписок (`support/family`). «Отпуск» — 10–15 октября 2026, бюджет 150 000; «сейчас» — 15-е, последний день. (а) до поездки — карточки нет, даты в
 * «Подробнее»; (б) в пути: выписка Ильяса с тратами в датах и вне, кредит по выписке в датах (отметка `opId`) → «Потрачено»
 * только из трат; «Убрать» и «Вернуть» меняют сумму и `tripSpends`; (в) выписка Аруны на её телефоне → общий итог = сумма
 * двух записей, чужих строк нет; (г) после — «За поездку» и «Съездили?» («Сбылось» — в альбом); (д) viewer — итог без строк и действий; (е) старая цель без дат —
 * ничего не пишется. Экраны — SSR (`screen`), нажатия — функциями компонента (`screenMixin`); браузер — стенд §6.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

const TRIP = { from: '2026-10-10', to: '2026-10-15', budget: 150_000 }
const withTrip = (extra: Partial<Goal> = TRIP) => planFamilyDoc().goals.map((g) => (g.id === 'trip' ? { ...g, ...extra } : g))

const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false,
})
// Ильяс: отель и кафе — в датах, Magnum — накануне, кредит 58 000 — платёж по выписке в датах.
const ILYAS = [op('2026-10-10', -70_000, 'Hotel Shymbulak'), op('2026-10-11', -12_000, 'Cafe Medeu'), op('2026-10-09', -5_000, 'Magnum'), op('2026-10-14', -58_000, 'Оплата Kaspi Кредита')]
const ARUNA = [op('2026-10-12', -8_000, 'Yandex Go'), op('2026-10-13', -30_000, 'Sulpak')]

describe('e2e / понятность Блок 9 — поездка с бюджетом', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-15T08:00:00Z')
    server = fakeServer(planFamilyDoc({ goals: withTrip() }))
    st = fakeStatements()
    // Личный документ (`tripExcluded`) — в сеть не ходит; телефоны держат его у себя.
    vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h-family', user_id: 'u', rev: rev + 1, data, updated_at: '' }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const user = role === 'viewer' ? 'u-v' : `u-${slot}`
    useAuthStore().setAuthData({
      token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
      household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
      member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
    })
    const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
    const store = useFinanceStore()
    store.claimFor('h-family')
    await store.pullHousehold(client)
    await useOperationsStore().pull(client)
    return { pinia, client, store }
  }
  const on = (p: Phone) => (setActivePinia(p.pinia), p)

  async function upload(p: Phone, list: Omit<Operation, 'id'>[]) {
    const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-10-01', to: '2026-10-15', skipped: 0, operations: assignIds(list) }
    on(p)
    const ops = useOperationsStore()
    ops.setDraft([{ name: 'выписка.pdf', parsed }])
    await ops.send(p.client)
    return ops
  }
  const sync = async (p: Phone) => {
    on(p)
    await p.store.syncHousehold(p.client)
  }
  const pull = async (p: Phone) => {
    on(p)
    await p.store.pullHousehold(p.client)
  }

  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| | /g, ' ').replace(/[ \t\r\n]+/g, ' ')
  const tripScreen = async (p: Phone, mixins = [screenMixin({ opsOpen: true, excludedOpen: true })]) => screen(p.pinia, GoalDetail, '/goals/trip', undefined, mixins)
  const opIdOf = (merchant: string) => useOperationsStore().all.find((o) => o.merchant === merchant)!.id
  // Нажатия у строки — функциями карточки; действие смеси одноразовое — на каждое нажатие своя.
  const tapExclude = (merchant: string) =>
    screenMixin({ opsOpen: true }, (s) => (s.exclude as (o: Operation) => void)((s.lists as { ops: Operation[] }).ops.find((o) => o.merchant === merchant)!))
  const tapInclude = (merchant: string) =>
    screenMixin({ excludedOpen: true }, (s) => (s.include as (o: Operation) => void)((s.lists as { excluded: Operation[] }).excluded.find((o) => o.merchant === merchant)!))
  const record = (p: Phone, by: 'a' | 'b') => on(p).store.householdDoc.tripSpends?.find((t) => t.id === `trip:${by}`)

  it('(а) до поездки — карточки нет, даты в «Подробнее», итог не пишется', async () => {
    at('2026-10-05T08:00:00Z')
    const a = await phone('a')
    await upload(a, [op('2026-10-03', -9_000, 'Magnum')])
    const html = text(await tripScreen(a))
    expect(html).not.toContain('data-trip-title')
    expect(html).toContain('Поездка 10–15 октября')
    expect(a.store.householdDoc.tripSpends ?? []).toEqual([])
  })

  it('(б) в пути: «Потрачено» без платежа по выписке и трат вне дат; «Убрать» и «Вернуть» меняют сумму и запись', async () => {
    const a = await phone('a')
    const ops = await upload(a, ILYAS)
    // «Да, отметить» платёж кредита — отметка с `opId` строки выписки.
    await ops.acceptMatch(ops.pendingMatches.find((c) => c.targetId === 'loan')!, a.client)
    expect(a.store.payments.find((p) => p.targetId === 'loan' && p.opId)).toBeTruthy()
    let html = text(await tripScreen(a))
    expect(html).toContain('Потрачено 82 000 из 150 000 ₸')
    expect(html).toContain('Операции · 2')
    expect(html).toContain('Hotel Shymbulak')
    expect(html).not.toContain('Magnum')
    expect(html).not.toContain('Kaspi Кредита')
    expect(record(a, 'a')).toMatchObject({ amount: 82_000, ops: 2 })

    const hotel = opIdOf('Hotel Shymbulak')
    await tripScreen(a, [tapExclude('Hotel Shymbulak')])
    await nextTick()
    html = text(await tripScreen(a))
    expect(html).toContain('Потрачено 12 000 из 150 000 ₸')
    expect(html).toContain('Убрано · 1')
    expect(record(a, 'a')).toMatchObject({ amount: 12_000, ops: 1 })
    expect(a.store.tripExcluded.map((x) => x.id)).toEqual([hotel])
    // «Убрать» не удаляет операцию: она в выписке, как была.
    expect(useOperationsStore().all.some((o) => o.id === hotel)).toBe(true)

    await tripScreen(a, [tapInclude('Hotel Shymbulak')])
    await nextTick()
    expect(text(await tripScreen(a))).toContain('Потрачено 82 000 из 150 000 ₸')
    expect(record(a, 'a')).toMatchObject({ amount: 82_000, ops: 2 })
    expect(a.store.tripExcluded).toEqual([])
  })

  it('(в) второй телефон: общий итог — сумма двух записей; у каждого свои строки, чужих нет; запись партнёра не затёрта', async () => {
    const a = await phone('a')
    await upload(a, ILYAS.slice(0, 3))
    await sync(a)
    const b = await phone('b')
    await upload(b, ARUNA)
    await sync(b)
    await pull(a)
    expect(record(a, 'a')).toMatchObject({ amount: 82_000 })
    expect(record(a, 'b')).toMatchObject({ amount: 38_000, ops: 2 })

    const seenByA = text(await tripScreen(a))
    expect(seenByA).toContain('Потрачено 120 000 из 150 000 ₸')
    expect(seenByA).toContain('Вы 82 000 ₸ · Аруна 38 000 ₸')
    expect(seenByA).not.toContain('Sulpak')
    await pull(b)
    const seenByB = text(await tripScreen(b))
    expect(seenByB).toContain('Потрачено 120 000 из 150 000 ₸')
    expect(seenByB).toContain('Ильяс 82 000 ₸ · Вы 38 000 ₸')
    expect(seenByB).toContain('Sulpak')
    expect(seenByB).not.toContain('Hotel Shymbulak')
    // Герой «Мечт» — первая цель очереди; под фото — «название · N %» (FR-09), траты поездки — только на её экране.
    on(a).store.makeMain('trip')
    const hero = text(await screen(a.pinia, Dreams, '/'))
    expect(hero).toMatch(/Отпуск ·\s+[0-9]+ %/)
    expect(hero).not.toContain('потрачено')
  })

  it('(г) после поездки — «За поездку — N из M», запись остаётся; «Съездили?» вместо «Пополнить», «Сбылось» — в альбом', async () => {
    const a = await phone('a')
    await upload(a, ILYAS.slice(0, 3))
    await sync(a)
    at('2026-10-20T08:00:00Z')
    const later = await phone('a')
    const after = text(await tripScreen(later))
    expect(after).toContain('За поездку 82 000 из 150 000 ₸')
    expect(record(later, 'a')).toMatchObject({ amount: 82_000, ops: 2 })
    // Решение владельца Б (возврат приёмки): «Съездили?» вместо срока и «Пополнить»; «Сбылось» — мечта в альбом.
    expect(after).toContain('Съездили? Отметьте — поездка уйдёт в «Сбылось» Ещё нет Сбылось')
    expect(after).not.toContain('Пополнить')
    const done = text(await tripScreen(later, [screenMixin({}, (s) => (s.markDone as () => void)())]))
    expect(on(later).store.goals.find((g) => g.id === 'trip')?.doneAt).toBeTruthy()
    expect(done).not.toContain('Съездили?')
    expect(done).toContain('За поездку 82 000 из 150 000 ₸')
  })

  it('(д) viewer — итог без строк и действий', async () => {
    const a = await phone('a')
    await upload(a, ILYAS.slice(0, 3))
    await sync(a)
    const v = await phone('b', 'viewer')
    const html = await tripScreen(v)
    expect(text(html)).toContain('Потрачено 82 000 из 150 000 ₸')
    expect(html).not.toContain('data-trip-ops-toggle')
    expect(html).not.toContain('data-trip-exclude')
    expect(html).not.toContain('Меню цели')
  })

  it('(е) старая цель без дат — итог поездки не пишется, экран прежний', async () => {
    server = fakeServer(planFamilyDoc({ goals: withTrip({}) }))
    const a = await phone('a')
    await upload(a, ILYAS.slice(0, 3))
    await sync(a)
    expect(server.data.tripSpends ?? []).toEqual([])
    const html = await tripScreen(a)
    expect(html).not.toContain('data-trip')
    expect(server.data.goals.find((g) => g.id === 'trip')).not.toHaveProperty('from')
    expect(T0).toBeTruthy()
  })
})
