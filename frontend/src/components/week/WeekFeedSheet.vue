<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { dayWeekdayLabel } from '@/lib/dates'
import { liveSpendCategories, type WeekFeedOp } from '@/lib/finance'
import { spendColor } from '@/lib/palette'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { plural } from '@/lib/utils'
import Sheet from '@/components/kit/Sheet.vue'
import OpRow from '@/components/kit/OpRow.vue'
import OpSheet from '@/components/OpSheet.vue'

/**
 * Лента трат недели (бэклог «Лента недели», Р-1): свои траты по дням — с телефона (значок) и из выписки вместе.
 * Строка — `OpRow` (продавец коротко, раздел, сумма, «вернули»); нажатие — лист операции (`OpSheet`) поверх ленты, у ручной
 * траты — `edit` (лист «Трата», бэклог «Ручная трата», Р-2: её раздел выбрал человек, правило по продавцу ей не нужно). Только свои
 * операции (стор отдаёт свои, Р-5) — партнёр видит лишь итоги разделов. Ничего не считает: лента — `weekFeed`.
 */
const props = defineProps<{ open: boolean; week: string; feed: { count: number; days: { date: string; ops: WeekFeedOp[] }[] } }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', id: string): void }>()

const finance = useFinanceStore()
const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
function category(id: string) {
  if (id === UNKNOWN_CATEGORY) return null
  const c = categories.value.find((x) => x.id === id)
  return c ? { name: c.name, color: spendColor(c) } : null
}
const opOpen = ref<string | null>(null)
function tap(o: WeekFeedOp) {
  if (o.hand) emit('edit', o.id)
  else opOpen.value = o.id
}
// Под заголовком «История» — одна строка «N операций» (К-5, Р-14 «Figma»: счётчик переехал сюда со строки «Недели»).
const meta = computed(() => `${props.feed.count} ${plural(props.feed.count, 'операция', 'операции', 'операций')}`)
</script>

<template>
  <Sheet :open="open" title="История" @close="emit('close')">
    <p class="mb-1 type-meta num" data-feed-meta>{{ meta }}</p>
    <div class="flex flex-col" data-feed>
      <template v-for="d in feed.days" :key="d.date">
        <p class="pb-1 pt-3 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2" data-feed-day>{{ dayWeekdayLabel(d.date) }}</p>
        <div>
          <OpRow
            v-for="o in d.ops"
            :key="o.id"
            :merchant="o.name"
            :category="category(o.categoryId)"
            :amount="-o.amount"
            :phone="o.phone"
            :refund="o.refund"
            :one-off="o.oneOff"
            clickable
            :data-feed-op="o.id"
            @click="tap(o)"
          />
        </div>
      </template>
    </div>
    <p v-if="!feed.count" class="py-2 type-meta">За эту неделю трат нет</p>
  </Sheet>
  <OpSheet :op-id="opOpen" :z="60" @close="opOpen = null" />
</template>
