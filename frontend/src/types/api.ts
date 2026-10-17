import type { SyncDoc } from './finance'

export interface User {
  id: string
  email: string
  /** Имя из Google (B2C-22); у старых пользователей с паролем — нет. */
  display_name?: string
  created_at: string
}

export interface Household {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  slot: 'a' | 'b' | 'c'
  display_name: string
  role: 'member' | 'viewer'
  joined_at: string
}

/** Вход (B2C-22): у пользователя без семьи `household` и `member` — null, дальше — «с кем». */
export interface AuthResponse {
  token: string
  user: User
  household: Household | null
  member: HouseholdMember | null
}

export interface MeResponse {
  user: User
  household: Household | null
  member: HouseholdMember | null
  /** Почта в `ADMIN_EMAILS` (B2C-28) — пункт «Цифры» в настройках. */
  admin?: boolean
  /** ИИ у семьи (бэклог «ИИ», Р-7): ключ на сервере задан и владелец включил ИИ семье. */
  ai?: boolean
}

/** Ответ `POST /api/ai/review` (бэклог «ИИ», AI-08): что хорошо, где риск, 2–3 шага; экран — из белого списка или null. */
export interface AiReviewAnswer {
  good: string
  risk: string
  steps: { text: string; screen: string | null }[]
}

/** Ответ `POST /api/ai/sellers` (AI-11): по названию — id раздела из присланных или null; порядок — как ушло. */
export interface AiSellersAnswer {
  items: { name: string; categoryId: string | null }[]
}

/** Участник семьи из `GET /api/household/members` (B2C-23): без почты и id. */
export interface MemberView {
  slot: 'a' | 'b' | 'c'
  display_name: string
  role: 'member' | 'viewer'
  joined_at: string
}

export interface InviteResponse {
  code: string
  expires_at: string
}

export interface JoinResponse {
  token: string
  member: HouseholdMember
}

export interface HouseholdDocResponse {
  household_id: string
  rev: number
  data: SyncDoc
  updated_at: string
  updated_by?: string
}

export interface PrivateDocResponse {
  household_id: string
  user_id: string
  rev: number
  data: Record<string, unknown>
  updated_at: string
}

export interface ConflictResponse<T = HouseholdDocResponse | PrivateDocResponse> {
  error: string
  server_doc: T
}

/** Запись загрузки выписки (B2C-06): видна семье. */
export interface StatementUploadResponse {
  id: string
  slot: 'a' | 'b' | 'c' | ''
  bank: string
  period_from: string
  period_to: string
  ops_count: number
  created_at: string
}

/** Операция на проводе (B2C-06) — личная, только своя. */
export interface OperationWire {
  id: string
  bank: string
  date: string
  amount: number
  kind: string
  merchant: string
  counterparty?: string | null
  note?: string | null
  category_id: string | null
  internal: boolean
  upload_id?: string | null
  updated_at?: string
}

export interface OperationsPage {
  operations: OperationWire[]
  next: string | null
}

/** Семья в админке ИИ (бэклог «ИИ», AI-03): почты участников по slot, флаг, расход за месяц Алматы. */
export interface AdminFamily {
  id: string
  created_at: string
  emails: string[]
  ai: boolean
  month: string
  requests: number
  /** Расход ≈ $ целыми микродолларами. */
  cost_micros: number
}

/**
 * Ответ `GET /api/admin/families`: `limit_micros` — лимит ИИ на семью в месяц микродолларами (одно значение на все
 * семьи, бэклог «ИИ-польза» Р-11), `key` — ключ Claude задан.
 */
export interface AdminFamilies {
  families: AdminFamily[]
  limit_micros: number
  key: boolean
}

/** Ответ `POST /api/admin/ai-check`. */
export type AiCheck =
  | { ok: true; model: string; ms: number }
  | { ok: false; reason: 'no_key' | 'failed' | 'rate_limited' | 'refused' }
