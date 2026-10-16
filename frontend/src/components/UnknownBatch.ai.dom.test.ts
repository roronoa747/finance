// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { AI_SELLERS_KEY } from '@/lib/storage'
import { DEFAULT_SPEND_CATEGORIES } from '@/lib/statements/dictionary'
import type { MerchantRule, Operation } from '@/lib/statements/types'
import Week from '@/views/Week.vue'

/**
 * AI-12 (бэклог «ИИ», Р-5, Р-9, Р-10): предложения ИИ в пачке «Без раздела» листа «Вопросы» «Недели». Ручка —
 * подменённый `apiClient.aiSellers` со счётчиком; личный документ (согласие, правила) — подменённые get/push.
 * Четверг 24 сентября 2026; незнакомые словарю этой недели: Respect Boutique, Tau Lider, ИП Абенова (фамилия — не
 * уходит), Дана К. (получатель — человеку, не уходит).
 */
let app: App | null = null
let n = 0
const op = (date: string, amount: number, merchant: string, extra: Partial<Operation> = {}): Operation => ({
  id: `o${++n}`, bank: 'kaspi', date, amount: -amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...extra,
})
const OPS: Operation[] = [
  op('2026-09-21', 30_000, 'Respect Boutique'),
  op('2026-09-22', 12_000, 'Respect Boutique'),
  op('2026-09-22', 8_000, 'Tau Lider'),
  op('2026-09-23', 5_000, 'ИП Абенова'),
  op('2026-09-23', 20_000, 'Дана К.', { counterparty: 'Дана К.' }),
  op('2026-09-23', 3_000, 'Yandex Go', { categoryId: 'sc_transport' }),
]
const ANSWER = {
  items: [
    { name: 'Respect Boutique', categoryId: 'sc_shopping' },
    { name: 'Tau Lider', categoryId: null },
  ],
}

let priv: { rev: number; data: Record<string, unknown> }
beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'upsertOperations').mockImplementation(() => new Promise(() => {}))
  priv = { rev: 1, data: {} }
  vi.spyOn(apiClient, 'getPrivateDoc').mockImplementation(async () => ({ household_id: 'h1', user_id: 'u-a', rev: priv.rev, data: priv.data, updated_at: '' }))
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (_rev, data) => {
    priv = { rev: priv.rev + 1, data }
    return { household_id: 'h1', user_id: 'u-a', rev: priv.rev, data, updated_at: '' }
  })
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function openWeek(o: { ai?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  auth.ai = o.ai ?? true
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [{ id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' }]
  // Лист согласия живёт в оболочке; здесь экран без неё — стор «спрашивает», ответ даёт тест.
  useAiStore().sheetMounted = true
  const store = useOperationsStore()
  for (const x of OPS) store.ops[x.id] = { ...x }
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Week)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { finance, store, ai: useAiStore() }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
  await Promise.resolve()
  for (let i = 0; i < 3; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const sheet = () => q('[role="dialog"]')
const rowOf = (label: string) => all('[data-unknown-row]').find((r) => txt(r).startsWith(label)) ?? null
const openBatch = () => press(q('[data-bang]'))
const closeSheet = () => press(q('[role="dialog"] [aria-label="Закрыть"]'))
const ruleOf = (finance: ReturnType<typeof useFinanceStore>, merchant: string) =>
  ((finance.privateDoc.merchantRules ?? []) as MerchantRule[]).find((r) => r.match.merchant === merchant)

describe('AI-12: предложения ИИ в «Без раздела»', () => {
  it('семья без ИИ — запроса нет, пачка как раньше: без чипов, ✓ и строки ИИ', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers')
    await openWeek({ ai: false })
    await openBatch()
    expect(txt(sheet())).toContain('Без раздела · 4')
    expect(spy).not.toHaveBeenCalled()
    expect(useAiStore().sheetOpen).toBe(false)
    expect(q('[data-ai-sellers]')).toBeNull()
    expect(q('[data-ai-accept]')).toBeNull()
    expect(q('[data-ai-hint]')).toBeNull()
  })

  it('первое открытие — согласие, один запрос с отобранными названиями и разделами; чип и ✓ у предложенного, null — без них; повтор — 0 запросов', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers').mockResolvedValue(ANSWER)
    const { ai, finance } = await openWeek()
    await openBatch()
    // Не спрошено — лист согласия; до ответа запроса нет.
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    expect(spy).not.toHaveBeenCalled()
    ai.answer(true)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    // Уходят только продавцы без «ИП + фамилия» (по сумме) и разделы семьи {id, name} — без «Без раздела».
    const [names, categories] = spy.mock.calls[0]
    expect(names).toEqual(['Respect Boutique', 'Tau Lider'])
    expect(categories.map((c) => Object.keys(c).sort().join())).toEqual(categories.map(() => 'id,name'))
    expect(categories.map((c) => c.id)).toContain('sc_food')
    expect(categories.map((c) => c.id)).not.toContain('_unknown')
    await flush()

    expect(txt(q('[data-ai-sellers]'))).toBe('ИИ предлагает · 1')
    const respect = rowOf('Respect Boutique')!
    expect(txt(respect.querySelector('[data-ai-hint]'))).toBe('Одежда и покупки')
    expect(respect.querySelector('[data-ai-accept]')!.getAttribute('aria-label')).toBe('Принять: Одежда и покупки')
    expect(rowOf('Tau Lider')!.querySelector('[data-ai-hint], [data-ai-accept]')).toBeNull()
    expect(rowOf('ИП Абенова')!.querySelector('[data-ai-hint], [data-ai-accept]')).toBeNull()
    expect(rowOf('Дана К.')!.querySelector('[data-ai-hint], [data-ai-accept]')).toBeNull()
    // ✓ одного размера: у строк без предложения — место той же ширины, суммы стоят ровно.
    expect(rowOf('Tau Lider')!.lastElementChild!.className).toContain('w-8')
    // Само ничего не применилось.
    expect(ruleOf(finance, 'respect boutique')).toBeUndefined()
    // Кэш телефона — по продавцу пачки, null тоже запомнен.
    const cache = JSON.parse(localStorage.getItem(AI_SELLERS_KEY)!) as Record<string, { to: string | null }>
    expect(cache['{"merchant":"respect boutique"}'].to).toBe('sc_shopping')
    expect(cache['{"merchant":"tau lider"}'].to).toBeNull()

    await closeSheet()
    await openBatch()
    expect(txt(q('[data-ai-sellers]'))).toBe('ИИ предлагает · 1')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('✓ — то же правило «продавец → раздел», что выбор чипами; строка уходит из пачки', async () => {
    vi.spyOn(apiClient, 'aiSellers').mockResolvedValue(ANSWER)
    // Через чипы: отметить Respect Boutique → «Ещё» → «Одежда и покупки».
    const manual = await openWeek()
    manual.ai.setConsent(true)
    await openBatch()
    await press(rowOf('Respect Boutique')!.querySelector('button'))
    await press(all('[role="dialog"] button').find((b) => txt(b).startsWith('Ещё')))
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Одежда и покупки'))
    const byChips = ruleOf(manual.finance, 'respect boutique')!
    expect(byChips.to).toEqual({ categoryId: 'sc_shopping' })
    const chipsOps = Object.values(manual.store.ops).filter((o) => o.merchant === 'Respect Boutique').map((o) => o.categoryId)
    app!.unmount()
    document.body.innerHTML = ''
    localStorage.clear()

    // Через ✓ ИИ.
    const viaAi = await openWeek()
    viaAi.ai.setConsent(true)
    await openBatch()
    await vi.waitFor(() => expect(rowOf('Respect Boutique')!.querySelector('[data-ai-accept]')).toBeTruthy())
    await press(rowOf('Respect Boutique')!.querySelector<HTMLElement>('[data-ai-accept]'))
    const byAi = ruleOf(viaAi.finance, 'respect boutique')!
    const strip = (r: MerchantRule) => ({ ...r, id: '', updatedAt: '' })
    expect(strip(byAi)).toEqual(strip(byChips))
    expect(Object.values(viaAi.store.ops).filter((o) => o.merchant === 'Respect Boutique').map((o) => o.categoryId)).toEqual(chipsOps)
    expect(chipsOps).toEqual(['sc_shopping', 'sc_shopping'])
    await vi.waitFor(() => expect(rowOf('Respect Boutique')).toBeNull())
    expect(txt(sheet())).toContain('Без раздела · 3')
  })

  it('лимит — «ИИ вернётся 1 октября», ручной выбор работает; не вышло — «Подсказки не пришли»', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers').mockRejectedValue(new ApiError('ai_limit', 429))
    const { ai, finance } = await openWeek()
    ai.setConsent(true)
    await openBatch()
    await vi.waitFor(() => expect(txt(q('[data-ai-sellers]'))).toBe('ИИ вернётся 1 октября'))
    expect(q('[data-ai-accept]')).toBeNull()
    await press(rowOf('Tau Lider')!.querySelector('button'))
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Продукты'))
    expect(ruleOf(finance, 'tau lider')!.to).toEqual({ categoryId: 'sc_food' })
    // Ошибка не кэшируется: следующее открытие спросит снова.
    expect(localStorage.getItem(AI_SELLERS_KEY)).toBeNull()

    spy.mockRejectedValue(new ApiError('ai_failed', 502))
    await closeSheet()
    await openBatch()
    await vi.waitFor(() => expect(txt(q('[data-ai-sellers]'))).toBe('Подсказки не пришли'))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('ответ идёт — крутилка и место ✓ уже стоят: суммы не съезжают, когда ответ придёт (`/ux` Блока 3)', async () => {
    let reply: (a: typeof ANSWER) => void = () => {}
    vi.spyOn(apiClient, 'aiSellers').mockImplementation(() => new Promise((ok) => (reply = ok)))
    const { ai } = await openWeek()
    ai.setConsent(true)
    await openBatch()
    await vi.waitFor(() => expect(txt(q('[data-ai-sellers]'))).toBe('ИИ думает…'))
    expect(q('[data-ai-spin]')).toBeTruthy()
    expect(rowOf('Respect Boutique')!.lastElementChild!.className).toContain('w-8')
    expect(rowOf('Tau Lider')!.lastElementChild!.className).toContain('w-8')
    reply(ANSWER)
    await vi.waitFor(() => expect(txt(q('[data-ai-sellers]'))).toBe('ИИ предлагает · 1'))
    expect(q('[data-ai-spin]')).toBeNull()
    expect(rowOf('Tau Lider')!.lastElementChild!.className).toContain('w-8')
  })

  it('«Не надо» — запросов нет ни сейчас, ни при следующем открытии', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers').mockResolvedValue(ANSWER)
    const { ai } = await openWeek()
    await openBatch()
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(false)
    await flush()
    await closeSheet()
    await openBatch()
    expect(ai.sheetOpen).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    expect(q('[data-ai-sellers]')).toBeNull()
  })

  it('предложения старше 60 дней — спрашиваются заново; свежие — нет', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers').mockResolvedValue({ items: [{ name: 'Respect Boutique', categoryId: 'sc_shopping' }] })
    localStorage.setItem(
      AI_SELLERS_KEY,
      JSON.stringify({
        '{"merchant":"respect boutique"}': { to: 'sc_cafe', at: '2026-07-20T00:00:00.000Z' },
        '{"merchant":"tau lider"}': { to: 'sc_health', at: '2026-09-01T00:00:00.000Z' },
      }),
    )
    const { ai } = await openWeek()
    ai.setConsent(true)
    await openBatch()
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0]).toEqual(['Respect Boutique'])
    await flush()
    expect(txt(rowOf('Respect Boutique')!.querySelector('[data-ai-hint]'))).toBe('Одежда и покупки')
    expect(txt(rowOf('Tau Lider')!.querySelector('[data-ai-hint]'))).toBe('Здоровье и аптеки')
    expect(txt(q('[data-ai-sellers]'))).toBe('ИИ предлагает · 2')
  })

  it('предложенный раздел семья удалила — ни чипа, ни ✓, в счёт шапки не идёт (критик Блока 3)', async () => {
    const spy = vi.spyOn(apiClient, 'aiSellers')
    const fresh = '2026-09-20T00:00:00.000Z'
    localStorage.setItem(
      AI_SELLERS_KEY,
      JSON.stringify({ '{"merchant":"respect boutique"}': { to: 'sc_cafe', at: fresh }, '{"merchant":"tau lider"}': { to: 'sc_food', at: fresh } }),
    )
    const { ai, finance } = await openWeek()
    ai.setConsent(true)
    finance.householdDoc.spendCategories = DEFAULT_SPEND_CATEGORIES.map((c) => ({ ...c, updatedAt: '', ...(c.id === 'sc_cafe' ? { deletedAt: fresh } : {}) }))
    await openBatch()
    expect(spy).not.toHaveBeenCalled()
    expect(rowOf('Respect Boutique')!.querySelector('[data-ai-hint], [data-ai-accept]')).toBeNull()
    expect(txt(rowOf('Tau Lider')!.querySelector('[data-ai-hint]'))).toBe('Продукты')
    expect(txt(q('[data-ai-sellers]'))).toBe('ИИ предлагает · 1')
  })
})
