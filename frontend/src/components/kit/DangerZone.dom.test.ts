// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import DangerZone from './DangerZone.vue'

/** Защита вводом слова (B2C-25): «Отмена» её не ослабляет (ревью frontend Б4 Н-6). */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!

describe('kit/DangerZone в DOM', () => {
  it('ввести слово → «Отмена» → открыть снова: поле пустое, кнопка выключена', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(DangerZone, { label: 'Удалить аккаунт', confirmLabel: 'Удалить навсегда', confirmWord: 'удалить', warning: 'Безвозвратно.' }) })
    app.mount(root)

    button('Удалить аккаунт').click()
    await nextTick()
    const input = document.querySelector('input')!
    input.value = 'удалить'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(button('Удалить навсегда').disabled).toBe(false)

    button('Отмена').click()
    await nextTick()
    button('Удалить аккаунт').click()
    await nextTick()
    expect(document.querySelector('input')!.value).toBe('')
    expect(button('Удалить навсегда').disabled).toBe(true)
  })
})
