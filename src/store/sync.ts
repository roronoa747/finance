import { supabase, cloudEnabled } from '@/lib/supabase'
import { useStore } from './useStore'
import { mergeDocs, isEmptyDoc } from './merge'
import type { Membership, SyncDoc } from './types'

/**
 * Синхронизация документом.
 *
 * Забираем состояние семьи целиком, сливаем со своим, отправляем обратно
 * вместе с номером версии, которую видели. Если сервер уже новее — он не
 * применяет запись, а возвращает актуальный документ: сливаем ещё раз и
 * повторяем. Так одновременная правка с двух телефонов не теряется.
 *
 * Почему не построчная синхронизация: у пары состояние весит килобайты и
 * правится редко. Курсоры, журнал и надгробия на строку дали бы примерно
 * вдесятеро больше кода без единого выигрыша.
 */

const MAX_ATTEMPTS = 4

type PushResult = { rev: number; data: SyncDoc; conflict: boolean }

let timer: ReturnType<typeof setTimeout> | null = null
let running = false

function s() {
  return useStore.getState()
}

export async function loadMembership(): Promise<Membership[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('my_membership')
  if (error) throw error
  const rows = (data ?? []) as Array<{
    household_id: string; household_name: string; user_id: string
    slot: string; display_name: string; role: string
  }>
  return rows.map((r) => ({
    householdId: r.household_id,
    householdName: r.household_name,
    userId: r.user_id,
    slot: r.slot as Membership['slot'],
    displayName: r.display_name,
    role: r.role as Membership['role'],
  }))
}

/** Полный цикл: забрать, слить, отправить. Безопасно вызывать сколько угодно раз. */
export async function sync(): Promise<void> {
  if (!cloudEnabled || !supabase || running) return
  const { householdId } = s()
  if (!householdId) return

  if (!navigator.onLine) {
    s().setSync({ status: 'offline' })
    return
  }

  running = true
  s().setSync({ status: 'syncing', lastError: null })

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data: pulled, error: pullError } = await supabase.rpc('pull_doc', { hid: householdId })
      if (pullError) throw pullError

      const row = (Array.isArray(pulled) ? pulled[0] : pulled) as
        | { rev: number; data: SyncDoc }
        | undefined

      /*
        Пустой ответ — это не «на сервере ничего нет», а «сервер не отдал нам
        документ»: чаще всего протухла сессия или пользователь больше не
        числится в семье. Если это проглотить, клиент попробует записать с
        нулевой ревизией, получит расхождение и после нескольких кругов
        покажет «не сошлось» — сообщение, по которому невозможно понять причину.
      */
      if (!row || typeof row.rev !== 'number') {
        s().setSync({
          status: 'error',
          lastError: 'Сервер не отдал бюджет. Похоже, сессия устарела — выйдите и войдите снова.',
        })
        return
      }

      const remoteRev = row.rev
      const remoteDoc = row.data ?? null

      const localDoc = s().getDoc()
      /*
        Обычно сливаем. Не сливаем в двух случаях:
        — на сервере пусто, это первый выход в облако;
        — идёт сброс, и локальная пустота должна ЗАМЕНИТЬ облачную копию,
          иначе слияние добросовестно вернёт всё, что мы только что стёрли.
      */
      const replace = s().forceReplace || isEmptyDoc(remoteDoc)
      const merged = replace ? localDoc : mergeDocs(localDoc, remoteDoc as SyncDoc)

      s().applyDoc(merged, remoteRev)

      const { data: pushed, error: pushError } = await supabase.rpc('push_doc', {
        hid: householdId,
        expected_rev: remoteRev,
        new_data: merged,
      })
      if (pushError) throw pushError

      const result = (Array.isArray(pushed) ? pushed[0] : pushed) as PushResult | undefined
      if (!result) throw new Error('Сервер не вернул результат записи')

      if (!result.conflict) {
        s().applyDoc(result.data ?? merged, result.rev)
        s().setSync({
          status: 'idle',
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
          // Замена состоялась — дальше работаем обычным слиянием.
          forceReplace: false,
        })
        return
      }

      // Кто-то записал между нашим чтением и записью — сливаем с новым и пробуем снова.
      const remerged = mergeDocs(s().getDoc(), result.data)
      s().applyDoc(remerged, result.rev)
    }

    // Четыре круга подряд не сошлись — это уже не гонка, а что-то другое.
    s().setSync({ status: 'conflict', lastError: 'Не удалось согласовать версии' })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    s().setSync({ status: 'error', lastError: message })
  } finally {
    running = false
  }
}

/** Правки идут пачками — ждём паузы, а не дёргаем сервер на каждый символ. */
export function scheduleSync(delay = 1500) {
  if (!cloudEnabled) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void sync()
  }, delay)
}

let started = false

/** Подписки на всё, после чего имеет смысл синхронизироваться. */
export function startSyncEngine() {
  if (started || !cloudEnabled) return
  started = true

  useStore.subscribe((state, prev) => {
    if (state.status === 'dirty' && prev.status !== 'dirty') scheduleSync()
  })

  window.addEventListener('online', () => void sync())
  window.addEventListener('offline', () => s().setSync({ status: 'offline' }))
  window.addEventListener('focus', () => void sync())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync()
  })

  // Редкий фоновый круг: ловит правки партнёра, когда приложение просто открыто.
  setInterval(() => {
    if (document.visibilityState === 'visible') void sync()
  }, 60_000)
}

export async function createHousehold(name: string, displayName: string): Promise<string> {
  if (!supabase) throw new Error('Облако не подключено')
  const { data, error } = await supabase.rpc('create_household', {
    p_name: name,
    p_display_name: displayName,
  })
  if (error) throw error
  return data as string
}

export async function joinHousehold(code: string, displayName: string): Promise<string> {
  if (!supabase) throw new Error('Облако не подключено')
  const { data, error } = await supabase.rpc('join_household', {
    p_code: code,
    p_display_name: displayName,
  })
  if (error) throw error
  return data as string
}

export async function createInvite(householdId: string): Promise<string> {
  if (!supabase) throw new Error('Облако не подключено')
  const { data, error } = await supabase.rpc('create_invite', { hid: householdId })
  if (error) throw error
  return data as string
}
