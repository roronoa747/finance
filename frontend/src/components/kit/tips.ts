import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { markTipSeen, readTipsSeen } from '@/lib/storage'

/**
 * Очередь пузырей обучения (`Tip.vue`, бэклог «первый» Р-7): на экране — не больше одного. Показывается первый
 * смонтированный из ещё не увиденных, остальные ждут его «Понятно»; пока открыт лист (`Sheet`) или тост (`Toast`) —
 * ни одного: пузырь ждёт их закрытия.
 */
const mounted = reactive<{ key: symbol; id: string; ready: () => boolean }[]>([])
/** Открытые листы и тосты. */
const overlays = ref(0)
/** «Видел» — на устройстве; число растёт при отметке, чтобы очередь перечитала хранилище. */
const marks = ref(0)

const active = computed(() => {
  void marks.value
  if (overlays.value > 0) return null
  const seen = readTipsSeen()
  return mounted.find((t) => t.ready() && !seen.includes(t.id))?.key ?? null
})

/**
 * Пузырь `id` в очереди, пока смонтирован (в DOM; SSR-рендер очередь не трогает) и `ready` (предмет есть — пустой экран
 * пузыря не показывает и очередь не держит): `shown` — он сейчас тот самый один, `done` — «Понятно».
 */
export function useTip(id: string, ready: () => boolean = () => true) {
  const key = Symbol(id)
  onMounted(() => mounted.push({ key, id, ready }))
  onUnmounted(() => {
    const i = mounted.findIndex((t) => t.key === key)
    if (i >= 0) mounted.splice(i, 1)
  })
  return {
    shown: computed(() => active.value === key),
    done() {
      markTipSeen(id)
      marks.value++
    },
  }
}

/** Лист или тост открыт — пузыри ждут; вызвать отданную функцию при закрытии (повторный вызов — без эффекта). */
export function holdTips(): () => void {
  overlays.value++
  let held = true
  return () => {
    if (held) overlays.value--
    held = false
  }
}

/** Сколько пузырь стоит на экране, чтобы считаться увиденным без «Понятно» (F2-Х3, Р-13 «Figma»). */
export const TIP_SEEN_MS = 4000
