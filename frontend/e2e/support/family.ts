import { vi } from 'vitest'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import type { Component, ComponentOptions } from 'vue'
import { useFinanceStore } from '../../src/stores/finance'
import { renderScreen, screenMixin } from '../../src/test/screenState'
import { ApiClient, ApiError } from '../../src/api/client'
import type { SyncDoc } from '../../src/types/finance'
import type { HouseholdDocResponse, ConflictResponse, OperationWire, StatementUploadResponse } from '../../src/types/api'

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

/**
 * Фейк личных документов и фото (B2C-18): личный документ — свой у каждого пользователя
 * (`sync.go` private), фото — семьи, скрытое отдаёт только автору, чужое скрытое — 404
 * (`handlers/photos.go`). Один на семью; телефон получает свои методы через `privateFor`.
 */
export type FakePrivate = {
  docs: Map<string, { rev: number; data: Record<string, unknown> }>
  photos: Map<string, { user: string; hidden: boolean; bytes: ArrayBuffer; type: string }>
}

export function fakePrivate(): FakePrivate {
  return { docs: new Map(), photos: new Map() }
}

export function privateFor(pv: FakePrivate, user: string) {
  const own = () => pv.docs.get(user) ?? { rev: 0, data: {} }
  const snapshot = () => ({ household_id: 'h-family', user_id: user, rev: own().rev, data: JSON.parse(JSON.stringify(own().data)), updated_at: new Date().toISOString() })
  return {
    getPrivateDoc: vi.fn(async () => snapshot()),
    pushPrivateDoc: vi.fn(async (rev: number, data: Record<string, unknown>) => {
      if (rev !== own().rev) throw new ApiError('conflict', 409, { error: 'conflict', server_doc: snapshot() })
      pv.docs.set(user, { rev: rev + 1, data: JSON.parse(JSON.stringify(data)) })
      return snapshot()
    }),
    uploadPhoto: vi.fn(async (blob: Blob, hidden = false) => {
      const id = `00000000-0000-4000-8000-${String(pv.photos.size + 1).padStart(12, '0')}`
      pv.photos.set(id, { user, hidden, bytes: await blob.arrayBuffer(), type: blob.type })
      return { id }
    }),
    getPhoto: vi.fn(async (id: string) => {
      const p = pv.photos.get(id)
      if (!p || (p.hidden && p.user !== user)) return null
      return new Blob([p.bytes], { type: p.type })
    }),
    deletePhoto: vi.fn(async (id: string) => {
      const p = pv.photos.get(id)
      if (!p || (p.hidden && p.user !== user)) throw new ApiError('not found', 404)
      pv.photos.delete(id)
    }),
  }
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

/** Экран глазами телефона: SSR на его сторе (`renderScreen`). */
export async function screen(
  pinia: Pinia,
  view: Component,
  path: string,
  props?: Record<string, unknown>,
  mixins: ComponentOptions[] = [],
) {
  setActivePinia(pinia)
  return renderScreen(view, path, props, mixins)
}

/** «Сейчас» телефона и сервера (фальшивые таймеры включает сам тест). */
/** Нажатие «Оплатил» в листе платежа «Месяца» (`MonthPlan.pay`, Блок 15, Р-94): счёт прошлой оплаты — отметка сразу, иначе лист. */
export const tapPay = (targetId: string) =>
  screenMixin({}, (s) => (s.pay as (d: unknown) => void)((s.plan as { dues: { targetId: string }[] }).dues.find((d) => d.targetId === targetId)))

export const at = (iso: string) => vi.setSystemTime(new Date(iso))

export const setOnline = (onLine: boolean) => vi.stubGlobal('navigator', { onLine })

/**
 * Фейк ручек выписок (B2C-06): записи загрузок — общие для семьи, операции — по владельцу,
 * как `handlers/statements.go`. Один на семью; телефон получает свои методы через `statementsFor`.
 */
export type FakeStatements = {
  uploads: (StatementUploadResponse & { user: string })[]
  ops: Map<string, Map<string, OperationWire>>
}

export function fakeStatements(): FakeStatements {
  return { uploads: [], ops: new Map() }
}

export function statementsFor(st: FakeStatements, user: string, slot: 'a' | 'b') {
  return {
    createStatementUpload: vi.fn(async (u: { bank: string; period_from: string; period_to: string; ops_count: number }) => {
      const record = { id: `00000000-0000-4000-8000-${String(st.uploads.length + 1).padStart(12, '0')}`, slot, ...u, created_at: new Date().toISOString() }
      st.uploads.unshift({ ...record, user })
      return record
    }),
    listStatementUploads: vi.fn(async () => ({ uploads: st.uploads.map(({ user: _user, ...u }) => u) })),
    upsertOperations: vi.fn(async (ops: OperationWire[]) => {
      const mine = st.ops.get(user) ?? new Map<string, OperationWire>()
      for (const o of ops) mine.set(o.id, JSON.parse(JSON.stringify(o)))
      st.ops.set(user, mine)
      return { upserted: ops.length }
    }),
    listOperations: vi.fn(async () => ({ operations: [...(st.ops.get(user)?.values() ?? [])], next: null })),
  }
}
