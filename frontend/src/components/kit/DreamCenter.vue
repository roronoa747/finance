<script setup lang="ts">
import { computed } from 'vue'
import { PhHeart } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import AdviceMark from '@/components/ai/AdviceMark.vue'
import CountUp from './CountUp.vue'

/**
 * Мечта по центру (пивот 3, Р-42): фото квадратом 236 со скруглением 32, под ним одна строка «<название> · N %»
 * средним размером (владелец, 2026-10-15, FR-09: процент не крупной цифрой, серой строки «ближе на N дней» / «на паузе» нет —
 * срок, пауза и траты поездки живут на экране цели; исключение — метка «мечта сдвинулась» `note`, Р-6 «ИИ-польза», только
 * при сдвиге от недели). Процент бежит (`CountUp`). Нажатие на фото или строку — `open`
 * (экран цели). Слот `actions` — под строкой («Добавить фото»). `empty` — «На что копим?» с одной брендовой «Выбрать
 * мечту» (у viewer без кнопки). Процент считает `finance.ts` — здесь только вывод.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    percent?: number
    src?: string | null
    author?: string | null
    empty?: boolean
    canPick?: boolean
    /** Метка «мечта сдвинулась» (AU-06, Р-6): тихая строка под названием, точка — `warn` дальше, `ok` ближе. */
    note?: string | null
    noteTone?: 'warn' | 'ok'
    /** Номер совета ИИ про главную мечту (бэклог «Разбор», RZ-11) — ✦ после строки «название · %»; нет — ничего. */
    mark?: number | null
  }>(),
  { title: '', percent: 0, src: null, author: null, empty: false, canPick: true, note: null, noteTone: 'warn', mark: null },
)

const emit = defineEmits<{ (e: 'open'): void; (e: 'pick'): void }>()

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.percent))))
// «·» и процент держатся за название — одним куском.
const NBSP = ' '
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
    <!-- Кнопка — строка «название · %», растянутая на фото и строку (`row-open`); ✦ совета ИИ — рядом своей кнопкой (RZ-11). -->
    <div class="press fx-in relative flex cursor-pointer flex-col items-center gap-2.5 rounded-[32px] text-center" @click="emit('open')">
      <span class="relative block size-[236px] overflow-hidden rounded-[32px] bg-surface-3">
        <img v-if="src" :src="src" alt="" class="size-full object-cover" />
        <PhHeart v-else :size="44" class="absolute inset-0 m-auto text-ink-3" aria-hidden="true" />
        <!-- Автор — на самом фото, как в герое (Р-28: требование Unsplash). -->
        <span v-if="author" class="absolute right-3 top-2 text-[11px]" :class="src ? 'text-on-photo opacity-75' : 'text-ink-2'">Фото: {{ author }}</span>
      </span>
      <span class="flex max-w-[300px] items-center justify-center">
        <button type="button" class="row-open text-balance text-[20px] font-semibold leading-snug text-ink" :aria-label="`${title}: ${pct} %`" data-hero-line>
          {{ title }}{{ NBSP }}·{{ NBSP }}<span class="font-num font-bold num"><CountUp :value="pct" :format="percentText" /></span>
        </button>
        <AdviceMark :n="mark ?? null" />
      </span>
      <span v-if="note" class="-mt-1 flex max-w-[300px] items-start gap-1.5 text-[13px] text-ink-2" data-hero-note>
        <i class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="noteTone === 'ok' ? 'bg-ok' : 'bg-warn'" aria-hidden="true" />{{ note }}
      </span>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap justify-center gap-2">
      <slot name="actions" />
    </div>
  </section>
</template>
