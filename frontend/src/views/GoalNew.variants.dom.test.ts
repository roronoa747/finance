// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
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

async function open() {
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
  app = createApp(GoalNew)
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
})
