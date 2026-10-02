<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RING_MS, RING_SHRINK_MS, RING_STEP_MS, reducedMotion } from '@/lib/motion'

/**
 * Кольцо разбора (B2C-57, Р-53; макет `money-breakdown.html` «Б · Кольцо», `animateRing`): сумма —
 * круг, сектора — статьи по порядку (`share` 0…1 и `color`-токен, как у `StackBar`), хвост —
 * `--track`. При появлении сектора растут от нуля по очереди (`--motion-ring` на сектор, шаг
 * `--motion-ring-step`); смена долей (статью выключили) — плавно за `--motion-ring-shrink`. Обводка
 * 0,5 px по внешнему и внутреннему краю — `--ink` на 35 %, мягкая тень `--shadow-ring`. SSR и
 * «уменьшить движение» — сразу конечный вид. В центре — слот («Остаётся»).
 */
const props = defineProps<{
  segments: { key: string; share: number; color: string }[]
  label?: string
  /** Записанный разбор: кольцо сразу конечное, без роста. */
  still?: boolean
}>()

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const target = () => props.segments.map((s) => clamp(s.share))
const shown = ref<number[]>(props.still || reducedMotion() ? target() : target().map(() => 0))
let raf = 0

function animate(to: number[], stagger: boolean) {
  cancelAnimationFrame(raf)
  if (reducedMotion()) {
    shown.value = to
    return
  }
  const from = to.map((_, i) => shown.value[i] ?? 0)
  const d = stagger ? RING_MS : RING_SHRINK_MS
  const gap = stagger ? RING_STEP_MS : 0
  const t0 = performance.now()
  const frame = (t: number) => {
    let done = true
    shown.value = to.map((v, i) => {
      const k = clamp((t - t0 - i * gap) / d)
      if (k < 1) done = false
      return from[i] + (v - from[i]) * (1 - (1 - k) ** 3)
    })
    if (!done) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
}

onMounted(() => {
  if (!props.still) animate(target(), true)
})
watch(
  () => props.segments.map((s) => `${s.key}:${s.share}`).join('|'),
  () => animate(target(), false),
)
onBeforeUnmount(() => cancelAnimationFrame(raf))

/** Сектора — conic-gradient в градусах по накопленной доле; остаток круга — дорожка. */
const background = computed(() => {
  let acc = 0
  const stops: string[] = []
  shown.value.forEach((v, i) => {
    if (v <= 0 || !props.segments[i]) return
    const a = acc * 360
    acc = Math.min(1, acc + v)
    stops.push(`${props.segments[i].color} ${a}deg ${acc * 360}deg`)
  })
  return `conic-gradient(${[...stops, `var(--track) ${acc * 360}deg 360deg`].join(', ')})`
})

const LINE = '0 0 0 0.5px color-mix(in srgb, var(--ink) 35%, transparent)'
</script>

<template>
  <div
    role="img"
    :aria-label="label"
    class="relative my-1.5 grid size-[220px] shrink-0 place-items-center self-center rounded-full"
    :style="{ background, boxShadow: `${LINE}, var(--shadow-ring)` }"
    data-ring
  >
    <div class="flex size-[164px] flex-col items-center justify-center gap-0.5 rounded-full bg-canvas text-center" :style="{ boxShadow: LINE }">
      <slot />
    </div>
  </div>
</template>
