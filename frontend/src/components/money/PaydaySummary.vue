<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { plain } from '@/lib/money'
import { dayLabel } from '@/lib/dates'
import { salaryAsk, totalIncome, untilPayday } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Card from '@/components/kit/Card.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import PaidRow from '@/components/PaidRow.vue'
import SalaryRow from '@/components/SalaryRow.vue'

/**
 * Сводка «До зарплаты» (пивот 3, Р-32) вместо «Впереди»: дни до ближайшей зарплаты, сколько
 * списаний до неё и на какую сумму, хватает ли на счетах — всё из `untilPayday` (оплаченное в
 * своём месяце в сумму не входит). Нажатие — лист с теми же строками («Оплатил» — участнику) и
 * строкой зарплаты. «Пришла зарплата» — здесь же по `salaryAsk`, как было в «Деньгах» (Р-39);
 * `quiet` — на экране уже есть брендовое действие («Распределить», правило 12).
 */
defineProps<{ quiet?: boolean }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()
const open = ref(false)

// Остатки общих счетов и долгов — из отметок, как их отдаёт стор.
const info = computed(() =>
  totalIncome(financeStore.people) > 0
    ? untilPayday({
        people: financeStore.people,
        obligations: financeStore.obligations,
        credits: financeStore.credits,
        accounts: financeStore.householdAccounts,
        payments: financeStore.payments,
      })
    : null,
)

const title = computed(() => {
  const d = info.value?.inDays ?? 0
  return d === 0 ? 'Зарплата сегодня' : `До зарплаты ${d} ${plural(d, 'день', 'дня', 'дней')}`
})
const meta = computed(() => {
  const p = info.value
  if (!p) return ''
  const k = p.due.length
  const head = k ? `${k} ${plural(k, 'списание', 'списания', 'списаний')} · ${plain(p.dueTotal)} ₸` : 'Списаний нет'
  return p.knowsCash && p.shortfall >= 0 ? `${head} · остаётся ${plain(p.shortfall)} ₸` : head
})

const salaryHere = computed(
  () =>
    !authStore.isViewer &&
    !!salaryAsk({ people: financeStore.people, obligations: financeStore.obligations, credits: financeStore.credits, payments: financeStore.payments }, authStore.slot),
)
</script>

<template>
  <Card v-if="info" tight class="flex flex-col gap-1">
    <button type="button" class="flex flex-col gap-1 text-left cursor-pointer" aria-haspopup="dialog" @click="open = true">
      <span class="flex w-full items-center justify-between gap-3">
        <span class="type-h3 text-ink">{{ title }}</span>
        <Tag v-if="info.knowsCash && info.shortfall >= 0" tone="ok">хватает</Tag>
        <Tag v-else-if="info.knowsCash" tone="warn" class="num">не хватает {{ plain(-info.shortfall) }} ₸</Tag>
        <PhCaretRight v-else :size="16" class="shrink-0 text-ink-3" />
      </span>
      <span class="type-meta num">{{ meta }}</span>
      <span v-if="!info.knowsCash" class="type-meta">Добавьте счёт — покажем, хватит ли</span>
    </button>
    <SalaryRow v-if="salaryHere" button :quiet="quiet" :person-id="info.who.id" :period="info.key" />
  </Card>

  <Sheet :open="open && !!info" title="До зарплаты" @close="open = false">
    <div v-if="info" class="-mx-1 flex flex-col">
      <PaidRow
        v-for="d in [...info.due, ...info.paid]"
        :key="d.id"
        dense
        :kind="d.kind"
        :target-id="d.targetId"
        :period="d.when"
        :title="d.name"
        :note="dayLabel(d.day, d.when)"
      />
      <SalaryRow dense :person-id="info.who.id" :period="info.key" :note="dayLabel(info.day, info.key)" />
    </div>
  </Sheet>
</template>
