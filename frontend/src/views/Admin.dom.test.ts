// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, ApiError, type AdminMetrics } from '@/api/client'
import type { AdminFamilies, AdminFamily } from '@/types/api'
import Admin from '@/views/Admin.vue'

/**
 * AI-04 (бэклог «ИИ», Р-7, Р-8): раздел «Семьи» над метриками — почты и тумблер ИИ у каждой семьи, расход тихой
 * строкой у семей с ИИ или тратами; переключение — сразу PUT, ошибка возвращает тумблер; без ключа — строка
 * предупреждения; «Проверить связь» → тост, причина отказа — в подсказке.
 */
let app: App | null = null

const metrics: AdminMetrics = {
  users: 3,
  households: 2,
  households_with_upload: 1,
  second_upload_14d: { eligible: 1, retained: 1 },
  active_7d: 1,
  active_28d: 2,
  funnel_28d: { created: 1, uploaded: 1, goal: 1, done: 1 },
  weeks: [],
}

const fam = (over: Partial<AdminFamily>): AdminFamily => ({
  id: 'h-1',
  created_at: '2026-10-01T00:00:00Z',
  emails: ['aigul@example.com', 'ilyas@example.com'],
  ai: true,
  month: '2026-10',
  requests: 3,
  cost_micros: 420_000,
  ...over,
})

const list = (over: Partial<AdminFamilies> = {}): AdminFamilies => ({
  families: [fam({}), fam({ id: 'h-2', emails: ['bota@example.com'], ai: false, requests: 0, cost_micros: 0 })],
  limit_micros: 2_000_000,
  key: true,
  ...over,
})

async function settle() {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

async function mount(): Promise<HTMLElement> {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const pinia = createPinia()
  setActivePinia(pinia)
  app = createApp(Admin)
  app.use(pinia)
  app.mount(el)
  await settle()
  return el
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-family]')]
const toggle = (row: HTMLElement) => row.querySelector<HTMLButtonElement>('[role="switch"]')!

beforeEach(() => {
  vi.spyOn(apiClient, 'adminMetrics').mockResolvedValue(metrics)
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('AI-04: админка — семьи и ИИ', () => {
  it('семьи над метриками: почты, тумблеры в порядке ответа, расход — только у ИИ или с тратами', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    const el = await mount()

    const card = el.querySelector('[data-families]')!
    expect(card).not.toBeNull()
    expect(el.textContent!.indexOf('Семьи')).toBeLessThan(el.textContent!.indexOf('Вторая выписка'))
    const [a, b] = rows(el)
    expect(a.dataset.family).toBe('h-1')
    expect(a.querySelector('[data-emails]')!.textContent).toBe('aigul@example.com · ilyas@example.com')
    expect(toggle(a).getAttribute('aria-checked')).toBe('true')
    expect(a.querySelector('[data-spent]')!.textContent).toBe('3 запроса · ≈ $0.42 из $2')
    expect(toggle(b).getAttribute('aria-checked')).toBe('false')
    expect(b.querySelector('[data-spent]')).toBeNull()
    expect(el.querySelector('[data-no-key]')).toBeNull()
  })

  it('клик по тумблеру — setFamilyAi(id, true); на время запроса тумблер неактивен', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    let done!: (f: AdminFamily) => void
    const put = vi.spyOn(apiClient, 'setFamilyAi').mockImplementation(() => new Promise((r) => (done = r)))
    const el = await mount()

    const b = rows(el)[1]
    toggle(b).click()
    await settle()
    expect(put).toHaveBeenCalledWith('h-2', true)
    expect(toggle(b).disabled).toBe(true)
    expect(toggle(b).getAttribute('aria-checked')).toBe('true')

    done(fam({ id: 'h-2', emails: ['bota@example.com'], ai: true, requests: 0, cost_micros: 0 }))
    await settle()
    expect(toggle(b).disabled).toBe(false)
    expect(toggle(b).getAttribute('aria-checked')).toBe('true')
    expect(b.querySelector('[data-spent]')!.textContent).toBe('0 запросов')
  })

  it('ошибка PUT — тумблер возвращается и строка alert', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    vi.spyOn(apiClient, 'setFamilyAi').mockRejectedValue(new ApiError('boom', 500))
    const el = await mount()

    const a = rows(el)[0]
    toggle(a).click()
    await settle()
    expect(toggle(a).getAttribute('aria-checked')).toBe('true')
    expect(el.querySelector('[data-families] [role="alert"]')!.textContent).toBe('Не получилось выключить ИИ.')
  })

  it('без ключа — одна строка-предупреждение', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ key: false }))
    const el = await mount()
    expect(el.querySelector('[data-no-key]')!.textContent).toBe('Ключ не задан — ИИ выключен везде')
  })

  it('«Проверить связь» → тост «Связь есть · N мс»; отказ — «Нет связи», причина в подсказке', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    const check = vi.spyOn(apiClient, 'aiCheck').mockResolvedValue({ ok: true, model: 'claude-haiku-5-5', ms: 812 })
    const el = await mount()

    el.querySelector<HTMLButtonElement>('[data-ai-check]')!.click()
    await settle()
    expect(check).toHaveBeenCalledOnce()
    expect(el.querySelector('[data-check-note]')!.textContent).toBe('Связь есть · 812 мс')
    expect(el.querySelector('button[aria-label="Почему нет связи"]')).toBeNull()

    check.mockResolvedValue({ ok: false, reason: 'failed' })
    el.querySelector<HTMLButtonElement>('[data-ai-check]')!.click()
    await settle()
    expect(el.querySelector('[data-check-note]')!.textContent).toBe('Нет связи')
    // Тост уйдёт — слово «Нет связи» остаётся в карточке рядом с «?».
    expect(el.querySelector('[data-check-fail]')!.textContent).toContain('Нет связи')
    const why = el.querySelector<HTMLButtonElement>('[data-check-fail] button[aria-label="Почему нет связи"]')!
    expect(why).not.toBeNull()
    expect(el.textContent).not.toContain('Claude не ответил')
    why.click()
    await settle()
    expect(el.querySelector('[data-check-reason]')!.textContent).toContain('Claude не ответил')
  })

  it('цифры не загрузились — семьи и тумблеры всё равно видны', async () => {
    vi.spyOn(apiClient, 'adminMetrics').mockRejectedValue(new ApiError('boom', 500))
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    const el = await mount()
    expect(rows(el)).toHaveLength(2)
    expect(el.textContent).toContain('Не получилось загрузить цифры.')
  })

  it('семьи не загрузились (не 404) — строка alert, цифры ниже видны', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockRejectedValue(new ApiError('boom', 500))
    const el = await mount()
    expect(el.querySelector('[data-families]')).toBeNull()
    expect(el.querySelector('[role="alert"]')!.textContent).toBe('Не получилось загрузить семьи.')
    expect(el.textContent).toContain('Пользователи')
    expect(el.textContent).toContain('Вторая выписка')
  })

  it('«Проверить связь» без сети — «Нет связи», в подсказке «Сервер не ответил.»', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    vi.spyOn(apiClient, 'aiCheck').mockRejectedValue(new TypeError('Failed to fetch'))
    const el = await mount()

    el.querySelector<HTMLButtonElement>('[data-ai-check]')!.click()
    await settle()
    expect(el.querySelector('[data-check-note]')!.textContent).toBe('Нет связи')
    expect(el.querySelector('[data-check-fail]')!.textContent).toContain('Нет связи')
    el.querySelector<HTMLButtonElement>('[data-check-fail] button[aria-label="Почему нет связи"]')!.click()
    await settle()
    expect(el.querySelector('[data-check-reason]')!.textContent).toContain('Сервер не ответил.')
  })

  // AU-09 (бэклог «ИИ-польза», Р-11): лимит — деньги; в подсказке — «До $N», у семьи — «≈ $ из $N».
  it('лимит в долларах: в подсказке «До $2 …», у семьи «из $2»; другой лимит — своё число', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ limit_micros: 5_000_000 }))
    const el = await mount()
    el.querySelector<HTMLButtonElement>('[data-families] button[aria-label="Про лимит"]')!.click()
    await settle()
    expect(el.querySelector('[data-limit]')!.textContent).toBe('До $5 ИИ в месяц на семью.')
    expect(el.textContent).not.toContain('запросов ИИ')
    expect(rows(el)[0].querySelector('[data-spent]')!.textContent).toBe('3 запроса · ≈ $0.42 из $5')
  })

  it('запросы есть, а расход 0 (модели нет в таблице цен) — «≈ —», не «$0»', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ families: [fam({ requests: 2, cost_micros: 0 })] }))
    const el = await mount()
    expect(rows(el)[0].querySelector('[data-spent]')!.textContent).toBe('2 запроса · ≈ —')
  })

  // Ревью frontend Блока 2, Н-4: оплаченные неудачи (requests 0, расход > 0) видны и у семьи, которой ИИ уже выключили.
  it('ИИ выключен, запросов 0, а расход есть (брак модели) — строка расхода видна', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ families: [fam({ ai: false, requests: 0, cost_micros: 21_000 })] }))
    const el = await mount()
    expect(rows(el)[0].querySelector('[data-spent]')!.textContent).toBe('0 запросов · ≈ $0.03 из $2') // центы вверх (`usdFromMicros`)
  })

  it('не владельцу — «Нет такой страницы», семей нет', async () => {
    vi.spyOn(apiClient, 'adminMetrics').mockRejectedValue(new ApiError('not found', 404))
    vi.spyOn(apiClient, 'adminFamilies').mockRejectedValue(new ApiError('not found', 404))
    const el = await mount()
    expect(el.textContent).toContain('Нет такой страницы.')
    expect(el.querySelector('[data-families]')).toBeNull()
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('AP-11: «Цифры» — пуши банков', () => {
  const counts = (parsed: number, ignored: number, unknown: number) => ({ parsed, ignored, unknown })

  it('одна строка за 7 дней — сумма по банкам; банки и 30 дней — под «Подробнее»', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    vi.spyOn(apiClient, 'adminMetrics').mockResolvedValue({
      ...metrics,
      push_stats: [
        { bank: 'freedom', d7: counts(2, 1, 0), d30: counts(5, 1, 0) },
        { bank: 'kaspi', d7: counts(4, 0, 1), d30: counts(9, 2, 3) },
      ],
    })
    const el = await mount()
    const card = el.querySelector<HTMLElement>('[data-push-stats]')!
    expect(card).not.toBeNull()
    expect(card.querySelector('[data-push-week]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('разобрано 6 · не разобрано 1')
    // Банки — в свёрнутом «Подробнее», не на экране сразу (правило 12: сложное скрыто).
    expect(card.querySelector('details')!.open).toBe(false)
    const kaspi = card.querySelector<HTMLElement>('[data-push-bank="kaspi"]')!
    expect([...kaspi.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Kaspi', '4', '0', '1'])
  })

  it('пушей за 30 дней не было или старый сервер — карточки нет', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list())
    vi.spyOn(apiClient, 'adminMetrics').mockResolvedValue({ ...metrics, push_stats: [] })
    const el = await mount()
    expect(el.querySelector('[data-push-stats]')).toBeNull()
    app?.unmount()
    app = null
    vi.spyOn(apiClient, 'adminMetrics').mockResolvedValue(metrics)
    const old = await mount()
    expect(old.querySelector('[data-push-stats]')).toBeNull()
  })
})
