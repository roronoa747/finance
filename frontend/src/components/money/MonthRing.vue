<script setup lang="ts">
import { computed } from 'vue'

/**
 * Малое кольцо месяца (Р-78; Блок 5 «Фидбек», Р-30 — «Месяц» Б, Figma `18:119`): одно кольцо — платежи · траты · цели
 * и фонды долями дохода; дуг зарплат снаружи больше нет (приход зарплаты — подсветка строки в карточке зарплат).
 * Центр пустой — «Остаётся» и число стоят справа от кольца. Суммы — готовые из `monthPlan`/`monthPlanPast`; здесь
 * только доли дуг. Цвета — токены (`--s1`, `--s8`, `--s3`). Круг-оглавление (ворота B2C-91): с `pickable` цвет
 * нажимается (`pick`), при раскрытом разделе (`active`) остальные бледнеют. Те же разделы открываются строками под
 * кольцом — для читалки кольцо скрыто.
 */
const props = withDefaults(
  defineProps<{
    parts: { key: string; amount: number; color: string }[]
    /** Целое кольца: доход месяца (части сверх него обрезаются кругом); 0 — доли из суммы частей (Х-23). */
    total: number
    size?: number
    /** Раскрытый раздел — ключ части; остальные бледнеют. */
    active?: string | null
    pickable?: boolean
  }>(),
  { size: 112, active: null, pickable: false },
)

const emit = defineEmits<{ (e: 'pick', key: string): void }>()

const R = 88
const C = 2 * Math.PI * R
const GAP = 2

type Arc = { key: string; from: number; len: number; color: string }

const arcs = computed(() => {
  // Дохода нет (Р-37, Х-23 — владелец 2026-10-23): доли — из суммы разделов, кольцо целиком; все нули — только дорожка.
  const whole = props.total > 0 ? props.total : props.parts.reduce((s, x) => s + Math.max(0, x.amount), 0)
  if (whole <= 0) return []
  let acc = 0
  const out: Arc[] = []
  for (const x of props.parts) {
    const len = Math.min(C - acc, (C * Math.max(0, x.amount)) / whole)
    if (len > 0) out.push({ key: x.key, from: acc, len, color: `var(${x.color})` })
    acc += Math.max(0, len)
  }
  return out
})
const dash = (a: Arc) => `${Math.max(0, a.len - GAP)} ${C}`
</script>

<template>
  <div class="relative shrink-0" :style="{ width: `${size}px`, height: `${size}px` }" data-month-ring>
    <svg viewBox="0 0 240 240" aria-hidden="true" class="absolute inset-0 size-full">
      <circle cx="120" cy="120" :r="R" fill="none" stroke="var(--track)" stroke-width="24" />
      <circle
        v-for="a in arcs"
        :key="a.key"
        class="ring-arc"
        :class="pickable && 'ring-pick'"
        :data-part="a.key"
        :opacity="active && active !== a.key ? 0.3 : 1"
        @click="pickable && emit('pick', a.key)"
        cx="120"
        cy="120"
        :r="R"
        fill="none"
        :stroke="a.color"
        stroke-width="24"
        :stroke-dasharray="dash(a)"
        :stroke-dashoffset="-a.from"
        transform="rotate(-90 120 120)"
      />
    </svg>
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
