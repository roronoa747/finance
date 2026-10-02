import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Движение на JS (Р-45): бег цифр (`kit/CountUp`) и заполнение полос (`ProgressBar`, `StackBar`).
 * CSS-правило `prefers-reduced-motion` в `style.css` гасит только переходы и анимации CSS —
 * JS спрашивает систему сам. Длительность — та же, что `--motion-fill` в `style.css`.
 */
export const FILL_MS = 900

/** «Уменьшить движение» включено — или окна нет (SSR): числа и полосы сразу конечные. */
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Полоса растёт от нуля при появлении: в SSR и при «уменьшить движение» — сразу `true`
 * (ширина конечная); в браузере — `false` до второго кадра, чтобы пустая полоса успела
 * нарисоваться и переход `width` пошёл от нуля (как `.fill` макета).
 */
export function useGrow(): Ref<boolean> {
  const grown = ref(true)
  let raf = 0
  onMounted(() => {
    if (reducedMotion()) return
    grown.value = false
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        grown.value = true
      })
    })
  })
  onBeforeUnmount(() => cancelAnimationFrame(raf))
  return grown
}
