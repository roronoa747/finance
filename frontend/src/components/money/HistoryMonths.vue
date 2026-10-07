<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { plain } from '@/lib/money'
import { MONTHS_NOM, monthKey, parseMonthKey } from '@/lib/dates'
import Card from '@/components/kit/Card.vue'
import HistorySquare from '@/components/money/HistorySquare.vue'

/**
 * «История» — месяцы (Блок 16, Р-111; макет money-b16.html): до 12 прошлых месяцев — «<Месяц> · осталось N» и
 * зелёным «+отложили M», нажатие — «План · Месяц» того месяца (`/month?month=`, сводка `monthPlanPast` — те же числа).
 * Внизу тихое «Все записи ›» — прежняя лента (`HistorySquare`, Р-35), свёрнута. Числа — `historyMonths` (стор: `historyMonthsNow`).
 */
const router = useRouter()
const finance = useFinanceStore()

const months = computed(() => finance.historyMonthsNow())
const thisYear = computed(() => parseMonthKey(monthKey()).year)
function title(key: string): string {
  const { year, month } = parseMonthKey(key)
  return MONTHS_NOM[month] + (year !== thisYear.value ? ` ${year}` : '')
}

const feedOpen = ref(false)
</script>

<template>
  <Card v-if="months.length" flush data-history-months>
    <button
      v-for="m in months"
      :key="m.key"
      type="button"
      class="press flex w-full cursor-pointer items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-2"
      :data-history-month="m.key"
      @click="router.push(`/month?month=${m.key}`)"
    >
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class="text-[15px] font-semibold text-ink">{{ title(m.key) }}</span>
        <span class="type-meta num" data-left>осталось {{ plain(m.left) }}</span>
      </span>
      <span v-if="m.put > 0" class="shrink-0 text-[15px] font-semibold num text-ok" data-put>+{{ plain(m.put) }}</span>
      <PhCaretRight :size="14" class="shrink-0 text-ink-3" />
    </button>
  </Card>
  <p v-if="months.length" class="px-1 type-meta">Зелёным — сколько отложили за месяц</p>
  <p v-else class="px-1 py-2 type-meta" data-history-empty>Здесь появятся прошлые месяцы</p>

  <!-- Прежняя лента — свёрнута (правило 12) -->
  <button
    type="button"
    class="press flex w-full cursor-pointer items-center justify-between gap-3 rounded-[16px] border border-card-border bg-surface px-4 py-3 text-left text-[15px] font-semibold text-ink"
    :aria-expanded="feedOpen"
    data-history-feed
    @click="feedOpen = !feedOpen"
  >
    Все записи
    <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="feedOpen && 'rotate-90'" />
  </button>
  <div v-show="feedOpen" class="flex flex-col gap-3" data-history-feed-body>
    <HistorySquare />
  </div>
</template>
