import { watch } from 'vue'
import { useAuthStore } from './auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from './finance'
import { useOperationsStore } from './operations'
import { useFxStore } from './fx'
import { docCurrencies } from '@/lib/finance'

/** Как часто ловить правки партнёра, пока приложение открыто. */
export const BACKGROUND_SYNC_MS = 60_000

let started = false

/** Обход фото желаний движка (B2C-72); до старта движка — ничего. */
let linkPhotosHook: () => void = () => {}

/**
 * Документ семьи только что пришёл с сервера вне круга движка (вход в семью на `Access`) —
 * фото старых желаний со ссылкой ищутся сразу, не дожидаясь следующего синка.
 */
export function afterFamilyLoaded(): void {
  linkPhotosHook()
}

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

  // Личный документ (B2C-05) — тем же кругом: неотправленное досылаем со слиянием, иначе
  // забираем правки со второго устройства (успешный pull снимает и прошлый сбой).
  const syncPrivate = () => {
    if (finance.privateUnsent) void finance.syncPrivate()
    else void finance.pullPrivateDoc()
  }

  /**
   * Фото старых желаний со ссылкой (B2C-72, смоук 2 Б12): ищутся при запуске в фоне, не дожидаясь
   * «Желаний», — один раз на вход, после первого успешного круга (документ семьи с сервера).
   * Следующие синки (фокус, интервал) обход не повторяют; «Желания» зовут свой — дублей нет
   * (`inFlight`, `tried`). Демо, viewer (ручка 403), без сети — не зовётся; выход отменяет.
   * Модуль обхода (сжатие) — отдельным чанком, только когда нужен.
   */
  let photosFor: string | null = null
  let photosStop: AbortController | null = null
  const linkPhotos = () => {
    const token = auth.token
    if (!token || photosFor === token || !signedIn() || auth.isViewer || finance.isDemo) return
    if (finance.status !== 'idle' || win.navigator?.onLine === false) return
    photosFor = token
    const stop = (photosStop = new AbortController())
    void import('@/lib/photos/wishLinkPhotos')
      .then((m) => (stop.signal.aborted ? 0 : m.fillWishPhotos(finance, undefined, stop.signal)))
      .catch(() => {})
  }
  linkPhotosHook = linkPhotos
  watch(
    () => auth.token,
    (token) => {
      if (token) return
      photosStop?.abort()
      photosStop = null
      photosFor = null
    },
  )

  // Книга курсов (B2C-77): валюты документа за 13 месяцев — на входе, тем же кругом синка (новый
  // день) и сразу, как в документе появилась новая валюта. Догружает только недостающие дни.
  const rates = () => {
    if (signedIn()) void useFxStore().ensureDocRates()
  }
  watch(
    () => [auth.token, docCurrencies({ accounts: finance.accounts, people: finance.people }).join()],
    () => rates(),
  )

  const sync = () => {
    if (!signedIn()) return
    rates()
    // Только 'idle' значит «локально всё уже на сервере». Правка без сети оставляет
    // 'offline', сбой — 'error': их нужно слить и отправить, а не затереть серверной копией.
    if (finance.status === 'idle') void finance.pullHousehold().then(linkPhotos)
    else void finance.syncHousehold().then(linkPhotos)
    syncPrivate()
    // Операции выписки, не ушедшие без сети (B2C-07), — тем же кругом.
    const operations = useOperationsStore()
    if (operations.pendingCount) void operations.flush()
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

  // Демо, начатое до RP-05: документ помечается демо и больше не ходит на сервер.
  if (auth.isDemo) finance.claimFor(DEMO_HOUSEHOLD)

  if (signedIn()) {
    // Документ, записанный до RP-04, получает хозяина — семью, в которой вошли.
    if (auth.household) finance.claimFor(auth.household.id)
    // Без сети статус честный сразу, а не «синхронизировано» до первого события.
    if (win.navigator?.onLine === false) finance.status = 'offline'
    // Первый круг всегда полный: неотправленная перед закрытием правка не теряется.
    else {
      void finance.syncHousehold().then(linkPhotos)
      syncPrivate()
    }
    rates()
  }
}

/** Только для тестов: движок запускается один раз на страницу. */
export function resetSyncEngineForTests(): void {
  started = false
  linkPhotosHook = () => {}
}
