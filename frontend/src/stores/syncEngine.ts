import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'

/** Как часто ловить правки партнёра, пока приложение открыто. */
export const BACKGROUND_SYNC_MS = 60_000

let started = false

/**
 * Подписки, после которых имеет смысл синхронизироваться, — как `startSyncEngine`
 * в React (`src/store/sync.ts`): вернулись в приложение, появилась сеть, раз в минуту
 * на открытом экране. Без них правка партнёра видна только после собственной правки.
 *
 * Всё отправлено — только забираем документ; иначе — полный цикл со слиянием.
 * Так ревизия не растёт каждую минуту от одного лишь открытого приложения.
 */
export function startSyncEngine(win: Window = window, doc: Document = document): void {
  if (started) return
  started = true

  const auth = useAuthStore()
  const finance = useFinanceStore()
  const signedIn = () => auth.isAuthenticated && !auth.isDemo

  const sync = () => {
    if (!signedIn()) return
    // Только 'idle' значит «локально всё уже на сервере». Правка без сети оставляет
    // 'offline', сбой — 'error': их нужно слить и отправить, а не затереть серверной копией.
    if (finance.status === 'idle') void finance.pullHousehold()
    else void finance.syncHousehold()
  }

  win.addEventListener('online', sync)
  win.addEventListener('offline', () => {
    if (signedIn()) finance.status = 'offline'
  })
  win.addEventListener('focus', sync)
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') sync()
  })
  win.setInterval(() => {
    if (doc.visibilityState === 'visible') sync()
  }, BACKGROUND_SYNC_MS)

  if (signedIn()) {
    // Документ, записанный до RP-04, получает хозяина — семью, в которой вошли.
    if (auth.household) finance.claimFor(auth.household.id)
    // Без сети статус честный сразу, а не «синхронизировано» до первого события.
    if (win.navigator?.onLine === false) finance.status = 'offline'
    // Первый круг всегда полный: неотправленная перед закрытием правка не теряется.
    else void finance.syncHousehold()
  }
}

/** Только для тестов: движок запускается один раз на страницу. */
export function resetSyncEngineForTests(): void {
  started = false
}
