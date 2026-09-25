import { vi } from 'vitest'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import { createSSRApp, type Component, type ComponentOptions } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '../../src/router'
import { useFinanceStore } from '../../src/stores/finance'
import { ApiClient, ApiError } from '../../src/api/client'
import type { SyncDoc } from '../../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse } from '../../src/types/api'

/**
 * Стенд «двух телефонов» для e2e (ревью frontend Блока 2, Н-7): фейковый сервер общего
 * документа с ревизиями и 409 — как Go `sync.go`; телефон — свой стор Pinia на своём
 * клиенте; экран — SSR на сторе телефона. Браузерная проверка — на стенде §6.
 */

/** Документ на сервере. Push меняет поля на месте — телефоны держат ссылку на тот же объект. */
export type FakeServer = { rev: number; data: SyncDoc }

export function fakeServer(data: SyncDoc, rev = 1): FakeServer {
  return { rev, data }
}

/** Клиент телефона: чужая ревизия — 409 с документом сервера, как у Go. */
export function backend(server: FakeServer): ApiClient {
  const snapshot = (): HouseholdDocResponse => ({
    household_id: 'h-family',
    rev: server.rev,
    data: JSON.parse(JSON.stringify(server.data)),
    updated_at: new Date().toISOString(),
  })
  return {
    getHouseholdDoc: vi.fn(async () => snapshot()),
    pushHouseholdDoc: vi.fn(async (rev: number, data: SyncDoc) => {
      if (rev !== server.rev) {
        const conflict: ConflictResponse<HouseholdDocResponse> = { error: 'conflict', server_doc: snapshot() }
        throw new ApiError('conflict', 409, conflict)
      }
      server.rev += 1
      server.data = JSON.parse(JSON.stringify(data))
      return snapshot()
    }),
  } as unknown as ApiClient
}

/** Телефон: свой стор, свой клиент; документ уже скачан с сервера. */
export async function phone(server: FakeServer) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useFinanceStore()
  const client = backend(server)
  await store.pullHousehold(client)
  return { store, client, pinia }
}

/**
 * Экран глазами телефона: SSR на его сторе. Маршруты приложения без охранника входа —
 * адрес, параметры и запрос те же, что в браузере. Комментарии SSR вырезаны: текст —
 * как его видит человек. `mixins` — поля и нажатия до рендера (`screenMixin`).
 */
export async function screen(
  pinia: Pinia,
  view: Component,
  path: string,
  props?: Record<string, unknown>,
  mixins: ComponentOptions[] = [],
) {
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const app = createSSRApp(view, props)
  app.use(router)
  for (const m of mixins) app.mixin(m)
  return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

/** «Сейчас» телефона и сервера (фальшивые таймеры включает сам тест). */
export const at = (iso: string) => vi.setSystemTime(new Date(iso))

export const setOnline = (onLine: boolean) => vi.stubGlobal('navigator', { onLine })
