// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc } from '@/test/planFamily'
import { canAfford } from '@/lib/finance'
import { money } from '@/lib/money'
import { plural } from '@/lib/utils'
import type { SyncDoc } from '@/types/finance'
import AffordSheet from './AffordSheet.vue'

/**
 * PN-17: лист «Хватит?» — «Да» / «Нет» по `canAfford` (`planFamilyDoc`, 12 сентября 2026); без счетов — от остатка
 * плана месяца. Документ после прикидки прежний.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function open(extra: Partial<SyncDoc> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(extra), 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(AffordSheet, { open: true }) })
  app.use(pinia)
  app.mount(root)
  await flush()
  return store
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
async function type(value: string) {
  const input = q('[data-afford-sum]') as HTMLInputElement
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flush()
}
const expected = (store: ReturnType<typeof useFinanceStore>, amount: number) => {
  const { state, ctx } = store.planInput('2026-09')
  return canAfford({ ...state, accounts: store.householdAccounts }, ctx, amount)
}

describe('PN-17: «Хватит?»', () => {
  it('пусто — подсказка', async () => {
    await open()
    expect(q('[data-afford-result]')).toBeNull()
    expect(txt(q('[data-afford-empty]'))).toBe('Введите сумму')
  })

  it('со счетами: «Да» — сколько останется до зарплаты и через сколько дней; документ не меняется', async () => {
    const store = await open()
    const before = JSON.stringify(store.householdDoc)
    await type('150000')
    const r = expected(store, 150_000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.inDays).not.toBeNull()
    expect(txt(q('[data-afford-yes]'))).toBe('Да')
    expect(norm(txt(q('[data-afford-left]')))).toContain(norm(`до зарплаты останется ${money(r.left)}`))
    // Срок зарплаты — своей строкой, как строки «Нет» (`/ux` Б5: в одной строке переносился на 390 px).
    expect(txt(q('[data-afford-payday]'))).toContain(`зарплата через ${r.inDays}`)
    expect(JSON.stringify(store.householdDoc)).toBe(before)
  })

  it('со счетами: большая сумма — «Нет», сколько не хватает и на сколько месяцев отодвинется мечта', async () => {
    const store = await open()
    await type('5000000')
    const r = expected(store, 5_000_000)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(txt(q('[data-afford-no]'))).toBe('Нет')
    expect(q('[data-afford-no]')!.className).toContain('text-warn')
    expect(norm(txt(q('[data-afford-short]')))).toBe(norm(`не хватает ${money(r.short)}`))
    // Владелец Б5: сдвиг — в месяцах («никто в днях не прикидывает»), дней в строке нет.
    expect(r.goal && r.months).toBeTruthy()
    expect(r.months!).toBeGreaterThan(1)
    expect(txt(q('[data-afford-goal]'))).toBe(`${r.goal} отодвинется на ${r.months} ${plural(r.months!, 'месяц', 'месяца', 'месяцев')}`)
    expect(txt(q('[data-afford-goal]'))).not.toMatch(/дн/)
  })

  it('со счетами: нехватка меньше месяца взносов — «почти не сдвинется»', async () => {
    const store = await open()
    const up = expected(store, 0)
    if (!up.ok) return expect.unreachable('на демо-счетах хватает на 0')
    await type(String(up.left + 1000))
    const r = expected(store, up.left + 1000)
    expect(!r.ok && r.months).toBe(0)
    expect(txt(q('[data-afford-goal]'))).toBe(`${!r.ok && r.goal} почти не сдвинется`)
  })

  it('без счетов — от остатка плана месяца, без «через N дней»', async () => {
    const store = await open({ accounts: [] })
    const rest = store.monthPlanOf('2026-09').rest
    expect(rest).toBeGreaterThan(0)
    await type(String(rest - 1000))
    expect(txt(q('[data-afford-yes]'))).toBe('Да')
    expect(norm(txt(q('[data-afford-left]')))).toBe(norm(`до зарплаты останется ${money(1000)}`))
    expect(q('[data-afford-payday]')).toBeNull()
    await type(String(rest + 1000))
    expect(norm(txt(q('[data-afford-short]')))).toBe(norm(`не хватает ${money(1000)}`))
  })
})
