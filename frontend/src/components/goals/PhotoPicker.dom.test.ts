// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { apiClient } from '@/api/client'
import { GOAL_TYPES } from '@/lib/goalTemplates'
import { planFamilyDoc } from '@/test/planFamily'
import PhotoPicker from './PhotoPicker.vue'

/**
 * PN-08: лист выбора фото — 19 плиток тем, «Своё фото» и «По ссылке»; плитка ссылки раскрывает поле под сеткой,
 * картинка со страницы уходит родителю как файл (`file`) — тот грузит её как своё фото и закрывает лист.
 */
let app: App | null = null
let files: File[] = []

beforeEach(() => {
  files = []
  vi.useFakeTimers()
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ goals: [] }), 1)
  const state = reactive({ open: true })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(PhotoPicker, { open: state.open, onFile: (f: File) => files.push(f) }) })
  app.use(pinia)
  app.mount(root)
  return state
}

const tiles = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].map((b) => b.textContent?.trim())
const linkTile = () => document.querySelector('[data-link-tile]') as HTMLButtonElement
const field = () => document.querySelector('[data-link-photo]')

describe('PN-08: PhotoPicker — «По ссылке»', () => {
  it('19 плиток тем в порядке GOAL_TYPES, затем «Своё фото» и «По ссылке»; поле ссылки свёрнуто', async () => {
    mount()
    await nextTick()
    expect(tiles()).toEqual([...GOAL_TYPES.map((k) => k.name), 'Своё фото', 'По ссылке'])
    expect(GOAL_TYPES).toHaveLength(19)
    expect(field()).toBeNull()
  })

  it('плитка раскрывает поле; ссылка → `file` с картинкой со страницы; повторное нажатие сворачивает; при открытии листа — свёрнуто', async () => {
    vi.spyOn(apiClient, 'linkPreview').mockResolvedValue({ title: 'Диван', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) })
    const state = mount()
    await nextTick()
    linkTile().click()
    await nextTick()
    expect(field()).not.toBeNull()
    expect(linkTile().getAttribute('aria-pressed')).toBe('true')

    const input = document.querySelector('input[placeholder="Вставьте ссылку"]') as HTMLInputElement
    input.value = 'https://kaspi.kz/shop/p/sofa/'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(files).toHaveLength(1)
    expect(files[0]).toBeInstanceOf(File)

    linkTile().click()
    await nextTick()
    expect(field()).toBeNull()

    linkTile().click()
    await nextTick()
    expect(field()).not.toBeNull()
    state.open = false
    await nextTick()
    state.open = true
    await nextTick()
    expect(field()).toBeNull()
  })

  it('/ux: поле раскрыто → выбор темы сворачивает его — выделена одна плитка (как в «Новой мечте»)', async () => {
    mount()
    await nextTick()
    linkTile().click()
    await nextTick()
    expect(field()).not.toBeNull()
    const sport = [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent?.includes('Спорт'))!
    sport.click()
    await nextTick()
    expect(field()).toBeNull()
    expect(linkTile().getAttribute('aria-pressed')).toBe('false')
    expect(sport.getAttribute('aria-pressed')).toBe('true')
  })
})
