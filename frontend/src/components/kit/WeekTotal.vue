<script setup lang="ts">
import { computed } from 'vue'
import { money } from '@/lib/money'
import { plural } from '@/lib/utils'
import Card from './Card.vue'
import CountUp from './CountUp.vue'
import StackBar from './StackBar.vue'
import Tag from './Tag.vue'
import type { WeekSegment } from './WeekCard.vue'

/**
 * Карточка недели «Недели» (пивот 3, макет `pivot-3/dreams-week.html` «А · Ритуал»): «Итог недели», крупная
 * сумма обоих (бежит — `CountUp`), чип против прошлой недели, полоса разделов и короткая легенда (до 4
 * разделов + «ещё N»), «Не разобрано · <сумма>» строкой. Суммы и доли — `weekPicture`, разница —
 * `weekVersusPrev` (`finance.ts`); здесь только показ. Даты недели — в подписи шапки.
 */
const props = withDefaults(
  defineProps<{
    total: number
    /** Разница с прошлой неделей, целый процент (`weekVersusPrev`); null — одной из недель нет. */
    delta?: number | null
    /** Разделы без «не разобрано», по убыванию суммы. */
    segments: WeekSegment[]
    unknown?: number
    unknownShare?: number
  }>(),
  { delta: null, unknown: 0, unknownShare: 0 },
)

const LEGEND = 4
const NBSP = ' '

const chip = computed(() => {
  const d = props.delta
  if (d === null) return null
  if (d === 0) return { text: 'как на прошлой', tone: 'neutral' as const }
  return d < 0 ? { text: `−${-d}${NBSP}% к прошлой`, tone: 'ok' as const } : { text: `+${d}${NBSP}% к прошлой`, tone: 'warn' as const }
})
const legend = computed(() => props.segments.slice(0, LEGEND))
const more = computed(() => Math.max(0, props.segments.length - LEGEND))
const stack = computed(() => [
  ...props.segments.map((s) => ({ key: s.id, share: s.share, color: s.color })),
  ...(props.unknown > 0 ? [{ key: '_unknown', share: props.unknownShare, color: 'var(--s-unknown)' }] : []),
])
</script>

<template>
  <Card class="flex flex-col gap-3">
    <div class="type-label">Итог недели</div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="type-big num text-[40px] text-ink"><CountUp :value="total" :format="money" /></span>
      <Tag v-if="chip" :tone="chip.tone">{{ chip.text }}</Tag>
    </div>
    <StackBar v-if="stack.length" :segments="stack" />
    <div v-if="legend.length" class="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-ink-2">
      <span v-for="s in legend" :key="s.id" class="inline-flex items-center gap-1.5">
        <i class="size-[8px] shrink-0 rounded-full" :style="{ background: s.color }" aria-hidden="true" />{{ s.name }}
      </span>
      <span v-if="more" class="text-ink-3">ещё {{ more }} {{ plural(more, 'раздел', 'раздела', 'разделов') }}</span>
    </div>
    <div v-if="unknown > 0" class="flex items-center gap-1.5 type-meta">
      <i class="size-[8px] shrink-0 rounded-full bg-s-unknown" aria-hidden="true" />
      <span>Не разобрано · <span class="num">{{ money(unknown) }}</span></span>
    </div>
  </Card>
</template>
