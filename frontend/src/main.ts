import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import './style.css'
import App from './App.vue'
import { startSyncEngine } from './stores/syncEngine'
import { watchServiceWorkerUpdates } from './lib/pwa'
import { applyCurrentPalette, watchSystemTheme } from './lib/theme'
import { apiClient } from './api/client'
import { useAuthStore } from './stores/auth'

// Тема — до монтирования: на /access и /start тоже, без вспышки светлой.
applyCurrentPalette()
watchSystemTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')

// 401 любой ручки (B2C-25): вход больше не действует — выход без стирания документа и экран входа.
apiClient.onUnauthorized = () => {
  if (useAuthStore(pinia).expire()) void router.replace({ path: '/access', query: { expired: '1' } })
}
startSyncEngine()

// Новая версия PWA подхватывается сама: перезагрузка на смене SW (Б-20).
if ('serviceWorker' in navigator) {
  watchServiceWorkerUpdates({ sw: navigator.serviceWorker, doc: document, win: window })
}
