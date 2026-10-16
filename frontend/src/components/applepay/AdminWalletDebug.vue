<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiClient } from '@/api/client'
import { atLabel } from '@/lib/dates'
import Card from '@/components/kit/Card.vue'

/**
 * Последнее касание Apple Pay, которое сервер разбирал из текста (Р-13а), — только своё и только админу, сутки: по нему
 * подстраивается разбор формата команды. Нет такого — карточки нет.
 */
const debug = ref<{ body: string; at: string } | null>(null)

onMounted(async () => {
  try {
    const d = await apiClient.adminWalletDebug()
    if (d.body && d.at) debug.value = { body: d.body, at: d.at }
  } catch {
    // не админ или сбой — карточки нет
  }
})

const time = (iso: string) => `${atLabel(iso)}, ${new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' })}`
</script>

<template>
  <Card v-if="debug" data-wallet-debug>
    <!-- Не «нераспознанное»: сервер хранит тело и когда нашёл сумму в тексте (отклонение 4 исполнителя). -->
    <h2 class="type-h3 text-ink">Последнее касание</h2>
    <p class="type-meta mt-1">{{ time(debug.at) }}</p>
    <pre class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-[12px] bg-surface-2 p-3 text-[12.5px] text-ink">{{ debug.body }}</pre>
  </Card>
</template>
