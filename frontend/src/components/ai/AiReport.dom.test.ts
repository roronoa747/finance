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
import { useOperationsStore } from '@/stores/operations'
import { authAs, planFamilyDoc, T0 } from '@/test/planFamily'
import type { AiReview, Goal, SyncDoc } from '@/types/finance'
import type { MonthSummaryAI } from '@/lib/aiSummary'
import { stepCandidates, type StepCandidate } from '@/lib/finance'
import { money } from '@/lib/money'
import { startDemo } from '@/lib/demo'
import Month from '@/views/Month.vue'

vi.mock('@/lib/photos/store', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/store')>()),
  photoUrl: vi.fn(async () => null),
}))

/**
 * AI-09 (бэклог «ИИ», Р-4, Р-7, Р-9): кнопка разбора у остатка «Месяца», лист разбора, разбор в общем документе.
 * Ручка — подменённый `apiClient.aiReview` со счётчиком; личный документ — фейковый сервер (`ensureConsent` тянет его).
 * AU-13 (бэклог «ИИ-польза», Р-2, Р-3): разбор v2 — факты в запросе, шаг с «Сделать» → `DoSheet`, «✓ Сделано»;
 * разборы v1 читаются как раньше, шаг на этот же экран — текст (Х-13). RZ-07 (бэклог «Разбор»): лист снят — те же
 * проверки на отчёте `AiReport` (v1/v2 — одной карточкой), ниже — карточки v3.
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

/** Ответ ручки v3 (значения фактов уже подставлены сервером): совет на первое действие — «Сделать» семьи с подушкой. */
const answer = {
  where: 'Остаётся 120 000 ₸.',
  advices: [{ title: 'В подушку', text: 'Кредитка под 40%.', figure: null as string | null, action: 'a1' }],
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
  finance.setHouseholdDoc(opts.doc ?? withFund(), 1)
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
const dialog = () => document.querySelector('[data-report]')

describe('AI-09: разбор месяца у остатка', () => {
  it('семья без ИИ — пилюли нет, «Хватит?» в кольце; с ИИ — пилюля «✦ Разбор» рядом с «Хватит?» под кольцом, той же высоты, не брендовая (RZ-08)', async () => {
    await open({ ai: false })
    expect(q('[data-review-open]')).toBeNull()
    expect(document.querySelectorAll('[data-afford-open]')).toHaveLength(1)
    app!.unmount()
    document.body.innerHTML = ''

    await open()
    const btn = q('[data-review-open]')!
    expect(btn.getAttribute('aria-label')).toBe('Разобрать месяц')
    expect(txt(btn)).toBe('Разбор')
    expect(btn.querySelector('svg')).not.toBeNull()
    expect(document.querySelectorAll('[data-afford-open]')).toHaveLength(1)
    const afford = q('[data-afford-open]')!
    expect(btn.parentElement).toBe(afford.parentElement)
    expect(btn.className).toContain('h-8')
    expect(afford.className).toContain('h-8')
    expect(btn.className).not.toContain('bg-brand ')
    // «Хватит?» под кольцом открывает свой лист, как в кольце.
    await press(afford)
    expect([...document.querySelectorAll('[role="dialog"] h3')].map(txt)).toContain('Хватит?')
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

  it('нет разбора: согласие → запрос фактами и действиями без имён (повод «месяц») → разбор v3 в общем документе → лист', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview').mockResolvedValue(answer)
    const finance = await open()
    const ai = useAiStore()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(ai.sheetOpen).toBe(true))
    expect(spy).not.toHaveBeenCalled()
    ai.answer(true)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await flush()

    // Исходящее тело v3 — повод, факты и действия RZ-03: без имён семьи.
    const body = spy.mock.calls[0][0]
    expect(body.reason).toBe('month')
    expect(body.v).toBe(3)
    expect(body.facts.length).toBeGreaterThan(3)
    expect(body.actions[0]).toMatchObject({ id: 'a1', kind: 'do' })
    const sent = JSON.stringify(body)
    for (const name of ['Ильяс', 'Аруна']) expect(sent).not.toContain(name)

    const list = finance.householdDoc.aiReviews ?? []
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ month: KEY, by: 'a', good: '', risk: '', v: 3, reason: 'month', reasonKey: `month:${KEY}`, steps: [], where: answer.where })
    expect(list[0].advices![0]).toMatchObject({ title: 'В подушку', text: 'Кредитка под 40%.', figure: null, action: { kind: 'do' } })
    expect(list[0].sent).toEqual({ v: 3, facts: body.facts, actions: body.actions })
    expect(list[0].work!.found).toBeGreaterThanOrEqual(0)
    expect(finance.unsent).toBe(true)
    expect(txt(q('[data-review-advice-text]'))).toBe('Кредитка под 40%.')
    // Число не рвётся строкой: разряды и «₸» — через неразрывный пробел (стенд: «95 / 000 ₸»); документ — как пришло.
    expect(q('[data-review-where]')!.textContent).toContain('120 000 ₸')
    expect(list[0].where).toBe('Остаётся 120 000 ₸.')
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
    expect(txt(q('[data-review-where]'))).toBe(answer.where)
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
    expect(txt(q('[data-review-where]'))).toBe(answer.where)
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

/**
 * RZ-07 (бэклог «Разбор», Р-2, Р-15, Р-17): отчёт на весь экран — карточки по порядку (работа, куда ушло, советы, итог),
 * у совета крупная цифра факта и одна кнопка; листание нажатием по трети, старт с `card`; ✕, свайп вниз и «Открыть»
 * закрывают и снимают параметр; v1/v2 — одной карточкой.
 */
describe('RZ-07: отчёт разбора v3', () => {
  const advices = (candidate: StepCandidate): AiReview['advices'] => [
    { title: 'В подушку', text: 'Отложим остаток — подушки почти нет.', figure: null, action: { kind: 'do', candidate } },
    { title: 'Кафе у дома', text: 'Раздуло одной покупкой.', figure: { about: 'траты на «Кафе» выше обычного на', value: '60 000 ₸' }, action: { kind: 'open', target: { kind: 'cat', id: 'sc_cafe', name: 'Кафе' } } },
  ]
  const savedV3 = (candidate: StepCandidate, extra: Partial<AiReview> = {}): AiReview =>
    saved({
      v: 3, reason: 'month', reasonKey: `month:${KEY}`, good: '', risk: '', steps: [],
      where: 'Кафе выросло — мечта отодвинулась.',
      advices: advices(candidate),
      work: { ops: 1240, found: 4, monthly: 60_000 },
      sent: { v: 3, facts: [{ id: 'f1', about: 'доход месяца', value: '1 200 000 ₸', raw: 1_200_000 }], actions: [{ id: 'a1', kind: 'open', about: 'открыть траты «Кафе»', value: '', effect: '' }] },
      ...extra,
    })
  /** Семья с подушкой и разбором v3 текущего месяца (кандидат — из того же входа плана). */
  async function openV3(opts: { role?: 'member' | 'viewer'; extra?: Partial<AiReview>; path?: string } = {}) {
    await open()
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    await open({ role: opts.role, doc: withFund({ aiReviews: [savedV3(c, opts.extra)] }) })
    if (opts.path) {
      await router.push(opts.path)
      await flush()
    } else await press(q('[data-review-open]'))
    // Отчёт — по адресу: переход (ленивый компонент маршрута) доходит не за один тик.
    await vi.waitFor(() => expect(router.currentRoute.value.query.review).toBe('1'))
    await flush()
    return c
  }
  const kinds = () => [...document.querySelectorAll('[data-report-card]')].map((c) => c.getAttribute('data-report-card'))
  const activeKind = () => q('[data-report-card][data-active]')?.getAttribute('data-report-card')
  const tap = async (x: number) => {
    q('[data-report-card][data-active]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x }))
    await flush()
  }

  it('карточки по порядку: работа ИИ, куда ушло, советы; счётчик — числа разбора; у совета крупная цифра факта', async () => {
    await openV3()
    expect(dialog()!.getAttribute('aria-label')).toBe('Разбор месяца')
    expect(kinds()).toEqual(['work', 'where', 'advice', 'advice'])
    expect(document.querySelectorAll('[data-report-progress] > span')).toHaveLength(4)
    expect(activeKind()).toBe('work')
    // RZ-14 (владелец 2026-10-19): крупно — деньги находок в месяц («Фидбек», Р-19), операции — строкой.
    expect(txt(q('[data-review-big]'))).toMatch(/^≈ 60\s000 ₸$/)
    expect(txt(q('[data-review-work-word]'))).toBe('в месяц уходит на найденное')
    expect(txt(q('[data-review-work]'))).toMatch(/^4 находки из 1\s240 операций$/)
    // Повод и день — тихо: «12 сентября · начался месяц».
    expect(txt(q('[data-review-when]'))).toBe('12 сентября · начался месяц')
    expect(txt(q('[data-review-where]'))).toBe('Кафе выросло — мечта отодвинулась.')
    // Подпись картинки называет месяц находок: выписок нет — прошлый.
    expect(txt(q('[data-review-where-month]'))).toBe('в августе')
    expect([...document.querySelectorAll('[data-review-advice-title]')].map(txt)).toEqual(['В подушку', 'Кафе у дома'])
    const cards = [...document.querySelectorAll('[data-review-advice]')]
    expect(cards[0].querySelector('[data-review-figure]')).toBeNull()
    expect(txt(cards[1].querySelector('[data-review-figure]'))).toBe('60 000 ₸')
    expect(txt(cards[1].querySelector('[data-review-figure-about]'))).toBe('траты на «Кафе» выше обычного на')
    // Кнопка у совета одна: «Сделать» (брендовая) у первого, «Открыть» у второго.
    expect([...cards[0].querySelectorAll('button, a')].map(txt)).toEqual(['Сделать'])
    expect([...cards[1].querySelectorAll('button, a')].map(txt)).toEqual(['Открыть'])
    expect(cards[0].querySelector('[data-review-do]')!.className).toContain('bg-brand')
    expect(q('[data-review-link]')!.getAttribute('href')).toBe('/month?month=2026-08&cat=sc_cafe') // месяц картинки — август (выписок нет), RZ-13
    expect(q('[data-review-good]')).toBeNull()
    // Открыли — разбор увиден, параметр на адресе.
    expect(useAiStore().seenReview).toBe('r1')
    expect(router.currentRoute.value.query.review).toBe('1')
  })

  it('«Сделать» → лист с цифрами кода поверх отчёта → подтвердил: сдвиг месяца, «✓ Сделано», тост над отчётом', async () => {
    const c = await openV3()
    await press(q('[data-review-do]'))
    expect(q('[data-do-amount]')!.textContent).toBe(money(c.shift.amount))
    // Лист «Сделать» — над отчётом (z 60 > 50).
    const layer = [...document.querySelectorAll<HTMLElement>('body > div')].find((d) => d.querySelector('[data-do-amount]'))!
    expect(Number(layer.style.zIndex)).toBe(60)
    await press(q('[data-do-confirm]'))
    expect((useFinanceStore().householdDoc.planShifts ?? []).filter((s) => !s.deletedAt)).toHaveLength(1)
    expect(txt(q('[data-review-done]'))).toBe('Сделано')
    expect(q('[data-review-do]')).toBeNull()
    // Лист закрыт, отчёт открыт — экран всё ещё «под окном»: тост встаёт над ним (`html[data-sheet-open] #shell-toast`).
    expect(dialog()).not.toBeNull()
    expect(document.documentElement.hasAttribute('data-sheet-open')).toBe(true)
    expect(q('[data-do-toast]')).not.toBeNull()
  })

  it('«Открыть» ведёт на экран предмета, отчёт закрыт, параметр снят; своих трат в разделе нет — лист «нет трат» (FB-12)', async () => {
    await openV3()
    await press(q('[data-review-link]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?month=2026-08&cat=sc_cafe'), { timeout: 5000 })
    await flush()
    expect(dialog()).toBeNull()
    // Разбор семейный (Р-18), а лист раздела — свой: у меня в августе кафе нет — одна строка, без цифр семьи.
    expect(txt(q('[role="dialog"] [data-cat-none]'))).toBe('У вас трат в этом разделе нет')
  })

  it('нажатие по правой трети — следующая карточка, по левой — предыдущая, по середине — ничего', async () => {
    await openV3()
    const w = window.innerWidth
    await tap(w - 10)
    expect(activeKind()).toBe('where')
    await tap(w / 2)
    expect(activeKind()).toBe('where')
    await tap(5)
    expect(activeKind()).toBe('work')
    await tap(5)
    expect(activeKind()).toBe('work')
  })

  it('старт с `card=2` — карточка второго совета', async () => {
    await openV3({ path: '/month?review=1&card=2' })
    expect(dialog()).not.toBeNull()
    expect(txt(q('[data-report-card][data-active] [data-review-advice-title]'))).toBe('Кафе у дома')
  })

  it('✕ закрывает и снимает `review` и `card`; повторное открытие — с первой карточки', async () => {
    await openV3({ path: '/month?review=1&card=2' })
    await press(q('[data-report-close]'))
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month'))
    expect(dialog()).toBeNull()
    await press(q('[data-review-open]'))
    expect(activeKind()).toBe('work')
  })

  it('свайп вниз от верха карточки закрывает; короткий и вбок — нет', async () => {
    await openV3()
    const swipe = async (dx: number, dy: number) => {
      const el = q('[data-report-card][data-active]')!
      const t = (x: number, y: number) => ({ clientX: x, clientY: y, identifier: 0, target: el }) as unknown as Touch
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(100, 100)] }))
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(100 + dx, 100 + dy)] }))
      await flush()
    }
    await swipe(0, 40)
    expect(dialog()).not.toBeNull()
    await swipe(200, 120)
    expect(dialog()).not.toBeNull()
    // Карточка прокручена вниз — свайп вниз прокручивает её назад, отчёт остаётся (критик Блока 2).
    const card = q('[data-report-card][data-active]')!
    card.scrollTop = 40
    await swipe(10, 120)
    expect(dialog()).not.toBeNull()
    card.scrollTop = 0
    await swipe(10, 120)
    await vi.waitFor(() => expect(router.currentRoute.value.query.review).toBeUndefined())
    expect(dialog()).toBeNull()
  })

  it('Escape закрывает отчёт; открыт лист «Сделать» — Escape закрывает только его', async () => {
    await openV3()
    await press(q('[data-review-do]'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flush()
    expect(q('[data-do-amount]')).toBeNull()
    expect(dialog()).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flush()
    expect(dialog()).toBeNull()
  })

  it('клавиатура (`/ux`): соседние карточки `inert`, стрелки листают, Tab по кругу внутри отчёта — не под него', async () => {
    await openV3()
    const inert = () => [...document.querySelectorAll('[data-report-card]')].map((c) => c.hasAttribute('inert'))
    expect(inert()).toEqual([false, true, true, true])
    const key = (k: string, shiftKey = false) => {
      const e = new KeyboardEvent('keydown', { key: k, shiftKey, cancelable: true })
      document.dispatchEvent(e)
      return e
    }
    key('ArrowRight')
    await flush()
    expect(activeKind()).toBe('where')
    expect(inert()).toEqual([true, false, true, true])
    key('ArrowLeft')
    await flush()
    expect(activeKind()).toBe('work')
    // Последняя карточка: ✕ → «Открыть» → «что ушло»; «Сделать» соседней (inert) карточки в круг не входит.
    for (let i = 0; i < 3; i++) key('ArrowRight')
    await flush()
    expect(activeKind()).toBe('advice')
    expect(inert()).toEqual([true, true, true, false])
    const close = q('[data-report-close]')!
    const sent = q('[data-review-sent-open]')!
    sent.focus()
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    expect(key('Tab', true).defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(sent)
    // Фокус ушёл из отчёта (за ним — экран) — Tab возвращает на первую кнопку отчёта.
    q<HTMLElement>('[data-afford-open]')!.focus()
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)
    // Открыт лист «Сделать» поверх — стрелки отчёт не листают.
    key('ArrowLeft')
    await flush()
    const title = () => txt(q('[data-report-card][data-active] [data-review-advice-title]'))
    expect(title()).toBe('В подушку')
    await press(q('[data-report-card][data-active] [data-review-do]'))
    expect(q('[data-do-amount]')).not.toBeNull()
    key('ArrowRight')
    await flush()
    expect(title()).toBe('В подушку')
  })

  it('«что ушло» — на последней карточке, раскрывается фактами и «открыть — …»; «Обновить» — разбору больше суток', async () => {
    await openV3({ extra: { at: '2026-09-11T06:00:00.000Z' } })
    useAiStore().setConsent(true)
    await flush()
    const last = [...document.querySelectorAll('[data-report-card]')].at(-1)!
    expect(last.querySelector('[data-review-foot]')).not.toBeNull()
    expect(document.querySelectorAll('[data-review-foot]')).toHaveLength(1)
    await press(q('[data-review-sent-open]'))
    expect(txt(q('[data-review-sent]'))).toContain('открыть — траты «Кафе»')
    expect(q('[data-review-refresh]')).not.toBeNull()
  })

  it('RZ-08: «Куда ушло» — полосы разделов месяца находок, выше обычного — отмечено, строка модели под ними; без выписок — строка-заглушка', async () => {
    await openV3()
    expect(txt(q('[data-review-where-empty]'))).toBe('Выписок за месяц ещё нет')
    expect(q('[data-where-bars]')).toBeNull()
    expect(txt(q('[data-review-where]'))).toBe('Кафе выросло — мечта отодвинулась.')
    app!.unmount()
    document.body.innerHTML = ''

    const total = (period: string, categoryId: string, amount: number) => ({ id: `a:month:${period}:${categoryId}`, by: 'a' as const, kind: 'month' as const, period, categoryId, amount, ops: 3, updatedAt: T0 })
    const spendTotals = [
      ...['2026-06', '2026-07', '2026-08'].flatMap((m) => [total(m, 'sc_cafe', 30_000), total(m, 'sc_food', 100_000)]),
      total(KEY, 'sc_cafe', 90_000), total(KEY, 'sc_food', 95_000),
    ]
    vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [{ id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-06-01', period_to: '2026-09-12', ops_count: 40, created_at: T0 }] } as never)
    await open()
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    await open({ doc: withFund({ aiReviews: [savedV3(c)], spendTotals }) })
    await useOperationsStore().loadUploads()
    await flush()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    // Выписка дошла до 7-го — месяц находок текущий.
    expect(txt(q('[data-review-where-month]'))).toBe('в сентябре')
    expect([...document.querySelectorAll('[data-where-row]')].map((el) => el.getAttribute('data-where-row'))).toEqual(['sc_food', 'sc_cafe'])
    expect(q('[data-where-row="sc_cafe"]')!.hasAttribute('data-over')).toBe(true)
    expect(q('[data-where-row="sc_food"]')!.hasAttribute('data-over')).toBe(false)
    expect(q('[data-review-where-empty]')).toBeNull()
    // Строка — ссылка на лист раздела, листание по ней не срабатывает.
    expect(q('[data-where-row="sc_cafe"]')!.getAttribute('href')).toBe('/month?cat=sc_cafe')
    // Рост полос — когда карточку видно, не за кадром (все карточки монтируются сразу, `/ux`).
    const fill = () => q('[data-where-row="sc_food"] [data-where-fill]')!.style.width
    await new Promise((r) => setTimeout(r, 120))
    expect(fill()).toBe('0%')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }))
    await flush()
    await vi.waitFor(() => expect(fill()).not.toBe('0%'))
  })

  it('RZ-15: подпись крупной цифры — короткая подпись кода (`label`); имя из заголовка второй раз не пишется (`/ux` Блока 3); разбор без неё — `about`', async () => {
    const c = await openV3()
    app!.unmount()
    document.body.innerHTML = ''
    const [first, second] = advices(c)!
    const labelled = { ...second, title: 'Раздуло одной покупкой', figure: { ...second.figure!, label: 'сверх обычного · Кафе' } }
    await open({ doc: withFund({ aiReviews: [savedV3(c, { advices: [first, labelled] })] }) })
    await router.push('/month?review=1&card=2')
    await vi.waitFor(() => expect(dialog()).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(txt(q('[data-report-card][data-active] [data-review-figure-about]'))).toBe('сверх обычного · Кафе')
    app!.unmount()
    document.body.innerHTML = ''
    // Заголовок «Кафе у дома» уже называет раздел — подпись «сверх обычного» без « · Кафе».
    await open({ doc: withFund({ aiReviews: [savedV3(c, { advices: [first, { ...labelled, title: 'Кафе у дома' }] })] }) })
    await router.push('/month?review=1&card=2')
    await vi.waitFor(() => expect(dialog()).not.toBeNull(), { timeout: 5000 })
    await flush()
    expect(txt(q('[data-report-card][data-active] [data-review-figure-about]'))).toBe('сверх обычного')
  })

  it('без находок в советах — счётчик без «≈»: крупно операции, «нашёл K» (RZ-14 — как было)', async () => {
    await openV3({ extra: { work: { ops: 12, found: 0, monthly: 0 } } })
    expect(txt(q('[data-review-big]'))).toBe('12')
    expect(txt(q('[data-review-work-word]'))).toBe('операций просмотрено')
    expect(txt(q('[data-review-work]'))).toBe('нашёл 0')
  })

  it('RZ-14: склонения строки «K находок из N операций» — 1 находка из 21 операции, 5 находок из 1 операции', async () => {
    await openV3({ extra: { work: { ops: 21, found: 1, monthly: 12_000 } } })
    expect(txt(q('[data-review-work]'))).toBe('1 находка из 21 операции')
    app!.unmount()
    document.body.innerHTML = ''
    await openV3({ extra: { work: { ops: 1, found: 5, monthly: 12_000 } } })
    expect(txt(q('[data-review-work]'))).toBe('5 находок из 1 операции')
    expect(txt(q('[data-review-big]'))).toMatch(/^≈ 12\s000 ₸$/)
  })

  it('разбор до «Фидбек» Р-19 (₸ в год, подпись «за год · …») открывается: счётчик — месяцем, совет — как сохранён', async () => {
    const old = { title: 'Магазин у дома', text: 'Частые покупки у дома.', figure: { about: 'частые траты у «Магазин у дома» — за год', value: '248 400 ₸', label: 'за год · Магазин у дома' }, action: { kind: 'open' as const, target: { kind: 'seller' as const, id: 'магазин у дома', name: 'Магазин у дома' } } }
    await openV3({ extra: { work: { ops: 40, found: 2, yearly: 720_000 }, advices: [old] } })
    expect(txt(q('[data-review-big]'))).toMatch(/^≈ 60\s000 ₸$/)
    expect(txt(q('[data-review-work-word]'))).toBe('в месяц уходит на найденное')
    expect(txt(q('[data-review-work]'))).toBe('2 находки из 40 операций')
    expect(kinds()).toEqual(['work', 'where', 'advice'])
    const card = q('[data-review-advice]')!
    expect(txt(card.querySelector('[data-review-figure]'))).toBe('248 400 ₸')
    expect(txt(card.querySelector('[data-review-figure-about]'))).toBe('за год')
  })

  it('viewer: «Открыть» есть, «Сделать» нет (текст совета остаётся), «Обновить» нет', async () => {
    await openV3({ role: 'viewer', extra: { at: '2026-09-01T06:00:00.000Z' } })
    expect(q('[data-review-link]')).not.toBeNull()
    expect(q('[data-review-do]')).toBeNull()
    expect(txt(document.querySelectorAll('[data-review-advice-text]')[0])).toBe('Отложим остаток — подушки почти нет.')
    // У совета «Сделать» viewer — без кнопки вовсе (Р-12), не «Открыть» цели, как у устаревшего (критик Блока 2).
    expect(document.querySelectorAll('[data-review-advice]')[0].querySelectorAll('button, a')).toHaveLength(0)
    expect(q('[data-review-refresh]')).toBeNull()
  })

  it('нажатие кнопки в карточке — её действие, карточка та же (не листание по трети)', async () => {
    await openV3({ path: '/month?review=1&card=1' })
    const title = () => txt(q('[data-report-card][data-active] [data-review-advice-title]'))
    expect(title()).toBe('В подушку')
    await press(q('[data-review-do]'))
    expect(q('[data-do-amount]')).not.toBeNull()
    expect(title()).toBe('В подушку')
  })

  it('нажали пилюлю и сразу ушли на другой адрес, пока свой `?review=1` в пути, — отчёт закрыт', async () => {
    await open()
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    await open({ doc: withFund({ aiReviews: [savedV3(c)] }) })
    q('[data-review-open]')!.click()
    void router.push('/month?cat=sc_cafe')
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?cat=sc_cafe'))
    await flush()
    expect(dialog()).toBeNull()
  })

  it('закрыли «Назад» с открытым листом «Сделать» — снова открыли: листа нет, отчёт с первой карточки', async () => {
    await openV3()
    await press(q('[data-review-do]'))
    expect(q('[data-do-amount]')).not.toBeNull()
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.query.review).toBeUndefined())
    await flush()
    expect(dialog()).toBeNull()
    expect(q('[data-do-amount]')).toBeNull()
    await press(q('[data-review-open]'))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await flush()
    expect(q('[data-do-amount]')).toBeNull()
    expect(activeKind()).toBe('work')
  })

  it('«Сделать» устарел (кандидата нет в свежих) — «Открыть» той же цели вместо голого текста', async () => {
    await open()
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    // Подушки как фонда больше нет — кандидата `cushion` у семьи нет.
    await open({ doc: planFamilyDoc({ aiReviews: [savedV3(c)] }) })
    await press(q('[data-review-open]'))
    const first = document.querySelectorAll('[data-review-advice]')[0]
    expect(first.querySelector('[data-review-do]')).toBeNull()
    expect(first.querySelector('[data-review-link]')!.getAttribute('href')).toBe('/goals/fund')
  })

  it('итог прошлого месяца — по v3 прошлого месяца: «Сделать» сделан, раздел совета; прошлый — v2: карточки нет', async () => {
    await open()
    const c = candidateOf('cushion')
    app!.unmount()
    document.body.innerHTML = ''
    const prev = savedV3(c, { id: 'r0', month: '2026-08', at: '2026-08-01T06:00:00.000Z' })
    const shift = { id: 's1', period: '2026-08', by: 'a' as const, from: 'rest' as const, to: { goalId: 'fund' }, amount: 10_000, at: T0, updatedAt: T0 }
    await open({ doc: withFund({ aiReviews: [prev, savedV3(c)], planShifts: [shift] }) })
    await press(q('[data-review-open]'))
    expect(kinds()).toEqual(['work', 'where', 'advice', 'advice', 'outcome'])
    expect(txt(q('[data-outcome-done]'))).toMatch(/^В подушку ?Сделано$/)
    expect(txt(q('[data-outcome-section]'))).toContain('Кафе')
    expect(q('[data-report-card="outcome"] [data-review-foot]')).not.toBeNull()
    app!.unmount()
    document.body.innerHTML = ''

    await open({ doc: withFund({ aiReviews: [savedV2(null, { id: 'r0', month: '2026-08', at: '2026-08-01T06:00:00.000Z' }), savedV3(c)] }) })
    await press(q('[data-review-open]'))
    expect(kinds()).not.toContain('outcome')
  })

  it('v2 — одна карточка «Разбор» (Хорошо · Риск · Шаг), без полосок, низ на ней', async () => {
    await open({ doc: withFund({ aiReviews: [savedV2(null)] }) })
    await press(q('[data-review-open]'))
    expect(kinds()).toEqual(['old'])
    expect(q('[data-report-progress]')).toBeNull()
    expect(txt(q('[data-review-step-text]'))).toBe('Отложим остаток в подушку')
    expect(q('[data-report-card="old"] [data-review-foot]')).not.toBeNull()
  })

  it('демо: по адресу — отчёт «Пример», без дня и «Обновить»; запроса нет', async () => {
    const spy = vi.spyOn(apiClient, 'aiReview')
    const pinia = createPinia()
    setActivePinia(pinia)
    expect(startDemo()).toBe(true)
    router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/month?review=1')
    await router.isReady()
    const root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(Month)
    app.use(pinia)
    app.use(router)
    app.mount(root)
    await flush()
    expect(dialog()).not.toBeNull()
    expect(txt(q('[data-review-example]'))).toBe('Пример')
    expect(q('[data-review-day]')).toBeNull()
    expect(q('[data-review-refresh]')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

