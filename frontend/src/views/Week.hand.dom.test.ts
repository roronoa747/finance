// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { periodsOf, spendTotals } from '@/lib/statements/model'
import { plain } from '@/lib/money'
import type { Operation } from '@/lib/statements/types'
import Week from './Week.vue'

/**
 * Бэклог «Ручная трата» (MAN-01, MAN-02; Р-1, Р-2): «+» → «Трата» (`/week?spend=1`) → сумма, раздел → «Сохранить» —
 * трата в разделе «Недели» и в итогах; в листе раздела ручная строка — кнопка правки (строка выписки — нет); правка
 * и удаление переписывают итоги. Вторник 20 октября 2026 — неделя W43.
 */
let app: App | null = null
const LINE: Operation = { id: '1111222233334444', bank: 'kaspi', date: '2026-10-19', amount: -4_000, kind: 'purchase', merchant: 'Magnum', categoryId: 'sc_food', internal: false }

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-20T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'upsertOperations').mockResolvedValue({ upserted: 1 })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openWeek(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [{ id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' }]
  finance.householdDoc.spendTotals = periodsOf([LINE]).flatMap(({ kind, period }) => spendTotals([LINE], 'a', kind, period, ''))
  const store = useOperationsStore()
  store.ops[LINE.id] = LINE
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Week)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { finance, store, router }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const norm = (s: string) => s.replace(/\s+/g, ' ')
const flush = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
  await Promise.resolve()
  for (let i = 0; i < 3; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  el!.click()
  await flush()
}
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el, 'поле').toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}
const amountOf = (id: string) => txt(q(`[data-row="${id}"] [data-amount]`))
const total = (finance: ReturnType<typeof useFinanceStore>, id: string) => finance.householdDoc.spendTotals?.find((t) => t.id === id)
const hands = (store: ReturnType<typeof useOperationsStore>) => store.all.filter((o) => o.bank === 'hand')

describe('MAN-01: «Трата» руками', () => {
  it('?spend=1 открывает лист; без суммы и раздела — строка «что не так»; 2 500 «Продукты» → в разделе недели и в итоге', async () => {
    const { finance, store, router } = await openWeek('/week?spend=1')
    const sheet = q('[data-hand-sheet]')
    expect(sheet, 'лист «Трата»').toBeTruthy()
    expect(q<HTMLInputElement>('[data-hand-date]')!.value).toBe('2026-10-20')
    // Главная кнопка одна — «Сохранить»; удалить у новой нечего.
    expect(txt(q('[data-hand-save]'))).toBe('Сохранить')
    expect(txt(sheet)).not.toContain('Удалить')

    await press(q('[data-hand-save]'))
    expect(txt(q('[role="dialog"]'))).toContain('Введите сумму')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '2500')
    expect(q<HTMLInputElement>('input[data-hand-amount]')!.value.replace(/\s/g, '')).toBe('2500')
    await press(q('[data-hand-save]'))
    expect(txt(q('[role="dialog"]'))).toContain('Выберите раздел')
    expect(hands(store)).toEqual([])

    await press(q('[data-hand-category="sc_food"]'))
    expect(q('[data-hand-category="sc_food"]')!.getAttribute('aria-pressed')).toBe('true')
    await type(q<HTMLInputElement>('[data-hand-note]'), 'Базар')
    await press(q('[data-hand-save]'))

    expect(hands(store)).toMatchObject([{ amount: -2_500, categoryId: 'sc_food', date: '2026-10-20', merchant: 'Базар' }])
    expect(q('[data-hand-sheet]'), 'лист закрыт').toBeNull()
    await vi.waitFor(() => expect(router.currentRoute.value.query.spend).toBeUndefined())
    // 4 000 из выписки + 2 500 руками.
    expect(total(finance, 'a:week:2026-W43:sc_food')).toMatchObject({ amount: 6_500, ops: 2 })
    expect(amountOf('sc_food')).toBe(norm(plain(6_500)))
  })
})

describe('MAN-01: разделы листа', () => {
  it('видно шесть разделов и «Ещё N ▾» — «Сохранить» не уезжает за край; раздел из хвоста при правке виден свёрнутым', async () => {
    const { store } = await openWeek('/week?spend=1')
    const chips = () => [...document.querySelectorAll<HTMLElement>('[data-hand-category]')].map((e) => e.dataset.handCategory)
    expect(chips()).toHaveLength(6)
    // Разделов в документе ещё нет — словарь по умолчанию, 18.
    expect(txt(q('[data-hand-more]'))).toBe('Ещё 12 ▾')
    await press(q('[data-hand-more]'))
    expect(chips()).toHaveLength(18)
    expect(q('[data-hand-more]')).toBeNull()
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '5000')
    await press(q('[data-hand-category="sc_fun"]'))
    await press(q('[data-hand-save]'))
    const [own] = hands(store)
    expect(own).toMatchObject({ categoryId: 'sc_fun', amount: -5_000 })
    await press(q('[data-row="sc_fun"] button.row-open'))
    await press(q(`[data-hand-op="${own.id}"]`))
    expect(chips()).toHaveLength(7)
    expect(q('[data-hand-category="sc_fun"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(txt(q('[data-hand-more]'))).toBe('Ещё 11 ▾')
  })
})

describe('MAN-01: дата ручной траты', () => {
  it('трата прошлой недели — после «Сохранить» на экране её неделя; дата позже сегодня — строка «что не так»', async () => {
    const { finance } = await openWeek('/week?spend=1')
    expect(txt(q('[data-week-label]'))).toBe('19–25 октября')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '1200')
    await press(q('[data-hand-category="sc_transport"]'))
    await type(q<HTMLInputElement>('[data-hand-date]'), '2026-10-21')
    await press(q('[data-hand-save]'))
    expect(txt(q('[role="dialog"]'))).toContain('Дата — сегодня или раньше')
    await type(q<HTMLInputElement>('[data-hand-date]'), '2026-10-12')
    await press(q('[data-hand-save]'))
    expect(txt(q('[data-week-label]'))).toBe('12–18 октября')
    expect(total(finance, 'a:week:2026-W42:sc_transport')).toMatchObject({ amount: 1_200, ops: 1 })
    expect(amountOf('sc_transport')).toBe(norm(plain(1_200)))
  })
})

describe('MAN-02: правка и удаление ручной траты', () => {
  async function withHand() {
    const ctx = await openWeek('/week?spend=1')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '2500')
    await press(q('[data-hand-category="sc_food"]'))
    await press(q('[data-hand-save]'))
    await press(q('[data-row="sc_food"] button.row-open'))
    return ctx
  }

  it('в листе раздела ручная строка — кнопка правки, строка выписки — нет; правка суммы и раздела переписывает итоги', async () => {
    const { finance, store } = await withHand()
    const [own] = hands(store)
    expect(q(`[data-hand-op="${own.id}"]`), 'ручная — кнопка').toBeTruthy()
    expect(document.querySelectorAll('[data-hand-op]')).toHaveLength(1)

    await press(q(`[data-hand-op="${own.id}"]`))
    expect(q('[data-hand-sheet]'), 'лист правки').toBeTruthy()
    expect(q<HTMLInputElement>('input[data-hand-amount]')!.value.replace(/\s/g, '')).toBe('2500')
    expect(q('[data-hand-category="sc_food"]')!.getAttribute('aria-pressed')).toBe('true')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '3000')
    await press(q('[data-hand-category="sc_cafe"]'))
    await press(q('[data-hand-save]'))

    expect(hands(store)).toMatchObject([{ id: own.id, amount: -3_000, categoryId: 'sc_cafe' }])
    expect(total(finance, 'a:week:2026-W43:sc_food')).toMatchObject({ amount: 4_000, ops: 1 })
    expect(total(finance, 'a:week:2026-W43:sc_cafe')).toMatchObject({ amount: 3_000, ops: 1 })
  })

  it('лента «Траты недели» (критик, Х-2): ручная строка — лист «Трата» с её полями, строка выписки — «куда отнести?»', async () => {
    const { finance, store } = await openWeek('/week?spend=1')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '2500')
    await press(q('[data-hand-category="sc_food"]'))
    await type(q<HTMLInputElement>('[data-hand-note]'), 'Базар')
    await press(q('[data-hand-save]'))
    const [own] = hands(store)
    const rules = JSON.stringify(finance.merchantRules)

    await press(q('[data-week-feed]'))
    expect(txt(q(`[data-feed-op="${own.id}"]`))).toContain('Базар')
    await press(q(`[data-feed-op="${own.id}"]`))
    // Лента уступила место листу правки: один диалог, «куда отнести?» нет.
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(q('[data-hand-sheet]'), 'лист правки').toBeTruthy()
    expect(q<HTMLInputElement>('input[data-hand-amount]')!.value.replace(/\s/g, '')).toBe('2500')
    expect(q('[data-hand-category="sc_food"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(txt(q('[role="dialog"]'))).not.toContain('куда отнести')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '3000')
    await press(q('[data-hand-save]'))
    expect(hands(store)).toMatchObject([{ id: own.id, amount: -3_000 }])
    // Правило семьи по «Базар» не заведено.
    expect(JSON.stringify(finance.merchantRules)).toBe(rules)

    await press(q('[data-week-feed]'))
    await press(q(`[data-feed-op="${LINE.id}"]`))
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    expect(txt(document.querySelectorAll('[role="dialog"]')[1])).toContain('Мне вернули') // лист операции (FB-04)
    expect(q('[data-hand-sheet]')).toBeNull()
  })

  it('«Удалить трату» → подтверждение — трата ушла из копии и итога', async () => {
    const { finance, store } = await withHand()
    const [own] = hands(store)
    await press(q(`[data-hand-op="${own.id}"]`))
    const zone = [...document.querySelectorAll<HTMLElement>('[data-hand-sheet] button')].find((b) => txt(b) === 'Удалить трату')
    await press(zone)
    const confirm = [...document.querySelectorAll<HTMLElement>('[data-hand-sheet] button')].find((b) => txt(b) === 'Удалить')
    await press(confirm)
    expect(hands(store)).toEqual([])
    expect(total(finance, 'a:week:2026-W43:sc_food')).toMatchObject({ amount: 4_000, ops: 1 })
  })
})

describe('FB-03: «+ Раздел» в форме «Трата»', () => {
  it('«+ Раздел» → «Подарки» → «Готово» — выбран; «Сохранить» → строка «Подарки» на «Неделе»', async () => {
    const { finance, store } = await openWeek('/week?spend=1')
    await type(q<HTMLInputElement>('input[data-hand-amount]'), '15000')
    await press(q('[data-new-category]'))
    await type(q<HTMLInputElement>('[data-new-category-row] input'), 'Подарки')
    await press(q('[data-new-category-done]'))
    const id = finance.householdDoc.spendCategories!.find((c) => c.name === 'Подарки')!.id
    expect(q(`[data-hand-category="${id}"]`)!.getAttribute('aria-pressed')).toBe('true')
    await press(q('[data-hand-save]'))
    expect(hands(store)).toMatchObject([{ amount: -15_000, categoryId: id }])
    expect(txt(q(`[data-row="${id}"]`))).toContain('Подарки')
  })
})
