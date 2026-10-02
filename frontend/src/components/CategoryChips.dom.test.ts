// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import type { SpendCategory } from '@/lib/statements/types'
import CategoryChips from './CategoryChips.vue'

/**
 * Ревью frontend Б9, Н-5: общий «куда отнести?» («Неделя» и «История») — «Ещё N ▾», «Кому → что»
 * с полем «что это» и «Между своими». Ответ уходит событием `choose` с правилом `MerchantRule['to']`.
 */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const T = '2026-09-01T00:00:00.000Z'
const eight: SpendCategory[] = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i + 1}`, name: `Раздел ${i + 1}`, hue: 'blue', order: i + 1, updatedAt: T,
}))

async function mount(props: { counterparty?: boolean } = {}) {
  setActivePinia(createPinia())
  useFinanceStore().householdDoc.spendCategories = eight
  const onChoose = vi.fn()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(CategoryChips, { ...props, onChoose }) })
  app.mount(root)
  await nextTick()
  return onChoose
}

const buttons = () => [...document.querySelectorAll('button')]
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label)
const chipNames = () => buttons().map((b) => b.textContent?.trim() ?? '').filter((t) => t.startsWith('Раздел '))

describe('Н-5: CategoryChips — «Ещё N», «Кому → что», «Между своими»', () => {
  it('8 разделов — видно 6 и «Ещё 2 ▾»; нажатие — все 8, «Ещё» уходит; раздел → choose({ categoryId })', async () => {
    const onChoose = await mount()
    expect(chipNames()).toEqual(['Раздел 1', 'Раздел 2', 'Раздел 3', 'Раздел 4', 'Раздел 5', 'Раздел 6'])
    button('Ещё 2 ▾')!.click()
    await nextTick()
    expect(chipNames()).toHaveLength(8)
    expect(button('Ещё 2 ▾')).toBeUndefined()
    button('Раздел 8')!.click()
    expect(onChoose).toHaveBeenCalledWith({ categoryId: 'c8' })
    // После ответа список снова свёрнут.
    await nextTick()
    expect(chipNames()).toHaveLength(6)
  })

  it('перевод человеку: «Кому → что» → «няня» → «Запомнить» — choose({ person: «няня» }); пустой ответ — без события', async () => {
    const onChoose = await mount({ counterparty: true })
    expect(document.querySelector('input')).toBeNull()
    button('Кому → что')!.click()
    await nextTick()
    const input = document.querySelector('input')!
    expect(input.getAttribute('placeholder')).toBe('например, няня')

    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await nextTick()
    button('Запомнить')!.click()
    expect(onChoose).not.toHaveBeenCalled()

    input.value = '  няня '
    input.dispatchEvent(new Event('input'))
    await nextTick()
    button('Запомнить')!.click()
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith({ person: 'няня' })
    // Ответ дан — поле закрыто.
    await nextTick()
    expect(document.querySelector('input')).toBeNull()
  })

  it('«Между своими» → choose({ internal: true }); без counterparty чипа «Кому → что» нет', async () => {
    const onChoose = await mount()
    expect(button('Кому → что')).toBeUndefined()
    button('Между своими')!.click()
    expect(onChoose).toHaveBeenCalledWith({ internal: true })
  })
})
