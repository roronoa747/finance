// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { apiClient, ApiError } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useAiStore } from '@/stores/ai'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview, SyncDoc } from '@/types/finance'
import Month from '@/views/Month.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * AI-09 (бэклог «ИИ», Р-4, Р-7, Р-9): кнопка разбора у остатка «Месяца», лист разбора, разбор в общем документе.
 * Ручка — подменённый `apiClient.aiReview` со счётчиком; личный документ — фейковый сервер (`ensureConsent` тянет его).
 */
let app: App | null = null
let router: Router
const NOW = '2026-09-12T07:00:00Z'
const KEY = '2026-09'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  let priv = { rev: 1, data: {} as Record<string, unknown> }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).endsWith('/sync/private')) throw new Error('офлайн')
      if (init?.method === 'POST') priv = { rev: priv.rev + 1, data: (JSON.parse(String(init.body)) as { data: Record<string, unknown> }).data }
      return new Response(JSON.stringify(priv), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const answer = {
  good: 'Остаётся 120 000 ₸.',
  risk: 'Кредитка под 40%.',
  steps: [
    { text: 'Посмотрим долги.', screen: '/money/debts' },
    { text: 'Обсудим вдвоём.', screen: null },
  ],
}

const saved = (extra: Partial<AiReview> = {}): AiReview => ({
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: 'Сохранённое хорошо.', risk: 'Сохранённый риск.',
  steps: [{ text: 'Шаг к долгам.', screen: '/money/debts' }, { text: 'Шаг словами.', screen: null }],
  sent: null, updatedAt: T0, ...extra,
})

async function open(opts: { role?: 'member' | 'viewer'; ai?: boolean; doc?: SyncDoc } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setAuthData(authAs(opts.role ?? 'member', 'a'))
  auth.ai = opts.ai ?? true
  const finance = useFinanceStore()
  finance.setHouseholdDoc(opts.doc ?? planFamilyDoc(), 1)
  // Лист согласия живёт в оболочке; здесь экран без неё — стор «спрашивает», ответ даёт тест.
  useAiStore().sheetMounted = true
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/month')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Month)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return finance
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const dialog = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent?.includes('Разбор месяца')) ?? null

describe('AI-09: разбор месяца у остатка', () => {
  it('семья без ИИ — кнопки нет; с ИИ — круглая кнопка рядом с «Хватит?», той же высоты, не брендовая', async () => {
    await open({ ai: false })
    expect(q('[data-review-open]')).toBeNull()
    app!.unmount()
    document.body.innerHTML = ''

    await open()
    const btn = q('[data-review-open]')!
    expect(btn.getAttribute('aria-label')).toBe('Разобрать месяц')
    const afford = q('[data-afford-open]')!
    expect(btn.parentElement).toBe(afford.parentElement)
    expect(btn.className).toContain('h-8')
    expect(afford.className).toContain('h-8')
    expect(btn.className).not.toContain('bg-brand ')
  })

  it('разбор месяца есть — лист без запроса; точка до первого открытия на этом телефоне', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    await open({ doc: planFamilyDoc({ aiReviews: [saved()] }) })
    expect(q('[data-review-open]')!.getAttribute('aria-label')).toBe('Разбор месяца')
    expect(q('[data-review-dot]')).not.toBeNull()
    await press(q('[data-review-open]'))
    expect(spy).not.toHaveBeenCalled()
    expect(txt(q('[data-review-good]'))).toBe('Сохранённое хорошо.')
    expect(q('[data-review-dot]')).toBeNull()
    // Шаг с экраном — ссылка, без — текст.
    expect(q<HTMLAnchorElement>('[data-review-step-link]')!.getAttribute('href')).toBe('/money/debts')
    expect(txt(q('[data-review-step]'))).toContain('Шаг словами.')
    // «Обновить» — не раньше суток.
    expect(q('[data-review-refresh]')).toBeNull()
  })

  it('числа на показе не рвутся строкой: разряды и «₸»/«%» — неразрывно, «499641» — разрядами, год как есть', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ good: 'Остаётся 95 000 ₸ и 499641 ₸ к июню 2028 под 19 %.' })] }) })
    await press(q('[data-review-open]'))
    expect(q('[data-review-good]')!.textContent).toBe('Остаётся 95 000 ₸ и 499 641 ₸ к июню 2028 под 19 %.')
    // В документе — как пришло.
    expect(useFinanceStore().aiReviewOf(KEY)!.good).toBe('Остаётся 95 000 ₸ и 499641 ₸ к июню 2028 под 19 %.')
  })

  it('«тенге» словом не отрывается от числа (живой короткий ответ: «627 000 / тенге», `/ux`)', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ risk: 'Остаётся 627 000 тенге.' })] }) })
    await press(q('[data-review-open]'))
    expect(q('[data-review-risk]')!.textContent).toBe('Остаётся 627 000 тенге.')
  })

  it('нет разбора: согласие → запрос сводкой без имён → разбор в общем документе → лист', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    const finance = await open()
    const ai = useAiStore()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    expect(spy).not.toHaveBeenCalled()
    ai.answer(true)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await flush()

    // Исходящее тело — сводка AI-07: без имён семьи.
    const sent = JSON.stringify(spy.mock.calls[0][0])
    for (const name of ['Ильяс', 'Аруна']) expect(sent).not.toContain(name)
    expect(sent).toContain('участник 1')

    const list = finance.householdDoc.aiReviews ?? []
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ month: KEY, by: 'a', good: answer.good, steps: answer.steps })
    expect(list[0].sent).toEqual(spy.mock.calls[0][0])
    expect(finance.unsent).toBe(true)
    expect(txt(q('[data-review-risk]'))).toBe('Кредитка под 40%.')
    // Число не рвётся строкой: разряды и «₸» — через неразрывный пробел (стенд: «95 / 000 ₸»); документ — как пришло.
    expect(q('[data-review-good]')!.textContent).toContain('120 000 ₸')
    expect(list[0].good).toBe('Остаётся 120 000 ₸.')
    // Свой разбор — без точки.
    expect(q('[data-review-dot]')).toBeNull()

    // «Что ушло» — разделы сводки списком, не JSON.
    await press(q('[data-review-sent-open]'))
    const shown = txt(q('[data-review-sent]'))
    for (const part of ['Доход', 'Платежи', 'Траты', 'Долги', 'Цели', 'участник 1']) expect(shown).toContain(part)
    expect(shown).not.toContain('{')

    // Второе нажатие — тот же разбор, без запроса.
    q<HTMLButtonElement>('[role="dialog"] button[aria-label="Закрыть"]')?.click()
    await flush()
    await press(q('[data-review-open]'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('«Думаю…» с крутилкой; лист закрыли до ответа — готовый разбор зовёт точкой, открыли — точка ушла (`/ux`)', async () => {
    let reply!: (a: typeof answer) => void
    vi.spyOn(apiClient, 'aiReview').mockImplementation(() => new Promise((r) => (reply = r)))
    await open()
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-state="thinking"]'))).toBe('Думаю…')
    expect(q('[data-review-state="thinking"] [data-review-spin]')).not.toBeNull()
    q<HTMLButtonElement>('[role="dialog"] button[aria-label="Закрыть"]')?.click()
    await flush()
    reply(answer)
    await vi.waitFor(() => expect(useFinanceStore().householdDoc.aiReviews ?? []).toHaveLength(1))
    await flush()
    expect(q('[data-review-dot]')).not.toBeNull()
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-good]'))).toBe(answer.good)
    expect(q('[data-review-dot]')).toBeNull()
  })

  it('«что ушло»: свободное до целей — «свободно до целей», как в тексте разбора', async () => {
    vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    await open()
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(q('[data-review-good]')).not.toBeNull())
    await press(q('[data-review-sent-open]'))
    expect(txt(q('[data-review-sent]'))).toMatch(/свободно до целей — [\d\s ]+₸/)
  })

  it('«Не надо» — запроса нет, лист разбора не открыт', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    await open()
    const ai = useAiStore()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    ai.answer(false)
    await flush()
    expect(spy).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    // Критик Блока 2: «Не надо» — как без ИИ (Р-9): кнопка, которая больше ничего не делает, уходит.
    expect(q('[data-review-open]')).toBeNull()
  })

  it('согласие «нет»: разбор партнёра — читается, «Обновить» нет (нажатие ничего бы не сделало)', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ at: '2026-09-01T06:00:00.000Z' })] }) })
    useAiStore().setConsent(false)
    await flush()
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-good]'))).toBe('Сохранённое хорошо.')
    expect(q('[data-review-refresh]')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('лимит месяца (429 ai_limit) — «ИИ вернётся 1-го»; сбой — «Не вышло. Попробуйте позже»', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockRejectedValueOnce(new ApiError('ai_limit', 429))
    await open()
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(txt(dialog())).toContain('ИИ вернётся 1-го'))
    expect(useFinanceStore().householdDoc.aiReviews ?? []).toHaveLength(0)

    spy.mockRejectedValueOnce(new ApiError('ai_failed', 502))
    q<HTMLButtonElement>('[role="dialog"] button[aria-label="Закрыть"]')?.click()
    await flush()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(txt(dialog())).toContain('Не вышло. Попробуйте позже'))
  })

  it('«Обновить» — участнику, когда разбору больше суток; новый разбор заменяет показ', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ at: '2026-09-11T06:00:00.000Z' })] }) })
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    await press(q('[data-review-refresh]'))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await flush()
    expect(txt(q('[data-review-good]'))).toBe(answer.good)
    expect(q('[data-review-refresh]')).toBeNull()
  })

  it('viewer: сохранённый разбор читает, без «Обновить» и без запроса; нет разбора — нет кнопки', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    await open({ role: 'viewer', doc: planFamilyDoc({ aiReviews: [saved({ at: '2026-09-01T06:00:00.000Z' })] }) })
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-good]'))).toBe('Сохранённое хорошо.')
    expect(q('[data-review-refresh]')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    app!.unmount()
    document.body.innerHTML = ''

    await open({ role: 'viewer' })
    expect(q('[data-review-open]')).toBeNull()
  })
})
