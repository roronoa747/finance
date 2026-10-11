// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { templateById, themePhotos } from '@/lib/goalTemplates'
import GoalNew from './GoalNew.vue'

import { apiClient } from '@/api/client'

// Загрузка фото шаблона — без сети: цель уже записана с template, фото догружается потом; своё фото (и по ссылке) — заглушка.
const attached = vi.hoisted(() => ({ files: [] as [string, Blob][] }))
vi.mock('@/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
  attachFile: vi.fn(async (_store: unknown, id: string, file: Blob) => {
    attached.files.push([id, file])
    return true
  }),
}))

/** B2C-64-а: несколько фото на тему — ряд вариантов под сеткой; выбранный вариант уходит в цель вместе с автором. */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  attached.files = []
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function open(props: { next?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs('member', 'a'))
  const finance = useFinanceStore()
  finance.setHouseholdDoc(planFamilyDoc({ goals: [] }), 1)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/goals/new')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(GoalNew, props)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const variants = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Фото "]')]

describe('B2C-64-а: фото-варианты темы в «Новой цели»', () => {
  it('тема показывает свои варианты (первый — фото плитки); у «Путешествия» — ряд «Куда», вариантов нет', async () => {
    await open()
    expect(variants()).toHaveLength(0)
    button('Свадьба').click()
    await nextTick()
    expect(variants()).toHaveLength(themePhotos('wedding').length)
    expect(variants()[0].getAttribute('aria-pressed')).toBe('true')
    expect(variants()[0].querySelector('img')!.getAttribute('src')).toContain(templateById('wedding')!.photo.unsplashId)

    button('Путешествие').click()
    await nextTick()
    expect(variants()).toHaveLength(0)
    expect(document.body.textContent).toContain('Куда')
  })

  it('выбор варианта → превью с его автором, цель с template варианта', async () => {
    const finance = await open()
    button('Ремонт').click()
    await nextTick()
    variants()[2].click()
    await nextTick()
    expect(variants()[2].getAttribute('aria-pressed')).toBe('true')
    button('Дальше').click()
    await nextTick()
    const tpl = templateById('renovation-3')!
    expect(document.body.textContent).toContain(tpl.photo.author)

    const need = document.querySelector('input[placeholder="1 800 000"]') as HTMLInputElement
    need.value = '900 000'
    need.dispatchEvent(new Event('input'))
    await nextTick()
    button('Готово — к мечте').click()
    await nextTick()
    const goal = finance.goals.find((g) => g.name === 'Ремонт')!
    expect(goal.template).toBe('renovation-3')
    expect(goal.hue).toBe(tpl.hue)
  })
})

describe('PN-19: «Подушка» в «Новой мечте» — фонд семьи без формы', () => {
  const settle = async (router: Router, path: RegExp) => {
    for (let i = 0; i < 40 && !path.test(router.currentRoute.value.fullPath); i++) await new Promise((r) => setTimeout(r, 10))
  }

  it('«Подушка» → «Дальше»: формы нет, `ensureFund`, а не `addGoal`; переход на экран фонда; вариант фото — у фонда', async () => {
    const finance = await open()
    const router = app!.config.globalProperties.$router
    const addGoal = vi.spyOn(finance, 'addGoal')
    const ensureFund = vi.spyOn(finance, 'ensureFund')
    button('Подушка').click()
    await nextTick()
    variants()[1].click()
    await nextTick()
    button('Дальше').click()
    await settle(router, /^\/goals\/(?!new)/)
    expect(document.querySelector('input[placeholder="1 800 000"]'), 'формы суммы нет').toBeNull()
    expect(addGoal).not.toHaveBeenCalled()
    expect(ensureFund).toHaveBeenCalledWith('cushion')
    const fund = finance.goals.find((g) => g.fund === 'cushion')!
    expect(fund).toBeDefined()
    // Заглушка загрузки — «отложено»: экран фонда с заметкой «Картинка появится при сети», как у мечты.
    expect(router.currentRoute.value.fullPath).toBe(`/goals/${fund.id}?photo=later`)
    const { attachTemplate } = await import('@/lib/photos/goalPhoto')
    expect(attachTemplate).toHaveBeenCalledWith(finance, fund.id, templateById('cushion-2'))
  })

  it('подушка уже есть — тот же id, переход к ней с `?fund=exists` (тост), новой цели нет, фото не трогаем', async () => {
    const finance = await open()
    const router = app!.config.globalProperties.$router
    const first = finance.ensureFund('cushion')
    const count = finance.goals.length
    const { attachTemplate } = await import('@/lib/photos/goalPhoto')
    vi.mocked(attachTemplate).mockClear()
    button('Подушка').click()
    await nextTick()
    button('Дальше').click()
    await settle(router, /fund=exists/)
    expect(router.currentRoute.value.fullPath).toBe(`/goals/${first}?fund=exists`)
    expect(finance.goals).toHaveLength(count)
    expect(attachTemplate).not.toHaveBeenCalled()
  })

  it('копилка Блока 11 — та же подушка: помечается фондом, новой цели нет', async () => {
    const finance = await open()
    const router = app!.config.globalProperties.$router
    const pot = finance.addGoal({ name: 'Копилка', need: 500_000, monthly: 0, hue: 'teal', template: null })
    finance.setMoneySettings({ potGoalId: pot })
    const count = finance.goals.length
    button('Подушка').click()
    await nextTick()
    button('Дальше').click()
    await settle(router, /fund=exists/)
    expect(router.currentRoute.value.fullPath).toBe(`/goals/${pot}?fund=exists`)
    expect(finance.goals).toHaveLength(count)
    expect(finance.goals.find((g) => g.id === pot)!.fund).toBe('cushion')
  })

  it('старая мечта с картинкой подушки — не фонд: «Подушка» заводит новую, мечта остаётся мечтой (критик Б6)', async () => {
    const finance = await open()
    const router = app!.config.globalProperties.$router
    const old = finance.addGoal({ name: 'На чёрный день', need: 900_000, monthly: 0, hue: 'teal', template: 'cushion' })
    button('Подушка').click()
    await nextTick()
    button('Дальше').click()
    await settle(router, /^\/goals\/(?!new)/)
    const fund = finance.goals.find((g) => g.fund === 'cushion')!
    expect(fund.id).not.toBe(old)
    expect(router.currentRoute.value.fullPath).not.toContain('fund=exists')
    expect(finance.goals.find((g) => g.id === old)!.fund ?? null).toBeNull()
  })

  // Возврат приёмки Б6 (решение владельца А, `pn-block-6-first-run-cushion.md`): «Что копим?» первого запуска — только мечты.
  // Вне первого запуска (без `next`) плитка есть и ведёт в фонд — первый тест этого блока.
  const tiles = () => [...document.querySelectorAll('button')].map((b) => b.textContent?.trim())

  it('первый запуск (`next`): плитки «Подушка» нет, остальные темы и «Своё фото» на месте', async () => {
    await open({ next: '/start/invite' })
    expect(button('Подушка'), 'плитки «Подушка» нет').toBeUndefined()
    expect(tiles()).toContain('Свадьба')
    expect(tiles()).toContain('Своё фото')
    expect(tiles()).toContain('По ссылке')
  })

  // `/ux` возврата Б6: тем 18 — ряды полные; «Своё фото · По ссылке» — свой ряд пополам, а не две плитки и пустая ячейка.
  it('сетка без пустой ячейки: первый запуск — «Своё фото · По ссылке» рядом пополам; «Новая мечта» — в ряду с «Животным»', async () => {
    await open({ next: '/start/invite' })
    const own = () => document.querySelector('[data-own-tiles]') as HTMLElement
    expect(own().classList.contains('col-span-3'), 'свой ряд на всю ширину').toBe(true)
    expect([...own().querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Своё фото', 'По ссылке'])
    app?.unmount()
    document.body.innerHTML = ''
    await open()
    expect(own().classList.contains('contents'), 'вне первого запуска — ячейки общей сетки').toBe(true)
  })
})

describe('PN-08: «По ссылке» в «Новой мечте»', () => {
  it('плитка раскрывает поле; ссылка → шаг «form» с названием со страницы; цель без шаблона, картинка — своим фото', async () => {
    vi.useFakeTimers()
    vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Угловой диван Askona', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) })
    const finance = await open()
    // Тема выбрана, потом ссылка: ссылка побеждает — шаблона у цели нет.
    button('Мебель').click()
    await nextTick()
    const tile = document.querySelector('[data-link-tile]') as HTMLButtonElement
    expect(tile).not.toBeNull()
    expect(document.querySelector('[data-link-photo]')).toBeNull()
    tile.click()
    await nextTick()
    const link = document.querySelector('input[placeholder="Вставьте ссылку"]') as HTMLInputElement
    link.value = 'https://kaspi.kz/shop/p/sofa-askona/'
    link.dispatchEvent(new Event('input'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await nextTick()

    const name = document.querySelector('input[placeholder="Япония"]') as HTMLInputElement
    expect(name, 'шаг «form»').not.toBeNull()
    expect(name.value).toBe('Угловой диван Askona')
    const need = document.querySelector('input[placeholder="1 800 000"]') as HTMLInputElement
    need.value = '450 000'
    need.dispatchEvent(new Event('input'))
    await nextTick()
    // Создание ждёт переход роутера — настоящие таймеры и короткое ожидание.
    vi.useRealTimers()
    button('Готово — к мечте').click()
    for (let i = 0; i < 40 && !attached.files.length; i++) await new Promise((r) => setTimeout(r, 50))
    await nextTick()
    const goal = finance.goals.find((g) => g.name === 'Угловой диван Askona')!
    expect(goal).toBeDefined()
    // `addGoal` при `template: null` ключ не пишет; `null` ставит `attachFile` (здесь — заглушка).
    expect(goal.template).toBeFalsy()
    expect(goal.hue).toBe('blue')
    expect(goal.need).toBe(450_000)
    expect(attached.files).toHaveLength(1)
    expect(attached.files[0][0]).toBe(goal.id)
    expect(attached.files[0][1]).toBeInstanceOf(File)
  })

  it('/ux: ссылка → форма → «Назад» — поле ссылки свёрнуто (не берёт фокус с клавиатурой)', async () => {
    vi.useFakeTimers()
    vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Диван', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) })
    await open()
    ;(document.querySelector('[data-link-tile]') as HTMLButtonElement).click()
    await nextTick()
    const link = document.querySelector('input[placeholder="Вставьте ссылку"]') as HTMLInputElement
    link.value = 'https://kaspi.kz/shop/p/sofa/'
    link.dispatchEvent(new Event('input'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    await nextTick()
    expect(document.querySelector('input[placeholder="Япония"]'), 'шаг «form»').not.toBeNull()
    button('Назад').click()
    await nextTick()
    expect(document.querySelector('[data-link-tile]'), 'шаг «pick»').not.toBeNull()
    expect(document.querySelector('[data-link-photo]')).toBeNull()
    expect(document.querySelector('[data-link-tile]')!.getAttribute('aria-pressed')).toBe('false')
  })
})
