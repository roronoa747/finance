<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'

withDefaults(
  defineProps<{
    label: string
    warning: string
    confirmLabel?: string
  }>(),
  {
    confirmLabel: 'Удалить',
  },
)

const emit = defineEmits<{
  (e: 'confirm'): void
}>()

const confirm = ref(false)
</script>

<template>
  <div class="mt-1 border-t border-line pt-3">
    <div v-if="confirm" class="rounded-xl border border-destructive-line bg-destructive-soft p-3">
      <div class="mb-2 flex gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          stroke="currentColor"
          stroke-width="1.9"
          stroke-linecap="round"
          class="mt-px shrink-0 text-destructive"
        >
          <path d="M12 3.5 1.8 20.5h20.4L12 3.5ZM12 10v4M12 17.5h.01" />
        </svg>
        <p class="text-[12.5px] leading-relaxed text-ink-2">{{ warning }}</p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1 bg-surface" @click="confirm = false">
          Отмена
        </Button>
        <Button
          class="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
      </div>
    </div>
    <button
      v-else
      type="button"
      class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-destructive-line bg-destructive-soft px-4 py-2.5 text-[13px] font-medium text-destructive active:translate-y-px cursor-pointer"
      @click="confirm = true"
    >
      {{ label }}
    </button>
  </div>
</template>
