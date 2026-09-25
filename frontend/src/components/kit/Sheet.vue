<script lang="ts">
/** Открытые листы по порядку открытия: Escape закрывает только верхний. */
const stack: symbol[] = []
</script>

<script setup lang="ts">
import { nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'

/**
 * Окно поверх экрана: на телефоне — лист снизу, на широком экране — по центру.
 * Закрывается крестиком, тапом по затемнению и Escape. Лист поверх другого окна
 * (`z` 60 — «Оплатил» внутри модалки Капитала) закрывается первым, окно под ним
 * остаётся.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
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

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || stack[stack.length - 1] !== me) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
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
  if (downOnScrim) emit('close')
  downOnScrim = false
}

function show() {
  stack.push(me)
  back = document.activeElement instanceof HTMLElement ? document.activeElement : null
  document.addEventListener('keydown', onKeydown)
  void nextTick(() => {
    if (card.value && !card.value.contains(document.activeElement)) card.value.focus()
  })
}

function hide() {
  const i = stack.indexOf(me)
  if (i < 0) return
  stack.splice(i, 1)
  document.removeEventListener('keydown', onKeydown)
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
      class="fixed inset-0 flex items-end justify-center bg-scrim backdrop-blur-xs sm:items-center sm:p-4"
      :style="{ zIndex: z }"
      @pointerdown="onScrimDown"
      @click.self="onScrimClick"
    >
      <div
        ref="card"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 pb-8 text-left shadow-lift outline-none sm:rounded-2xl sm:pb-5"
      >
        <div class="mb-4 flex items-center justify-between gap-3">
          <h3 class="flex min-w-0 items-center gap-2 font-display text-[17px] font-semibold text-ink">
            <span :id="titleId">{{ title }}</span>
            <slot name="mark" />
          </h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 shrink-0 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="emit('close')"
          >
            <PhX :size="16" />
          </button>
        </div>

        <slot />

        <div v-if="$slots.footer" class="mt-1">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
