// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { planFamilyDoc } from '@/test/planFamily'
import GoalSheet from './GoalSheet.vue'

/**
 * PV-19 (критик Блока 4): правка «Уже накоплено» не теряется при закрытии окна. Поле пишет
 * по уходу из него, а Escape и крестик (Safari не отдаёт ему фокус) закрывают окно, не
 * уводя фокус, — `kit/Sheet` уводит его сам до `close`, пока цель окна ещё открыта.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function openTrip() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(), 1)
  store.contribute('trip', 10_000, 'a')
  const goalId = ref<string | null>('trip')
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(GoalSheet, { goalId: goalId.value, onClose: () => (goalId.value = null) }) })
  app.use(pinia)
  app.mount(root)
  await nextTick()
  await nextTick()
  const field = (label: string) =>
    [...document.querySelectorAll('[role="dialog"] label')]
      .find((l) => l.textContent?.includes(label))!
      .querySelector('input')!
  return { store, goalId, field }
}

async function type(input: HTMLInputElement, text: string) {
  input.focus()
  input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('PV-19: GoalSheet в DOM — закрытие окна не теряет правку поля', () => {
  it('«Уже накоплено» и Escape — seed записан, взнос в истории, окно закрыто', async () => {
    const { store, goalId, field } = await openTrip()
    await type(field('Уже накоплено'), '120 000')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick()
    expect(goalId.value).toBeNull()
    const trip = store.goals.find((g) => g.id === 'trip')!
    expect(trip).toMatchObject({ seed: 110_000, have: 120_000 })
    expect(trip.movements.map((m) => m.amount)).toEqual([10_000])
  })

  it('«Название» и крестик без фокуса на нём — записано', async () => {
    const { store, goalId, field } = await openTrip()
    await type(field('Название'), 'Отпуск в Турции')
    document.querySelector<HTMLElement>('[aria-label="Закрыть"]')!.click()
    await nextTick()
    expect(goalId.value).toBeNull()
    expect(store.goals.find((g) => g.id === 'trip')!.name).toBe('Отпуск в Турции')
  })
})

describe('PV-23 (хвосты Б4): «Готово» через close() кита; взноса в окне нет', () => {
  it('«Уже накоплено» набрано, фокус в поле, «Готово» без смены фокуса — seed записан, окно закрыто', async () => {
    const { store, goalId, field } = await openTrip()
    const have = field('Уже накоплено')
    await type(have, '120 000')
    expect(document.activeElement).toBe(have)
    ;[...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === 'Готово')!.click()
    await nextTick()
    expect(goalId.value).toBeNull()
    expect(store.goals.find((g) => g.id === 'trip')!).toMatchObject({ seed: 110_000, have: 120_000 })
  })

  it('«Откладывать в месяц» — только на экране цели, в окне правки поля нет (как React)', async () => {
    await openTrip()
    const labels = [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.textContent ?? '')
    expect(labels.some((t) => t.includes('Откладывать в месяц'))).toBe(false)
    expect(labels.some((t) => t.includes('Уже накоплено'))).toBe(true)
  })
})
