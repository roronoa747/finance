<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { holdTips } from './tips'
import { isTopSheet, popSheet, pushSheet } from './sheetStack'

/**
 * Окно поверх экрана: на телефоне — лист снизу, на широком экране — по центру.
 * Закрывается крестиком, тапом по затемнению, Escape и на телефоне — стягиванием вниз. Лист поверх другого окна
 * (`z` 60 — «Оплатил» внутри модалки Капитала) закрывается первым, окно под ним
 * остаётся.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** Заголовок только для диктора: лист сам говорит крупно (момент «Сбылось!», `/ux` Б4 «понятность»). */
    titleHidden?: boolean
    z?: number
  }>(),
  { z: 50 },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

// В браузере лист уходит в body. Без document (SSR-тесты) body нет — рендер на месте.
const inline = typeof document === 'undefined'
const titleId = useId()
const card = ref<HTMLElement | null>(null)
const me = Symbol('sheet')
let back: HTMLElement | null = null
/** Пока лист открыт, подсказки у предмета (`Tip`) ждут его закрытия. */
let releaseTips: (() => void) | null = null

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/**
 * Закрыть окно, не потеряв правку. Поля окон пишут по уходу из поля (`NumFieldBlur`,
 * `@blur`), а родитель на `close` сразу убирает запись окна — blur, пришедший позже (фокус
 * назад в `hide`), писать уже некуда. Escape фокус не трогает, крестик в Safari тоже.
 */
function close() {
  const at = document.activeElement
  if (at instanceof HTMLElement && card.value?.contains(at)) at.blur()
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || !isTopSheet(me)) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  // Tab не уводит фокус под затемнение: там можно открыть другое окно, которое
  // встанет под это.
  if (e.key !== 'Tab' || !card.value) return
  const items = [...card.value.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (!items.length) return
  const first = items[0]
  const last = items[items.length - 1]
  const at = document.activeElement
  const inside = at instanceof HTMLElement && card.value.contains(at)
  if (e.shiftKey && (!inside || at === first || at === card.value)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (!inside || at === last)) {
    e.preventDefault()
    first.focus()
  }
}

// Закрывает только нажатие, начатое на затемнении: выделение текста из поля,
// отпущенное за краем окна, тоже даёт click по фону — окно закрылось бы с правкой.
let downOnScrim = false

function onScrimDown(e: PointerEvent) {
  downOnScrim = e.target === e.currentTarget
}

function onScrimClick() {
  if (downOnScrim) close()
  downOnScrim = false
}

/*
 * Стянуть вниз (PN-35, решение владельца 2026-10-11): на телефоне лист тянется пальцем за любое место, когда его
 * содержимое прокручено до верха. Touch, а не pointer: только `touchmove` может отменить родную прокрутку — решение
 * «тянем или прокручиваем» принимается на первом движении, пока оно ещё отменяемо. Окно `sm:` не тянется.
 */
const SHUT_PX = 120 // или 30 % высоты листа — что меньше
const FLICK = 0.5 // px/мс: быстрое смахивание закрывает и с короткого хода
const pull = ref(0)
const settling = ref(false)
let gesture: 'idle' | 'drag' | 'skip' = 'skip'
let y0 = 0
let x0 = 0
let lastY = 0
let lastT = 0
let speed = 0
let closing = false
let settle: ReturnType<typeof setTimeout> | null = null

/** Жест не трогает: выделение текста, бегунок, вложенную прокрутку, которую ещё есть куда листать вверх. */
function busy(target: EventTarget | null) {
  // Только выделение в листе: забытое за ним (экран стоит) не должно отключать жест навсегда.
  const sel = document.getSelection?.()
  if (sel && !sel.isCollapsed && card.value?.contains(sel.anchorNode)) return true
  for (let el = target instanceof Element ? target : null; el && el !== card.value; el = el.parentElement) {
    if (el instanceof HTMLInputElement && el.type === 'range') return true
    // Выделение внутри поля getSelection() видит не во всех браузерах.
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.selectionStart !== el.selectionEnd) return true
    if (el.scrollTop > 0) return true
  }
  return false
}

function onTouchStart(e: TouchEvent) {
  gesture = 'skip'
  const c = card.value
  if (!c || closing || e.touches.length !== 1 || !isTopSheet(me)) return
  if (window.matchMedia?.('(min-width: 640px)').matches) return
  if (c.scrollTop > 0 || busy(e.target)) return
  const t = e.touches[0]
  y0 = lastY = t.clientY
  x0 = t.clientX
  lastT = e.timeStamp
  speed = 0
  gesture = 'idle'
}

function onTouchMove(e: TouchEvent) {
  if (gesture === 'skip' || !card.value) return
  const t = e.touches[0]
  const dy = t.clientY - y0
  if (gesture === 'idle') {
    // Палец ещё не сдвинулся (субпиксели Android) — направление решит следующее движение.
    if (dy === 0 && t.clientX === x0) return
    // Вверх, вбок или содержимое успело уехать — это прокрутка, лист на весь жест не трогаем.
    if (dy <= 0 || Math.abs(t.clientX - x0) > dy || card.value.scrollTop > 0) {
      gesture = 'skip'
      return
    }
    gesture = 'drag'
    // Подхватили лист, пока он пружинил назад, — тянется от пальца, без перехода.
    if (settle) clearTimeout(settle)
    settle = null
    settling.value = false
  }
  if (e.cancelable) e.preventDefault()
  const dt = e.timeStamp - lastT
  if (dt > 0) speed = (t.clientY - lastY) / dt
  lastY = t.clientY
  lastT = e.timeStamp
  pull.value = Math.max(0, dy)
}

/** Отпустил: дальше порога или смахнул — лист доезжает вниз и закрывается, иначе — пружиной на место. */
function onTouchEnd(e: TouchEvent) {
  const c = card.value
  if (gesture !== 'drag' || !c) {
    gesture = 'skip'
    return
  }
  gesture = 'skip'
  const h = c.offsetHeight
  closing = e.type === 'touchend' && (pull.value > Math.min(SHUT_PX, h * 0.3) || (speed > FLICK && pull.value > 0))
  settling.value = true
  // Доезд — переходом `transform` (`prefers-reduced-motion` гасит его в style.css).
  pull.value = closing ? Math.max(h, pull.value) : 0
  if (settle) clearTimeout(settle)
  settle = setTimeout(settled, reduced() ? 0 : 160)
}

function reduced() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function settled() {
  settle = null
  // Тот же close(), что у крестика: фокус уходит из поля до emit — правка записана.
  if (closing) close()
  // Родитель лист не закрыл — он на месте; закрыл — карточка уходит в том же рендере.
  closing = false
  pull.value = 0
  settling.value = false
}

/** Сдвиг — только пока тянут: оставшийся transform сделал бы карточку контейнером для `fixed` (окно `Hint`). */
const cardStyle = computed(() =>
  pull.value || settling.value
    ? { transform: pull.value ? `translateY(${pull.value}px)` : undefined, transition: settling.value ? 'transform var(--motion-fast) var(--ease-out)' : 'none' }
    : undefined,
)
const scrimStyle = computed(() => {
  const h = card.value?.offsetHeight || 1
  return pull.value ? { opacity: Math.max(0, 1 - pull.value / h), transition: settling.value ? 'opacity var(--motion-fast) var(--ease-out)' : 'none' } : undefined
})

/** Пока открыт хоть один лист (или отчёт разбора), экран за ним не прокручивается — `sheetStack`. */
function show() {
  pushSheet(me)
  releaseTips = holdTips()
  back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('keydown', onKeydown)
  void nextTick(() => {
    if (card.value && !card.value.contains(document.activeElement)) card.value.focus()
  })
}

function hide() {
  if (!popSheet(me)) return
  releaseTips?.()
  releaseTips = null
  document.removeEventListener('keydown', onKeydown)
  if (settle) clearTimeout(settle)
  settle = null
  closing = false
  gesture = 'skip'
  pull.value = 0
  settling.value = false
  // Фокус — туда, откуда окно открыли, если тот элемент ещё на странице.
  if (back?.isConnected) back.focus()
  back = null
}

watch(
  () => props.open,
  (open) => {
    if (inline) return
    if (open) show()
    else hide()
  },
  { immediate: true },
)

onUnmounted(() => {
  if (!inline) hide()
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div
      v-if="open"
      class="fx-fade fixed inset-0 flex items-end justify-center overscroll-contain sm:items-center sm:p-4"
      :style="{ zIndex: z }"
      @pointerdown="onScrimDown"
      @click.self="onScrimClick"
      @touchmove.self.prevent
    >
      <!-- Затемнение — своим слоем: пока лист тянут, оно светлеет, а карточка — нет. Нажатия проходят к фону. -->
      <div aria-hidden="true" class="pointer-events-none absolute inset-0 bg-scrim backdrop-blur-xs" :style="scrimStyle" />
      <!-- Лист снизу (DESIGN.md §5): радиус 28, тень только у листа, заголовок 24. Ручка-полоска — лист тянется вниз
           (PN-35); стоит поверх отступа, заголовок и крестик на прежних местах. Окно `sm:` не тянется — ручки нет. -->
      <div
        ref="card"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="fx-sheet relative max-h-[88dvh] w-full max-w-[420px] overflow-y-auto overscroll-contain rounded-t-[28px] bg-surface px-5 pb-9 pt-5 text-left shadow-sheet outline-none sm:rounded-card sm:pb-5"
        :style="cardStyle"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <div aria-hidden="true" class="absolute left-1/2 top-2 h-[5px] w-9 -translate-x-1/2 rounded-full bg-line-strong sm:hidden" />
        <div class="mb-4 flex items-center justify-between gap-3">
          <!-- Отметка рядом с заголовком, а не внутри: имя окна и заголовок — только title. -->
          <div class="flex min-w-0 items-center gap-2">
            <h3 :id="titleId" class="min-w-0 type-sheet text-ink" :class="{ 'sr-only': titleHidden }">{{ title }}</h3>
            <slot name="mark" />
          </div>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="close"
          >
            <PhX :size="18" />
          </button>
        </div>

        <!-- close — «Готово» окна закрывает так же, как крестик: сначала уводит фокус из поля. -->
        <slot :close="close" />

        <div v-if="$slots.footer" class="mt-1">
          <slot name="footer" :close="close" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
