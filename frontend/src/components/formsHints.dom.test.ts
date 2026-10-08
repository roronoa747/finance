// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import GoalNew from '@/views/GoalNew.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'

vi.mock('@/lib/photos/goalPhoto', async (orig) => ({
  ...(await orig<typeof import('@/lib/photos/goalPhoto')>()),
  attachTemplate: vi.fn(async () => 'deferred'),
}))

/** B2C-106 (Р-114): живые листы — кнопка не серая, нажатие называет пустое поле и ничего не пишет. */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function mount(component: Parameters<typeof h>[0], props: Record<string, unknown> = {}) {
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
  app = createApp({ render: () => h(component, props) })
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  return finance
}

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent?.trim())
const tick = async () => {
  await nextTick()
  await nextTick()
}
function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
}

describe('B2C-106: формы говорят сами', () => {
  it('новая мечта: «Дальше» без картинки и «Готово» без суммы — строка у поля, фокус, цель не записана', async () => {
    const finance = await mount(GoalNew)
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
    expect(finance.goals).toHaveLength(0)

    type(name, 'Ремонт кухни')
    await tick()
    button('Готово — к мечте').click()
    await tick()
    const need = document.querySelector('input[placeholder="1 800 000"]') as HTMLInputElement
    expect(alerts()).toEqual(['Введите сумму'])
    expect(document.activeElement).toBe(need)
    expect(finance.goals).toHaveLength(0)

    type(need, '900 000')
    await tick()
    button('Готово — к мечте').click()
    await tick()
    expect(finance.goals.map((g) => g.name)).toEqual(['Ремонт кухни'])
  })

  it('новый кредит: «Добавить» пустого листа — «Введите остаток», затем «Введите платёж»; заполнил — кредит записан', async () => {
    const finance = await mount(NewDebtSheet, { open: true })
    const before = finance.credits.length
    expect(button('Добавить').disabled).toBe(false)
    button('Добавить').click()
    await tick()
    expect(alerts()).toEqual(['Введите остаток'])
    const principal = document.querySelector('input[placeholder="600 000"]') as HTMLInputElement
    expect(document.activeElement).toBe(principal)
    expect(finance.credits).toHaveLength(before)

    type(principal, '600 000')
    await tick()
    expect(alerts()).toEqual([])
    button('Добавить').click()
    await tick()
    expect(alerts()).toEqual(['Введите платёж'])
    expect(finance.credits).toHaveLength(before)

    type(document.querySelector('input[placeholder="55 000"]') as HTMLInputElement, '55 000')
    await tick()
    button('Добавить').click()
    await tick()
    expect(finance.credits).toHaveLength(before + 1)
    expect(finance.credits.at(-1)).toMatchObject({ principal: 600_000, payment: 55_000 })
  })
})
