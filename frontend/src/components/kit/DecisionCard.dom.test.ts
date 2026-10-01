// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import DecisionCard from './DecisionCard.vue'
import Chip from './Chip.vue'

/** Карточка решения в DOM (B2C-12): три действия — три события; клавиатура ходит по кнопкам. */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

function mount(render: () => ReturnType<typeof h>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render })
  app.mount(root)
}

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]

describe('kit/DecisionCard в DOM', () => {
  it('«Да» / «Нет» / «Потом» — свои события, по одному на нажатие', async () => {
    const seen: string[] = []
    mount(() =>
      h(DecisionCard, {
        question: 'Это зарплата Ильяса?',
        actions: { primary: 'Да, зарплата', secondary: 'Разовый доход', ghost: 'Потом' },
        onPrimary: () => seen.push('primary'),
        onSecondary: () => seen.push('secondary'),
        onGhost: () => seen.push('ghost'),
      }),
    )
    await nextTick()
    const [yes, no, later] = buttons()
    expect([yes, no, later].map((b) => b.textContent?.trim())).toEqual(['Да, зарплата', 'Разовый доход', 'Потом'])
    yes.click()
    no.click()
    later.click()
    expect(seen).toEqual(['primary', 'secondary', 'ghost'])
  })

  it('клавиатура: кнопки настоящие (type=button, фокусируемые), disabled глушит все три', async () => {
    const seen: string[] = []
    const props = {
      question: 'Оставить подписку?',
      actions: { primary: 'Оставить', secondary: 'Отписаться', ghost: 'Подумать' },
      onPrimary: () => seen.push('primary'),
    }
    mount(() => h(DecisionCard, props))
    await nextTick()
    for (const b of buttons()) {
      expect(b.type).toBe('button')
      expect(b.tabIndex).toBeGreaterThanOrEqual(0)
    }
    buttons()[2].focus()
    expect(document.activeElement).toBe(buttons()[2])
    app?.unmount()
    document.body.innerHTML = ''

    mount(() => h(DecisionCard, { ...props, disabled: true }))
    await nextTick()
    for (const b of buttons()) expect(b.disabled).toBe(true)
    buttons()[0].click()
    expect(seen).toEqual([])
  })

  it('чипы одиночного выбора: нажатие переключает aria-pressed через родителя', async () => {
    let picked = 'sc_food'
    const chips = ['sc_food', 'sc_cafe']
    mount(() =>
      h(DecisionCard, { question: 'ИП Сериков — куда отнести?' }, {
        chips: () => chips.map((id) => h(Chip, { key: id, on: picked === id, onClick: () => (picked = id) }, () => id)),
      }),
    )
    await nextTick()
    const [food, cafe] = buttons()
    expect(food.getAttribute('aria-pressed')).toBe('true')
    expect(cafe.getAttribute('aria-pressed')).toBe('false')
    cafe.click()
    expect(picked).toBe('sc_cafe')
  })
})
