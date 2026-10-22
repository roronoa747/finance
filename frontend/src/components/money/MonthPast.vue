<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { useFinanceStore } from '@/stores/finance'
import { useFxStore } from '@/stores/fx'
import { money, plain } from '@/lib/money'
import { liveSpendCategories, monthPlan, monthPlanPast, rkShare, sectionMonth, spendCompare, spendPlansBy } from '@/lib/finance'
import { plannedElsewhere } from '@/lib/statements/dictionary'
import type { PersonId } from '@/types/finance'
import Card from '@/components/kit/Card.vue'
import MonthRing from '@/components/money/MonthRing.vue'
import SpendCategorySheet from '@/components/money/SpendCategorySheet.vue'
import OpSheet from '@/components/OpSheet.vue'
import HandSpendSheet from '@/components/week/HandSpendSheet.vue'
import { useQueryValue } from '@/components/useQuerySheet'

/**
 * Прошлый месяц сводкой (Р-85, макет month-plan.html «Сентябрь»): только чтение — пришло, платежи, траты,
 * отложили, осталось и взносы по целям — короткими строками без фото (Р-92). Всё из `monthPlanPast`: записи «Отложить по плану», старые разборы и
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

/*
 * Лист раздела прошлого месяца по адресу `?month=<месяц>&cat=<id>` — строка «Куда ушло» и «Открыть» отчёта за месяц
 * находок (Х-9, владелец 2026-10-19, RZ-13): цифры того месяца, только чтение (закрытый месяц — без «Изменить»). Свои
 * (FB-12, Р-18): факт и план — мои; раздел без моих трат и плана — «нет трат»; viewer — листа нет. Карточка «Траты» —
 * семья, как была.
 */
const auth = useAuthStore()
const me = computed<PersonId>(() => auth.slot ?? 'a')
const { value: catFor, close: closeCat } = useQueryValue('cat')
const input = computed(() => finance.planInput(props.monthKey))
const catRow = computed(() =>
  catFor.value && !auth.isViewer ? (spendCompare(input.value.state, input.value.ctx, me.value).rows.find((r) => r.categoryId === catFor.value) ?? null) : null,
)
const catNone = computed(() => {
  const all = finance.householdDoc.spendCategories ?? []
  const c = catFor.value && !auth.isViewer && !catRow.value && !plannedElsewhere(catFor.value, all) ? liveSpendCategories(all).find((x) => x.id === catFor.value) : null
  return c?.name ?? null
})
const catRk = computed(() => (catRow.value?.group ? rkShare(input.value.state, input.value.ctx, catRow.value.group, me.value) : null))
const catPlans = computed(() =>
  catRow.value ? spendPlansBy(monthPlan(input.value.state, input.value.ctx), finance.people.filter((p) => !p.deletedAt && p.id === me.value), catRow.value.categoryId) : [],
)
/** Свои операции раздела за тот месяц (FB-05, Р-14) — как на «Месяце»; viewer — нет. */
const ops = useOperationsStore()
const catAll = ref(false)
watch(catFor, () => (catAll.value = false))
const catOps = computed(() => {
  if (!catFor.value || auth.isViewer) return null
  const { marked, categories } = ops.totalMarks(ops.shown)
  return sectionMonth(ops.shown, { month: props.monthKey, categoryId: catFor.value, marked, categories, ...(catAll.value ? { limit: Infinity } : {}) })
})
const catOp = ref<string | null>(null)
const catHand = ref<string | null>(null)
function openCatHand(id: string) {
  closeCat()
  catHand.value = id
}
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
        <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ g.name }}</span>
        <span class="font-num text-[15px] font-bold num text-ink">{{ plain(g.amount) }}</span>
      </div>
    </Card>

    <SpendCategorySheet
      :row="catRow"
      :rk="catRk"
      :plans="catPlans"
      :can-edit="false"
      :month="monthKey"
      :ops="catOps"
      :none="catNone"
      @close="closeCat"
      @more="catAll = true"
      @open="(id) => (catOp = id)"
      @hand="openCatHand"
    />
    <!-- Своя операция прошлого месяца — заметку и «Мне вернули» поправить можно (FB-05). -->
    <OpSheet :op-id="catOp" :z="60" @close="catOp = null" />
    <HandSpendSheet v-if="!auth.isViewer" :open="catHand !== null" :op-id="catHand" @close="catHand = null" />
  </div>
</template>
