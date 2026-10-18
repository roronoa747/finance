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
import type { AiReview, Goal, SyncDoc } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { stepCandidates, type StepCandidate } from '@/lib/finance'
import { money } from '@/lib/money'
import Month from '@/views/Month.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * AI-09 (бэклог «ИИ», Р-4, Р-7, Р-9): кнопка разбора у остатка «Месяца», лист разбора, разбор в общем документе.
 * Ручка — подменённый `apiClient.aiReview` со счётчиком; личный документ — фейковый сервер (`ensureConsent` тянет его).
 * AU-13 (бэклог «ИИ-польза», Р-2, Р-3): разбор v2 — факты в запросе, шаг с «Сделать» → `DoSheet`, «✓ Сделано»;
 * разборы v1 читаются как раньше, шаг на этот же экран — текст (Х-13).
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

/** Ответ ручки v2 (значения фактов уже подставлены сервером). */
const answer = {
  good: 'Остаётся 120 000 ₸.',
  risk: 'Кредитка под 40%.',
  step: { text: 'Посмотрим долги', candidate: null as string | null },
}

/** Фонд-подушка: у семьи появляются кандидаты «Сделать» — досрочка и подушка (`stepCandidates`). */
const cushionFund: Goal = { id: 'fund', name: 'Подушка безопасности', need: 0, seed: 100_000, have: 100_000, monthly: 0, hue: 'teal', planPct: 0, movements: [], fund: 'cushion', updatedAt: T0 }
const withFund = (extra: Partial<SyncDoc> = {}) => planFamilyDoc({ goals: [...planFamilyDoc().goals, cushionFund], ...extra })
/** Кандидат кода по id — из того же входа плана, что у листа. */
const candidateOf = (id: string) => {
  const { state, ctx } = useFinanceStore().planInput(KEY)
  return stepCandidates(state, ctx).find((c) => c.id === id)!
}
/** Разбор v2 в документе: шаг с кандидатом (или без). */
const savedV2 = (candidate: StepCandidate | null, extra: Partial<AiReview> = {}): AiReview =>
  saved({ v: 2, reason: 'month', reasonKey: `month:${KEY}`, steps: [], step: { text: 'Отложим остаток в подушку', candidate }, sent: { facts: [{ id: 'f1', about: 'доход месяца', value: '1 200 000 ₸', raw: 1_200_000 }], candidates: [] }, ...extra })

const saved = (extra: Partial<AiReview> = {}): AiReview => ({
  id: 'r1', month: KEY, at: '2026-09-12T06:00:00.000Z', by: 'b', good: 'Сохранённое хорошо.', risk: 'Сохранённый риск.',
  steps: [{ text: 'Шаг к долгам.', screen: '/money/debts' }, { text: 'Шаг словами.', screen: null }],
  sent: null, updatedAt: T0, ...extra,
})

/** Ушедшая сводка с досрочкой по плану, целями на паузе (ради плана и выключенной) и ставками 0 и «не знаем». */
const sentFull = (): MonthSummaryAI => ({
  month: KEY, daysToPayday: 5,
  income: { total: 900_000, byPerson: [{ who: 'участник 1', amount: 900_000 }] },
  dues: { total: 100_000, items: [{ name: 'Аренда', amount: 100_000 }] },
  spend: { total: 200_000, fact: null, byCategory: [] },
  rest: 300_000, short: 0, free: 600_000, saved: 0,
  debts: {
    total: 1_500_000,
    items: [
      { name: 'Автокредит', left: 1_000_000, payment: 95_000, ratePercent: 19, endMonth: '2028-06' },
      { name: 'Брату', left: 300_000, payment: 50_000, ratePercent: 0, endMonth: '2027-03' },
      { name: 'Кредитка', left: 200_000, payment: 20_000, ratePercent: null, endMonth: null },
    ],
  },
  prepay: { name: 'Автокредит', monthlyPut: 90_000, doneMonth: '2027-07' },
  goals: [
    { name: 'Машина', want: 5_000_000, have: 500_000, monthlyPut: 0, doneMonth: '2034-08', paused: true, afterPlan: true },
    { name: 'Новый диван', want: 300_000, have: 0, monthlyPut: 0, doneMonth: null, paused: true, afterPlan: false },
  ],
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
    // Точку слышит и диктор (ревью frontend Блока 2, Н-5): «новый», пока не открыли.
    expect(q('[data-review-open]')!.getAttribute('aria-label')).toBe('Разбор месяца, новый')
    expect(q('[data-review-dot]')).not.toBeNull()
    await press(q('[data-review-open]'))
    expect(spy).not.toHaveBeenCalled()
    expect(txt(q('[data-review-good]'))).toBe('Сохранённое хорошо.')
    expect(q('[data-review-dot]')).toBeNull()
    expect(q('[data-review-open]')!.getAttribute('aria-label')).toBe('Разбор месяца')
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

  it('нет разбора: согласие → запрос фактами без имён (повод «месяц») → разбор v2 в общем документе → лист', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    const finance = await open()
    const ai = useAiStore()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    expect(spy).not.toHaveBeenCalled()
    ai.answer(true)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await flush()

    // Исходящее тело — повод, факты и кандидаты AU-11: без имён семьи.
    const body = spy.mock.calls[0][0]
    expect(body.reason).toBe('month')
    expect(body.facts.length).toBeGreaterThan(3)
    const sent = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна']) expect(sent).not.toContain(name)

    const list = finance.householdDoc.aiReviews ?? []
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ month: KEY, by: 'a', good: answer.good, v: 2, reason: 'month', reasonKey: `month:${KEY}`, steps: [], step: { text: 'Посмотрим долги', candidate: null } })
    expect(list[0].sent).toEqual({ facts: body.facts, candidates: body.candidates })
    expect(finance.unsent).toBe(true)
    expect(txt(q('[data-review-risk]'))).toBe('Кредитка под 40%.')
    // Число не рвётся строкой: разряды и «₸» — через неразрывный пробел (стенд: «95 / 000 ₸»); документ — как пришло.
    expect(q('[data-review-good]')!.textContent).toContain('120 000 ₸')
    expect(list[0].good).toBe('Остаётся 120 000 ₸.')
    // Свой разбор — без точки.
    expect(q('[data-review-dot]')).toBeNull()

    // «Что ушло» — факты строками «о чём: значение», не JSON.
    await press(q('[data-review-sent-open]'))
    const shown = txt(q('[data-review-sent]'))
    expect(shown).toContain('доход месяца: 1 200 000 ₸')
    expect(shown).toContain('платежи месяца')
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

  it('«что ушло» разбора v1 (сохранён до v2): свободное до целей — «свободно до целей»', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ sent: sentFull() })] }) })
    await press(q('[data-review-open]'))
    await press(q('[data-review-sent-open]'))
    expect(txt(q('[data-review-sent]'))).toMatch(/свободно до целей — [\d\s ]+₸/)
  })

  // Ревью frontend Блока 2, Н-1: досрочка по плану и пауза ради плана уходят в модель — и видны в «что ушло».
  it('«что ушло»: досрочка в долг строкой под «Долгами», цель на паузе — «ради плана»; старая сводка без них читается', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ sent: sentFull() })] }) })
    await press(q('[data-review-open]'))
    await press(q('[data-review-sent-open]'))
    const shown = txt(q('[data-review-sent]'))
    expect(shown).toContain('досрочно — Автокредит, 90 000 ₸ в месяц, к июлю 2027')
    expect(shown).toContain('Машина — 500 000 ₸ из 5 000 000 ₸, на паузе ради плана')
    expect(shown).not.toContain('Новый диван — 0 ₸ из 300 000 ₸, на паузе ради плана')
    app!.unmount()
    document.body.innerHTML = ''

    const { prepay: _p, ...old } = sentFull()
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ sent: { ...old, goals: old.goals.map(({ afterPlan: _a, ...g }) => g) } })] }) })
    await press(q('[data-review-open]'))
    await press(q('[data-review-sent-open]'))
    expect(txt(q('[data-review-sent]'))).not.toContain('досрочно')
    expect(txt(q('[data-review-sent]'))).toContain('Машина — 500 000 ₸ из 5 000 000 ₸, на паузе')
  })

  // Ревью frontend Блока 2, Н-2: всё, что ушло в модель, видно — месяц цели на паузе, ставка 0 % и «не знаем».
  it('«что ушло»: срок цели на паузе ради плана, ставка «0 %» и «ставку уточните»', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ sent: sentFull() })] }) })
    await press(q('[data-review-open]'))
    await press(q('[data-review-sent-open]'))
    const shown = txt(q('[data-review-sent]'))
    expect(shown).toContain('Машина — 500 000 ₸ из 5 000 000 ₸, на паузе ради плана, к августу 2034')
    expect(shown).toContain('Новый диван — 0 ₸ из 300 000 ₸, на паузе')
    expect(shown).not.toContain('Новый диван — 0 ₸ из 300 000 ₸, на паузе,')
    expect(shown).toContain('Автокредит — 1 000 000 ₸, 95 000 ₸ в месяц, 19 %, к июню 2028')
    expect(shown).toContain('Брату — 300 000 ₸, 50 000 ₸ в месяц, 0 %, к марту 2027')
    expect(shown).toContain('Кредитка — 200 000 ₸, 20 000 ₸ в месяц, ставку уточните, не закроем')
  })

  // Ревью frontend Блока 2, Н-4: согласие не спрошено, а личный документ не подтянуть (нет сети) — «Не вышло», без
  // листа согласия и без запроса разбора (иначе «Не надо» с нового телефона переписало бы «да» — хвост Н-4 Блока 1).
  it('нет сети на первом ✦: «Не вышло. Попробуйте позже», листа согласия нет, запроса нет', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await open()
    const ai = useAiStore()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(q('[data-review-state]')?.getAttribute('data-review-state')).toBe('failed'))
    expect(txt(q('[data-review-state]'))).toBe('Не вышло. Попробуйте позже')
    expect(ai.consentFailed).toBe(true)
    expect(ai.sheetOpen).toBe(false)
    expect(ai.consent).toBe('unknown')
    expect(spy).not.toHaveBeenCalled()
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

  it('лимит месяца (429 ai_limit) — «ИИ вернётся 1 <следующего месяца>»; сбой — «Не вышло. Попробуйте позже»', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockRejectedValueOnce(new ApiError('ai_limit', 429))
    await open()
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(txt(dialog())).toContain('ИИ вернётся 1 октября'))
    expect(useFinanceStore().householdDoc.aiReviews ?? []).toHaveLength(0)

    spy.mockRejectedValueOnce(new ApiError('ai_failed', 502))
    const reopen = async () => {
      q<HTMLButtonElement>('[role="dialog"] button[aria-label="Закрыть"]')?.click()
      await flush()
      await press(q('[data-review-open]'))
    }
    await reopen()
    await vi.waitFor(() => expect(txt(dialog())).toContain('Не вышло. Попробуйте позже'))

    // Месяц — по Алматы (лимит семьи сбрасывается 1-го по Алматы, Р-8): 31 декабря 20:00 UTC там уже 1 января.
    vi.setSystemTime(new Date('2026-12-31T20:00:00Z'))
    spy.mockRejectedValueOnce(new ApiError('ai_limit', 429))
    await reopen()
    await vi.waitFor(() => expect(txt(dialog())).toContain('ИИ вернётся 1 февраля'))
  })

  it('«Обновить» — участнику, когда разбору больше суток; повод «refresh», новый разбор заменяет показ', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ at: '2026-09-11T06:00:00.000Z' })] }) })
    useAiStore().setConsent(true)
    await press(q('[data-review-open]'))
    await press(q('[data-review-refresh]'))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    expect(spy.mock.calls[0][0].reason).toBe('refresh')
    expect(useFinanceStore().aiReviewOf(KEY)!.reasonKey).toBeUndefined()
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

describe('AU-13: лист разбора v2 — «Сделать» у шага', () => {
  it('шаг с применимым кандидатом — «Сделать» → лист с готовыми цифрами → подтвердил: сдвиг месяца, разбор открыт, «✓ Сделано»', async () => {
    const doc = withFund()
    await open({ doc })
    const c = candidateOf('cushion')
    useFinanceStore().setHouseholdDoc(withFund({ aiReviews: [savedV2(c)] }), 2)
    await flush()
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-step-text]'))).toBe('Отложим остаток в подушку')
    expect(q('[data-review-steps]')).toBeNull()
    const doBtn = q<HTMLButtonElement>('[data-review-do]')!
    expect(doBtn.textContent!.trim()).toBe('Сделать')
    // Небольшая тихая кнопка у предмета (правило 12), не брендовая во всю ширину.
    expect(doBtn.className).toContain('h-8')
    expect(doBtn.className).not.toContain('w-full')
    await press(doBtn)
    // Цифры листа — свежего кандидата кода.
    expect(q('[data-do-amount]')!.textContent).toBe(money(c.shift.amount))
    await press(q('[data-do-confirm]'))
    const shifts = (useFinanceStore().householdDoc.planShifts ?? []).filter((s) => !s.deletedAt)
    expect(shifts).toHaveLength(1)
    expect(shifts[0]).toMatchObject({ period: KEY, from: 'rest', to: { goalId: 'fund' }, amount: c.shift.amount })
    expect(dialog()).not.toBeNull()
    expect(txt(q('[data-review-done]'))).toBe('Сделано')
    expect(q('[data-review-do]')).toBeNull()
  })

  it('кандидат больше не применим (нет в свежих `stepCandidates`) — кнопки нет, текст шага есть', async () => {
    const doc = withFund()
    await open({ doc })
    const c = candidateOf('cushion')
    // Подушки больше нет — кандидата `cushion` у семьи нет.
    useFinanceStore().setHouseholdDoc(planFamilyDoc({ aiReviews: [savedV2(c)] }), 2)
    await flush()
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-step-text]'))).toBe('Отложим остаток в подушку')
    expect(q('[data-review-do]')).toBeNull()
    expect(q('[data-review-done]')).toBeNull()
  })

  it('шаг без кандидата — только текст', async () => {
    await open({ doc: withFund({ aiReviews: [savedV2(null)] }) })
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-step-text]'))).toBe('Отложим остаток в подушку')
    expect(q('[data-review-do]')).toBeNull()
  })

  it('viewer — разбор v2 читает, «Сделать» нет', async () => {
    const doc = withFund()
    await open({ doc })
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    await open({ role: 'viewer', doc: withFund({ aiReviews: [savedV2(c)] }) })
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-step-text]'))).toBe('Отложим остаток в подушку')
    expect(q('[data-review-do]')).toBeNull()
  })

  it('дата разбора в нижней строке — день по Алматы (Х-18): «Подсказка ИИ · 13 сентября · что ушло»', async () => {
    // 20:30 UTC 12-го — уже 13-е в Алматы.
    await open({ doc: withFund({ aiReviews: [savedV2(null, { at: '2026-09-12T20:30:00.000Z' })] }) })
    await press(q('[data-review-open]'))
    expect(txt(q('[data-review-day]'))).toBe('13 сентября')
    expect(txt(q('[data-review-sent-open]')!.parentElement)).toBe('Подсказка ИИ · 13 сентября · что ушло')
  })

  it('«что ушло» v2 — факты строками', async () => {
    await open({ doc: withFund({ aiReviews: [savedV2(null)] }) })
    await press(q('[data-review-open]'))
    await press(q('[data-review-sent-open]'))
    expect(txt(q('[data-review-sent]'))).toContain('доход месяца: 1 200 000 ₸')
  })

  // Х-13 (владелец, 2026-10-17): «клики по рекомендациям никуда не ведут, просто закрывают экран».
  it('v1: шаг на «/month» с «Месяца» — текст без стрелки, лист не закрывается; на другой экран — ссылка', async () => {
    await open({ doc: planFamilyDoc({ aiReviews: [saved({ steps: [{ text: 'Сверить траты с планом', screen: '/month' }, { text: 'Шаг к долгам.', screen: '/money/debts' }] })] }) })
    await press(q('[data-review-open]'))
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-review-step-link]')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/money/debts'])
    const plain = q('[data-review-step]')!
    expect(txt(plain)).toContain('Сверить траты с планом')
    await press(plain)
    expect(dialog()).not.toBeNull()
  })
})
