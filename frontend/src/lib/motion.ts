import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Движение на JS (Р-45): бег цифр (`kit/CountUp`) и заполнение полос (`ProgressBar`, `StackBar`).
 * CSS-правило `prefers-reduced-motion` в `style.css` гасит только переходы и анимации CSS —
 * JS спрашивает систему сам. Длительность — та же, что `--motion-fill` в `style.css`.
 */
export const FILL_MS = 900

/** Кольцо разбора (Р-53) — те же значения, что `--motion-ring`, `--motion-ring-step`, `--motion-ring-shrink`. */
export const RING_MS = 420
export const RING_STEP_MS = 160
export const RING_SHRINK_MS = 500

/** «Уменьшить движение» включено — или окна нет (SSR): числа и полосы сразу конечные. */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Полоса растёт от нуля при появлении: в SSR и при «уменьшить движение» — сразу `true`
 * (ширина конечная); в браузере полоса рождается пустой и становится полной на втором кадре —
 * переход `width` идёт от нуля (как `.fill` макета). Пустой — с первой вставки, не из `onMounted`:
 * оболочка в том же цикле пишет `scrollTop` (пересчёт стилей), и полная ширина успевала стать
 * «прошлой» — переход шёл 100 → 0 → 100 и был не виден.
 */
export function useGrow(): Ref<boolean> {
  const grown = ref(reducedMotion())
  let raf = 0
  onMounted(() => {
    if (grown.value) return
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        grown.value = true
      })
    })
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return grown
}
