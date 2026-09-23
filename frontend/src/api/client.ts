import type {
  AuthResponse,
  MeResponse,
  InviteResponse,
  JoinResponse,
  HouseholdDocResponse,
  PrivateDocResponse,
  ConflictResponse,
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
}

export const apiClient = new ApiClient()
