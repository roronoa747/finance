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
  last_active_at: null,
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

describe('ADM-01: семьи — активность, первые 10, поиск', () => {
  // 20 октября, 12:00 в Алматы.
  const NOW = new Date('2026-10-20T07:00:00Z')
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      fam({ id: `h-${i + 1}`, emails: [`user${i + 1}@example.com`], ai: false, requests: 0, cost_micros: 0 }),
    )
  const type = async (el: HTMLElement, text: string) => {
    const input = el.querySelector<HTMLInputElement>('[data-family-search]')!
    input.value = text
    input.dispatchEvent(new Event('input'))
    await settle()
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('зелёная точка — вход за 7 суток; подпись по дням Алматы; не заходили — ни точки, ни подписи', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(
      list({
        families: [
          fam({ id: 'today', last_active_at: '2026-10-19T19:30:00Z' }), // 00:30 20-го в Алматы
          fam({ id: 'yday', last_active_at: '2026-10-19T18:30:00Z' }), // 23:30 19-го
          fam({ id: 'six', last_active_at: '2026-10-13T08:00:00Z' }), // 6 суток 23 ч — ещё активна
          fam({ id: 'old', last_active_at: '2026-10-13T06:00:00Z' }), // 7 суток 1 ч — уже нет
          fam({ id: 'never' }),
        ],
      }),
    )
    const el = await mount()
    const row = (id: string) => el.querySelector<HTMLElement>(`[data-family="${id}"]`)!
    const ago = (id: string) => row(id).querySelector('[data-ago]')?.textContent ?? null
    const dot = (id: string) => row(id).querySelector('[data-active]') !== null
    expect([ago('today'), ago('yday'), ago('six'), ago('old'), ago('never')]).toEqual(['сегодня', 'вчера', '7 дней назад', '7 дней назад', null])
    expect([dot('today'), dot('yday'), dot('six'), dot('old'), dot('never')]).toEqual([true, true, true, false, false])
    expect(row('today').querySelector('[data-active]')!.classList.contains('bg-ok')).toBe(true)
    // Одна линия: почты и подпись — в одной строке.
    expect(row('yday').querySelector('[data-emails]')!.parentElement).toBe(row('yday').querySelector('[data-ago]')!.parentElement)
  })

  it('15 семей — первые 10 в порядке ответа и «Ещё 5»; нажали — все, кнопки нет', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ families: many(15) }))
    const el = await mount()
    expect(rows(el).map((r) => r.dataset.family)).toEqual(many(10).map((f) => f.id))
    const more = el.querySelector<HTMLButtonElement>('[data-family-more]')!
    expect(more.textContent!.trim()).toBe('Ещё 5')
    more.click()
    await settle()
    expect(rows(el)).toHaveLength(15)
    expect(el.querySelector('[data-family-more]')).toBeNull()
  })

  it('10 семей и меньше — ни поиска, ни «Ещё»', async () => {
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ families: many(10) }))
    const el = await mount()
    expect(rows(el)).toHaveLength(10)
    expect(el.querySelector('[data-family-search]')).toBeNull()
    expect(el.querySelector('[data-family-more]')).toBeNull()
  })

  it('поиск по части почты без регистра — все совпадения без лимита 10; ничего — «Никого не нашли»', async () => {
    const families = many(15)
    families[1].emails = ['aigul@example.com', 'Ilyas.M@Mail.kz']
    families[13].emails = ['bota@mail.kz']
    vi.spyOn(apiClient, 'adminFamilies').mockResolvedValue(list({ families }))
    const el = await mount()

    await type(el, '  MAIL.KZ ')
    expect(rows(el).map((r) => r.dataset.family)).toEqual(['h-2', 'h-14'])
    expect(el.querySelector('[data-family-more]')).toBeNull()

    await type(el, 'user1')
    expect(rows(el).map((r) => r.dataset.family)).toEqual(['h-1', 'h-10', 'h-11', 'h-12', 'h-13', 'h-15']) // h-11…h-15 — за первыми 10
    expect(el.querySelector('[data-family-none]')).toBeNull()

    await type(el, 'нет-такой')
    expect(rows(el)).toHaveLength(0)
    expect(el.querySelector('[data-family-none]')!.textContent).toBe('Никого не нашли')

    await type(el, '')
    expect(rows(el)).toHaveLength(10)
    expect(el.querySelector('[data-family-more]')!.textContent!.trim()).toBe('Ещё 5')
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
