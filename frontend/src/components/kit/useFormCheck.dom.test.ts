// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import Field from './Field.vue'
import NumField from './NumField.vue'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import { useFormCheck } from './useFormCheck'
import { parseMoney } from '@/lib/money'

/** Р-114: кнопка формы не блокируется молча — называет первое пустое поле. */

let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

function mountForm(submit: () => void) {
  const name = ref('')
  const amount = ref('')
  const Form = defineComponent({
    setup() {
      const form = useFormCheck(() => [
        ['name', !name.value.trim() && 'Введите название'],
        ['amount', parseMoney(amount.value) <= 0 && 'Введите сумму'],
      ])
      return () =>
        h('div', [
          h(Field, { label: 'Название', name: 'name' }, () =>
            h(Input, { modelValue: name.value, 'onUpdate:modelValue': (v: string) => (name.value = v) }),
          ),
          h(Field, { label: 'Сумма', name: 'amount' }, () =>
            h(NumField, { modelValue: amount.value, 'onUpdate:modelValue': (v: string) => (amount.value = v) }),
          ),
          h(Button, { onClick: () => form.submit(submit) }, () => 'Добавить'),
        ])
    },
  })
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Form)
  app.mount(root)
  return { name, amount }
}

const button = () => document.querySelector('button') as HTMLButtonElement
const inputs = () => [...document.querySelectorAll('input')]
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent)

describe('B2C-106: useFormCheck + Field', () => {
  it('пустая форма: кнопка активна, нажатие — ошибка у первого поля, фокус на нём, submit не вызван', async () => {
    const submit = vi.fn()
    mountForm(submit)
    expect(button().disabled).toBe(false)
    button().click()
    await nextTick()
    await nextTick()
    expect(submit).not.toHaveBeenCalled()
    expect(alerts()).toEqual(['Введите название'])
    expect(inputs()[0].getAttribute('aria-invalid')).toBe('true')
    expect(inputs()[0].getAttribute('aria-describedby')).toBe(document.querySelector('[role="alert"]')!.id)
    expect(inputs()[1].hasAttribute('aria-invalid')).toBe(false)
    expect(document.activeElement).toBe(inputs()[0])
  })

  it('исправил поле — ошибка ушла; следующее нажатие называет следующее поле; всё верно — submit', async () => {
    const submit = vi.fn()
    const s = mountForm(submit)
    button().click()
    await nextTick()
    s.name.value = 'Ипотека'
    await nextTick()
    expect(alerts()).toEqual([])
    button().click()
    await nextTick()
    await nextTick()
    expect(alerts()).toEqual(['Введите сумму'])
    expect(document.activeElement).toBe(inputs()[1])
    expect(submit).not.toHaveBeenCalled()
    s.amount.value = '5 000'
    await nextTick()
    expect(alerts()).toEqual([])
    button().click()
    await nextTick()
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
