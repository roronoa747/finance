// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, getActivePinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView, type Router } from 'vue-router'
import { createAppRouter } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, handId, handOperation } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import type { Goal, SyncDoc } from '../src/types/finance'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 6 «Маленькая пачка» «Figma» (FG-28…FG-32) — общий e2e исполнителя. Семья и помощники — из приёмки Блока 5
 * (`fg-block5-accept`): тот же человек A на двух телефонах (A1, A2 — слот 'a', один пользователь), партнёр B; карта
 * «Kaspi Gold» — счёт для трат только A. Наблюдатели тянут операции общим `apiClient` — он подменён ручками телефона, чей
 * pinia активен.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

/** Телефоны, у которых сервер операций отвечает ошибкой; ручки операций каждого телефона — для общего `apiClient`. */
const down = new Set<Pinia>()
const handles = new Map<Pinia, ReturnType<typeof statementsFor>>()
const failing = async () => {
  throw new Error('503 Service Unavailable')
}

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', { broken = false } = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  if (broken) down.add(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const ops = statementsFor(st, user, slot)
  handles.set(pinia, ops)
  const client = { ...backend(server), ...ops, listOperations: (...args: []) => (down.has(pinia) ? failing() : ops.listOperations(...args)) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  await useOperationsStore().pull(client)
  return { pinia, client, store }
}

/** Круг движка для документа (операции тянет наблюдатель счёта по сигналу). */
async function docRound(p: Phone) {
  setActivePinia(p.pinia)
  await p.store.pullHousehold(p.client)
  await settle()
  await p.store.syncHousehold(p.client)
}
/** Полный круг: свои операции + документ. */
async function sync(p: Phone) {
  setActivePinia(p.pinia)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const onCard = async (p: Phone) => text(await screen(p.pinia, Week, '/week')).match(/На карте ([\d ]+₸)/)?.[1] ?? null
const nbsp = (s: string) => s.replace(/\s/g, ' ')
const spentOnServer = (server: FakeServer) => (server.data.accountSpent ?? []).find((s) => s.id === 'card:a')?.amount
const mine = (p: Phone) => p.store.householdDoc.accountSpent?.find((s) => s.id === 'card:a')?.amount

let seq = 0
async function statement(p: Phone, rows: Omit<Operation, 'id'>[]) {
  setActivePinia(p.pinia)
  const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-10-01', to: rows.map((r) => r.date).sort().pop()!, skipped: 0, operations: assignIds(rows) }
  useOperationsStore().setDraft([{ name: `kaspi-${++seq}.pdf`, parsed }])
  await useOperationsStore().send(p.client)
  await sync(p)
}
const row = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: amount < 0 ? 'purchase' : 'transfer-in', merchant, categoryId: null, internal: false, ...extra,
})

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
  // happy-dom (сценарии вида) отдаёт относительным адресам хост — запросы мимо подменённых ручек не уходят в сеть.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
  down.clear()
  handles.clear()
  vi.useFakeTimers()
  at('2026-10-15T07:00:00Z')
  server = fakeServer(planFamilyDoc())
  st = fakeStatements()
  seq = 0
  // Общий клиент — ручки операций телефона, чей pinia активен в момент запроса; отказ — у него же.
  const own = () => handles.get(getActivePinia()!)!
  vi.spyOn(apiClient, 'listOperations').mockImplementation(((...args: []) => (down.has(getActivePinia()!) ? failing() : own().listOperations(...args))) as never)
  vi.spyOn(apiClient, 'upsertOperations').mockImplementation(((...args: [never]) => own().upsertOperations(...args)) as never)
  vi.spyOn(apiClient, 'listStatementUploads').mockImplementation((() => own().listStatementUploads()) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Семья: карта A сверена 12-го на 2 000 000; A1 загрузил −250 000 (A2 подтянул) и −12 500 (A2 не знает). */
async function family() {
  const a1 = await phone(server, st, 'a')
  const a2 = await phone(server, st, 'a')
  const b = await phone(server, st, 'b')
  setActivePinia(a1.pinia)
  a1.store.setSpendAccount('card', 'a')
  at('2026-10-12T07:00:00Z')
  a1.store.setAccountAmount('card', 2_000_000)
  await sync(a1)
  await sync(b)
  at('2026-10-14T19:00:00Z')
  await statement(a1, [row('2026-10-14', -250_000, 'Technodom')])
  await sync(a2)
  at('2026-10-15T07:00:00Z')
  await statement(a1, [row('2026-10-15', -12_500, 'Magnum')])
  expect(spentOnServer(server)).toBe(262_500)
  return { a1, a2, b }
}

/** Остаток карты у всех; «На карте» «Недели» — у телефонов A (у B карта не счёт для трат — строки нет). */
async function sameEverywhere(phonesA: Phone[], b: Phone, amount: number) {
  for (const p of [...phonesA, b]) expect(card(p)).toBe(amount)
  for (const p of phonesA) expect(nbsp(String(await onCard(p)))).toBe(nbsp(money(amount)))
  expect(await onCard(b)).toBeNull()
}

/** Итоги недели A на сервере (документ семьи моков): раздел → сумма; ноль — тоже запись. */
const weekOnServer = (server: FakeServer) =>
  Object.fromEntries((server.data.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === WEEK).map((t) => [t.categoryId, t.amount]))
const weekMine = (p: Phone) =>
  Object.fromEntries((p.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === WEEK).map((t) => [t.categoryId, t.amount]))
const WEEK = '2026-W42'
/** Круг движка участника: документ + `pullFresh` (FG-27). */
async function engineRound(p: Phone) {
  setActivePinia(p.pinia)
  await p.store.pullHousehold(p.client)
  await useOperationsStore().pullFresh(p.client)
  await settle()
  await p.store.syncHousehold(p.client)
}
async function hand(p: Phone, amount: number) {
  setActivePinia(p.pinia)
  const op = handOperation({ id: handId(), amount, categoryId: 'sc_food', date: '2026-10-15', note: '' }, 'Продукты')
  await useOperationsStore().saveHand(op, {}, p.client)
}

describe('e2e / Блок 6 «Маленькая пачка» — FG-28: итоги разделов второго своего телефона', () => {
  it('(1) проба критика: выписка A1 → «Оплатил» B → документ на A2 раньше его pull — «Еда» недели A на сервере 12 500 все 3 круга', async () => {
    const { a1, a2, b } = await family()
    const before = weekOnServer(server)
    expect(before.sc_food).toBe(12_500)
    at('2026-10-15T08:00:00Z')
    setActivePinia(b.pinia)
    b.store.markPaid('obligation', 'rent', 'b', { accountId: null })
    await sync(b)
    // Круг A2 на медленной сети: ответ операций придержан, документ уходит раньше — итоги по старой копии не пишутся.
    at('2026-10-15T08:00:30Z')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const a2ops = handles.get(a2.pinia)!
    vi.mocked(apiClient.listOperations).mockImplementationOnce((async (...args: []) => {
      await gate
      return a2ops.listOperations(...args)
    }) as never)
    await docRound(a2)
    expect(weekOnServer(server)).toEqual(before)
    expect(weekMine(a2)).toEqual(before)
    release()
    await settle()
    await sync(a2)
    expect(weekOnServer(server)).toEqual(before)
    for (let r = 0; r < 3; r++) {
      at(`2026-10-15T08:0${r + 1}:00Z`)
      for (const p of [a2, a1, b]) {
        await docRound(p)
        expect(weekOnServer(server)).toEqual(before)
        expect(spentOnServer(server)).toBe(262_500)
      }
    }
    expect(weekMine(a2)).toEqual(before)
  })

  it('(2) самодогон: ручная трата A2 со старой копией — итоги по копии A2; его круг приносит выписку A1 — 16 000; у A1 после круга — то же', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    await hand(a2, 3_500)
    // Прямой путь — по копии A2 (выписки −12 500 в ней нет).
    expect(weekMine(a2).sc_food).toBe(3_500)
    await sync(b)
    at('2026-10-15T08:01:00Z')
    await engineRound(a2)
    expect(weekMine(a2).sc_food).toBe(16_000)
    expect(mine(a2)).toBe(266_000)
    expect(weekOnServer(server).sc_food).toBe(16_000)
    at('2026-10-15T08:02:00Z')
    await engineRound(a1)
    expect(weekMine(a1).sc_food).toBe(16_000)
    expect(mine(a1)).toBe(266_000)
    for (let r = 0; r < 3; r++) {
      at(`2026-10-15T08:1${r}:00Z`)
      for (const p of [a1, a2, b]) await engineRound(p)
      expect(weekOnServer(server).sc_food).toBe(16_000)
      expect(spentOnServer(server)).toBe(266_000)
    }
    await sameEverywhere([a1, a2], b, 1_734_000)
  })

  it('(3) регресс: ручная трата на свежем телефоне — итоги и «На карте» сразу, без запроса операций', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    await hand(a1, 1_500)
    expect(ops).not.toHaveBeenCalled()
    expect(weekMine(a1).sc_food).toBe(14_000)
    expect(mine(a1)).toBe(264_000)
    expect(card(a1)).toBe(1_736_000)
    await sync(a1)
    expect(weekOnServer(server).sc_food).toBe(14_000)
    at('2026-10-15T08:01:00Z')
    for (const p of [a2, b]) await engineRound(p)
    await sameEverywhere([a1, a2], b, 1_736_000)
  })
})

describe('e2e / Блок 6 «Маленькая пачка» — FG-29: окно свежести от сигнала документа', () => {
  it('(4) выписка A1 в окне 5 с после pull A2 → «Оплатил» B → круг A2: card:a и итоги недели по обеим выпискам', async () => {
    const { a1, a2, b } = await family()
    at('2026-10-15T08:00:00Z')
    setActivePinia(a2.pinia)
    await useOperationsStore().pull(a2.client)
    at('2026-10-15T08:00:01Z')
    await statement(a1, [row('2026-10-15', -7_500, 'Magnum')])
    expect(spentOnServer(server)).toBe(270_000)
    expect(weekOnServer(server).sc_food).toBe(20_000)
    at('2026-10-15T08:00:02Z')
    setActivePinia(b.pinia)
    b.store.markPaid('obligation', 'rent', 'b', { accountId: null })
    await sync(b)
    await docRound(a1)
    at('2026-10-15T08:00:03Z')
    const ops = vi.mocked(apiClient.listOperations)
    ops.mockClear()
    await docRound(a2)
    expect(ops).toHaveBeenCalledTimes(1)
    expect(mine(a2)).toBe(270_000)
    expect(weekMine(a2).sc_food).toBe(20_000)
    for (let r = 0; r < 3; r++) {
      at(`2026-10-15T08:0${r + 1}:00Z`)
      for (const p of [a1, a2, b]) await docRound(p)
      expect(spentOnServer(server)).toBe(270_000)
      expect(weekOnServer(server).sc_food).toBe(20_000)
    }
    await sameEverywhere([a1, a2], b, 1_730_000)
  })
})

/* Вид (FG-30…FG-32): экраны в DOM — роутер приложения, оболочка, семья `planFamilyDoc` с целями ниже. */
let app: App | null = null
const goal = (id: string, name: string, extra: Partial<Goal> = {}): Goal => ({
  id, name, need: 1_000_000, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: T0, ...extra,
})
async function viewPhone(extra: Partial<SyncDoc>, role: 'member' | 'viewer' = 'member') {
  server = fakeServer(planFamilyDoc(extra))
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(backend(server))
  return pinia
}
const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await vi.dynamicImportSettled()
  for (let i = 0; i < n; i++) await nextTick()
}
async function mount(pinia: Pinia, path: string): Promise<Router> {
  app?.unmount()
  document.body.innerHTML = ''
  setActivePinia(pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(RouterView) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await tick()
  return router
}
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const LONG = 'Поездка в Японию на сакуру и Фудзи'

describe('e2e / Блок 6 «Маленькая пачка» — вид', () => {
  beforeEach(() => {
    localStorage.setItem('ff_tips_seen', JSON.stringify(['tab-week', 'tab-month', 'tab-money', 'tab-dreams']))
  })
  afterEach(() => {
    app?.unmount()
    app = null
    document.body.innerHTML = ''
  })

  it('FG-30: цель — шапка оболочки одна, без заголовка; «Поделиться» и «···» в ней; имя — на обложке один раз', async () => {
    const pinia = await viewPhone({ goals: [goal('jp', LONG, { seed: 200_000, have: 200_000, main: true })] })
    await mount(pinia, '/goals/jp')
    const heads = all('[data-shell-header]')
    expect(heads).toHaveLength(1)
    expect(heads[0].querySelector('h1')).toBeNull()
    expect(txt(heads[0])).not.toContain('Поездка')
    expect(q('[data-shell-header] [aria-label="Назад"]')!.className).toContain('bg-surface-glass')
    for (const sel of ['[data-goal-share]', '[aria-label="Меню цели"]']) expect(heads[0].querySelector<HTMLElement>(sel)!.className).toContain('bg-surface-glass')
    expect(all('[data-hero-title]').map(txt)).toEqual([LONG])
    expect(document.body.textContent!.split(LONG)).toHaveLength(2)
  })

  it('FG-31: «Мечты» с обложкой — одна шапка на фото ниже выреза (safe-area), шапки оболочки нет; «План» — шапка оболочки с тем же env()', async () => {
    const pinia = await viewPhone({ goals: [goal('jp', 'Япония', { seed: 300_000, have: 300_000, main: true })] })
    const router = await mount(pinia, '/')
    expect(q('[data-shell-header]')).toBeNull()
    const heads = all('[data-dreams-cover] header')
    expect(heads).toHaveLength(1)
    expect(heads[0].parentElement!.className).toContain('env(safe-area-inset-top)')
    await router.push('/month')
    await tick()
    expect(q('[data-shell-header]')!.className).toContain('pt-[max(16px,calc(env(safe-area-inset-top)_+_8px))]')
    expect(q('nav[aria-label="Разделы"]')!.className).toContain('env(safe-area-inset-bottom)')
  })

  it('FG-32: строки целей — процент колонкой одной ширины, без «+N недели» и «на паузе»; пауза — приглушением', async () => {
    const pinia = await viewPhone({
      goals: [
        goal('jp', 'Япония', { seed: 300_000, have: 300_000, main: true }),
        goal('a3', 'Три', { seed: 30_000, have: 30_000 }),
        goal('a18', 'Восемнадцать', { seed: 180_000, have: 180_000, pausedAt: T0 }),
        goal('a100', 'Сто', { seed: 1_000_000, have: 1_000_000 }),
      ],
    })
    await mount(pinia, '/')
    const pcts = all('[data-row-pct]')
    expect(pcts.map(txt)).toEqual(['3 %', '18 %', '100 %'])
    for (const el of pcts) expect(el.className).toMatch(/\bw-\[52px\]/)
    expect(q('[data-row-note]')).toBeNull()
    expect(txt(document.body)).not.toContain('на паузе')
    expect(txt(document.body)).not.toMatch(/\+\d+ недел/)
    expect(q('[data-id="a18"]')!.matches('.opacity-60') || !!q('[data-id="a18"] .opacity-60')).toBe(true)
  })
})
