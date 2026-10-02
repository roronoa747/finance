<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { money } from '@/lib/money'
import { plural } from '@/lib/utils'
import Card from './Card.vue'
import CountUp from './CountUp.vue'
import StackBar from './StackBar.vue'
import Tag from './Tag.vue'

/**
 * Карточка недели (DESIGN.md §5): сумма обоих, тег («по выпискам обоих» / «без выписки
 * <имя>»), стопка разделов, первые 4 строки и «ещё N разделов · не разобрано X», ссылка
 * «Неделя →». Суммы и доли считает `weekPicture` (`finance.ts`); здесь — только показ.
 * `unknownRow` — «Не разобрано» последней строкой списка (g2 «Неделя — итог»: «2 продавца ·
 * разобрать», нажатие — событие `unknown`) вместо хвоста в подвале.
 */
export type WeekSegment = { id: string; name: string; amount: number; share: number; color: string }

const props = withDefaults(
  defineProps<{
    total: number
    tag?: { text: string; tone: 'ok' | 'warn' | 'neutral' | 'brand' } | null
    /** Разделы без «не разобрано», по убыванию суммы. */
    segments: WeekSegment[]
    /** Сумма «не разобрано» (в стопке — `--s-unknown`). */
    unknown?: number
    unknownShare?: number
    rows?: number
    link?: { text: string; to: string } | null
    unknownRow?: { meta?: string; action?: boolean } | null
  }>(),
  { tag: null, unknown: 0, unknownShare: 0, rows: 4, link: null, unknownRow: null },
)

const emit = defineEmits<{ (e: 'unknown'): void }>()

const shown = computed(() => props.segments.slice(0, props.rows))
const more = computed(() => Math.max(0, props.segments.length - props.rows))
const stack = computed(() => [
  ...props.segments.map((s) => ({ key: s.id, share: s.share, color: s.color })),
  ...(props.unknown > 0 ? [{ key: '_unknown', share: props.unknownShare, color: 'var(--s-unknown)' }] : []),
])
const unknownLine = computed(() => props.unknown > 0 && !!props.unknownRow)
const footer = computed(() => {
  const parts: string[] = []
  if (more.value) parts.push(`ещё ${more.value} ${plural(more.value, 'раздел', 'раздела', 'разделов')}`)
  if (props.unknown > 0 && !props.unknownRow) parts.push(`не разобрано ${money(props.unknown)}`)
  return parts.join(' · ')
})
</script>

<template>
  <Card class="flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3">
      <span class="type-h3 money text-ink"><CountUp :value="total" :format="money" /></span>
      <Tag v-if="tag" :tone="tag.tone">{{ tag.text }}</Tag>
    </div>
    <StackBar v-if="stack.length" :segments="stack" />
    <div v-if="shown.length || unknownLine" class="flex flex-col">
      <div
        v-for="s in shown"
        :key="s.id"
        class="flex items-center gap-2.5 border-t border-line py-2.5 first:border-t-0 first:pt-0 last:pb-0"
      >
        <i class="size-[9px] shrink-0 rounded-full" :style="{ background: s.color }" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ s.name }}</span>
        <span class="money whitespace-nowrap text-ink">{{ money(s.amount) }}</span>
      </div>
      <component
        :is="unknownRow?.action ? 'button' : 'div'"
        v-if="unknownLine"
        :type="unknownRow?.action ? 'button' : undefined"
        class="flex w-full items-center gap-2.5 border-t border-line py-2.5 text-left first:border-t-0 first:pt-0 last:pb-0"
        :class="unknownRow?.action ? 'cursor-pointer' : ''"
        @click="unknownRow?.action && emit('unknown')"
      >
        <i class="size-[9px] shrink-0 rounded-full bg-s-unknown" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium text-ink">Не разобрано</span>
          <span v-if="unknownRow?.meta" class="block truncate type-meta">{{ unknownRow.meta }}</span>
        </span>
        <span class="money whitespace-nowrap text-ink">{{ money(unknown) }}</span>
        <svg v-if="unknownRow?.action" width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="ml-0.5 shrink-0 text-ink-3"><path d="M1 1l5.5 6L1 13" /></svg>
      </component>
    </div>
    <slot />
    <div v-if="footer || link" class="flex items-center justify-between gap-3 type-meta">
      <span class="min-w-0 truncate">{{ footer }}</span>
      <RouterLink v-if="link" :to="link.to" class="shrink-0 font-semibold text-brand">{{ link.text }}</RouterLink>
    </div>
  </Card>
</template>
