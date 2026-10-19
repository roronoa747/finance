// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import { routes } from '@/router'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc, T0 } from '@/test/planFamily'
import { DEFAULT_SPEND_CATEGORIES } from '@/lib/statements/dictionary'
import type { WhereRow } from '@/lib/finance'
import { plain } from '@/lib/money'
import WhereBars from './WhereBars.vue'

/**
 * RZ-08 (бэклог «Разбор», Р-4): «Куда ушло» картинкой — строка на раздел с одной цифрой, полоса на долю `share`, риски
 * «обычно» и плана, выше обычного — `--warn`; нажатие — лист раздела «Месяца» по адресу.
 */
let app: App | null = null
let router: Router

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const ROWS: WhereRow[] = [
  { categoryId: 'sc_food', name: 'Продукты', amount: 450_000, usual: 380_000, plan: 400_000, share: 1, usualShare: 380 / 450, planShare: 400 / 450, over: false },
  { categoryId: 'sc_cafe', name: 'Кафе и рестораны', amount: 150_000, usual: 90_000, plan: null, share: 1 / 3, usualShare: 0.2, planShare: null, over: true },
  { categoryId: 'sc_fun', name: 'Развлечения', amount: 45_000, usual: null, plan: null, share: 0.1, usualShare: null, planShare: null, over: false },
]

const play = ref(true)
async function mount(rows = ROWS, playing = true) {
  play.value = playing
  const pinia = createPinia()
  setActivePinia(pinia)
  useFinanceStore().setHouseholdDoc(planFamilyDoc({ spendCategories: DEFAULT_SPEND_CATEGORIES.map((c) => ({ ...c, updatedAt: T0 })) }), 1)
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/month?review=1')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(WhereBars, { rows, play: play.value }) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
}

const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-where-row="${id}"]`)!
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Полосы растут от нуля (`useGrow`, два кадра): ширина — после роста. */
const grownWidth = async (id: string) => {
  const fill = rowEl(id).querySelector<HTMLElement>('[data-where-fill]')!
  for (let i = 0; i < 20 && fill.style.width === '0%'; i++) await new Promise((r) => setTimeout(r, 20))
  return fill.style.width
}

describe('RZ-08: WhereBars — «Куда ушло» картинкой', () => {
  it('строки по `whereRows`: название и одна цифра — факт месяца', async () => {
    await mount()
    expect([...document.querySelectorAll('[data-where-row]')].map((el) => el.getAttribute('data-where-row'))).toEqual(['sc_food', 'sc_cafe', 'sc_fun'])
    const food = rowEl('sc_food')
    expect(txt(food.querySelector('[data-where-name]'))).toBe('Продукты')
    expect(food.querySelector('b')!.textContent).toBe(plain(450_000))
    // Одна цифра на строку: «обычно» и план — рисками, без чисел.
    expect(txt(food).match(/\d[\d\s ]*/g)).toHaveLength(1)
  })

  it('ширина полосы = share; риски «обычно» и плана — где есть; выше обычного — токен --warn и точка, иначе тихая --ink-3', async () => {
    await mount()
    expect(await grownWidth('sc_food')).toBe('100%')
    expect(Number.parseFloat(await grownWidth('sc_cafe'))).toBeCloseTo(100 / 3)
    expect(Number.parseFloat(rowEl('sc_food').querySelector<HTMLElement>('[data-where-usual]')!.style.left)).toBeCloseTo((380 / 450) * 100)
    expect(Number.parseFloat(rowEl('sc_food').querySelector<HTMLElement>('[data-where-plan]')!.style.left)).toBeCloseTo((400 / 450) * 100)
    expect(rowEl('sc_cafe').querySelector('[data-where-plan]')).toBeNull()
    expect(rowEl('sc_fun').querySelector('[data-where-usual]')).toBeNull()
    expect(rowEl('sc_cafe').querySelector('[data-where-fill]')!.classList.contains('bg-warn')).toBe(true)
    expect(rowEl('sc_cafe').hasAttribute('data-over')).toBe(true)
    expect(rowEl('sc_cafe').querySelector('[data-where-dot]')).not.toBeNull()
    expect(txt(rowEl('sc_cafe').querySelector('[data-where-name]'))).toBe('Кафе и рестораны, больше обычного')
    expect(rowEl('sc_food').querySelector('[data-where-fill]')!.classList.contains('bg-ink-3')).toBe(true)
    expect(rowEl('sc_food').querySelector('[data-where-dot]')).toBeNull()
    // Легенда — того, что нарисовано.
    expect([...document.querySelectorAll('[data-where-legend] > span')].map(txt)).toEqual(['обычно', 'план'])
  })

  it('`play: false` — полосы ждут на нуле; включили — растут (отчёт: когда карточку видно, `/ux`)', async () => {
    await mount(ROWS, false)
    await new Promise((r) => setTimeout(r, 120))
    expect(rowEl('sc_food').querySelector<HTMLElement>('[data-where-fill]')!.style.width).toBe('0%')
    play.value = true
    await nextTick()
    expect(await grownWidth('sc_food')).toBe('100%')
  })

  it('нет рисок — нет легенды', async () => {
    await mount([ROWS[2]])
    expect(document.querySelector('[data-where-legend]')).toBeNull()
  })

  it('нажатие строки — лист раздела «Месяца» по адресу', async () => {
    await mount()
    expect(rowEl('sc_cafe').getAttribute('href')).toBe('/month?cat=sc_cafe')
    rowEl('sc_cafe').click()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/month?cat=sc_cafe'))
  })
})

