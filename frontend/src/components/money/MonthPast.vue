<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, plain } from '@/lib/money'
import { monthPlanPast } from '@/lib/finance'
import { usePhotos } from '@/lib/photos/usePhoto'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import Card from '@/components/kit/Card.vue'
import MonthRing from '@/components/money/MonthRing.vue'

/**
 * Прошлый месяц сводкой (Р-85, макет month-plan.html «Сентябрь»): только чтение — пришло, платежи, траты,
 * отложили, осталось и взносы по целям. Всё из `monthPlanPast`: записи «Отложить по плану», старые разборы и
 * раскладки читаются как были.
 */
const props = defineProps<{ monthKey: string }>()

const finance = useFinanceStore()
const fx = useFxStore()

const past = computed(() => monthPlanPast({ ...finance.householdDoc, credits: finance.credits, book: fx.book }, props.monthKey))
const parts = computed(() => [
  { key: 'paid', amount: past.value.paid, color: '--s1' },
  { key: 'spent', amount: past.value.spent ?? 0, color: '--s8' },
  { key: 'saved', amount: past.value.put, color: '--s3' },
])
const income = computed(() => past.value.cameBy.map((x) => ({ ...x, came: true })))
const goalOf = (id: string) => finance.goals.find((g) => g.id === id)
const photos = usePhotos(() => past.value.goals.map((g) => goalOf(g.goalId)?.photoId))
</script>

<template>
  <div class="flex flex-col gap-3" data-month-past>
    <MonthRing :income="income" :parts="parts" :total="past.came" :size="150">
      <span class="type-section">Осталось</span>
      <span class="font-num text-[19px] font-bold num" :class="past.left < 0 ? 'text-warn' : 'text-ink'">{{ money(past.left) }}</span>
    </MonthRing>

    <Card class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between text-[15px] text-ink"><span>Пришло</span><b class="font-num num">{{ money(past.came) }}</b></div>
      <div class="flex items-baseline justify-between text-[15px] text-ink"><span>Платежи</span><b class="font-num num">{{ money(past.paid) }}</b></div>
      <div class="flex items-baseline justify-between text-[15px] text-ink">
        <span>Траты</span><b class="font-num num">{{ past.spent === null ? '—' : money(past.spent) }}</b>
      </div>
      <div class="flex items-baseline justify-between text-[15px] text-ink"><span>Отложили</span><b class="font-num num text-ok">{{ money(past.saved) }}</b></div>
      <div v-if="past.prepaid > 0" class="flex items-baseline justify-between text-[15px] text-ink">
        <span>Досрочно в долг</span><b class="font-num num">{{ money(past.prepaid) }}</b>
      </div>
      <div class="flex items-baseline justify-between text-[15px] text-ink"><span>Осталось</span><b class="font-num num">{{ money(past.left) }}</b></div>
    </Card>

    <Card v-if="past.goals.length" flush class="px-3.5 py-0.5">
      <div v-for="g in past.goals" :key="g.goalId" class="flex items-center gap-2.5 border-t border-line py-2.5 first:border-t-0">
        <span
          class="block size-12 shrink-0 overflow-hidden rounded-[13px] bg-surface-3"
          :style="!goalOf(g.goalId)?.photoId && goalOf(g.goalId) ? { background: hueColor(goalOf(g.goalId)!.hue, isDark) } : undefined"
        >
          <img v-if="goalOf(g.goalId)?.photoId && photos[goalOf(g.goalId)!.photoId!]" :src="photos[goalOf(g.goalId)!.photoId!]!" alt="" class="size-full object-cover" />
        </span>
        <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ g.name }}</span>
        <span class="font-num text-[15px] font-bold num text-ink">{{ plain(g.amount) }}</span>
      </div>
    </Card>
  </div>
</template>
