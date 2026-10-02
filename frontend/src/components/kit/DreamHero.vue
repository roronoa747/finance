<script setup lang="ts">
import { computed } from 'vue'
import { money } from '@/lib/money'
import Button from '@/components/ui/Button.vue'
import ProgressBar from './ProgressBar.vue'

/**
 * Герой мечты (DESIGN.md §5): фото во всю карточку, «До мечты», процент 64 (цифры --font-num) и одна
 * строка «<Цель> · <накоплено> из <нужно> ₸ · будет вашей в <месяц год>». Состояния:
 * без фото — `--surface-3` и ink-текст (слот `actions` — чип «Добавить фото»); `empty` —
 * «На что копим?» с кнопкой. Высота: главный 440, экран цели 380, превью 180.
 * Пропсы — данные: процент и месяц считает `finance.ts`.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    percent?: number
    src?: string | null
    author?: string | null
    /** Профиль автора на Unsplash (Р-28: имя и ссылка) — подпись становится ссылкой. */
    authorUrl?: string | null
    haveAmount?: number
    needAmount?: number
    /** «мае 2027» — уже в предложном падеже (`monthIn`). */
    doneMonth?: string | null
    /** Своя вторая строка вместо собранной из сумм и месяца. */
    line?: string
    size?: 'main' | 'goal' | 'preview'
    empty?: boolean
    /** Пустое состояние с кнопкой «Выбрать мечту»; у viewer кнопки нет. */
    canPick?: boolean
  }>(),
  { percent: 0, size: 'main', empty: false, src: null, author: null, authorUrl: null, doneMonth: null, canPick: true },
)

const emit = defineEmits<{ (e: 'pick'): void }>()

const HEIGHT = { main: 'min-h-[440px]', goal: 'min-h-[380px]', preview: 'min-h-[180px]' } as const

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))))

// Разделитель «·» держится за предыдущее слово (неразрывный пробел перед ним): строка никогда не
// начинается с точки (смоук владельца, п. 4); месяц и год — одним куском.
const line2 = computed(() => {
  if (props.line !== undefined) return props.line
  const parts: string[] = []
  if (props.title) parts.push(props.title)
  if (props.haveAmount !== undefined && props.needAmount !== undefined) parts.push(`${money(props.haveAmount).replace(/\s₸$/u, '')} из ${money(props.needAmount)}`)
  if (props.doneMonth) parts.push(`будет вашей в ${props.doneMonth.replace(/ /g, ' ')}`)
  return parts.join(' · ')
})
</script>

<template>
  <section
    v-if="empty"
    class="flex min-h-[300px] flex-col justify-center gap-3 rounded-hero border border-dashed border-line-strong bg-surface p-5 text-left text-ink"
  >
    <h2 class="type-h2">На что копим?</h2>
    <p class="text-ink-2">Одна мечта с фото — и этот экран покажет, сколько до неё осталось.</p>
    <div v-if="canPick"><Button @click="emit('pick')">Выбрать мечту</Button></div>
  </section>

  <section
    v-else
    class="relative isolate flex flex-col justify-end overflow-hidden rounded-hero p-5 text-left"
    :class="[HEIGHT[size], src ? 'text-on-photo' : 'bg-surface-3 text-ink']"
  >
    <img v-if="src" :src="src" alt="" class="absolute inset-0 -z-20 size-full object-cover" />
    <div v-if="src" class="absolute inset-x-0 bottom-0 top-[35%] -z-10 photo-scrim" aria-hidden="true" />
    <!-- Автор — один раз, на самом фото (владелец, 2026-09-27); ссылка на профиль — требование Unsplash. -->
    <div v-if="author" class="absolute right-4 top-3 text-[11px]" :class="src ? 'opacity-75' : 'text-ink-3'">
      <a v-if="authorUrl" :href="authorUrl" target="_blank" rel="noreferrer noopener" class="underline-offset-2 hover:underline" @click.stop>Фото: {{ author }}</a>
      <template v-else>Фото: {{ author }}</template>
    </div>
    <!-- Угол слева — одна маленькая кнопка (сменить фото), чтобы действия не закрывали картинку. -->
    <div v-if="$slots.corner" class="absolute left-3 top-3"><slot name="corner" /></div>

    <template v-if="size !== 'preview'">
      <div class="text-[14px] font-medium" :class="src ? 'opacity-85' : 'text-ink-3'">До мечты</div>
      <div class="mb-2 mt-1 type-percent num">{{ pct }}&nbsp;%</div>
    </template>
    <div v-if="line2" class="text-[15px]" :class="src ? 'opacity-90' : 'text-ink-2'">{{ line2 }}</div>
    <ProgressBar v-if="size !== 'preview'" :value="pct / 100" :tone="src ? 'photo' : 'brand'" :height="4" class="mt-3.5" />
    <div v-if="$slots.actions" class="mt-3.5 flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
