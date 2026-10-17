import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { habitImages, imageLine, imageMath } from '../src/lib/finance'
import { PRICES } from '../src/lib/prices'
import { assignIds } from '../src/lib/statements/model'
import type { Operation, ParsedStatement } from '../src/lib/statements/types'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { PersonId, SyncDoc } from '../src/types/finance'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Блок 7 «ИИ-польза» (AU-27…AU-30, Р-24…Р-31): образы трат — два телефона и viewer, октябрь 2026.
 *
 * Выписка Ильяса (телефон 1) — июль, август, сентябрь: по 20 поездок Yandex Go в месяц по 2 500 ₸ (50 000) и обеды в
 * кафе в будни — по 10 по 4 000 ₸ (40 000). В общий документ уходят только итоги привычек: такси и обеды — счётчик и
 * сумма за месяц. Телефон 2 (Аруна) и viewer видят образы в листах «Транспорт» и «Кафе»: такси → своя машина
 * (4 750 000 ÷ 50 000 = 95 месяцев), обеды за год 480 000 → доля мечты «Отпуск» (первая в очереди); «Перенести в мечту»
 * — 40 % обедов = 16 000: план кафе Ильяса 50 000 → 34 000, взнос «Отпуска» 40 000 → 56 000; «Отменить» — прежние.
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
const MONTHS = ['2026-07', '2026-08', '2026-09']
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/&amp;/g, '&').replace(/[ \t\r\n]+/g, ' ')
const sp = (s: string) => s.replace(/[  ]/g, ' ')
function part(html: string, attr: string) {
  const i = html.indexOf(attr)
  if (i < 0) return ''
  const open = html.lastIndexOf('<', i)
  const tag = html.slice(open + 1, html.indexOf(' ', open))
  return text(html.slice(open, html.indexOf(`</${tag}>`, i))).trim()
}
const plan = (by: PersonId, categoryId: string, amount: number) => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: T0 })
function familyDoc(): SyncDoc {
  const doc = planFamilyDoc()
  return planFamilyDoc({
    goals: doc.goals.filter((g) => g.id !== 'car'),
    goalOrder: { ids: ['trip', 'cushion'], updatedAt: T0 },
    spendPlans: [plan('a', 'sc_transport', 30_000), plan('a', 'sc_cafe', 50_000), plan('b', 'sc_food', 300_000)],
  })
}

/** Будние дни месяца: 1-е … по порядку, первые `n`. */
function weekdays(month: string, n: number): string[] {
  const out: string[] = []
  for (let d = 1; out.length < n; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`
    const w = new Date(`${iso}T00:00:00Z`).getUTCDay()
    if (w >= 1 && w <= 5) out.push(iso)
  }
  return out
}
const op = (date: string, amount: number, merchant: string): Omit<Operation, 'id'> => ({ bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false })

async function uploadA(A: Phone) {
  const operations = MONTHS.flatMap((m) => [
    ...Array.from({ length: 20 }, (_, i) => op(`${m}-${String(i + 1).padStart(2, '0')}`, -2_500, 'YANDEX GO')),
    ...weekdays(m, 10).map((d) => op(d, -4_000, 'Askhana Zira')),
  ])
  const parsed: ParsedStatement = { bank: 'kaspi', from: '2026-07-01', to: '2026-09-30', skipped: 0, operations: assignIds(operations) }
  setActivePinia(A.pinia)
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'a.pdf', parsed }])
  await ops.send(A.client)
  await A.store.syncHousehold(A.client)
}

/** «Месяц» с открытым листом раздела; `hint` — «?» открыт (окно Hint, `at`); `act` — нажатие. */
const month = (p: Phone, catFor: string, extra: Record<string, unknown> = {}, act?: (s: Record<string, unknown>) => void) =>
  screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'spend', catFor, ...extra }, act)])
const HINT = { at: { left: 0, top: 0, width: 300 } }

describe('e2e / ИИ-польза Блок 7 — образы трат', () => {
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
    at('2026-10-05T05:00:00Z')
    server = fakeServer(familyDoc())
    st = fakeStatements()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('выписка телефона 1 → итоги привычек у телефона 2: счётчик и сумма, ни продавцов, ни дат', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    await uploadA(A)
    await sync(A, B)
    const got = (on(B).householdDoc.habitTotals ?? []).map((t) => [t.id, t.count, t.amount])
    expect(got.sort()).toEqual(
      MONTHS.flatMap((m) => [[`a:${m}:lunch`, 10, 40_000], [`a:${m}:taxi`, 20, 50_000]]).sort(),
    )
    const raw = JSON.stringify(server.data.habitTotals)
    expect(raw).not.toMatch(/yandex|askhana/i)
    for (const t of server.data.habitTotals ?? []) expect(Object.keys(t).filter((k) => k !== 'deletedAt').sort()).toEqual(['amount', 'by', 'count', 'habit', 'id', 'period', 'updatedAt'])
  })

  it('три месяца — образ в листе «Транспорт» у обоих и у viewer (без кнопки); «?» — цена с источником и датой и расчёт', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    const V = await phone(server, st, 'b', 'viewer')
    const taxi = habitImages(on(B).planInput(K).state, K).find((i) => i.habit === 'taxi')!
    expect(taxi).toMatchObject({ monthly: 50_000, months: 95 })
    for (const p of [A, B, V]) expect(part(await month(p, 'sc_transport'), 'data-image-line')).toBe(sp(imageLine(taxi)))
    expect(await month(B, 'sc_transport')).toContain('data-image-act')
    const viewer = await month(V, 'sc_transport', HINT)
    expect(viewer).not.toContain('data-image-act')
    // Р-31: «Как посчитали» — видно и viewer.
    const m = imageMath(taxi)
    expect(part(viewer, 'data-image-item')).toBe(sp(m.item))
    expect(viewer).toContain(`href="${PRICES.car_used.url.replace(/&/g, '&amp;')}"`)
    expect(part(viewer, 'data-image-source')).toContain('17 октября 2026')
    expect(text(viewer)).toContain(sp(m.lines[1]))
  })

  it('«Перенести в мечту» на телефоне 1 → план и взнос у телефона 2; «Отменить» возвращает оба', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    const lunch = habitImages(on(A).planInput(K).state, K).find((i) => i.categoryId === 'sc_cafe')!
    expect(lunch.habit).toBe('lunch')
    expect(lunch.action).toMatchObject({ kind: 'move', amount: 16_000, goalId: 'trip' })
    expect(part(await month(A, 'sc_cafe'), 'data-image-act')).toBe('Перенести в мечту')

    // Лист переноса (`ImageMoveSheet.confirm`); прежние значения — для «Отменить» тоста.
    let saved: unknown = null
    await month(A, 'sc_cafe', { catFor: null, moveAction: lunch.action }, (s) => {
      void s.undoTo
      ;(s.confirm as () => void)()
      saved = s.undoTo
    })
    await sync(A, B)
    const cafeA = (p: Phone) => on(p).householdDoc.spendPlans!.find((x) => x.id === 'a:sc_cafe')!.amount
    const trip = (p: Phone) => on(p).goals.find((g) => g.id === 'trip')!.monthly
    expect([cafeA(B), trip(B)]).toEqual([34_000, 56_000])
    // Каждый месяц — не сдвиг этого месяца.
    expect(on(B).householdDoc.planShifts ?? []).toEqual([])
    // Перенос запомнен (Х-9): у телефона 2 вместо кнопки «✓ 16 000 в мечту» — второй раз план не урежется.
    const afterB = await month(B, 'sc_cafe')
    expect(part(afterB, 'data-image-moved')).toMatch(/^✓\s16\s000\sв\sмечту$/)
    expect(afterB).not.toContain('data-image-act')

    at('2026-10-05T05:01:00Z')
    await month(A, 'sc_cafe', { catFor: null, undoTo: saved }, (s) => {
      void s.undoTo
      ;(s.undo as () => void)()
    })
    await sync(A, B)
    expect([cafeA(B), trip(B)]).toEqual([50_000, 40_000])
    expect(part(await month(B, 'sc_cafe'), 'data-image-act')).toBe('Перенести в мечту')
  })
})
