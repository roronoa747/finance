/**
 * PWA переходит на новую версию сама (Б-20, перенос React `main.tsx`).
 *
 * Плагин собирает SW с `skipWaiting` + `clientsClaim`: новая версия берёт
 * управление сразу, но уже открытая страница продолжает жить со старым JS, пока
 * её не перезагрузят. Поэтому на смену контроллера перезагружаемся сами, а при
 * возврате в приложение просим SW проверить, не вышла ли новая версия.
 *
 * Зависимости — параметрами: так логику можно проверить фейками в Node.
 */

type Listen = (type: string, fn: () => void) => void

export type PwaDeps = {
  sw: {
    controller: unknown
    addEventListener: Listen
    removeEventListener: Listen
    getRegistration(): Promise<{ update(): Promise<unknown> } | undefined>
  }
  doc: { visibilityState: string; addEventListener: Listen; removeEventListener: Listen }
  win: { location: { reload(): void }; addEventListener: Listen; removeEventListener: Listen }
}

/** Подписывается на смену версии; возвращает отписку. */
export function watchServiceWorkerUpdates({ sw, doc, win }: PwaDeps): () => void {
  // При первой установке контроллера не было: SW берёт управление впервые,
  // страница уже свежая — перезагрузка только мигнула бы экраном.
  const hadController = Boolean(sw.controller)
  // Смена контроллера может прийти дважды — перезагружаемся один раз.
  let reloading = false

  const onControllerChange = () => {
    if (!hadController || reloading) return
    reloading = true
    win.location.reload()
  }

  // Возвращаемся в приложение — проверяем, не вышла ли новая версия. Офлайн
  // проверка падает — это не ошибка приложения, проверим в следующий раз.
  const checkForUpdate = () => {
    if (doc.visibilityState !== 'visible') return
    sw.getRegistration()
      .then((r) => r?.update())
      .catch(() => {})
  }

  sw.addEventListener('controllerchange', onControllerChange)
  doc.addEventListener('visibilitychange', checkForUpdate)
  win.addEventListener('focus', checkForUpdate)

  return () => {
    sw.removeEventListener('controllerchange', onControllerChange)
    doc.removeEventListener('visibilitychange', checkForUpdate)
    win.removeEventListener('focus', checkForUpdate)
  }
}
