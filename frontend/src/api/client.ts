import type {
  AuthResponse,
  MeResponse,
  InviteResponse,
  JoinResponse,
  HouseholdDocResponse,
  PrivateDocResponse,
  ConflictResponse,
  StatementUploadResponse,
  OperationWire,
  OperationsPage,
} from '@/types/api'
import type { SyncDoc } from '@/types/finance'

export class ApiError<T = unknown> extends Error {
  status: number
  data?: T
  isConflict: boolean

  constructor(message: string, status: number, data?: T) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.isConflict = status === 409
  }
}

/** Почему фото по ссылке не вышло (B2C-65): код ответа ручки; `offline` — до сервера не дошли. */
export type LinkPreviewReason = 'bad url' | 'blocked' | 'no image' | 'too large' | 'timeout' | 'unavailable' | 'offline'
const LINK_REASONS: LinkPreviewReason[] = ['bad url', 'blocked', 'no image', 'too large', 'timeout', 'unavailable']

export class LinkPreviewError extends Error {
  reason: LinkPreviewReason

  constructor(reason: LinkPreviewReason) {
    super(reason)
    this.name = 'LinkPreviewError'
    this.reason = reason
  }
}

/** base64 из JSON → байты картинки нужного типа. */
export function base64Blob(base64: string, type: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

export interface ApiClientConfig {
  baseUrl?: string
  getToken?: () => string | null
  fetchFn?: typeof fetch
}

export class ApiClient {
  private baseUrl: string
  private getToken: () => string | null
  private fetchFn: typeof fetch

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? '/api'
    this.getToken =
      config.getToken ??
      (() => (typeof localStorage !== 'undefined' ? localStorage.getItem('ff_auth_token') : null))
    this.fetchFn = config.fetchFn ?? ((...args) => fetch(...args))
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers = new Headers(options.headers || {})

    if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
      headers.set('Content-Type', 'application/json')
    }

    const token = this.getToken()
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const res = await this.fetchFn(url, {
      ...options,
      headers,
    })

    const contentType = res.headers.get('Content-Type') || ''
    const isJson = contentType.includes('application/json')
    const body = isJson ? await res.json().catch(() => null) : await res.text().catch(() => null)

    if (!res.ok) {
      const errMsg =
        body && typeof body === 'object' && 'error' in body
          ? (body as { error: string }).error
          : `HTTP error ${res.status} ${res.statusText}`
      throw new ApiError(errMsg, res.status, body)
    }

    return body as T
  }

  // Auth endpoints
  async register(data: {
    email: string
    password: string
    display_name: string
    household_name: string
  }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async login(data: { email: string; password: string }): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async me(): Promise<MeResponse> {
    return this.request<MeResponse>('/auth/me', {
      method: 'GET',
    })
  }

  // Household endpoints
  async createInvite(): Promise<InviteResponse> {
    return this.request<InviteResponse>('/household/invites', {
      method: 'POST',
    })
  }

  async joinHousehold(data: { code: string; display_name: string }): Promise<JoinResponse> {
    return this.request<JoinResponse>('/household/join', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  // Sync endpoints
  async getHouseholdDoc(): Promise<HouseholdDocResponse> {
    return this.request<HouseholdDocResponse>('/sync/household', {
      method: 'GET',
    })
  }

  async pushHouseholdDoc(lastSeenRev: number, data: SyncDoc): Promise<HouseholdDocResponse> {
    try {
      return await this.request<HouseholdDocResponse>('/sync/household', {
        method: 'POST',
        body: JSON.stringify({
          last_seen_rev: lastSeenRev,
          data,
        }),
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Re-throw typed conflict error with server_doc
        throw err as ApiError<ConflictResponse<HouseholdDocResponse>>
      }
      throw err
    }
  }

  async getPrivateDoc(): Promise<PrivateDocResponse> {
    return this.request<PrivateDocResponse>('/sync/private', {
      method: 'GET',
    })
  }

  async pushPrivateDoc(
    lastSeenRev: number,
    data: Record<string, unknown>,
  ): Promise<PrivateDocResponse> {
    try {
      return await this.request<PrivateDocResponse>('/sync/private', {
        method: 'POST',
        body: JSON.stringify({
          last_seen_rev: lastSeenRev,
          data,
        }),
      })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        throw err as ApiError<ConflictResponse<PrivateDocResponse>>
      }
      throw err
    }
  }

  // Выписки (B2C-06): файл на сервер не уходит — только разобранные операции.
  async createStatementUpload(data: {
    bank: string
    period_from: string
    period_to: string
    ops_count: number
  }): Promise<StatementUploadResponse> {
    return this.request<StatementUploadResponse>('/statements', { method: 'POST', body: JSON.stringify(data) })
  }

  async listStatementUploads(): Promise<{ uploads: StatementUploadResponse[] }> {
    return this.request<{ uploads: StatementUploadResponse[] }>('/statements', { method: 'GET' })
  }

  async upsertOperations(operations: OperationWire[]): Promise<{ upserted: number }> {
    return this.request<{ upserted: number }>('/operations/batch', {
      method: 'POST',
      body: JSON.stringify({ operations }),
    })
  }

  async listOperations(since: string | null, limit: number): Promise<OperationsPage> {
    const q = new URLSearchParams({ limit: String(limit) })
    if (since) q.set('since', since)
    return this.request<OperationsPage>(`/operations?${q}`, { method: 'GET' })
  }

  // Фото целей и желаний (B2C-16/17): байты — телом запроса, тип — заголовком.
  async uploadPhoto(blob: Blob, hidden = false): Promise<{ id: string }> {
    return this.request<{ id: string }>(`/photos${hidden ? '?hidden=1' : ''}`, {
      method: 'POST',
      body: blob,
      headers: { 'Content-Type': blob.type || 'image/webp' },
    })
  }

  /** Байты фото; null — нет такого (404: чужое, скрытое или удалено). */
  async getPhoto(id: string): Promise<Blob | null> {
    const headers = new Headers()
    const token = this.getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const res = await this.fetchFn(`${this.baseUrl}/photos/${encodeURIComponent(id)}`, { method: 'GET', headers })
    if (res.status === 404) return null
    if (!res.ok) throw new ApiError(`HTTP error ${res.status} ${res.statusText}`, res.status)
    return res.blob()
  }

  async deletePhoto(id: string): Promise<void> {
    await this.request<unknown>(`/photos/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  /** Фото и название со страницы товара (B2C-65, Р-60): цену не берём; отказ — `LinkPreviewError`. */
  async linkPreview(url: string): Promise<{ title: string; blob: Blob }> {
    let res: { title: string; imageType: string; image: string }
    try {
      res = await this.request('/photos/preview', { method: 'POST', body: JSON.stringify({ url }) })
    } catch (e) {
      if (!(e instanceof ApiError)) throw new LinkPreviewError('offline')
      throw new LinkPreviewError(LINK_REASONS.find((r) => r === e.message) ?? 'unavailable')
    }
    return { title: res.title, blob: base64Blob(res.image, res.imageType) }
  }
}

export const apiClient = new ApiClient()
