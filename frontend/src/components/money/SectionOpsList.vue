<script setup lang="ts">
import { PhCaretRight, PhPencilSimple } from '@phosphor-icons/vue'
import type { SectionMonth } from '@/lib/finance'
import { money } from '@/lib/money'
import { dayWeekdayLabel } from '@/lib/dates'
import Button from '@/components/ui/Button.vue'

/**
 * Свои операции месяца по дням (FB-05, Р-14) — лист раздела «Месяца» и лист «Разовые» (FB-07): первые пять и тихое
 * «Ещё N · сумма»; строка выписки — лист операции (`open`), ручная — «Трата» (`hand`). Числа — из `sectionMonth`.
 * Строка с повтором продавца (`recurring`, лист «Платежи без отметки», Х-6) — небольшая «В платежи» у суммы (`pay`).
 */
defineProps<{ ops: SectionMonth }>()
const emit = defineEmits<{
  /** «Ещё N» — родитель отдаёт все строки (`ops` без `limit`). */
  (e: 'more'): void
  /** Строка выписки или с телефона — лист операции. */
  (e: 'open', id: string): void
  /** Ручная трата — лист «Трата». */
  (e: 'hand', id: string): void
  /** «В платежи» у строки — лист нового платежа (`AddPaymentSheet`). */
  (e: 'pay', id: string): void
}>()
</script>

<template>
  <p class="mt-4 text-[13px] font-semibold text-ink-2 num" data-cat-ops-title>Мои операции · {{ ops.count }}</p>
  <div class="flex flex-col" data-cat-ops>
    <template v-for="d in ops.days" :key="d.date">
      <p class="pb-1 pt-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">{{ dayWeekdayLabel(d.date) }}</p>
      <div v-for="o in d.ops" :key="o.id" class="flex items-center gap-2 border-t border-line">
        <button
          type="button"
          class="press flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-[7px] text-left text-[14.5px] text-ink"
          :aria-label="o.hand ? `Поправить: ${o.name}` : o.name"
          :data-cat-op="o.id"
          @click="o.hand ? emit('hand', o.id) : emit('open', o.id)"
        >
          <span class="min-w-0 flex-1 truncate">{{ o.name }}<span v-if="o.oneOff" class="ml-1.5 type-meta" data-oneoff>разовая</span></span>
          <span v-if="o.refund" class="shrink-0 type-meta num" data-refund>вернули {{ money(o.refund) }}</span>
          <b class="font-num font-semibold num">{{ money(o.amount) }}</b>
          <PhPencilSimple v-if="o.hand" :size="14" class="shrink-0 text-ink-3" aria-hidden="true" />
          <PhCaretRight v-else-if="!o.recurring" :size="14" class="shrink-0 text-ink-3" aria-hidden="true" />
        </button>
        <Button v-if="o.recurring" variant="secondary" size="xs" class="shrink-0" :data-cat-pay="o.id" @click="emit('pay', o.id)">В платежи</Button>
      </div>
    </template>
  </div>
  <button
    v-if="ops.more"
    type="button"
    class="press flex w-full cursor-pointer items-center justify-between px-0.5 py-2 text-left text-[15px] font-semibold text-ink-2"
    data-cat-ops-more
    @click="emit('more')"
  >
    <span class="num">Ещё {{ ops.more.count }} · {{ money(ops.more.amount) }}</span>
    <PhCaretRight :size="15" class="text-ink-3" />
  </button>
</template>
