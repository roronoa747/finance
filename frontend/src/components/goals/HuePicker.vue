<script setup lang="ts">
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'

/**
 * Ряд образцов оттенков, выбранный — `aria-pressed`: «Цвет» цели в окнах создания
 * (`Goals.vue`) и правки (`GoalSheet`), «Цвета разделов» в «Оформлении» (подпись — имя раздела).
 */
withDefaults(defineProps<{ modelValue: HueKey; label?: string }>(), { label: 'Цвет' })

const emit = defineEmits<{
  (e: 'update:modelValue', val: HueKey): void
}>()
</script>

<template>
  <Field :label="label" group>
    <div class="flex flex-wrap gap-2 mb-3">
      <button
        v-for="h in HUE_KEYS"
        :key="h"
        type="button"
        :aria-label="HUES[h].label"
        :aria-pressed="modelValue === h"
        :class="cn('size-[28px] rounded-[9px] border-2 cursor-pointer transition-transform', modelValue === h ? 'border-ink scale-110' : 'border-transparent')"
        :style="{ background: HUES[h].light }"
        @click="emit('update:modelValue', h)"
      />
    </div>
  </Field>
</template>
