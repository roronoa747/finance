<script setup lang="ts">
import { ref, onMounted } from 'vue'

const healthStatus = ref<'checking' | 'ok' | 'error'>('checking')
const healthResponse = ref<string>('')

async function checkHealth() {
  healthStatus.value = 'checking'
  try {
    const res = await fetch('/api/health')
    if (res.ok) {
      const data = await res.json()
      healthStatus.value = 'ok'
      healthResponse.value = JSON.stringify(data)
    } else {
      healthStatus.value = 'error'
      healthResponse.value = `HTTP ${res.status} ${res.statusText}`
    }
  } catch (err) {
    healthStatus.value = 'error'
    healthResponse.value = String(err)
  }
}

onMounted(() => {
  checkHealth()
})
</script>

<template>
  <main class="min-h-screen bg-canvas text-ink p-6 flex flex-col items-center justify-center">
    <div class="max-w-md w-full bg-surface border border-line rounded-2xl p-6 shadow-card space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-semibold text-ink font-display">Семейный бюджет</h1>
        <span class="text-xs px-2.5 py-1 rounded-full font-medium bg-brand-soft text-brand">Vue 3 + Go</span>
      </div>

      <p class="text-sm text-ink-2">
        Скелет клиентского приложения инициализирован. Стек: Vue 3 (Composition API), Vite, Tailwind CSS 4, Pinia.
      </p>

      <div class="p-3.5 rounded-xl border border-line bg-surface-2 space-y-2">
        <div class="flex items-center justify-between text-xs font-medium">
          <span class="text-ink-3">Проксирование API (/api/health):</span>
          <span
            :class="{
              'text-brand': healthStatus === 'ok',
              'text-destructive': healthStatus === 'error',
              'text-warn': healthStatus === 'checking',
            }"
          >
            {{ healthStatus === 'ok' ? 'Подключено' : healthStatus === 'error' ? 'Ошибка соединения' : 'Проверка...' }}
          </span>
        </div>
        <div v-if="healthResponse" class="text-xs font-mono text-ink-3 break-all">
          {{ healthResponse }}
        </div>
      </div>

      <div class="pt-2 flex justify-end">
        <button
          @click="checkHealth"
          class="px-4 py-2 bg-brand text-brand-ink rounded-xl text-sm font-medium hover:opacity-90 transition active:scale-[0.98]"
        >
          Проверить бэкенд
        </button>
      </div>
    </div>
  </main>
</template>
