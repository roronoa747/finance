import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * Обновление установленного приложения.
 *
 * Service worker сам по себе только скачивает новую версию и забирает
 * управление — страница при этом продолжает работать на старом коде. В браузере
 * это лечится закрытием вкладки, но приложение с домашнего экрана не закрывают
 * никогда: оно может месяцами показывать сборку годичной давности, а человек
 * будет уверен, что видит свежую.
 *
 * Поэтому перезагружаем сами, когда новый worker забрал управление. Первая
 * установка не в счёт — там перезагружать нечего.
 */
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })

  // Возвращаемся в приложение — проверяем, не вышла ли новая версия.
  const checkForUpdate = () => {
    if (document.visibilityState !== 'visible') return
    void navigator.serviceWorker.getRegistration().then((r) => r?.update())
  }
  document.addEventListener('visibilitychange', checkForUpdate)
  window.addEventListener('focus', checkForUpdate)
}
