<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { FILL_MS, reducedMotion } from '@/lib/motion'

/**
 * Бег цифр (Р-45, макет «2 · Живо»): при появлении — от `from` (0) к `value`, при смене —
 * от показанного к новому; ≤ 1 с, кривая ease-out. Промежуточные — целые (деньги — целые
 * тенге), формат — снаружи (`money`, `plain`, `pct` + «%»). SSR и «уменьшить движение» —
 * сразу конечное значение. Пока бежит, ширину держит невидимое конечное значение — строка
 * вокруг не дёргается.
 */
const props = withDefaults(
  defineProps<{
    value: number
    format?: (n: number) => string
    from?: number
  }>(),
  { format: (n: number) => String(n), from: 0 },
)

const shown = ref(props.value)
const running = ref(false)
let raf = 0

function run(a: number, b: number) {
  cancelAnimationFrame(raf)
  if (a === b || reducedMotion()) {
    shown.value = b
    running.value = false
    return
  }
  const t0 = performance.now()
  shown.value = Math.round(a)
  running.value = true
  const step = (t: number) => {
    const k = Math.min(1, Math.max(0, t - t0) / FILL_MS)
    const eased = 1 - (1 - k) ** 3
    shown.value = k >= 1 ? b : Math.round(a + (b - a) * eased)
    if (k < 1) raf = requestAnimationFrame(step)
    else running.value = false
  }
  raf = requestAnimationFrame(step)
}

onMounted(() => run(props.from, props.value))
watch(
  () => props.value,
  (v) => run(shown.value, v),
)
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <span v-if="running" class="inline-grid">
    <span class="invisible col-start-1 row-start-1" aria-hidden="true">{{ format(value) }}</span>
    <span class="col-start-1 row-start-1">{{ format(shown) }}</span>
  </span>
  <span v-else>{{ format(value) }}</span>
</template>
