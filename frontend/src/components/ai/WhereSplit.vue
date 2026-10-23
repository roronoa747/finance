<script setup lang="ts">
import { computed } from 'vue'
import type { WherePart } from '@/lib/finance'
import { useGrow } from '@/lib/motion'

/**
 * «Куда ушло» на всю сумму (бэклог «Фидбек», Р-25, FB-17): одна полоса из четырёх частей — продавцы · люди · наличные ·
 * платежи — на свои доли (`whereSplit`, `finance.ts`), под ней подписи частей с долей; выходные — картинкой 7 дней
 * недели (сб–вс выделены) и одной долей (`weekendShare`). Цвета — токены (`--brand`, `--s5`, `--gold`, `--ink-3`), у
 * каждого пара тёмной темы. Чисел в ₸ нет — они в разделах ниже (правило 12: одна крупная цифра у предмета). Только показ.
 */
const props = withDefaults(defineProps<{ parts: WherePart[]; weekend?: { share: number; days: number } | null; play?: boolean }>(), { weekend: null, play: true })

const NAMES: Record<WherePart['key'], string> = { sellers: 'Продавцы', people: 'Люди', cash: 'Наличные', payments: 'Платежи' }
const COLOR: Record<WherePart['key'], string> = { sellers: 'bg-brand', people: 'bg-s5', cash: 'bg-gold', payments: 'bg-ink-3' }
const shown = computed(() => props.parts.filter((p) => p.amount > 0))
const grown = useGrow()
const DAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']
</script>

<template>
  <div class="flex flex-col" data-where-split>
    <span class="flex h-[14px] w-full gap-[3px] overflow-hidden rounded-pill bg-track" aria-hidden="true">
      <i
        v-for="p in shown"
        :key="p.key"
        class="block h-full rounded-pill transition-[flex-grow] duration-(--motion-fill) ease-(--ease-out)"
        :class="COLOR[p.key]"
        :style="{ flexGrow: grown && play ? Math.max(p.share, 1) : 0, flexBasis: 0 }"
        :data-split-part="p.key"
      />
    </span>
    <ul class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
      <li v-for="p in shown" :key="p.key" class="flex items-center gap-2 text-[14px] text-ink" :data-split-label="p.key">
        <i class="block size-2.5 shrink-0 rounded-full" :class="COLOR[p.key]" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ NAMES[p.key] }}</span>
        <b class="ml-auto font-semibold num">{{ p.share }}&nbsp;%</b>
      </li>
    </ul>
    <div v-if="weekend" class="mt-5 flex items-center gap-3" data-where-weekend>
      <span class="flex gap-1" aria-hidden="true">
        <i v-for="(d, i) in DAYS" :key="d" class="grid h-6 w-6 place-items-center rounded-[7px] text-[10.5px] font-semibold not-italic" :class="i >= 5 ? 'bg-brand text-brand-ink' : 'bg-surface-2 text-ink-2'">{{ d }}</i>
      </span>
      <span class="text-[14px] text-ink num" data-where-weekend-share>{{ weekend.share }}&nbsp;% — в выходные</span>
    </div>
  </div>
</template>
