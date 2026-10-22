import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { plain } from '../src/lib/money'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { UPLOAD_HOLD_MS, useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 3 «Фидбек» (FB-11, FB-12; Р-7, Р-18): партнёр видит у каждого одну строку «факт / план», разделы и операции —
 * только свои. Два телефона и viewer, пятница 12 октября 2026; каждый загрузил свою выписку 1–12 октября.
 *
 * Ручной расчёт:
 *   Ильяс  план: продукты 150 000 + кафе 40 000 = 190 000. Выписка: Magnum 30 000 (продукты), Del Papa 10 000 +
 *          Coffee Boom 3 500 (кафе), Автошкола 120 000 (образование, «Разовая»). Факт 30 000 + 13 500 + 120 000 =
 *          163 500 (разовая в факте, Р-5); разделы: продукты 30 000, кафе 13 500; «Разовые» 120 000.
 *   Аруна  план: продукты 100 000 + транспорт 25 000 = 125 000. Выписка: Small 20 000 (продукты), Yandex Go 6 000
 *          (транспорт). Факт 26 000; разделы: продукты 20 000, транспорт 6 000.
 *   Семья  «потрачено» 163 500 + 26 000 = 189 500 — как было (семейная цифра заголовка).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    // Viewer — на слоте Ильяса: экран не должен принять его за Ильяса (слот viewer может совпасть с участником).
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  return { pinia, client, store }
}

async function pull(...to: Phone[]) {
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
    await useOperationsStore().loadUploads(p.client)
  }
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  if (i < 0) return ''
  const j = html.indexOf(to, i + from.length)
  return html.slice(i, j < 0 ? undefined : j)
}
const people = (html: string) => [...html.matchAll(/data-spend-person="([^"]+)"/g)].map((m) => m[1])
const rows = (html: string) => [...html.matchAll(/data-spend-row="([^"]+)"/g)].map((m) => m[1])
const line = (html: string, by: string) => text(between(html, `data-spend-person="${by}"`, '</div>')).replace(/^.*?>/, '').trim()
const amountOf = (html: string, id: string) => text(between(between(html, `data-spend-row="${id}"`, '</div>'), 'data-spend-amount', '</span>')).replace(/^.*?>/, '').trim()

function familyDoc(): SyncDoc {
  return planFamilyDoc({
    spendPlans: [
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 150_000, updatedAt: T0 },
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 40_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 100_000, updatedAt: T0 },
      { id: 'b:sc_transport', by: 'b', categoryId: 'sc_transport', amount: 25_000, updatedAt: T0 },
    ],
  })
}

const op = (date: string, amount: number, merchant: string, categoryId: string): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
})
const statement = (ops: Omit<Operation, 'id'>[]): ParsedStatement => ({ bank: 'kaspi', from: '2026-10-01', to: '2026-10-12', skipped: 0, operations: assignIds(ops) })
const STATEMENT_A = () =>
  statement([
    op('2026-10-03', -30_000, 'Magnum', 'sc_food'),
    op('2026-10-05', -10_000, 'Del Papa Cafe', 'sc_cafe'),
    op('2026-10-09', -3_500, 'Coffee Boom', 'sc_cafe'),
    op('2026-10-10', -120_000, 'Автошкола Драйв', 'sc_education'),
  ])
const STATEMENT_B = () => statement([op('2026-10-04', -20_000, 'Small', 'sc_food'), op('2026-10-08', -6_000, 'Yandex Go', 'sc_transport')])

const month = (p: Phone, path = '/month', state: Record<string, unknown> = { opened: 'spend' }) => {
  setActivePinia(p.pinia)
  return screen(p.pinia, Month, path, undefined, [screenMixin(state)])
}

describe('e2e / Фидбек Блок 3 — партнёр: план · факт', () => {
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
    at('2026-10-12T07:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** Телефон загрузил свою выписку, дождался конца тоста и отправил итоги. */
  async function uploaded(p: Phone, parsed: ParsedStatement, oneOff?: string) {
    setActivePinia(p.pinia)
    const ops = useOperationsStore()
    await ops.upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    if (oneOff) ops.editOp(ops.shown.find((o) => o.merchant.startsWith(oneOff))!.id, { oneOff: true })
    await p.store.syncHousehold(p.client)
  }

  async function family() {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    await uploaded(A, STATEMENT_A(), 'Автошкола')
    await uploaded(B, STATEMENT_B())
    await pull(A, B)
    return { A, B }
  }

  it('Ильяс: строки обоих «факт / план», свой первым; ниже — только свои разделы и свои «Разовые»; «потрачено» — семья', async () => {
    const { A } = await family()
    const html = await month(A)
    expect(people(html)).toEqual(['a', 'b'])
    expect(line(html, 'a')).toBe(sp(`Ильяс ${plain(163_500)} / ${plain(190_000)}`))
    expect(line(html, 'b')).toBe(sp(`Аруна ${plain(26_000)} / ${plain(125_000)}`))
    expect(html).toContain('data-spend-mine')
    expect(rows(html)).toEqual(['sc_food', 'sc_cafe'])
    // Продукты — свои 30 000, не семейные 50 000.
    expect(amountOf(html, 'sc_food')).toBe(sp(plain(30_000)))
    expect(text(between(html, 'data-spend-oneoff', '</button>'))).toContain(sp(plain(120_000)))
    expect(text(between(html, 'data-section="spend"', '</button>'))).toContain(sp(`потрачено ${plain(189_500)}`))
  })

  it('Аруна: своя строка первой, свои разделы; разделов, разовых и операций Ильяса нет — ни в списке, ни в листе, ни по адресу', async () => {
    const { B } = await family()
    const html = await month(B)
    expect(people(html)).toEqual(['b', 'a'])
    expect(line(html, 'a')).toBe(sp(`Ильяс ${plain(163_500)} / ${plain(190_000)}`))
    expect(rows(html)).toEqual(['sc_food', 'sc_transport'])
    expect(amountOf(html, 'sc_food')).toBe(sp(plain(20_000)))
    expect(html).not.toContain('data-spend-oneoff')
    // Числа Ильяса по разделам — нигде в «Тратах» (его «факт / план» — только в его строке).
    const spends = text(between(html, 'data-spend-mine', 'data-section="queue"'))
    for (const n of [30_000, 13_500, 120_000]) expect(spends).not.toContain(sp(plain(n)))

    // Лист своих «Продуктов» — свой факт и «План» одной строкой.
    const food = await month(B, '/month?cat=sc_food')
    expect(text(between(food, 'data-cat-amount', '</p>'))).toContain(sp(plain(20_000)))
    expect(text(between(food, 'data-cat-plans-title', '</p>'))).toContain('План')
    expect([...food.matchAll(/data-cat-person="([^"]+)"/g)].map((m) => m[1])).toEqual(['b'])
    expect(food).not.toContain('Magnum')

    // Кафе Ильяса по адресу (отчёт ИИ ведёт на `?cat=`) — «нет трат», без его цифр и операций.
    const cafe = await month(B, '/month?cat=sc_cafe')
    expect(text(between(cafe, 'data-cat-none', '</p>'))).toContain('У вас трат в этом разделе нет')
    expect(cafe).not.toContain(plain(13_500))
    expect(cafe).not.toContain('Coffee Boom')
  })

  it('прошлый месяц: лист раздела `?month=&cat=` — тоже свой', async () => {
    const { A, B } = await family()
    at('2026-11-03T07:00:00Z')
    const path = (cat: string) => `/month?month=${K}&cat=${cat}`
    expect(text(between(await month(A, path('sc_cafe')), 'data-cat-amount', '</p>'))).toContain(sp(plain(13_500)))
    const cafeB = await month(B, path('sc_cafe'))
    expect(text(between(cafeB, 'data-cat-none', '</p>'))).toContain('У вас трат в этом разделе нет')
    expect(cafeB).not.toContain(plain(13_500))
  })

  it('viewer: строки участников — да; разделов, «Разовых», «+ Раздел» и листа раздела — нет', async () => {
    await family()
    const V = await phone(server, st, 'a', 'viewer')
    const html = await month(V)
    expect(people(html)).toEqual(['a', 'b'])
    expect(line(html, 'a')).toBe(sp(`Ильяс ${plain(163_500)} / ${plain(190_000)}`))
    expect(rows(html)).toEqual([])
    for (const attr of ['data-spend-mine', 'data-spend-oneoff', 'data-spend-unknown', 'data-spend-add']) expect(html).not.toContain(attr)
    expect(await month(V, '/month?cat=sc_food')).not.toContain('data-cat-amount')
  })
})
