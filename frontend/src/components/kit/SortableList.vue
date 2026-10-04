<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

/**
 * Сортируемый список (Р-84, макет month-plan.html «Очередь денег»): ⋮⋮ — перетащить сразу, строка — удержать
 * ~300 мс; пальцем и мышью, без библиотек. Короткое касание и сдвиг до порога — обычная прокрутка. У края окна —
 * автопрокрутка. Отпустили — `move(id, index)`; отпустили вбок за краем списка, Escape или отмена касания — на место.
 * Клавиатура: стрелки ↑↓ на ⋮⋮ — выше/ниже. Чтение с экрана: в подписи ⋮⋮ — место («2 из 5»), после переноса стрелкой
 * или пальцем — скрытая живая строка «Машина — 2 из 5» (ревью frontend Б14, Н-6). `disabled` (viewer) — без ⋮⋮ и удержания. Порядок держит экран:
 * список только показывает перенос, пока палец не отпущен.
 */
const props = withDefaults(
  defineProps<{
    ids: string[]
    /** Подпись ⋮⋮ для чтения с экрана: «Переставить: <имя>». */
    label?: (id: string) => string
    disabled?: boolean
  }>(),
  { label: undefined, disabled: false },
)

const emit = defineEmits<{ (e: 'move', id: string, index: number): void }>()

/** Удержание строки до подъёма, мс. */
const HOLD_MS = 300
/** Сдвиг пальца до подъёма, после которого это прокрутка, px. */
const SLOP = 8
/** Вбок за край списка дальше этого — отмена, px. */
const CANCEL_X = 40
/** Полоса у края окна, где включается автопрокрутка, px. */
const EDGE = 56

const order = ref<string[]>([...props.ids])
watch(
  () => props.ids,
  (ids) => {
    if (!drag.value) order.value = [...ids]
  },
)

const root = ref<HTMLElement | null>(null)
const drag = ref<{ id: string; pid: number; y0: number; dy: number; x: number; y: number } | null>(null)
let press: { id: string; pid: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null
let raf = 0
let swallowClick = false

/** Живая строка для чтения с экрана: куда встала строка после переноса. */
const announce = ref('')
const nameOf = (id: string) => (props.label ? props.label(id).replace(/^Переставить:\s*/, '') : '')
function placed(id: string, to: number) {
  const name = nameOf(id)
  announce.value = `${name ? `${name} — ` : ''}${to + 1} из ${props.ids.length}`
}

const rowOf = (id: string) => ([...(root.value?.children ?? [])] as HTMLElement[]).find((el) => el.dataset.id === id) ?? null

/**
 * Что прокручивается: в приложении — не окно, а `<main>` оболочки (AppShell) — ближайший предок с прокруткой по
 * вертикали; нет такого — окно. Ищется при подъёме.
 */
let scroller: HTMLElement | null = null
function findScroller(): HTMLElement | null {
  for (let el = root.value?.parentElement ?? null; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el
  }
  return null
}
const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY || 0)
const docY = (clientY: number) => clientY + scrollTop()

function lift(id: string, pid: number, x: number, y: number) {
  scroller = findScroller()
  drag.value = { id, pid, y0: docY(y), dy: 0, x, y }
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey)
  document.addEventListener('touchmove', blockScroll, { passive: false })
  tick()
}

function clearPress() {
  if (press) clearTimeout(press.timer)
  press = null
}

function onRowDown(e: PointerEvent, id: string) {
  if (props.disabled || drag.value || (e.button ?? 0) !== 0) return
  const t = e.target as HTMLElement | null
  if (t?.closest('[data-grip]')) {
    e.preventDefault()
    lift(id, e.pointerId, e.clientX, e.clientY)
    return
  }
  // Свои кнопки строки (переключатель, кружок плательщика) — не удержание.
  if (t?.closest('[data-no-drag], input, select, textarea')) return
  clearPress()
  press = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(() => startHeld(), HOLD_MS) }
  window.addEventListener('pointermove', onPressMove)
  window.addEventListener('pointerup', onPressEnd)
  window.addEventListener('pointercancel', onPressEnd)
}

function startHeld() {
  const p = press
  dropPressListeners()
  press = null
  if (!p) return
  swallowClick = true
  lift(p.id, p.pid, p.x, p.y)
}

function onPressMove(e: PointerEvent) {
  if (press && (Math.abs(e.clientY - press.y) > SLOP || Math.abs(e.clientX - press.x) > SLOP)) onPressEnd()
}

function onPressEnd() {
  clearPress()
  dropPressListeners()
}

function dropPressListeners() {
  window.removeEventListener('pointermove', onPressMove)
  window.removeEventListener('pointerup', onPressEnd)
  window.removeEventListener('pointercancel', onPressEnd)
}

function blockScroll(e: TouchEvent) {
  if (drag.value && e.cancelable) e.preventDefault()
}

/** Сдвиг поднятой строки и обмен с соседом, как только она прошла его половину (быстрый рывок — через несколько). */
function follow() {
  const d = drag.value
  if (!d) return
  for (let guard = 0; guard < order.value.length; guard++) {
    d.dy = docY(d.y) - d.y0
    const i = order.value.indexOf(d.id)
    const ph = i > 0 ? (rowOf(order.value[i - 1]!)?.offsetHeight ?? 0) : 0
    const nh = i < order.value.length - 1 ? (rowOf(order.value[i + 1]!)?.offsetHeight ?? 0) : 0
    if (ph > 0 && d.dy < -ph / 2) {
      order.value = swap(order.value, i, i - 1)
      d.y0 -= ph
    } else if (nh > 0 && d.dy > nh / 2) {
      order.value = swap(order.value, i, i + 1)
      d.y0 += nh
    } else break
  }
  d.dy = docY(d.y) - d.y0
}

function swap(ids: string[], a: number, b: number) {
  const out = ids.slice()
  ;[out[a], out[b]] = [out[b]!, out[a]!]
  return out
}

function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d || e.pointerId !== d.pid) return
  e.preventDefault()
  d.x = e.clientX
  d.y = e.clientY
  follow()
}

/** Автопрокрутка у края окна: палец стоит, страница едет — строка едет вместе с пальцем. */
function tick() {
  cancelAnimationFrame(raf)
  const d = drag.value
  if (!d) return
  const h = window.innerHeight || 0
  const step = d.y < EDGE ? -Math.ceil((EDGE - d.y) / 6) : h && d.y > h - EDGE ? Math.ceil((d.y - (h - EDGE)) / 6) : 0
  if (step) {
    if (scroller) scroller.scrollTop += step
    else window.scrollBy(0, step)
    follow()
  }
  raf = requestAnimationFrame(tick)
}

function outside(x: number) {
  const r = root.value?.getBoundingClientRect()
  return !!r && r.width > 0 && (x < r.left - CANCEL_X || x > r.right + CANCEL_X)
}

function finish(commit: boolean) {
  const d = drag.value
  if (!d) return
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', onCancel)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('touchmove', blockScroll)
  cancelAnimationFrame(raf)
  scroller = null
  const to = order.value.indexOf(d.id)
  drag.value = null
  if (commit && to !== props.ids.indexOf(d.id)) {
    emit('move', d.id, to)
    placed(d.id, to)
  }
  order.value = [...props.ids]
  // Подъём удержанием заканчивается «кликом» по строке — он не должен открывать карточку.
  if (swallowClick) setTimeout(() => (swallowClick = false), 0)
}

function onUp(e: PointerEvent) {
  if (drag.value && e.pointerId !== drag.value.pid) return
  finish(!outside(e.clientX))
}

function onCancel() {
  finish(false)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') finish(false)
}

function onClickCapture(e: MouseEvent) {
  if (!swallowClick) return
  e.stopPropagation()
  e.preventDefault()
  swallowClick = false
}

/** Стрелки на ⋮⋮ — выше/ниже на одно место; фокус остаётся на ⋮⋮ перенесённой строки. */
async function onGripKey(e: KeyboardEvent, id: string) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  e.preventDefault()
  const i = props.ids.indexOf(id)
  const to = e.key === 'ArrowUp' ? i - 1 : i + 1
  if (i < 0 || to < 0 || to >= props.ids.length) return
  emit('move', id, to)
  placed(id, to)
  await nextTick()
  rowOf(id)?.querySelector<HTMLElement>('[data-grip]')?.focus()
}

onBeforeUnmount(() => {
  clearPress()
  dropPressListeners()
  finish(false)
})
</script>

<template>
  <div ref="root" class="flex flex-col" @click.capture="onClickCapture">
    <div
      v-for="(id, index) in order"
      :key="id"
      :data-id="id"
      class="sortable-row relative flex items-center gap-1 border-t border-line bg-surface first:border-t-0"
      :class="drag?.id === id ? 'lifted z-10 -mx-2.5 rounded-[16px] px-2.5 shadow-lift' : 'settle'"
      :style="drag?.id === id ? { transform: `translateY(${drag.dy}px)` } : undefined"
      @pointerdown="onRowDown($event, id)"
    >
      <button
        v-if="!disabled"
        type="button"
        data-grip
        class="grip -ml-1 shrink-0 cursor-grab touch-none px-1.5 py-2 text-[17px] leading-none tracking-[-1px] text-ink-3"
        :aria-label="`${label ? label(id) : 'Переставить'}, ${index + 1} из ${order.length}. Стрелки вверх и вниз — выше и ниже`"
        @keydown="onGripKey($event, id)"
      >
        ⋮⋮
      </button>
      <div class="min-w-0 flex-1">
        <slot :id="id" :index="index" />
      </div>
    </div>
    <span v-if="!disabled" class="sr-only" aria-live="polite" data-sortable-live>{{ announce }}</span>
  </div>
</template>

<style scoped>
.sortable-row {
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}
.settle {
  transition: transform var(--motion-fast) var(--ease-out);
}
.lifted .grip {
  cursor: grabbing;
}
.grip:focus-visible {
  outline: 2.5px solid var(--brand);
  outline-offset: 2px;
  border-radius: 8px;
}
</style>
