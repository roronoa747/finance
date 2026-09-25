import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import './style.css'
import App from './App.vue'
import { startSyncEngine } from './stores/syncEngine'
import { watchServiceWorkerUpdates } from './lib/pwa'
import { applyCurrentPalette, watchSystemTheme } from './lib/theme'

// Тема — до монтирования: на /access и /setup тоже, без вспышки светлой.
applyCurrentPalette()
watchSystemTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')
startSyncEngine()

// Новая версия PWA подхватывается сама: перезагрузка на смене SW (Б-20).
if ('serviceWorker' in navigator) {
  watchServiceWorkerUpdates({ sw: navigator.serviceWorker, doc: document, win: window })
}
