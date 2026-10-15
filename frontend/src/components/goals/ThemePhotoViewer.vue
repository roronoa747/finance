<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { PhCaretLeft, PhCaretRight, PhX } from '@phosphor-icons/vue'
import { templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'
import Button from '@/components/ui/Button.vue'

/**
 * Фото темы на весь экран (владелец, 2026-10-15, FR-09: «маленькие, нельзя пролистать»): нажали на тему в «Новой
 * мечте» или в листе «Фото мечты» — её фото крупно, листаются свайпом (и ‹ › / стрелками на широком экране), вверху
 * крестик и «N из M», автор — на самом фото (Р-28, Unsplash). Одно главное действие — «Выбрать это»: отдаёт фото
 * родителю (`pick`), тот решает, что дальше. Закрыть — крестик или Escape (лист под ним остаётся открытым).
 */
const props = defineProps<{ photos: GoalTemplate[]; start?: number }>()
const emit = defineEmits<{ (e: 'pick', t: GoalTemplate): void; (e: 'close'): void }>()

const page = ref(Math.max(0, Math.min(props.photos.length - 1, props.start ?? 0)))
watch(
  () => props.photos,
  () => (page.value = Math.max(0, Math.min(props.photos.length - 1, props.start ?? 0))),
)

function go(step: number) {
  page.value = Math.max(0, Math.min(props.photos.length - 1, page.value + step))
}

/** Свайп: влево — следующее фото, вправо — прошлое; короче 40 px — не жест (как вступление первого запуска). */
const SWIPE = 40
let touchX: number | null = null
const onTouchStart = (e: TouchEvent) => (touchX = e.touches[0]?.clientX ?? null)
function onTouchEnd(e: TouchEvent) {
  const x = e.changedTouches[0]?.clientX
  if (touchX !== null && x !== undefined) {
    if (x - touchX <= -SWIPE) go(1)
    else if (x - touchX >= SWIPE) go(-1)
  }
  touchX = null
}

/** Escape закрывает только просмотр — перехват до листа (`Sheet` закрыл бы и себя). */
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopImmediatePropagation()
    emit('close')
  } else if (e.key === 'ArrowRight') go(1)
  else if (e.key === 'ArrowLeft') go(-1)
}
// Без document (SSR-тесты) — рендер на месте и без клавиш.
const inline = typeof document === 'undefined'
if (!inline) document.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
  if (!inline) document.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <Teleport to="body" :disabled="inline">
    <div
      class="fixed inset-0 z-[70] flex flex-col gap-3 bg-canvas px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]"
      role="dialog"
      aria-modal="true"
      aria-label="Фото темы"
      data-photo-viewer
    >
      <div class="flex h-11 items-center justify-between">
        <button type="button" class="press grid size-10 cursor-pointer place-items-center rounded-full bg-surface-2 text-ink" aria-label="Закрыть" @click="emit('close')">
          <PhX :size="18" />
        </button>
        <span class="text-[14px] font-semibold text-ink-2 num" data-viewer-count>{{ page + 1 }} из {{ photos.length }}</span>
        <span class="size-10" aria-hidden="true" />
      </div>

      <div class="relative min-h-0 flex-1 overflow-hidden rounded-[28px] bg-surface-3" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
        <div class="flex h-full transition-transform duration-300" :style="{ transform: `translateX(-${page * 100}%)` }">
          <div v-for="(p, i) in photos" :key="p.id" class="relative h-full w-full shrink-0" :aria-hidden="i !== page" data-viewer-photo>
            <img :src="templateImageUrl(p, 1200)" :alt="p.name" class="size-full object-cover" :loading="Math.abs(i - page) <= 1 ? undefined : 'lazy'" />
            <span class="absolute right-4 top-3 text-[11px] text-on-photo opacity-80">Фото: {{ p.photo.author }}</span>
          </div>
        </div>
        <!-- Широкий экран (мышь): ‹ › по краям фото; на телефоне — свайп. -->
        <button v-if="page > 0" type="button" class="press absolute left-3 top-1/2 hidden size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface text-ink sm:grid" aria-label="Прошлое фото" @click="go(-1)">
          <PhCaretLeft :size="18" />
        </button>
        <button v-if="page < photos.length - 1" type="button" class="press absolute right-3 top-1/2 hidden size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface text-ink sm:grid" aria-label="Следующее фото" @click="go(1)">
          <PhCaretRight :size="18" />
        </button>
      </div>

      <div class="flex justify-center gap-1.5" aria-hidden="true">
        <span v-for="(p, i) in photos" :key="p.id" class="h-1.5 rounded-full transition-all" :class="i === page ? 'w-5 bg-brand' : 'w-1.5 bg-track'" />
      </div>
      <Button size="lg" class="w-full" data-viewer-pick @click="emit('pick', photos[page]!)">Выбрать это</Button>
    </div>
  </Teleport>
</template>
