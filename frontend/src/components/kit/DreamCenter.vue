<script setup lang="ts">
import { computed } from 'vue'
import { PhHeart } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import CountUp from './CountUp.vue'

/**
 * Мечта по центру (пивот 3, Р-42; макет dreams-week.html «А · Строки»): фото квадратом 236 со
 * скруглением 32, под ним процент 40 (`--font-num`, бежит — `CountUp`) и «<название> · <месяц год>».
 * Нажатие на фото, процент или подпись — `open` (экран цели). Слот `actions` — под подписью
 * («Добавить фото»). `empty` — «На что копим?» с одной брендовой «Выбрать мечту» (у viewer без кнопки).
 * Процент и месяц считает `finance.ts` — здесь только вывод.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    percent?: number
    src?: string | null
    author?: string | null
    /** «май 2027» — месяц, когда мечта будет вашей; нет срока — только название. */
    month?: string | null
    empty?: boolean
    canPick?: boolean
  }>(),
  { title: '', percent: 0, src: null, author: null, month: null, empty: false, canPick: true },
)

const emit = defineEmits<{ (e: 'open'): void; (e: 'pick'): void }>()

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))))
// «·» держится за название, месяц с годом — одним куском (смоук владельца Блока 3, п. 4).
const NBSP = ' '
const line = computed(() => (props.month ? `${props.title}${NBSP}· ${props.month.replace(/ /g, NBSP)}` : props.title))
const percentText = (n: number) => `${n}${NBSP}%`
</script>

<template>
  <section v-if="empty" class="fx-in flex flex-col items-center gap-3 self-center pt-2 text-center">
    <div class="grid size-[236px] place-items-center rounded-[32px] border border-dashed border-line-strong bg-surface text-ink-3" aria-hidden="true">
      <PhHeart :size="44" />
    </div>
    <h2 class="type-h2 text-ink">На что копим?</h2>
    <Button v-if="canPick" @click="emit('pick')">Выбрать мечту</Button>
  </section>

  <section v-else class="flex flex-col items-center gap-2.5 self-center pt-2 text-center">
    <button
      type="button"
      class="press fx-in flex flex-col items-center gap-2.5 rounded-[32px] text-center"
      :aria-label="`${title}: ${pct} %`"
      @click="emit('open')"
    >
      <span class="relative block size-[236px] overflow-hidden rounded-[32px] bg-surface-3">
        <img v-if="src" :src="src" alt="" class="size-full object-cover" />
        <PhHeart v-else :size="44" class="absolute inset-0 m-auto text-ink-3" aria-hidden="true" />
        <!-- Автор — на самом фото, как в герое (Р-28: требование Unsplash). -->
        <span v-if="author" class="absolute right-3 top-2 text-[11px]" :class="src ? 'text-on-photo opacity-75' : 'text-ink-2'">Фото: {{ author }}</span>
      </span>
      <span class="type-percent num leading-none text-ink"><CountUp :value="pct" :format="percentText" /></span>
      <span class="text-[15px] text-ink-2">{{ line }}</span>
    </button>
    <div v-if="$slots.actions" class="flex flex-wrap justify-center gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
