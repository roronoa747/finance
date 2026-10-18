// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useQuerySheet, useQueryValue } from './useQuerySheet'

/**
 * Лист по адресу — общий механизм всех листов `?<key>=1` («Хватит?» `afford`, «Прикинуть кредит» `try`, отчёт разбора
 * `review`) и значения `?cat=<id>` (лист раздела «Месяца», чип истории). Критик Блока 2 «Разбор»: RZ-07/RZ-08 поменяли
 * его для всех листов — параметр ушёл с адреса сам («Назад») → лист закрыт; `close()` снимает и сопутствующие; открыли
 * кнопкой, а переход на адрес ещё в пути — `close()` его отменяет.
 */
let app: App | null = null

afterEach(() => {
  app?.unmount()
  app = null
})

const Empty = { render: () => null }

async function mount<T>(use: () => T, path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Empty }] })
  await router.push(path)
  await router.isReady()
  let api!: T
  app = createApp(
    defineComponent({
      setup() {
        api = use()
        return () => null
      },
    }),
  )
  app.use(router)
  app.mount(document.createElement('div'))
  await nextTick()
  return { router, api }
}

describe('useQuerySheet / useQueryValue (критик Блока 2 «Разбор»)', () => {
  it('`?k=1` — лист открыт; close() снимает параметр и сопутствующие, чужие оставляет', async () => {
    const { router, api } = await mount(() => useQuerySheet('k', ['card']), '/?k=1&card=2&month=2026-09')
    expect(api.open.value).toBe(true)
    api.close()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/?month=2026-09'))
    expect(api.open.value).toBe(false)
  })

  it('параметр ушёл с адреса сам («Назад») — лист закрыт; вернулся («Вперёд») — снова открыт', async () => {
    const { router, api } = await mount(() => useQuerySheet('k'), '/')
    await router.push('/?k=1')
    expect(api.open.value).toBe(true)
    router.back()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
    expect(api.open.value).toBe(false)
    router.forward()
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/?k=1'))
    expect(api.open.value).toBe(true)
  })

  it('открыт кнопкой, переход на `?k=1` ещё в пути — close() его отменяет: адрес без параметра, лист закрыт', async () => {
    const { router, api } = await mount(() => useQuerySheet('k'), '/')
    api.open.value = true
    const pending = router.push('/?k=1')
    api.close()
    await pending
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe('/'))
    expect(api.open.value).toBe(false)
  })

  it('открыт кнопкой без адреса — close() адрес не меняет', async () => {
    const { router, api } = await mount(() => useQuerySheet('k'), '/?month=2026-09')
    api.open.value = true
    api.close()
    await nextTick()
    await nextTick()
    expect(router.currentRoute.value.fullPath).toBe('/?month=2026-09')
    expect(api.open.value).toBe(false)
  })

  it('значение: `?cat=a` держит «a», другой адрес — новое значение, параметр ушёл — null; лист `?k=` открыт только при «1»', async () => {
    const { router, api } = await mount(() => ({ cat: useQueryValue('cat'), k: useQuerySheet('k') }), '/?cat=a&k=2')
    expect(api.cat.value.value).toBe('a')
    expect(api.k.open.value).toBe(false)
    await router.push('/?cat=b')
    expect(api.cat.value.value).toBe('b')
    await router.push('/')
    expect(api.cat.value.value).toBeNull()
  })
})
