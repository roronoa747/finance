<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { money } from '@/lib/money'
import { dayLabel } from '@/lib/dates'
import { tripSpent, type TripStatus } from '@/lib/finance'
import { spendColor } from '@/lib/palette'
import type { Operation } from '@/lib/statements/types'
import type { Goal } from '@/types/finance'
import Card from '@/components/kit/Card.vue'
import OpRow from '@/components/kit/OpRow.vue'
import ProgressBar from '@/components/kit/ProgressBar.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Поездка в пути и после (PN-31, Р-14): «Потрачено N из M» — одна цифра у мечты; итог семьи — из записей участников
 * (`tripSpent`), строки — только свои (операции личные, Р-5). «Операции · N» и «Убрано · N» свёрнуты; «Убрать» снимает
 * строку с поездки (операция остаётся в выписке), «Вернуть» — назад. Viewer — итог без строк и действий.
 */
const props = defineProps<{ goal: Goal; status: Extract<TripStatus, 'during' | 'after'> }>()

const finance = useFinanceStore()
const auth = useAuthStore()
const operations = useOperationsStore()
const canEdit = computed(() => !auth.isViewer)

const spent = computed(() => tripSpent(props.goal, finance.householdDoc.tripSpends, finance.people))
const over = computed(() => spent.value.total > spent.value.budget)
const title = computed(() => `${props.status === 'during' ? 'Потрачено' : 'За поездку —'} ${money(spent.value.total)} из ${money(spent.value.budget)}`)
// Кто сколько — только когда тратили оба: у одного строка повторила бы итог.
const split = computed(() =>
  spent.value.byPerson.length > 1 ? spent.value.byPerson.map((x) => `${x.person === auth.slot ? 'Вы' : x.name} ${money(x.amount)}`).join(' · ') : '',
)

const lists = computed(() => (canEdit.value ? operations.tripLists(props.goal) : { ops: [], excluded: [] }))
const opsOpen = ref(false)
const excludedOpen = ref(false)
// «Убрать» — не удаление: строка остаётся в выписке и на «Неделе», только не в итоге поездки (личная запись).
const exclude = (o: Operation) => finance.excludeFromTrip(props.goal.id, o.id)
const include = (o: Operation) => finance.includeInTrip(o.id)

const categories = computed(() => finance.householdDoc.spendCategories ?? [])
const category = (o: Operation) => {
  const c = categories.value.find((x) => x.id === o.categoryId)
  return c ? { name: c.name, color: spendColor(c) } : null
}
const day = (iso: string) => dayLabel(Number(iso.slice(8, 10)), iso.slice(0, 7))
</script>

<template>
  <Card data-trip :data-trip-status="status">
    <h2 class="type-h2 num text-ink" data-trip-title>{{ title }}</h2>
    <ProgressBar class="mt-3" :value="spent.budget > 0 ? spent.total / spent.budget : 0" :tone="over ? 'warn' : 'brand'" />
    <p v-if="split" class="mt-2 text-[13.5px] text-ink-2 num" data-trip-split>{{ split }}</p>

    <template v-if="lists.ops.length">
      <button
        type="button"
        class="press -mx-1 mt-3 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-2 px-1 py-1.5 text-left text-[14.5px] font-medium text-ink"
        :aria-expanded="opsOpen"
        data-trip-ops-toggle
        @click="opsOpen = !opsOpen"
      >
        <span class="min-w-0 flex-1">Операции · {{ lists.ops.length }}</span>
        <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="opsOpen && 'rotate-90'" />
      </button>
      <div v-if="opsOpen" class="mt-1" data-trip-ops>
        <div v-for="o in lists.ops" :key="o.id" class="flex items-center gap-2 border-t border-line py-2.5 first:border-t-0" :data-trip-op="o.id">
          <OpRow class="min-w-0 flex-1 !border-t-0 !py-0" :merchant="o.merchant" :category="category(o)" :amount="o.amount" :date="day(o.date)" />
          <Button variant="ghost" size="sm" class="shrink-0 px-2" data-trip-exclude @click="exclude(o)">Убрать</Button>
        </div>
      </div>
    </template>

    <template v-if="lists.excluded.length">
      <button
        type="button"
        class="press -mx-1 mt-2 flex w-[calc(100%+0.5rem)] cursor-pointer items-center gap-2 px-1 py-1.5 text-left text-[14.5px] font-medium text-ink-2"
        :aria-expanded="excludedOpen"
        data-trip-excluded-toggle
        @click="excludedOpen = !excludedOpen"
      >
        <span class="min-w-0 flex-1">Убрано · {{ lists.excluded.length }}</span>
        <PhCaretRight :size="14" class="shrink-0 text-ink-3 transition-transform" :class="excludedOpen && 'rotate-90'" />
      </button>
      <div v-if="excludedOpen" class="mt-1" data-trip-excluded>
        <div v-for="o in lists.excluded" :key="o.id" class="flex items-center gap-2 border-t border-line py-2.5 first:border-t-0" :data-trip-excluded-op="o.id">
          <OpRow class="min-w-0 flex-1 !border-t-0 !py-0" :merchant="o.merchant" :category="category(o)" :amount="o.amount" :date="day(o.date)" muted />
          <Button variant="ghost" size="sm" class="shrink-0 px-2" data-trip-include @click="include(o)">Вернуть</Button>
        </div>
      </div>
    </template>
  </Card>
</template>
