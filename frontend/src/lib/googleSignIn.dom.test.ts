// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Загрузка GIS и параметры кнопки (B2C-25) — до живого Google в смоуке (ревью frontend Б4 Н-8). */

type Mod = typeof import('./googleSignIn')
let mod: Mod

beforeEach(async () => {
  vi.resetModules() // свой `loading` на каждый тест
  document.head.innerHTML = ''
  delete window.google
  mod = await import('./googleSignIn')
})

afterEach(() => {
  delete window.google
})

describe('googleSignIn', () => {
  it('скрипт один на страницу; после сбоя следующий вызов добавляет новый', async () => {
    // Фальшивые document/window: happy-dom сам роняет загрузку внешнего скрипта.
    type Script = { src?: string; async?: boolean; onload?: () => void; onerror?: () => void }
    const scripts: Script[] = []
    const doc = { createElement: () => ({}) as Script, head: { appendChild: (s: Script) => scripts.push(s) } } as unknown as Document
    const win = {} as Window

    const a = mod.loadGoogleId(doc, win)
    const b = mod.loadGoogleId(doc, win)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({ src: 'https://accounts.google.com/gsi/client', async: true })
    scripts[0].onerror!()
    await expect(a).rejects.toThrow('gis unavailable')
    await expect(b).rejects.toThrow('gis unavailable')

    const c = mod.loadGoogleId(doc, win)
    expect(scripts).toHaveLength(2)
    win.google = { accounts: { id: { initialize: vi.fn(), renderButton: vi.fn() } } }
    scripts[1].onload!()
    await expect(c).resolves.toBe(win.google.accounts!.id)
  })

  it('кнопка: по-русски, «Продолжить с Google»; ширина 200…400, скрытый контейнер — 320', async () => {
    const renderButton = vi.fn()
    window.google = { accounts: { id: { initialize: vi.fn(), renderButton } } }
    const el = document.createElement('div')
    await mod.renderGoogleButton(el, () => {})
    expect(renderButton).toHaveBeenCalledWith(el, expect.objectContaining({ locale: 'ru', text: 'continue_with', width: 320 }))

    Object.defineProperty(el, 'clientWidth', { value: 600 })
    await mod.renderGoogleButton(el, () => {})
    expect(renderButton.mock.calls[1][1].width).toBe(400)
    await mod.renderGoogleButton(el, () => {}, { width: 120 })
    expect(renderButton.mock.calls[2][1].width).toBe(200)
  })

  it('ответ Google без credential токена не даёт', async () => {
    let callback: (r: { credential?: string }) => void = () => {}
    window.google = { accounts: { id: { initialize: (c) => (callback = c.callback), renderButton: vi.fn() } } }
    const onToken = vi.fn()
    await mod.renderGoogleButton(document.createElement('div'), onToken)
    callback({})
    callback({ credential: 'id-token' })
    expect(onToken).toHaveBeenCalledTimes(1)
    expect(onToken).toHaveBeenCalledWith('id-token')
  })
})
