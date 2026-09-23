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
