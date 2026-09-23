<script setup lang="ts">
import { ref, computed } from 'vue'
import { PhArrowsClockwise, PhCheck, PhCloudSlash, PhWarning, PhX } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import Button from '@/components/ui/Button.vue'

const financeStore = useFinanceStore()
const authStore = useAuthStore()

const open = ref(false)
const syncing = ref(false)

const status = computed(() => financeStore.status)
const lastSyncedAt = computed(() => financeStore.lastSyncedAt)
const lastError = computed(() => financeStore.lastError)

const isBad = computed(() => status.value === 'error' || status.value === 'conflict')

const label = computed(() => {
  switch (status.value) {
    case 'syncing':
      return 'синхронизация'
    case 'dirty':
      return 'ждёт отправки'
    case 'offline':
      return 'нет сети'
    case 'conflict':
    case 'error':
      return 'не сошлось'
    case 'idle':
    default:
      return 'синхронизировано'
  }
})

async function triggerManualSync() {
  syncing.value = true
  try {
    await financeStore.syncHousehold()
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      :class="[
        'flex items-center gap-1.5 text-[12px] font-medium transition-colors cursor-pointer',
        isBad ? 'text-warn' : status === 'idle' ? 'text-ink-3 hover:text-ink-2' : 'text-brand',
      ]"
      :title="lastError || label"
      @click="open = true"
    >
      <PhArrowsClockwise v-if="status === 'syncing'" :size="13" class="animate-spin" />
      <PhWarning v-else-if="isBad" :size="13" />
      <PhCloudSlash v-else-if="status === 'offline'" :size="13" />
      <PhArrowsClockwise v-else-if="status === 'dirty'" :size="13" />
      <PhCheck v-else :size="13" />
      <span>{{ label }}</span>
    </button>

    <!-- Modal / Drawer -->
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-xs transition-opacity"
      @click.self="open = false"
    >
      <div
        class="w-full max-w-[440px] rounded-t-3xl border border-line bg-surface p-5 pb-8 shadow-2xl text-left"
      >
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Синхронизация</h3>
          <button
            type="button"
            class="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="open = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <div class="flex flex-col gap-3">
          <div class="rounded-xl border border-line bg-surface-2 p-3.5 text-[13.5px]">
            <div class="flex items-center justify-between">
              <span class="text-ink-2">Состояние</span>
              <b :class="['font-semibold', isBad ? 'text-warn' : 'text-ink']">{{ label }}</b>
            </div>
            <div
              v-if="lastSyncedAt"
              class="mt-2 flex items-center justify-between text-[12.5px] text-ink-3"
            >
              <span>Последний обмен</span>
              <span class="num">{{ new Date(lastSyncedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</span>
            </div>
            <div
              v-if="lastError"
              class="mt-2 rounded-lg border border-warn-line bg-warn-soft p-2.5 text-[12px] text-ink-2"
            >
              {{ lastError }}
            </div>
          </div>

          <div
            v-if="authStore.household"
            class="rounded-xl border border-line bg-surface p-3.5 text-[13px]"
          >
            <div class="text-ink-3">Семья</div>
            <div class="mt-0.5 font-semibold text-ink">{{ authStore.household.name }}</div>
          </div>

          <Button
            class="w-full mt-2"
            :disabled="syncing || status === 'syncing'"
            @click="triggerManualSync"
          >
            {{ syncing ? 'Синхронизируем…' : 'Синхронизировать сейчас' }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
