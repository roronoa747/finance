// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { apiClient } from '@/api/client'
import { GOAL_TYPES, type GoalTemplate } from '@/lib/goalTemplates'
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

let picked: string[] = []

function mount(selected: string | null = null) {
  picked = []
  const pinia = createPinia()
  setActivePinia(pinia)
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ goals: [] }), 1)
  const state = reactive({ open: true })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({
    render: () =>
      h(PhotoPicker, { open: state.open, selected, onFile: (f: File) => files.push(f), onTemplate: (t: GoalTemplate) => picked.push(t.id) }),
  })
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

const tile = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent?.trim() === name)!
const row = () => [...document.querySelectorAll<HTMLButtonElement>('[data-theme-photos] button')]
const choose = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Выбрать это')!

describe('PN-33: PhotoPicker — другие фото темы у существующей мечты', () => {
  it('без темы ряда нет; тема → ряд из 5, первое отмечено; 3-е → «Выбрать это» отдаёт `<тип>-3`', async () => {
    mount()
    await nextTick()
    expect(row()).toHaveLength(0)
    tile('Спорт').click()
    await nextTick()
    expect(row()).toHaveLength(5)
    expect(row().map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false'])
    row()[2].click()
    await nextTick()
    expect(row()[2].getAttribute('aria-pressed')).toBe('true')
    expect(tile('Спорт').getAttribute('aria-pressed')).toBe('true')
    choose().click()
    await nextTick()
    expect(picked).toEqual(['sport-3'])
  })

  it('лист открыт с выбранным `sport-3` — тема выделена, ряд показан, третий отмечен', async () => {
    mount('sport-3')
    await nextTick()
    expect(tile('Спорт').getAttribute('aria-pressed')).toBe('true')
    expect(row().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false'])
    choose().click()
    await nextTick()
    expect(picked).toEqual(['sport-3'])
  })

  it('«Путешествие» — ряда нет, направления на месте', async () => {
    mount()
    await nextTick()
    tile('Путешествие').click()
    await nextTick()
    expect(row()).toHaveLength(0)
    expect(document.body.textContent).toContain('Куда')
  })
})
