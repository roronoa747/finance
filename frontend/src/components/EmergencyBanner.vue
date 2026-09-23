<script setup lang="ts">
import { computed } from 'vue'
import { PhShieldCheck, PhShieldWarning } from '@phosphor-icons/vue'
import { money } from '@/lib/money'

const props = withDefaults(
  defineProps<{
    months: number
    cash: number
    monthlyMandatory: number
  }>(),
  {
    months: 0,
    cash: 0,
    monthlyMandatory: 0,
  },
)

const tone = computed<'good' | 'warn' | 'neutral'>(() => {
  if (props.monthlyMandatory <= 0) return 'neutral'
  if (props.months >= 3) return 'good'
  return 'warn'
})

const label = computed(() => {
  if (props.monthlyMandatory <= 0) return 'Подушка безопасности'
  if (props.months >= 3) return `Подушка ${props.months} мес. — надёжный запас`
  if (props.months >= 1) return `Подушка ${props.months} мес. — цель 3–6 мес.`
  return `Подушка ${props.months} мес. — меньше месяца`
})

const targetThreeMonths = computed(() => props.monthlyMandatory * 3)
const progress = computed(() => {
  if (targetThreeMonths.value <= 0) return 0
  return Math.min(100, Math.round((props.cash / targetThreeMonths.value) * 100))
})
</script>

<template>
  <div
    class="flex flex-col gap-2.5 rounded-2xl border p-4 text-left transition-all shadow-xs"
    :class="
      tone === 'good'
        ? 'border-brand/40 bg-brand-soft/60 text-ink-2'
        : tone === 'warn'
          ? 'border-warn-line bg-warn-soft/80 text-ink-2'
          : 'border-line bg-surface text-ink-2'
    "
  >
    <div class="flex items-start gap-3">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-xl"
        :class="
          tone === 'good'
            ? 'bg-brand text-brand-ink'
            : tone === 'warn'
              ? 'bg-warn text-white'
              : 'bg-surface-3 text-ink-2'
        "
      >
        <PhShieldCheck v-if="tone === 'good'" :size="20" weight="fill" />
        <PhShieldWarning v-else :size="20" weight="fill" />
      </span>

      <div class="min-w-0 flex-1">
        <div class="font-display text-[15px] font-semibold text-ink leading-snug">
          {{ label }}
        </div>
        <p class="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
          Ликвидные средства на счетах: <b class="num text-ink">{{ money(cash) }}</b>.
          Обязательные траты в месяц: <span class="num">{{ money(monthlyMandatory) }}</span>.
        </p>
      </div>
    </div>

    <!-- Progress bar towards 3-month buffer -->
    <div v-if="monthlyMandatory > 0" class="mt-1 flex flex-col gap-1">
      <div class="flex justify-between text-[11px] text-ink-3">
        <span>Цель 3 месяца ({{ money(targetThreeMonths) }})</span>
        <span class="num font-semibold">{{ progress }}%</span>
      </div>
      <div class="h-2 w-full overflow-hidden rounded-full bg-track">
        <div
          class="h-full rounded-full transition-all duration-500"
          :class="tone === 'good' ? 'bg-brand' : 'bg-warn'"
          :style="{ width: `${progress}%` }"
        />
      </div>
    </div>
  </div>
</template>
