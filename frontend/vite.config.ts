/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // Манифест и service worker повторяют React-версию: у участников уже стоит
    // её SW на том же /sw.js со scope '/', и autoUpdate заменяет его этим.
    VitePWA({
      registerType: 'autoUpdate',
      // Иконку уже берёт globPatterns (svg) — без этого она дважды в прекэше.
      includeManifestIcons: false,
      manifest: {
        name: 'Family Finance',
        // Короткое имя подписывает иконку на домашнем экране.
        short_name: 'FF',
        description: 'Семейные финансы на двоих: цели, обязательства и накопления',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        // Холст направления А (DESIGN.md §4): заставка и строка сверху — цвет фона, не бренда (B2C-53).
        background_color: '#F2F2F0',
        theme_color: '#F2F2F0',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Прекэш React-сборки после замены удаляется.
        cleanupOutdatedCaches: true,
        // Маршруты Vue (createWebHistory) офлайн открывают index.html,
        // но API — никогда: его ответы SW не кэширует и не подменяет.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    testTimeout: 30000,
  },
})
