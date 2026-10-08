<script setup lang="ts">
import { computed } from 'vue'
import ProgressBar from './ProgressBar.vue'

/**
 * Герой цели (DESIGN.md §5): фото во всю карточку, «До мечты», процент 64 (цифры --font-num) и одна
 * готовая строка `line`. Без фото — `--surface-3` и ink-текст (слот `actions` — чип «Добавить фото»).
 * `goal` — экран цели (380), `preview` — превью новой цели (180, без процента и полосы). Главный
 * «Мечты» — `DreamCenter` (пивот 3, Р-42). Процент считает `finance.ts`.
 */
const props = withDefaults(
  defineProps<{
    line: string
    percent?: number
    src?: string | null
    author?: string | null
    /** Профиль автора на Unsplash (Р-28: имя и ссылка) — подпись становится ссылкой. */
    authorUrl?: string | null
    size?: 'goal' | 'preview'
    /** Подпись над процентом; у фонда — «Собрано» (ревью frontend Б14, Н-2). */
    eyebrow?: string
  }>(),
  { percent: 0, size: 'goal', src: null, author: null, authorUrl: null, eyebrow: '' },
)

const HEIGHT = { goal: 'min-h-[380px]', preview: 'min-h-[180px]' } as const

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))))
</script>

<template>
  <section
    class="relative isolate flex flex-col justify-end overflow-hidden rounded-hero p-5 text-left"
    :class="[HEIGHT[size], src ? 'text-on-photo' : 'bg-surface-3 text-ink']"
  >
    <img v-if="src" :src="src" alt="" class="absolute inset-0 -z-20 size-full object-cover" />
    <div v-if="src" class="absolute inset-x-0 bottom-0 top-[35%] -z-10 photo-scrim" aria-hidden="true" />
    <!-- Автор — один раз, на самом фото (владелец, 2026-09-27); ссылка на профиль — требование Unsplash. -->
    <div v-if="author" class="absolute right-4 top-3 text-[11px]" :class="src ? 'opacity-75' : 'text-ink-2'">
      <a v-if="authorUrl" :href="authorUrl" target="_blank" rel="noreferrer noopener" class="underline-offset-2 hover:underline" @click.stop>Фото: {{ author }}</a>
      <template v-else>Фото: {{ author }}</template>
    </div>
    <!-- Угол слева — одна маленькая кнопка (сменить фото), чтобы действия не закрывали картинку. -->
    <div v-if="$slots.corner" class="absolute left-3 top-3"><slot name="corner" /></div>

    <template v-if="size !== 'preview'">
      <div v-if="eyebrow" class="text-[14px] font-medium" :class="src ? 'opacity-85' : 'text-ink-2'">{{ eyebrow }}</div>
      <div class="mb-2 mt-1 type-percent num">{{ pct }}&nbsp;%</div>
    </template>
    <div v-if="line" class="text-[15px]" :class="src ? 'opacity-90' : 'text-ink-2'">{{ line }}</div>
    <ProgressBar v-if="size !== 'preview'" :value="pct / 100" :tone="src ? 'photo' : 'brand'" :height="4" class="mt-3.5" />
    <div v-if="$slots.actions" class="mt-3.5 flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
