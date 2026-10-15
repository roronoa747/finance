import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import { useRoute, useRouter, type Router } from 'vue-router'

/**
 * Прокрутка оболочки (Р-115). Прокручивается не окно, а `<main>` — `scrollBehavior` роутера тут
 * не работает. Перед уходом с экрана его `scrollTop` запоминается по `path`.
 * - «Назад» (жест, кнопка браузера, `router.back`) — на запомненное место.
 * - Переход на корень вкладки (`isRoot`) — на место этой вкладки.
 * - Вперёд на новый экран — сверху (после «Выбрать этот план» шаг месяца был за верхом экрана).
 * - Смена только query (окна «Капитала», Б-15) — прокрутку не трогает: ключ — `path`, не `fullPath`.
 * Данные экрана могут прийти позже — место дописывается по кадрам, пока высоты не хватает (до ~2 с).
 * Позиции живут, пока открыто приложение; между запусками не хранятся.
 *
 * Память — у роутера, не у оболочки (хвост §4 `/ux` Блока 1 «ИИ», AI-09): публичный экран вне оболочки
 * (`/privacy` из листа согласия или настроек) размонтирует её, а «назад» с него монтирует заново — место
 * возвращается при монтировании.
 */
type Memory = {
  saved: Map<string, number>
  popping: boolean
  lastWasPop: boolean
  /** `<main>` смонтированной оболочки; нет оболочки — null. */
  box: (() => HTMLElement | null) | null
}

const memories = new WeakMap<Router, Memory>()

/** Слушатели — один раз на роутер, на всё время приложения: уход с оболочки их не снимает. */
function memoryOf(router: Router): Memory {
  const known = memories.get(router)
  if (known) return known
  const mem: Memory = { saved: new Map(), popping: false, lastWasPop: false, box: null }
  // История сообщает только о переходах по ней (назад / вперёд), не о push.
  router.options.history.listen(() => {
    mem.popping = true
  })
  router.beforeEach((to, from) => {
    const el = mem.box?.()
    if (to.path !== from.path && el) mem.saved.set(from.path, el.scrollTop)
  })
  // Отменённый переход тоже проходит здесь — флаг «назад» не переживает его.
  router.afterEach(() => {
    mem.lastWasPop = mem.popping
    mem.popping = false
  })
  memories.set(router, mem)
  return mem
}

export function useScrollMemory(el: Ref<HTMLElement | null>, isRoot: (path: string) => boolean) {
  const router = useRouter()
  const route = useRoute()
  const mem = memoryOf(router)
  const box = () => el.value
  mem.box = box
  let frame = 0

  function stop() {
    if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
    frame = 0
  }

  function restore(y: number) {
    const el = box()
    if (!el) return
    el.scrollTop = y
    if (y <= 0 || typeof requestAnimationFrame === 'undefined') return
    let tries = 0
    // Человек сам взялся за прокрутку — не перетягиваем.
    el.addEventListener('touchstart', stop, { once: true, passive: true })
    el.addEventListener('wheel', stop, { once: true, passive: true })
    const step = () => {
      frame = 0
      if (!el.isConnected) return
      if (el.scrollHeight - el.clientHeight >= y || ++tries > 120) {
        el.scrollTop = y
        return
      }
      el.scrollTop = y
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  /** Место экрана `path` после перехода: «назад» и корень — запомненное, вперёд — сверху. */
  function arrive(path: string) {
    stop()
    restore(mem.lastWasPop || isRoot(path) ? (mem.saved.get(path) ?? 0) : 0)
    mem.lastWasPop = false
  }

  watch(() => route.path, arrive, { flush: 'post' })
  // Оболочку смонтировали заново («назад» с `/privacy`) — переход уже был, `watch` его не увидит.
  onMounted(() => arrive(route.path))

  onUnmounted(() => {
    if (mem.box === box) mem.box = null
    stop()
  })
}
