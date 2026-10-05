<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { memberColor } from '@/lib/palette'
import type { PersonId } from '@/types/finance'

/**
 * Круг месяца (Р-78, макет month-plan.html «Лесенка»): снаружи — зарплаты по людям (ещё не пришла — бледнее),
 * внутри — платежи · траты · цели и фонды долями дохода; в центре — слот (остаток месяца). Суммы — готовые из
 * `monthPlan`/`monthPlanPast`; здесь только доли дуг. Цвета — токены (`--s1`, `--s8`, `--s3`, цвет участника).
 * Круг-оглавление (ворота B2C-91): с `pickable` цвет нажимается (`pick`), при раскрытом разделе (`active`)
 * остальные бледнеют. Те же разделы открываются строками под кругом — круг для чтения с экрана скрыт.
 */
const props = withDefaults(
  defineProps<{
    income: { person: PersonId; amount: number; came: boolean }[]
    parts: { key: string; amount: number; color: string }[]
    /** Целое кольца: доход месяца (части сверх него обрезаются кругом). */
    total: number
    size?: number
    /** Раскрытый раздел — ключ части; остальные бледнеют. */
    active?: string | null
    pickable?: boolean
  }>(),
  { size: 236, active: null, pickable: false },
)

const emit = defineEmits<{ (e: 'pick', key: string): void }>()

const finance = useFinanceStore()
const R1 = 110
const R2 = 88
const C1 = 2 * Math.PI * R1
const C2 = 2 * Math.PI * R2
const GAP = 2

type Arc = { key: string; from: number; len: number; color: string; dim?: boolean }

function arcs<T extends { amount: number }>(xs: T[], C: number, color: (x: T) => string, key: (x: T) => string, dim?: (x: T) => boolean): Arc[] {
  const whole = Math.max(props.total, 1)
  let acc = 0
  const out: Arc[] = []
  for (const x of xs) {
    const len = Math.min(C - acc, (C * Math.max(0, x.amount)) / whole)
    if (len > 0) out.push({ key: key(x), from: acc, len, color: color(x), dim: dim?.(x) })
    acc += Math.max(0, len)
  }
  return out
}

const outer = computed(() =>
  arcs(props.income, C1, (x) => memberColor(finance.people, x.person), (x) => x.person, (x) => !x.came),
)
const inner = computed(() => arcs(props.parts, C2, (x) => `var(${x.color})`, (x) => x.key))
const dash = (a: Arc, C: number) => `${Math.max(0, a.len - GAP)} ${C}`
</script>

<template>
  <div class="relative shrink-0 self-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 240 240" aria-hidden="true" class="absolute inset-0 size-full">
      <circle cx="120" cy="120" :r="R1" fill="none" stroke="var(--track)" stroke-width="7" />
      <circle
        v-for="a in outer"
        :key="`o-${a.key}`"
        class="ring-arc"
        cx="120"
        cy="120"
        :r="R1"
        fill="none"
        :stroke="a.color"
        stroke-width="7"
        :opacity="a.dim ? 0.45 : 1"
        :stroke-dasharray="dash(a, C1)"
        :stroke-dashoffset="-a.from"
        transform="rotate(-90 120 120)"
      />
      <circle cx="120" cy="120" :r="R2" fill="none" stroke="var(--track)" stroke-width="24" />
      <circle
        v-for="a in inner"
        :key="`i-${a.key}`"
        class="ring-arc"
        :class="pickable && 'ring-pick'"
        :data-part="a.key"
        :opacity="active && active !== a.key ? 0.3 : 1"
        @click="pickable && emit('pick', a.key)"
        cx="120"
        cy="120"
        :r="R2"
        fill="none"
        :stroke="a.color"
        stroke-width="24"
        :stroke-dasharray="dash(a, C2)"
        :stroke-dashoffset="-a.from"
        transform="rotate(-90 120 120)"
      />
    </svg>
    <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
      <slot />
    </div>
  </div>
</template>

<style>
.ring-arc {
  transition:
    stroke-dasharray var(--motion-ring) var(--ease-out),
    stroke-dashoffset var(--motion-ring) var(--ease-out),
    opacity var(--motion-fast) var(--ease-out);
}
.ring-pick {
  cursor: pointer;
  pointer-events: stroke;
}
</style>
