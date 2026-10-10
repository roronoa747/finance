// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import MyCircle from './MyCircle.vue'

/**
 * B2C-69: свой смайлик с клавиатуры — последняя плитка сетки «Смайлик» — поле: вставил один смайлик → он выбран
 * и показан в плитке и в кружке сверху; буквы и два смайлика — ничего не пишется, поле очищается, текста ошибки нет.
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  // `setPerson` планирует синк — сети в тесте нет.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('нет сети'))))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(emoji?: string, role: 'member' | 'viewer' = 'member') {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData(authAs(role, 'a'))
  const finance = useFinanceStore()
  const doc = planFamilyDoc()
  if (emoji) doc.people[0].emoji = emoji
  finance.setHouseholdDoc(doc, 1)
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(MyCircle)
  app.use(pinia)
  app.mount(root)
  await nextTick()
  return finance
}

const field = () => document.querySelector('input[aria-label="Свой смайлик"]') as HTMLInputElement
const tile = () => field().closest('label') as HTMLLabelElement
const bigCircle = () => document.querySelector('.size-24') as HTMLElement
const me = () => useFinanceStore().people.find((p) => p.id === 'a')!

async function type(text: string) {
  const f = field()
  f.value = text
  f.dispatchEvent(new Event('input'))
  await nextTick()
}

describe('B2C-69: свой смайлик с клавиатуры', () => {
  it('плитка-поле последняя в сетке, с «＋»; ввод «🐼» → setPerson({ emoji: "🐼" }), плитка отмечена, кружок сверху — 🐼', async () => {
    const finance = await open()
    const grid = tile().parentElement!
    expect(grid.lastElementChild).toBe(tile())
    expect(grid.children).toHaveLength(13) // буква + 11 + поле
    expect(field().placeholder).toBe('＋')
    expect(field().value).toBe('')
    expect(tile().className).not.toContain('outline-ink')

    const set = vi.spyOn(finance, 'setPerson')
    await type('🐼')
    expect(set).toHaveBeenCalledWith('a', { emoji: '🐼' })
    expect(me().emoji).toBe('🐼')
    expect(field().value).toBe('🐼')
    expect(tile().className).toContain('outline-ink')
    expect(bigCircle().textContent?.trim()).toBe('🐼')
    // В списке ничего не отмечено — смайлик свой.
    expect(document.querySelector('button[aria-pressed="true"][aria-label]:not([aria-label^="Цвет"])')).toBeNull()
    expect(document.body.textContent).not.toMatch(/ошибк|только один/i)
  })

  it('ввод «ab» → ничего не записано, поле пустое; вставка нового при своём — новый заменяет прежний (B2C-74)', async () => {
    const finance = await open()
    const set = vi.spyOn(finance, 'setPerson')
    await type('ab')
    expect(set).not.toHaveBeenCalled()
    expect(me().emoji).toBeUndefined()
    expect(field().value).toBe('')
    expect(tile().className).not.toContain('outline-ink')
    expect(bigCircle().textContent?.trim()).toBe('И')

    await type('🐼')
    await type('🐼🐙')
    expect(set).toHaveBeenCalledTimes(2)
    expect(set).toHaveBeenLastCalledWith('a', { emoji: '🐙' })
    expect(me().emoji).toBe('🐙')
    expect(field().value).toBe('🐙')
    expect(tile().className).toContain('outline-ink')
    expect(bigCircle().textContent?.trim()).toBe('🐙')

    // Дописали буквы к своему — ничего не записано, поле возвращает свой.
    await type('🐙ab')
    expect(set).toHaveBeenCalledTimes(2)
    expect(me().emoji).toBe('🐙')
    expect(field().value).toBe('🐙')

    // Вставили смайлик из списка — он и выбран, отмечен в списке, плитка-поле свободна (как B2C-69).
    await type('🐙🦊')
    expect(me().emoji).toBe('🦊')
    expect(field().value).toBe('')
    expect(document.querySelector('button[aria-label="🦊"]')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('B2C-74: нажатие на плитку-поле выделяет прежний свой — вставка заменит его', async () => {
    await open('🐼')
    const select = vi.spyOn(field(), 'select')
    field().dispatchEvent(new Event('focus'))
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('PN-01: поле «Имя» над кружком — пишет setPerson(slot, { name }) по blur; пустое и то же имя — не пишется; «Сохранено» горит и гаснет', async () => {
    vi.useFakeTimers()
    const finance = await open()
    const name = document.querySelector('input[aria-label="Имя"]') as HTMLInputElement
    expect(name).not.toBeNull()
    expect(name.value).toBe('Ильяс')
    expect(name.compareDocumentPosition(bigCircle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.body.textContent).not.toContain('Сохранено')
    const set = vi.spyOn(finance, 'setPerson')
    // Как в браузере: ввод отрисовывается до ухода из поля (иначе Vue не перепатчит `value` на прежнее).
    const blur = async (text: string) => {
      name.value = text
      name.dispatchEvent(new Event('input'))
      await nextTick()
      name.dispatchEvent(new Event('blur'))
      await nextTick()
    }

    await blur('   ')
    expect(set).not.toHaveBeenCalled()
    expect(name.value).toBe('Ильяс')
    await blur(' Ильяс ')
    expect(set).not.toHaveBeenCalled()

    await blur('Ильяс М.')
    expect(set).toHaveBeenCalledWith('a', { name: 'Ильяс М.' })
    expect(me().name).toBe('Ильяс М.')
    expect(bigCircle().textContent?.trim()).toBe('И')
    expect(document.body.textContent).toContain('Сохранено')
    // Гаснет через 1,8 с; уход — `Transition` (кадр rAF и его таймер) — ещё один тик таймеров после рендера.
    await vi.advanceTimersByTimeAsync(2000)
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(document.body.textContent).not.toContain('Сохранено')
    vi.useRealTimers()
  })

  it('PN-01: viewer поля «Имя» не видит (маршрут и так member — запись в общий документ сервер не примет)', async () => {
    await open(undefined, 'viewer')
    expect(document.querySelector('input[aria-label="Имя"]')).toBeNull()
    expect(bigCircle()).not.toBeNull()
  })

  it('свой смайлик из документа (флаг, семья) стоит в плитке как выбранный; выбор из списка освобождает плитку', async () => {
    await open('🇰🇿')
    expect(field().value).toBe('🇰🇿')
    expect(tile().className).toContain('outline-ink')
    expect(bigCircle().textContent?.trim()).toBe('🇰🇿')
    expect(bigCircle().className).toContain('overflow-hidden')
    expect(bigCircle().className).toContain('whitespace-nowrap')

    ;(document.querySelector('button[aria-label="🦊"]') as HTMLButtonElement).click()
    await nextTick()
    expect(me().emoji).toBe('🦊')
    expect(field().value).toBe('')
    expect(tile().className).not.toContain('outline-ink')
    expect(document.querySelector('button[aria-label="🦊"]')?.getAttribute('aria-pressed')).toBe('true')
  })
})
