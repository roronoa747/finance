import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { spendCompare } from '../src/lib/finance'
import { money, plain } from '../src/lib/money'
import type { SpendTotal } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { PersonId, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 1 «ИИ-польза» (AU-01…AU-03, Р-5): траты в сравнении на «Месяце» — два телефона и viewer, понедельник
 * 12 октября 2026. Выписки: июль–сентябрь — у обоих целиком; октябрь — у Ильяса с 1-го по 12-е.
 *
 * Ручной расчёт:
 *   Кафе (Ильяс)     июль–сентябрь по 30 000 → обычно 30 000; октябрь 48 000 → точка (выше на 18 000 и на 60 %);
 *                    план 20 000 → «до плана: +10 000» в «Подушку»; % дохода 48 000 / 1 200 000 = 4.
 *   Продукты (оба)   июль 80 000 + 40 000, август 90 000 + 45 000, сентябрь 85 000 + 50 000 → обычно
 *                    (120 000 + 135 000 + 135 000) / 3 = 130 000; октябрь 50 000 — без точки; план 90 000 + 60 000 =
 *                    150 000 ≥ обычно — рекомендации нет.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  await useOperationsStore().loadUploads(client)
  return { pinia, client, store }
}

async function sync(from: Phone, ...to: Phone[]) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  for (const p of to) {
    setActivePinia(p.pinia)
    await p.store.pullHousehold(p.client)
  }
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
/** Текст элемента с атрибутом `attr` (первого) — из SSR-разметки. */
function part(html: string, attr: string) {
  const i = html.indexOf(attr)
  if (i < 0) return ''
  const open = html.lastIndexOf('<', i)
  const tag = html.slice(open + 1, html.indexOf(' ', open))
  return text(html.slice(open, html.indexOf(`</${tag}>`, i))).trim()
}

const total = (by: PersonId, period: string, categoryId: string, amount: number): SpendTotal => ({
  id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 3, updatedAt: T0,
})
function familyDoc(): SyncDoc {
  return planFamilyDoc({
    spendPlans: [
      { id: 'a:sc_cafe', by: 'a', categoryId: 'sc_cafe', amount: 20_000, updatedAt: T0 },
      { id: 'a:sc_food', by: 'a', categoryId: 'sc_food', amount: 90_000, updatedAt: T0 },
      { id: 'b:sc_food', by: 'b', categoryId: 'sc_food', amount: 60_000, updatedAt: T0 },
    ],
    spendTotals: [
      total('a', '2026-07', 'sc_cafe', 30_000), total('a', '2026-07', 'sc_food', 80_000), total('b', '2026-07', 'sc_food', 40_000),
      total('a', '2026-08', 'sc_cafe', 30_000), total('a', '2026-08', 'sc_food', 90_000), total('b', '2026-08', 'sc_food', 45_000),
      total('a', '2026-09', 'sc_cafe', 30_000), total('a', '2026-09', 'sc_food', 85_000), total('b', '2026-09', 'sc_food', 50_000),
      total('a', K, 'sc_cafe', 48_000), total('a', K, 'sc_food', 50_000),
    ],
  })
}
const upload = (slot: 'a' | 'b', from: string, to: string) => ({
  id: `up-${slot}-${from}`, slot, bank: 'kaspi', period_from: from, period_to: to, ops_count: 30, created_at: T0, user: `u-${slot}`,
})

/** «Месяц» с раскрытой «Тратами» и (если задан) листом раздела. */
const month = (p: Phone, catFor?: string, act?: (s: Record<string, unknown>) => void) =>
  screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'spend', ...(catFor ? { catFor } : {}) }, act)])
const compareOf = (p: Phone) => {
  setActivePinia(p.pinia)
  const { state, ctx } = p.store.planInput(K)
  return spendCompare(state, ctx)
}
const rowsOf = (html: string) => [...html.matchAll(/data-spend-row="([^"]+)"/g)].map((m) => m[1])
const dotsOf = (html: string) => [...html.matchAll(/data-spend-row="([^"]+)"[^>]*data-over/g)].map((m) => m[1])

describe('e2e / ИИ-польза Блок 1 — траты в сравнении на «Месяце»', () => {
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
    st.uploads.push(upload('a', '2026-07-01', '2026-10-12'), upload('b', '2026-07-01', '2026-08-31'), upload('b', '2026-09-01', '2026-09-30'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('member: разделы семьи, точка у кафе и у «Траты», лист с обычно, планом, % дохода и «до плана»; партнёр видит те же строки; viewer — без правок', async () => {
    const A = await phone(server, st, 'a')
    const r = compareOf(A)
    expect(r.rows.map((x) => [x.categoryId, x.amount, x.usual, x.plan, x.share, x.over])).toEqual([
      ['sc_food', 50_000, 130_000, 150_000, 4, false],
      ['sc_cafe', 48_000, 30_000, 20_000, 4, true],
    ])
    expect(r.rows[1].advice).toEqual({ amount: 10_000, goalId: 'cushion', goalName: 'Подушка', days: 659 })

    const html = await month(A)
    expect(rowsOf(html)).toEqual(['sc_food', 'sc_cafe'])
    expect(dotsOf(html)).toEqual(['sc_cafe'])
    expect(part(html, 'data-section="spend"')).toContain('Траты')
    expect(html).toMatch(/data-section="spend"[\s\S]*?data-section-dot[\s\S]*?data-section="queue"/)
    expect(html).toContain('data-spend-add')

    const sheet = await month(A, 'sc_cafe')
    expect(part(sheet, 'data-cat-amount')).toBe(text(money(48_000)).trim())
    expect(part(sheet, 'data-cat-share')).toBe('4 % дохода')
    expect(part(sheet, 'data-cat-usual')).toBe(sp(`обычно у вас ${plain(30_000)}`))
    expect(part(sheet, 'data-cat-plan')).toBe(sp(`план ${plain(20_000)}`))
    expect(part(sheet, 'data-cat-advice')).toBe(sp(`до плана: +${plain(10_000)} в «Подушка» · на 22 месяца раньше`))
    expect(sheet).toContain('data-cat-edit')

    // Партнёр после синка — те же строки и точки (одна правда документа и записей загрузок).
    const B = await phone(server, st, 'b')
    await sync(A, B)
    const htmlB = await month(B)
    expect(rowsOf(htmlB)).toEqual(['sc_food', 'sc_cafe'])
    expect(dotsOf(htmlB)).toEqual(['sc_cafe'])

    // Viewer — видит строки и лист, «Изменить» и «+ Раздел» нет.
    const V = await phone(server, st, 'a', 'viewer')
    const htmlV = await month(V)
    expect(rowsOf(htmlV)).toEqual(['sc_food', 'sc_cafe'])
    expect(htmlV).not.toContain('data-spend-add')
    const sheetV = await month(V, 'sc_food')
    expect(part(sheetV, 'data-cat-usual')).toBe(sp(`обычно у вас ${plain(130_000)}`))
    expect(sheetV).toContain('data-cat-person="b"')
    expect(sheetV).not.toContain('data-cat-edit')
  })

  it('меньше 2 полных месяцев — «обычно» нет, точек нет', async () => {
    // Июль и август у Аруны не загружены — полный месяц у обоих только сентябрь.
    st.uploads.splice(1, 1)
    const A = await phone(server, st, 'a')
    const r = compareOf(A)
    expect(r.usualFrom).toEqual([]) // полный месяц один — «обычно» не считается
    expect(r.rows.every((x) => x.usual === null && !x.over && !x.advice)).toBe(true)
    const html = await month(A)
    expect(dotsOf(html)).toEqual([])
    expect(html).not.toMatch(/data-section="spend"[\s\S]*?data-section-dot[\s\S]*?data-section="queue"/)
    expect(part(await month(A, 'sc_cafe'), 'data-cat-usual')).toBe('обычно — когда будет 2 месяца выписок')
  })

  it('план через лист раздела: «Изменить» → «Сколько в месяц» → партнёр видит новый план; рекомендации больше нет', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    await month(A, 'sc_cafe', (s) => {
      ;(s.editCatPlan as (by: PersonId, amount: number) => void)('a', 20_000)
      ;(s.spendEdit as { amount: string }).amount = '35 000'
      ;(s.saveSpend as () => void)()
    })
    setActivePinia(A.pinia)
    expect(A.store.householdDoc.spendPlans?.find((x) => x.id === 'a:sc_cafe')?.amount).toBe(35_000)
    await sync(A, B)
    const sheetB = await month(B, 'sc_cafe')
    expect(part(sheetB, 'data-cat-plan')).toBe(sp(`план ${plain(35_000)}`))
    // Обычно 30 000 ≤ плана 35 000 — «до плана» нет; точка остаётся (факт 48 000 выше обычного).
    expect(sheetB).not.toContain('data-cat-advice')
    expect(dotsOf(await month(B))).toEqual(['sc_cafe'])
  })
})
