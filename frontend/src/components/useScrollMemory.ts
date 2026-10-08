import { onUnmounted, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * Прокрутка оболочки (Р-115). Прокручивается не окно, а `<main>` — `scrollBehavior` роутера тут
 * не работает. Перед уходом с экрана его `scrollTop` запоминается по `path`.
 * - «Назад» (жест, кнопка браузера, `router.back`) — на запомненное место.
 * - Переход на корень вкладки (`isRoot`) — на место этой вкладки.
 * - Вперёд на новый экран — сверху (после «Выбрать этот план» шаг месяца был за верхом экрана).
 * - Смена только query (окна «Капитала», Б-15) — прокрутку не трогает: ключ — `path`, не `fullPath`.
 * Данные экрана могут прийти позже — место дописывается по кадрам, пока высоты не хватает (до ~2 с).
 * Позиции живут, пока открыто приложение; между запусками не хранятся.
 */
export function useScrollMemory(el: Ref<HTMLElement | null>, isRoot: (path: string) => boolean) {
  const router = useRouter()
  const route = useRoute()
  const saved = new Map<string, number>()
  let popping = false
  let lastWasPop = false
  let frame = 0

  // История сообщает только о переходах по ней (назад / вперёд), не о push.
  const offPop = router.options.history.listen(() => {
    popping = true
  })
  const offBefore = router.beforeEach((to, from) => {
    if (to.path !== from.path && el.value) saved.set(from.path, el.value.scrollTop)
  })
  // Отменённый переход тоже проходит здесь — флаг «назад» не переживает его.
  const offAfter = router.afterEach(() => {
    lastWasPop = popping
    popping = false
  })

  function stop() {
    if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame)
    frame = 0
  }

  function restore(y: number) {
    const box = el.value
    if (!box) return
    box.scrollTop = y
    if (y <= 0 || typeof requestAnimationFrame === 'undefined') return
    let tries = 0
    // Человек сам взялся за прокрутку — не перетягиваем.
    box.addEventListener('touchstart', stop, { once: true, passive: true })
    box.addEventListener('wheel', stop, { once: true, passive: true })
    const step = () => {
      frame = 0
      if (!box.isConnected) return
      if (box.scrollHeight - box.clientHeight >= y || ++tries > 120) {
        box.scrollTop = y
        return
      }
      box.scrollTop = y
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  watch(
    () => route.path,
    (path) => {
      stop()
      restore(lastWasPop || isRoot(path) ? (saved.get(path) ?? 0) : 0)
      lastWasPop = false
    },
    { flush: 'post' },
  )

  onUnmounted(() => {
    offPop()
    offBefore()
    offAfter()
    stop()
  })
}
