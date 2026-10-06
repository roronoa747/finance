<script setup lang="ts">
import { inject } from 'vue'

/**
 * Тост (макет week-month.html `.toast`): тёмная плашка над капсулой вкладок — короткая фраза и не больше одного
 * тихого действия («Отменить»). Внутри `AppShell` встаёт в его слот `#shell-toast`; без оболочки (тесты экрана) —
 * на месте. Сколько висит и что делает действие — решает родитель.
 */
defineProps<{ action?: string }>()
const emit = defineEmits<{ (e: 'action'): void }>()
const inShell = inject<boolean>('ff-shell-actions', false)
</script>

<template>
  <Teleport defer to="#shell-toast" :disabled="!inShell">
    <div class="fx-in flex items-center justify-between gap-3 rounded-[16px] bg-ink px-4 py-[13px] text-[14.5px] font-semibold text-canvas shadow-lift" role="status" data-toast>
      <span class="min-w-0 flex-1 num"><slot /></span>
      <button v-if="action" type="button" class="press shrink-0 cursor-pointer font-bold text-brand-soft" data-toast-action @click="emit('action')">{{ action }}</button>
    </div>
  </Teleport>
</template>
