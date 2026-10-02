<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowDown, PhArrowUp } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money } from '@/lib/money'
import { MONTHS_NOM, addMonths, dayLabel, monthKey, parseMonthKey } from '@/lib/dates'
import {
  hasMonthSummary,
  historyCategories,
  historyFeed,
  historyStart,
  monthSummary,
  progressMoments,
  liveSpendCategories,
  salaryAllocationPath,
  spendCategoryName,
  summaryMonth,
  type HistoryItem,
} from '@/lib/finance'
import { spendColor } from '@/lib/palette'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { ruleMatchOf } from '@/lib/statements/model'
import type { MerchantRule, Operation } from '@/lib/statements/types'
import type { Payment } from '@/types/finance'

import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import Chip from '@/components/kit/Chip.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import OpRow from '@/components/kit/OpRow.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import MonthSummaryCard from '@/components/MonthSummaryCard.vue'

/**
 * Квадрат «История» (пивот 3, Р-35; макет `pivot-3/index.html`, «История»): чипы фильтра, итог
 * месяца строкой (лист с карточкой и «Поделиться»), лента по дням — свои операции из выписок,
 * отметки семьи и моменты. Партнёр видит отметки, итоги и моменты, но не чужие покупки (Р-5: стор
 * операций отдаёт только свои). Раздел задним числом — по нажатию на операцию; отметка — её лист.
 * Ничего не считает: лента, разделы и итог — `finance.ts`.
 */
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()

const key = computed(() => monthKey())
const canEdit = computed(() => !authStore.isViewer)

/* ------------------ Период и лента ------------------ */
const months = ref<string[]>([key.value])
const moments = computed(() => progressMoments({ credits: financeStore.householdDoc.credits, goals: financeStore.goals, payments: financeStore.payments }))
const source = computed(() => ({ ops: ops.all, payments: financeStore.payments, moments: moments.value }))
const feed = computed(() => historyFeed(source.value, months.value))
const start = computed(() => historyStart(source.value))
const canEarlier = computed(() => !!start.value && start.value < months.value[months.value.length - 1])
const earlier = () => months.value.push(addMonths(months.value[months.value.length - 1], -1))

/* ------------------ Фильтр ------------------ */
type Filter = 'all' | 'ops' | 'marks' | string
const filter = ref<Filter>('all')
const spendCategories = computed(() => liveSpendCategories(financeStore.householdDoc.spendCategories))
const categoryOf = (id: string | null) => spendCategories.value.find((c) => c.id === id) ?? null
const chips = computed(() =>
  historyCategories(ops.all, months.value).map((id) => ({ id, name: spendCategoryName(spendCategories.value, id) })),
)
const shown = computed(() =>
  feed.value
    .map((d) => ({
      day: d.day,
      items: d.items.filter((x) => {
        if (filter.value === 'all') return true
        if (filter.value === 'ops') return x.kind === 'op'
        if (filter.value === 'marks') return x.kind === 'mark'
        return x.kind === 'op' && !x.op.internal && x.op.amount < 0 && (x.op.categoryId ?? UNKNOWN_CATEGORY) === filter.value
      }),
    }))
    .filter((d) => d.items.length),
)
const dayTitle = (day: string) => dayLabel(Number(day.slice(8, 10)), day.slice(0, 7))

/* ------------------ Итог месяца ------------------ */
// В последние и первые дни — `summaryMonth()`, в середине месяца — прошлый.
const summaryKey = computed(() => summaryMonth() ?? addMonths(key.value, -1))
const hasSummary = computed(() =>
  hasMonthSummary(
    monthSummary(
      { credits: financeStore.householdDoc.credits, goals: financeStore.goals, payments: financeStore.payments, wishlist: financeStore.wishlist },
      summaryKey.value,
    ),
  ),
)
const summaryOpen = ref(false)

/* ------------------ Строки ------------------ */
const personName = (id: string) => financeStore.people.find((p) => p.id === id)?.name ?? ''
const targetName = (p: Payment) =>
  p.kind === 'obligation'
    ? (financeStore.obligations.find((o) => o.id === p.targetId)?.name ?? 'Платёж')
    : (financeStore.credits.find((c) => c.id === p.targetId)?.name ?? 'Кредит')

/** Буква операции: у «ИП …» — «ИП», иначе первая буква продавца. */
const letter = (o: Operation) => (/^ИП\s/i.test(o.merchant) ? 'ИП' : o.merchant.slice(0, 1).toUpperCase())
const opCategory = (o: Operation) => {
  if (o.internal) return { name: 'между своими · не трата', color: 'var(--s12)' }
  const c = categoryOf(o.categoryId)
  return c ? { name: c.name, color: spendColor(c) } : null
}

function markLine(p: Payment): { title: string; note: string; value: string; plus: boolean } {
  const by = personName(p.by)
  const statement = p.source === 'statement' ? ' · из выписки' : ''
  if (p.kind === 'salary') return { title: `Зарплата · ${personName(p.targetId)}`, note: `пришла · отметка${statement}`, value: `+${money(p.amount)}`, plus: true }
  if (p.kind === 'prepay') {
    return { title: `Досрочка в «${targetName(p)}»`, note: `${money(p.saved ?? 0)} не отдадим банку · ${by}`, value: `−${money(p.amount)}`, plus: false }
  }
  return { title: targetName(p), note: `оплачено · ${by}${statement}`, value: `−${money(p.amount)}`, plus: false }
}

function momentLine(x: Extract<HistoryItem, { kind: 'moment' }>) {
  const m = x.moment
  if (m.kind === 'half') return { title: `«${m.name}»: собрали половину`, note: 'момент', to: null }
  if (m.kind !== 'closed') return { title: '', note: '', to: null }
  // Платёж долга из плана «Сначала долги» уже идёт в следующий долг — решать нечего.
  const inPlan = !!financeStore.activePlan?.creditIds.includes(m.creditId)
  return {
    title: `«${m.name}» закрыт`,
    note: inPlan ? 'его платёж идёт в следующий долг по плану' : `освободилось ${money(m.freed)} в месяц`,
    // Раскладка — решение: viewer его не принимает (Р-13).
    to: canEdit.value ? (inPlan ? '/money/plan' : `/week/salary?from=credit&credit=${m.creditId}`) : null,
  }
}

/* ------------------ Листы ------------------ */
// Раздел задним числом: правило по продавцу, итоги и «Свободно» пересчитывает стор.
const opOpen = ref<Operation | null>(null)
function recategorize(to: MerchantRule['to']) {
  if (opOpen.value) void ops.recategorize(ruleMatchOf(opOpen.value), to)
  opOpen.value = null
}
// Отметка — её лист (снять отметку, «Разложить» у зарплаты); у досрочки листа отметки нет.
const markOpen = ref<Payment | null>(null)
</script>

<template>
  <!-- Чипы фильтра -->
  <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Фильтр">
    <Chip :on="filter === 'all'" @click="filter = 'all'">Всё</Chip>
    <Chip :on="filter === 'ops'" @click="filter = 'ops'">Операции</Chip>
    <Chip :on="filter === 'marks'" @click="filter = 'marks'">Отметки</Chip>
    <Chip v-for="c in chips" :key="c.id" :on="filter === c.id" class="shrink-0 whitespace-nowrap" @click="filter = c.id">{{ c.name }}</Chip>
  </div>

  <!-- Итог — строкой, карточка «Наш месяц» с «Поделиться» — в листе -->
  <Card v-if="hasSummary" flush>
    <Row
      :title="`Наш ${MONTHS_NOM[parseMonthKey(summaryKey).month].toLowerCase()}`"
      note="итог месяца · поделиться"
      clickable
      @click="summaryOpen = true"
    />
  </Card>

  <!-- Лента по дням -->
  <template v-for="d in shown" :key="d.day">
    <div class="mt-1 px-1 type-section">{{ dayTitle(d.day) }}</div>
    <Card tight>
      <template v-for="x in d.items" :key="x.kind + x.id">
        <OpRow
          v-if="x.kind === 'op'"
          :merchant="x.op.merchant"
          :letter="letter(x.op)"
          :category="opCategory(x.op)"
          :amount="x.op.amount"
          :muted="x.op.internal"
          :clickable="canEdit && !x.op.internal"
          @click="opOpen = x.op"
        />
        <Row
          v-else-if="x.kind === 'mark'"
          dense
          :title="markLine(x.payment).title"
          :note="markLine(x.payment).note"
          :clickable="canEdit && x.payment.kind !== 'prepay'"
          @click="markOpen = x.payment"
        >
          <template #icon>
            <Avatar v-if="x.payment.kind === 'salary'" :id="x.payment.targetId as 'a'" :name="personName(x.payment.targetId)" :size="34" />
            <PhArrowUp v-else-if="markLine(x.payment).plus" :size="15" weight="bold" />
            <PhArrowDown v-else :size="15" weight="bold" />
          </template>
          <template #value>
            <span class="block text-[14.5px] font-semibold num" :class="markLine(x.payment).plus ? 'text-ok' : 'text-ink'">{{ markLine(x.payment).value }}</span>
          </template>
        </Row>
        <Row
          v-else
          dense
          :title="momentLine(x).title"
          :note="momentLine(x).note"
          :clickable="!!momentLine(x).to"
          @click="momentLine(x).to && router.push(momentLine(x).to!)"
        />
      </template>
    </Card>
  </template>

  <Card v-if="!feed.length">
    <EmptyState title="Пока пусто">
      <Button v-if="canEdit" variant="secondary" @click="router.push('/week?upload=1')">Загрузить выписку</Button>
    </EmptyState>
  </Card>
  <p v-else-if="!shown.length" class="px-1 type-meta">Здесь пока ничего.</p>

  <Button v-if="canEarlier" variant="ghost" class="w-full" @click="earlier">Раньше</Button>

  <!-- Листы -->
  <Sheet :open="summaryOpen && hasSummary" title="Итог месяца" @close="summaryOpen = false">
    <MonthSummaryCard :month="summaryKey" />
  </Sheet>

  <Sheet :open="!!opOpen" :title="opOpen ? `${opOpen.merchant} — куда отнести?` : ''" @close="opOpen = null">
    <template v-if="opOpen">
      <p class="mb-3 type-meta num">{{ dayTitle(opOpen.date) }} · {{ money(Math.abs(opOpen.amount)) }}</p>
      <CategoryChips :counterparty="!!opOpen.counterparty" @choose="recategorize" />
      <p class="mt-3 text-[12px] text-ink-3">Ответ запомним — такие строки разложатся сами.</p>
    </template>
  </Sheet>

  <MarkSheet
    v-if="markOpen && markOpen.kind !== 'prepay'"
    open="paid"
    :kind="markOpen.kind"
    :target-id="markOpen.targetId"
    :period="markOpen.period"
    :title="markOpen.kind === 'salary' ? `Зарплата · ${personName(markOpen.targetId)}` : targetName(markOpen)"
    @close="markOpen = null"
    @allocate="router.push(salaryAllocationPath(markOpen!.targetId as 'a', markOpen!.period))"
  />
</template>
