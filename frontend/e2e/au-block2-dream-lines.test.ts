import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { monthPlan } from '../src/lib/finance'
import type { SpendTotal } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { PersonId, SyncDoc } from '../src/types/finance'
import AffordSheet from '../src/components/money/AffordSheet.vue'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import Money from '../src/views/Money.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 2 «ИИ-польза» (AU-04…AU-08, Р-6, Р-3, Р-7): мечта и строки — два телефона и viewer, октябрь 2026.
 *
 * Семья: Ильяс — продукты 400 000 и кафе 47 000, Аруна — продукты 300 000; свободно ровно 130 000 (доход 1 200 000 −
 * платежи 323 000 − траты 747 000); очередь — машина, подушка, отпуск. Снимок 1 октября по плану: машине 60 000.
 * Выписка Ильяса — с 1 августа: продукты по 400 000 в августе и сентябре (обычно 400 000), в октябре 400 000 и кафе
 * 177 000 (выше плана на 130 000) → по факту свободно 0, машине 0: недобор 60 000 при 60 000 в месяц → 30 дней →
 * «+4 недели · кафе и рестораны выше плана». «Вернуть срок» — 60 000 из плана продуктов Аруны (у Ильяса перерасход).
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
const on = (p: Phone) => {
  setActivePinia(p.pinia)
  return p.store
}

const K = '2026-10'
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
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
const plan = (by: PersonId, categoryId: string, amount: number) => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
function familyDoc(): SyncDoc {
  return planFamilyDoc({
    spendPlans: [plan('a', 'sc_food', 400_000), plan('a', 'sc_cafe', 47_000), plan('b', 'sc_food', 300_000)],
    goalOrder: { ids: ['car', 'cushion', 'trip'], updatedAt: T0 },
    spendTotals: [total('a', '2026-08', 'sc_food', 400_000), total('a', '2026-09', 'sc_food', 400_000), total('a', K, 'sc_food', 400_000), total('a', K, 'sc_cafe', 177_000)],
  })
}
const LABEL = '+4 недели · кафе и рестораны выше плана'
const dreams = (p: Phone) => screen(p.pinia, Dreams, '/dreams')
const goal = (p: Phone, act?: (s: Record<string, unknown>) => void) => screen(p.pinia, GoalDetail, '/goals/car', undefined, act ? [screenMixin({ returnOpen: true }, act)] : [])

describe('e2e / ИИ-польза Блок 2 — мечта и строки', () => {
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
    at('2026-10-01T05:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
    st.uploads.push({ id: 'up-a', slot: 'a', bank: 'kaspi', period_from: '2026-08-01', period_to: '2026-10-12', ops_count: 30, created_at: T0, user: 'u-a' } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('снимок пишет первый участник; второй телефон не перезаписывает (ранний побеждает); viewer не пишет', async () => {
    const a = await phone(server, st, 'a')
    const b = await phone(server, st, 'b') // открыл приложение до синка Ильяса — снимка ещё не видел
    const v = await phone(server, st, 'b', 'viewer')
    expect(on(a).ensureTermSnap()).toBe(true)
    await sync(a)
    const first = server.data.termSnaps![0]!
    expect(first).toMatchObject({ id: K, at: '2026-10-01T05:00:00.000Z' })
    expect(first.goals.find((g) => g.goalId === 'car')!.given).toBe(60_000)

    at('2026-10-01T09:00:00Z')
    expect(on(b).ensureTermSnap()).toBe(true) // своя копия без сети — до встречи с сервером
    await sync(b, a, v) // 409 → слияние: ранний снимок Ильяса остаётся
    expect(server.data.termSnaps).toHaveLength(1)
    expect(server.data.termSnaps![0]!.at).toBe('2026-10-01T05:00:00.000Z')
    expect(on(b).ensureTermSnap()).toBe(false)
    expect(on(v).ensureTermSnap()).toBe(false)
  })

  it('метка у всех ролей; «Вернуть срок» на телефоне 1 → телефон 2 видит новый план и метку без сдвига; «Отменить» — возвращает', async () => {
    const a = await phone(server, st, 'a')
    on(a).ensureTermSnap()
    await sync(a)
    at('2026-10-12T07:00:00Z')
    const b = await phone(server, st, 'b')
    const v = await phone(server, st, 'b', 'viewer')
    for (const p of [a, b, v]) expect(part(await dreams(p), 'data-hero-note')).toBe(LABEL)
    expect(part(await goal(v), 'data-goal-shift')).toBe(LABEL)
    expect(await goal(v)).not.toContain('data-return-term')

    // Ильяс: «Вернуть срок» → лист → «Вернуть» (действие листа `DoSheet.confirm`).
    const html = await goal(a)
    expect(html).toContain('data-return-term')
    await goal(a, (s) => {
      if (!s.view) throw new Error('лист не открыт')
      ;(s.confirm as () => void)()
    })
    const shift = on(a).householdDoc.planShifts![0]!
    expect(shift).toMatchObject({ period: K, from: { spend: 'b', categoryId: 'sc_food' }, to: { goalId: 'car' }, amount: 60_000, by: 'a' })
    await sync(a, b, v)

    // Аруна: план месяца — её продукты 300 000 − 60 000; машине по плану 120 000; метки нет.
    const pb = on(b).monthPlanOf(K)
    expect(pb.spend.find((s) => s.by === 'b')!.rows.find((r) => r.categoryId === 'sc_food')!.plan).toBe(240_000)
    expect(pb.queue.find((q) => q.goalId === 'car')!.given).toBe(120_000)
    expect(await dreams(b)).not.toContain('data-hero-note')
    expect(await dreams(v)).not.toContain('data-hero-note')

    // «Отменить» на телефоне Ильяса — надгробие; у Аруны после синка метка и план прежние.
    on(a).undoPlanShift(shift.id)
    await sync(a, b)
    expect(part(await dreams(b), 'data-hero-note')).toBe(LABEL)
    const { state, ctx } = on(b).planInput(K)
    expect(monthPlan(state, ctx).spend.find((s) => s.by === 'b')!.plan).toBe(300_000)
  })

  it('«Хватит?» и «Долги» — строки у всех ролей', async () => {
    at('2026-10-12T07:00:00Z')
    const phones = [await phone(server, st, 'a'), await phone(server, st, 'b'), await phone(server, st, 'b', 'viewer')]
    for (const p of phones) {
      // 12 октября: на счетах 2 000 000, ближайшая зарплата — Аруны 20-го; «Кредит» 15-го (58 000) уводит в минус.
      const afford = await screen(p.pinia, AffordSheet, '/month', { open: true }, [screenMixin({ sum: '1 950 000' })])
      expect(part(afford, 'data-afford-why')).toBe('тесно 15–19-го — Кредит')
      const debts = await screen(p.pinia, Money, '/money/debts')
      expect(part(debts, 'data-debts-first')).toBe('первым — Кредитка: ставка 40 % — самая высокая')
    }
  })
})
