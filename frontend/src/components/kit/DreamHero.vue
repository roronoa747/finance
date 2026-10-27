<script setup lang="ts">
import { computed } from 'vue'
import ProgressBar from './ProgressBar.vue'

/**
 * Герой цели (DESIGN.md §5): фото во всю карточку, процент 34 (`type-percent`, цифры --font-num; подписи «До мечты» нет — Б17) и одна
 * готовая строка `line`. Без фото — `--surface-3` и ink-текст (слот `actions` — чип «Добавить фото»).
 * `goal` — обложка-карточка экрана цели (пачка 2 «Figma», FG-24, 78:50: 400, радиус 24; с `title` — название 26 над
 * процентом; слот `footer` — нижняя строка под полосой: срок и «Пополнить»), `preview` — превью новой цели (180, без процента
 * и полосы), `cover` — обложка «Мечт» во всю ширину (FG-21: 480, скруглён только низ — 28, как в макете 47:2; процент 34 → название 28 → полоса; слот `top`
 * — верхняя строка поверх фото, слот `title` — своя разметка названия, напр. кнопка с ✦). Пустой «Мечт» — `DreamCenter`.
 * Процент считает `finance.ts`.
 */
const props = withDefaults(
  defineProps<{
    line?: string
    percent?: number
    src?: string | null
    author?: string | null
    /** Профиль автора на Unsplash (Р-28: имя и ссылка) — подпись становится ссылкой. */
    authorUrl?: string | null
    size?: 'goal' | 'preview' | 'cover'
    /** Название на фото: обложка «Мечт» — 28 после процента; экран цели — 26 над процентом. */
    title?: string
    /** Подпись над процентом; у фонда — «Собрано» (ревью frontend Б14, Н-2). */
    eyebrow?: string
    /** Без фото — заливка оттенком цели (`hueColor`) с текстом на тени, а не серая (FG-20, «Тратьте как обычно»). */
    tone?: string | null
  }>(),
  { line: '', percent: 0, size: 'goal', src: null, author: null, authorUrl: null, eyebrow: '', tone: null, title: '' },
)

const HEIGHT = { goal: 'min-h-[400px] rounded-card', preview: 'min-h-[180px] rounded-hero', cover: 'min-h-[480px] rounded-b-hero' } as const

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))))
// Фото или оттенок — текст белым на тени; иначе — `--surface-3` и ink.
const onPhoto = computed(() => !!props.src || !!props.tone)
</script>

<template>
  <section
    class="relative isolate flex flex-col justify-end overflow-hidden p-5 text-left"
    :class="[HEIGHT[size], onPhoto ? 'text-on-photo' : 'bg-surface-3 text-ink']"
    :style="!src && tone ? { background: tone } : undefined"
  >
    <img v-if="src" :src="src" alt="" class="absolute inset-0 -z-20 size-full object-cover" />
    <div v-if="onPhoto" class="absolute inset-x-0 bottom-0 top-[35%] -z-10 photo-scrim" aria-hidden="true" />
    <!-- Верх светлого фото (небо шаблона «Машина»): белые «Мечты» и подпись автора иначе не читаются (`/ux` Блока 4; тот же
         приём — просмотр фото темы, FR-09). Шапка «Мечт» — полной полосой, одна подпись автора — тише. -->
    <div
      v-if="src && ($slots.top || author)"
      class="absolute inset-x-0 top-0 -z-10 photo-scrim-top"
      :class="$slots.top ? 'h-28' : 'h-14 opacity-60'"
      aria-hidden="true"
      data-hero-top-scrim
    />
    <!-- Верхняя строка поверх фото (обложка «Мечт»: «Мечты» и шапка оболочки). -->
    <div v-if="$slots.top" class="absolute inset-x-0 top-0 z-10 px-4 pt-3"><slot name="top" :on-photo="onPhoto" /></div>
    <!-- Автор — один раз, на самом фото (владелец, 2026-09-27); ссылка на профиль — требование Unsplash. -->
    <div v-if="author" class="absolute right-4 text-[11px]" :class="[src ? 'opacity-75' : 'text-ink-2', $slots.top ? 'top-[62px]' : 'top-3']">
      <a v-if="authorUrl" :href="authorUrl" target="_blank" rel="noreferrer noopener" class="underline-offset-2 hover:underline" @click.stop>Фото: {{ author }}</a>
      <template v-else>Фото: {{ author }}</template>
    </div>
    <!-- Угол слева — одна маленькая кнопка (сменить фото), чтобы действия не закрывали картинку. -->
    <div v-if="$slots.corner" class="absolute left-3 top-3"><slot name="corner" /></div>

    <template v-if="size === 'cover'">
      <div class="type-percent num" data-hero-percent>{{ pct }}&nbsp;%</div>
      <div class="mt-1.5 flex min-w-0 items-center gap-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]" data-hero-title>
        <slot name="title">{{ title }}</slot>
      </div>
    </template>
    <template v-else-if="size !== 'preview'">
      <div v-if="title" class="mb-1.5 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]" data-hero-title>{{ title }}</div>
      <div v-if="eyebrow" class="text-[14px] font-medium" :class="src ? 'opacity-85' : 'text-ink-2'">{{ eyebrow }}</div>
      <div class="mb-2 mt-1 type-percent num" data-hero-percent>{{ pct }}&nbsp;%</div>
    </template>
    <div v-if="line" class="text-[15px]" :class="onPhoto ? 'opacity-90' : 'text-ink-2'">{{ line }}</div>
    <ProgressBar v-if="size !== 'preview'" :value="pct / 100" :tone="src ? 'photo' : 'brand'" :height="4" class="mt-3.5" />
    <!-- Нижняя строка под полосой (экран цели, FG-24): срок слева, «Пополнить» справа. -->
    <div v-if="$slots.footer" class="mt-3 flex min-h-8 items-center justify-between gap-3"><slot name="footer" :on-photo="onPhoto" /></div>
    <div v-if="$slots.actions" class="mt-3.5 flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
