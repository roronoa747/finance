import type { SyncDoc } from './finance'

export interface User {
  id: string
  email: string
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

export interface AuthResponse {
  token: string
  user: User
  household: Household
  member: HouseholdMember
}

export interface MeResponse {
  user: User
  household: Household
  member: HouseholdMember
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
