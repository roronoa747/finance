// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App, type Component } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, RouterView, type Router } from 'vue-router'
import type { ApiClient } from '../src/api/client'
import { createAppRouter } from '../src/router'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { authAs, planFamilyDoc } from '../src/test/planFamily'
import { demoPhotoUrl } from '../src/lib/photos/store'
import GoalNew from '../src/views/GoalNew.vue'
import NewDebtSheet from '../src/components/capital/NewDebtSheet.vue'
import Access from '../src/views/Access.vue'
import { at, backend, fakeServer, type FakeServer } from './support/family'

vi.mock('../src/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
}))

/**
 * Блок 17 «Полировка» (B2C-111): два телефона и viewer на фейковом сервере, 12 сентября 2026, DOM (happy-dom).
 * 1. Формы говорят сами (Р-114): пустая новая мечта и новый кредит — кнопка не серая, нажатие подсвечивает первое пустое
 *    поле строкой и фокусом, ничего не записано; заполнил — записано и видно второму телефону.
 * 2. Прокрутка (Р-115): «Деньги» прокрутили → цель (сверху) → «назад» — то же место.
 * 3. Тишина (Р-116): в шапках вкладок и цели нет имён и «<месяц> · …».
 * 4. Демо (Р-118): «Вы» и «Партнёр», фото у всех целей и желаний из приложения, без /api.
 * 5. Viewer: кнопок ввода нет, как было.
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

let app: App | null = null
let server: FakeServer

async function phone(slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, slot))
  const client = backend(server)
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  return { pinia, client, store }
}
async function sync(from: Phone, to: Phone) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  setActivePinia(to.pinia)
  await to.store.pullHousehold(to.client)
}

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await nextTick()
}

/** Смонтировать компонент (или всё приложение — `RouterView`) телефона по адресу. */
async function mount(p: Phone, component: Component, path: string, props: Record<string, unknown> = {}): Promise<Router> {
  setActivePinia(p.pinia)
  const router = createAppRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(component, props) })
  app.use(p.pinia)
  app.use(router)
  app.mount(root)
  await tick()
  return router
}

const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim())
function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  at('2026-09-12T07:00:00Z')
  server = fakeServer(planFamilyDoc())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('e2e / B2C Блок 17 — полировка на двух телефонах и у viewer', () => {
  it('часть 1 — формы: пустая мечта и кредит называют поле, не пишут; заполнил — записано у обоих', async () => {
    const A = await phone('a')
    const B = await phone('b')

    await mount(A, GoalNew, '/goals/new')
    expect(button('Дальше').disabled).toBe(false)
    button('Дальше').click()
    await tick()
    expect(alerts()).toEqual(['Выберите картинку'])
    button('Ремонт').click()
    await tick()
    expect(alerts()).toEqual([])
    button('Дальше').click()
    await tick()
    const name = document.querySelector('input[placeholder="Япония"]') as HTMLInputElement
    type(name, '')
    await tick()
    button('Готово — к мечте').click()
    await tick()
    expect(alerts()).toEqual(['Введите название'])
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(name)
    type(name, 'Кухня')
    await tick()
    button('Готово — к мечте').click()
    await tick()
    const need = document.querySelector('input[placeholder="1 800 000"]') as HTMLInputElement
    expect(alerts()).toEqual(['Введите сумму'])
    expect(document.activeElement).toBe(need)
    expect(A.store.goals.some((g) => g.name === 'Кухня')).toBe(false)
    type(need, '900 000')
    await tick()
    button('Готово — к мечте').click()
    await tick()
    expect(A.store.goals.find((g) => g.name === 'Кухня')).toMatchObject({ need: 900_000 })
    app!.unmount()
    app = null
    document.body.innerHTML = ''

    const credits = A.store.credits.length
    await mount(A, NewDebtSheet, '/money', { open: true })
    button('Добавить').click()
    await tick()
    expect(alerts()).toEqual(['Введите остаток'])
    expect(A.store.credits).toHaveLength(credits)
    type(document.querySelector('input[placeholder="600 000"]') as HTMLInputElement, '120 000')
    await tick()
    button('Добавить').click()
    await tick()
    expect(alerts()).toEqual(['Введите платёж'])
    type(document.querySelector('input[placeholder="55 000"]') as HTMLInputElement, '10 000')
    await tick()
    button('Добавить').click()
    await tick()
    expect(A.store.credits).toHaveLength(credits + 1)

    await sync(A, B)
    expect(B.store.goals.find((g) => g.name === 'Кухня')).toMatchObject({ need: 900_000 })
    expect(B.store.credits.some((c) => c.principal === 120_000 && c.payment === 10_000)).toBe(true)
  })

  it('часть 2 и 3 — «назад» на то же место, новый экран сверху; шапки без имён и «<месяц> · …»', async () => {
    const A = await phone('a')
    const router = await mount(A, RouterView, '/money')
    const main = document.querySelector('main')!
    const header = () => document.querySelector('header')!.textContent ?? ''
    expect(header()).toContain('Деньги')
    for (const words of ['Ильяс', 'Аруна', 'Сентябрь', ' · ']) expect(header()).not.toContain(words)

    main.scrollTop = 520
    await router.push('/goals/car')
    await tick()
    expect(header()).toContain('Машина')
    expect(header()).not.toMatch(/мечта ·|Ильяс|Аруна/)
    expect(main.scrollTop).toBe(0)
    router.back()
    await new Promise((r) => setTimeout(r, 0))
    await tick()
    expect(router.currentRoute.value.path).toBe('/money')
    expect(main.scrollTop).toBe(520)

    for (const path of ['/', '/week', '/month']) {
      await router.push(path)
      await tick()
      for (const words of ['Ильяс', 'Аруна', 'Сентябрь ·']) expect(header()).not.toContain(words)
    }
  })

  it('часть 4 — демо: «Вы» и «Партнёр», фото у всех целей и желаний из приложения, без /api', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('демо не ходит в сеть')))
    vi.stubGlobal('fetch', fetchSpy)
    const pinia = createPinia()
    const p = { pinia } as Phone
    await mount(p, Access, '/access')
    ;[...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('демо'))!.click()
    await tick()
    const store = useFinanceStore()
    expect(store.people.map((x) => x.name)).toEqual(['Вы', 'Партнёр'])
    const items = [...store.goals, ...store.wishlist]
    expect(items.length).toBeGreaterThanOrEqual(8)
    for (const x of items) expect(demoPhotoUrl(x.photoId ?? '')).not.toBeNull()
    expect(JSON.stringify(store.householdDoc)).not.toMatch(/Ильяс|Аруна|Демо Семья/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('часть 5 — viewer: вкладки и цель без кнопок ввода', async () => {
    const V = await phone('a', 'viewer')
    const router = await mount(V, RouterView, '/month')
    const page = () => document.body.textContent ?? ''
    expect(page()).not.toContain('Внеплановый доход')
    expect(document.querySelector('button[aria-label="Добавить"]')).toBeNull()
    await router.push('/money')
    await tick()
    expect(page()).not.toContain('Добавить счёт')
    await router.push('/goals/car')
    await tick()
    expect(page()).not.toContain('Пополнить')
    await router.push('/')
    await tick()
    expect(page()).not.toContain('+ Новая')
  })
})
