import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

/**
 * Приложение обязано работать и без облака: пока проект не подключён,
 * это просто локальный кошелёк на одном устройстве. Поэтому клиент
 * необязательный, а не падение на старте.
 */
export const cloudEnabled = Boolean(url && key)

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null
