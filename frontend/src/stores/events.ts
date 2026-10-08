import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiClient, ApiError, type ApiClient } from '@/api/client'
import { EVENTS_QUEUE_KEY, readStorage, writeStorage } from '@/lib/storage'
import { todayIso } from '@/lib/dates'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'

/** Виды событий удержания (B2C-28, Р-27) — те же, что в CHECK `app.events`; `push_open` — Блок 5. */
export type EventKind = 'app_open' | 'week_done' | 'first_run_goal' | 'first_run_done' | 'push_open'

type Queued = { kind: EventKind; at: string }

/** Очередь не растёт без конца на телефоне без сети: старые вытесняются. */
const MAX_QUEUE = 50

/**
 * События удержания (B2C-28, Р-16): `track(kind)` кладёт событие в очередь на устройстве и
 * отправляет, когда есть сеть и вход; в демо — ничего. Сервер принимает только вид и время;
 * `app_open` он и сам считает раз в день, а очередь не пишет его чаще раза в день Алматы.
 */
export const useEventsStore = defineStore('events', () => {
  const queue = ref<Queued[]>(readStorage<Queued[]>(EVENTS_QUEUE_KEY, []))
  // День последнего app_open на этом устройстве — повторы дня в очередь не идут.
  let openedOn = ''
  let flushing: Promise<void> | null = null

  const signedIn = () => {
    const auth = useAuthStore()
    return auth.isAuthenticated && !auth.isDemo && !useFinanceStore().isDemo
  }

  function track(kind: EventKind, client: ApiClient = apiClient) {
    if (!signedIn()) return
    if (kind === 'app_open') {
      if (openedOn === todayIso()) return
      openedOn = todayIso()
    }
    queue.value = [...queue.value, { kind, at: new Date().toISOString() }].slice(-MAX_QUEUE)
    writeStorage(EVENTS_QUEUE_KEY, queue.value)
    void flush(client)
  }

  /** Досылает очередь по одному; нет сети — ждёт следующего раза, отказ сервера (4xx) — событие выбрасывается. */
  function flush(client: ApiClient = apiClient): Promise<void> {
    if (flushing) return flushing
    flushing = (async () => {
      while (queue.value.length && signedIn()) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break
        const [next] = queue.value
        try {
          await client.sendEvent(next.kind, next.at)
        } catch (e) {
          // 401 уже увёл на вход; 5xx и сеть — позже; 4xx — событие не примут и потом.
          if (!(e instanceof ApiError) || e.status >= 500 || e.status === 401) break
        }
        queue.value = queue.value.slice(1)
        writeStorage(EVENTS_QUEUE_KEY, queue.value)
      }
    })().finally(() => {
      flushing = null
    })
    return flushing
  }

  return { queue, track, flush }
})
