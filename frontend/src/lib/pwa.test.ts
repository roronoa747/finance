import { describe, it, expect, vi } from 'vitest'
import { watchServiceWorkerUpdates, type PwaDeps } from './pwa'

/** Фейковые navigator.serviceWorker, document и window со своими слушателями. */
function fakes(opts: { controller: boolean; registration?: { update(): Promise<unknown> } | undefined }) {
  const listeners = new Map<string, (() => void)[]>()
  const target = () => ({
    addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: () => void) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((x) => x !== fn)),
  })
  const reload = vi.fn()
  const getRegistration = vi.fn(async () => opts.registration)
  const deps: PwaDeps = {
    sw: { controller: opts.controller ? {} : null, getRegistration, ...target() },
    doc: { visibilityState: 'visible', ...target() },
    win: { location: { reload }, ...target() },
  }
  const fire = (type: string) => (listeners.get(type) ?? []).forEach((fn) => fn())
  return { deps, fire, reload, getRegistration, listeners }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('PV-07: PWA переходит на новую версию сама', () => {
  it('первая установка (контроллера не было) — смена контроллера не перезагружает', () => {
    const f = fakes({ controller: false })
    watchServiceWorkerUpdates(f.deps)
    f.fire('controllerchange')
    expect(f.reload).not.toHaveBeenCalled()
  })

  it('контроллер был — перезагрузка ровно одна, даже при двух событиях', () => {
    const f = fakes({ controller: true })
    watchServiceWorkerUpdates(f.deps)
    f.fire('controllerchange')
    f.fire('controllerchange')
    expect(f.reload).toHaveBeenCalledTimes(1)
  })

  it('возврат на вкладку (visible) и фокус — просим SW проверить обновление; скрытая вкладка — нет', async () => {
    const update = vi.fn(async () => undefined)
    const f = fakes({ controller: true, registration: { update } })
    watchServiceWorkerUpdates(f.deps)

    f.fire('visibilitychange')
    await flush()
    expect(update).toHaveBeenCalledTimes(1)

    f.fire('focus')
    await flush()
    expect(update).toHaveBeenCalledTimes(2)

    f.deps.doc.visibilityState = 'hidden'
    f.fire('visibilitychange')
    f.fire('focus')
    await flush()
    expect(update).toHaveBeenCalledTimes(2)
    expect(f.getRegistration).toHaveBeenCalledTimes(2)
  })

  it('регистрации нет или проверка упала офлайн — без исключений', async () => {
    const none = fakes({ controller: true, registration: undefined })
    watchServiceWorkerUpdates(none.deps)
    none.fire('focus')
    await flush()
    expect(none.getRegistration).toHaveBeenCalledTimes(1)

    const offline = fakes({ controller: true, registration: { update: () => Promise.reject(new Error('offline')) } })
    watchServiceWorkerUpdates(offline.deps)
    offline.fire('visibilitychange')
    await flush()
    expect(offline.reload).not.toHaveBeenCalled()
  })

  it('отписка снимает все три слушателя', () => {
    const f = fakes({ controller: true })
    const stop = watchServiceWorkerUpdates(f.deps)
    stop()
    for (const type of ['controllerchange', 'visibilitychange', 'focus']) expect(f.listeners.get(type)).toEqual([])
    f.fire('controllerchange')
    expect(f.reload).not.toHaveBeenCalled()
  })
})
