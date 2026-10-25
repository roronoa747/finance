import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { money, plain } from '../src/lib/money'
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
 * Приёмка Блока 3 «Фидбек» (FB-11, FB-12; Р-18): то, что стенд приёмки проверял руками, — сценарием.
 * Общий раздел «Продукты» — план у обоих, а тратил только Ильяс; партнёр меняет свой план со своего телефона.
 * Пятница 12 октября 2026; каждый загрузил свою выписку 1–12 октября.
 *
 * Ручной расчёт:
 *   Ильяс  план: продукты 150 000 + кафе 40 000 = 190 000. Выписка: Magnum 30 000 (продукты). Факт 30 000.
 *   Аруна  план: продукты 100 000 + транспорт 25 000 = 125 000. Выписка: Yandex Go 6 000 (транспорт). Факт 6 000;
 *          «Продукты» у неё — 0 (план есть, трат нет), не 30 000 Ильяса.
 *   Аруна меняет план продуктов на 80 000 → её строка 6 000 / 105 000; план Ильяса (150 000) и его строка — как были.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
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

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
const between = (html: string, from: string, to: string) => {
  const i = html.indexOf(from)
  if (i < 0) return ''
  const j = html.indexOf(to, i + from.length)
  return html.slice(i, j < 0 ? undefined : j)
}
const rows = (html: string) => [...html.matchAll(/data-spend-row="([^"]+)"/g)].map((m) => m[1])
const line = (html: string, by: string) => text(between(html, `data-spend-person="${by}"`, '</div>')).replace(/^.*?>/, '').trim()
const amountOf = (html: string, id: string) => text(between(between(html, `data-spend-row="${id}"`, '</div>'), 'data-spend-amount', '</span>')).replace(/^.*?>/, '').trim()
/** Сам лист раздела — от крупной цифры до конца (строки участников экрана выше в него не входят). */
const sheet = (html: string) => text(html.slice(Math.max(0, html.indexOf('data-cat-amount'))))
const planPeople = (html: string) => [...html.matchAll(/data-cat-person="([^"]+)"/g)].map((m) => m[1])

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

const month = (p: Phone, path = '/month') => {
  setActivePinia(p.pinia)
  return screen(p.pinia, Month, path, undefined, [screenMixin({ opened: 'spend' })])
}

describe('e2e / приёмка Фидбек Блок 3 — общий раздел и план партнёра', () => {
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

  async function uploaded(p: Phone, parsed: ParsedStatement) {
    setActivePinia(p.pinia)
    await useOperationsStore().upload([{ name: 'x.pdf', parsed }], p.client)
    await vi.advanceTimersByTimeAsync(UPLOAD_HOLD_MS)
    await p.store.syncHousehold(p.client)
  }

  async function family() {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    await uploaded(A, statement([op('2026-10-03', -30_000, 'Magnum', 'sc_food')]))
    await uploaded(B, statement([op('2026-10-08', -6_000, 'Yandex Go', 'sc_transport')]))
    await pull(A, B)
    return { A, B }
  }

  it('общий раздел: у партнёра «Продукты» — свой 0, не траты Ильяса; строки участников одинаковы на обоих телефонах', async () => {
    const { A, B } = await family()
    const a = await month(A)
    const b = await month(B)
    // Порядок — по факту: «Продукты» с нулём ниже транспорта.
    expect(rows(b)).toEqual(['sc_transport', 'sc_food'])
    expect(amountOf(b, 'sc_food')).toBe(sp(money(0)))
    expect(amountOf(a, 'sc_food')).toBe(sp(money(30_000)))
    // Одна и та же строка участника — одна и та же цифра у обоих.
    expect(line(a, 'a')).toBe(sp(`Ильяс ${plain(30_000)} / ${money(190_000)}`))
    expect(line(b, 'a')).toBe(line(a, 'a'))
    expect(line(a, 'b')).toBe(sp(`Аруна ${plain(6_000)} / ${money(125_000)}`))
    expect(line(b, 'b')).toBe(line(a, 'b'))

    // Лист «Продуктов» партнёра: свой план, ни цифры, ни операции Ильяса.
    const food = await month(B, '/month?cat=sc_food')
    expect(planPeople(food)).toEqual(['b'])
    expect(sheet(food)).toContain(sp(plain(100_000)))
    expect(sheet(food)).not.toContain(sp(plain(30_000)))
    expect(sheet(food)).not.toContain(sp(plain(150_000)))
    expect(food).not.toContain('Magnum')
  })

  it('партнёр меняет свой план со своего телефона: у Ильяса меняется только строка партнёра, его «План» — свой', async () => {
    const { A, B } = await family()
    setActivePinia(B.pinia)
    B.store.setSpendPlan('b', 'sc_food', 80_000)
    await B.store.syncHousehold(B.client)
    await pull(A)

    const a = await month(A)
    expect(line(a, 'b')).toBe(sp(`Аруна ${plain(6_000)} / ${money(105_000)}`))
    expect(line(a, 'a')).toBe(sp(`Ильяс ${plain(30_000)} / ${money(190_000)}`))
    const food = await month(A, '/month?cat=sc_food')
    expect(planPeople(food)).toEqual(['a'])
    expect(sheet(food)).toContain(sp(plain(150_000)))
    expect(sheet(food)).not.toContain(sp(plain(80_000)))
  })
})
