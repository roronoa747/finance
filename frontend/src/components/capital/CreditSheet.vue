<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import { dayLabel, monthKey } from '@/lib/dates'
import { creditOutlook, creditSchedule, creditTotals, liveCredits, nextCreditDue, planSchedule, type Due } from '@/lib/finance'
import type { Credit } from '@/types/finance'
import { plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import PaidRow from '@/components/PaidRow.vue'
import ScheduleTable from '@/components/ScheduleTable.vue'

/**
 * Окно кредита Капитала: «Оплатил» за ближайший платёж, правка полей (React
 * `CreditDialog`), выводы, график платежей, удаление. «Посчитать досрочное погашение»
 * просит Капитал открыть калькулятор (`payoff`).
 */
const props = defineProps<{ creditId: string | null }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'payoff', id: string): void
}>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

const activeCredit = computed(() => liveCredits(financeStore.credits).find((c) => c.id === props.creditId))
const creditSaved = useSavedMark(
  () => activeCredit.value?.id,
  () => activeCredit.value?.updatedAt,
)
const activeCreditOutlook = computed(() => (activeCredit.value ? creditOutlook(activeCredit.value) : null))
const activeCreditTotals = computed(() =>
  activeCredit.value ? creditTotals(financeStore.payments, activeCredit.value.id) : null,
)
// График — свёрнут по умолчанию и при смене кредита.
const scheduleOpen = ref(false)
watch(() => props.creditId, () => (scheduleOpen.value = false))
// Кредит, который гасит активный план, — график с его будущими шагами (Р-8).
const activeSchedule = computed(() => {
  const c = activeCredit.value
  if (!c || !scheduleOpen.value) return []
  const plan = financeStore.activePlan
  const withPlan = plan ? planSchedule(plan, financeStore.planState(), monthKey()) : null
  return withPlan?.creditId === c.id ? withPlan.rows : creditSchedule(c, financeStore.payments)
})
/** Ставка в поле правки — как в React: проценты с одним знаком. */
const rateText = (r: number) => (r * 100).toFixed(1).replace('.', ',')

// Поля пишутся по уходу из поля (React `CreditDialog`); остаток — только явным полем:
// это сверка с банком, она ставит якорь (RP-06).
function editCredit(patch: Partial<Credit>) {
  if (activeCredit.value) financeStore.updateCredit(activeCredit.value.id, patch)
}
function onCreditNameBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v && v !== activeCredit.value?.name) editCredit({ name: v })
}
function onCreditNoteBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v !== activeCredit.value?.note) editCredit({ note: v })
}
function onCreditPrincipal(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== activeCredit.value?.principal) editCredit({ principal: v })
}
function onCreditPayment(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== activeCredit.value?.payment) editCredit({ payment: v })
}
function onCreditRate(text: string) {
  const v = parseFloat(text.replace(',', '.'))
  // Ноль законен: рассрочка без процентов.
  if (Number.isFinite(v) && v >= 0) editCredit({ annualRate: v / 100 })
}
function onCreditDay(text: string) {
  const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
  if (v !== activeCredit.value?.day) editCredit({ day: v })
}

// Платёж, который модалка предлагает отметить, берётся при открытии: после
// «Оплатил» строка остаётся на этом месяце и показывает следующий платёж, а не
// перескакивает на следующий месяц с новой кнопкой. Правка дня, платежа или ставки
// меняет сам график — тогда снимок берётся заново.
const creditDue = ref<Due | null>(null)
watch(
  [
    () => activeCredit.value?.id,
    () => activeCredit.value?.day,
    () => activeCredit.value?.payment,
    () => activeCredit.value?.annualRate,
    // Закрытый долг снова открылся (сверка остатка, снятая синком отметка) — снимка
    // ещё нет. Сам остаток не следим: после «Оплатил», закрывшего долг, строка
    // оплаченного месяца должна остаться.
    () => !creditDue.value && (activeCredit.value?.principal ?? 0) > 0,
  ],
  () => {
    creditDue.value = activeCredit.value ? nextCreditDue(activeCredit.value, financeStore.payments) : null
  },
  { immediate: true },
)
</script>

<template>
  <Sheet :open="!!activeCredit" :title="activeCredit?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="creditSaved" />
    </template>
    <template v-if="activeCredit">
      <div v-if="creditDue" class="mb-3 rounded-xl border border-line px-3">
        <PaidRow
          dense
          more
          kind="credit"
          :target-id="activeCredit.id"
          :period="creditDue.period"
          :title="`Платёж ${dayLabel(creditDue.day, creditDue.period)}`"
          note="по графику"
        />
      </div>

      <p
        v-if="activeCreditTotals && activeCreditTotals.count > 0"
        class="-mt-1 mb-3 px-1 text-[12.5px] leading-relaxed text-ink-2 num"
      >
        За всё время: в долг {{ money(activeCreditTotals.body) }}, банку {{ money(activeCreditTotals.interest) }}
        ({{ activeCreditTotals.count }}
        {{ plural(activeCreditTotals.count, 'платёж', 'платежа', 'платежей') }})
      </p>

      <!-- Viewer видит цифры, но не правит (Р-12, матрица §3) -->
      <div
        v-if="authStore.isViewer"
        class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1.5"
      >
        <div class="flex justify-between">
          <span class="text-ink-2">Остаток долга</span>
          <b class="num text-ink">{{ money(activeCredit.principal) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">Платёж в месяц</span>
          <b class="num text-ink">{{ money(activeCredit.payment) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">Ставка (ГЭСВ)</span>
          <b class="num text-ink">{{ ratePct(activeCredit.annualRate, 1) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">День платежа</span>
          <b class="num text-ink">{{ activeCredit.day }}</b>
        </div>
      </div>
      <template v-else>
        <Field label="Название">
          <Input :default-value="activeCredit.name" class="mb-3" @blur="onCreditNameBlur" />
        </Field>
        <Field label="Остаток долга, ₸">
          <NumFieldBlur :initial="plain(activeCredit.principal)" class="mb-3" @commit="onCreditPrincipal" />
        </Field>
        <Field label="Платёж в месяц, ₸">
          <NumFieldBlur :initial="plain(activeCredit.payment)" class="mb-3" @commit="onCreditPayment" />
        </Field>
        <Field label="Ставка (ГЭСВ), % годовых">
          <NumFieldBlur :initial="rateText(activeCredit.annualRate)" kind="rate" class="mb-3" @commit="onCreditRate" />
        </Field>
        <Field label="День платежа">
          <NumFieldBlur :initial="String(activeCredit.day)" kind="int" class="mb-3" @commit="onCreditDay" />
        </Field>
      </template>

      <Button variant="outline" class="mb-3 w-full bg-surface-2" @click="emit('payoff', activeCredit.id)">
        Посчитать досрочное погашение
      </Button>

      <Field v-if="!authStore.isViewer" label="Примечание">
        <Input :default-value="activeCredit.note" class="mb-3" @blur="onCreditNoteBlur" />
      </Field>

      <!-- Закрытый долг (остаток 0) выводов не ждёт: строка «Оплатил» уже говорит «долг закрыт». -->
      <template v-if="activeCredit.principal > 0 && activeCreditOutlook">
        <div
          v-if="activeCreditOutlook.closes"
          class="mb-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13px]"
        >
          <div class="flex justify-between">
            <span class="text-ink-2">Платежей осталось</span>
            <b class="num text-ink">{{ activeCreditOutlook.months }}</b>
          </div>
          <div class="mt-1 flex justify-between">
            <span class="text-ink-2">Переплата до конца</span>
            <b class="num text-warn">{{ money(activeCreditOutlook.overpay) }}</b>
          </div>
        </div>
        <div
          v-else
          class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2"
        >
          При таком платеже долг не закрывается: проценты съедают его целиком.
          Проверьте остаток, платёж и ставку.
        </div>

        <!-- График платежей (Р-8): свёрнут; платёж меньше процентов — графика нет, есть текст выше -->
        <div v-if="activeCreditOutlook.closes" class="mb-3 rounded-xl border border-line px-3.5 py-2.5">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
            :aria-expanded="scheduleOpen"
            @click="scheduleOpen = !scheduleOpen"
          >
            <span class="text-[13px] font-medium text-ink">График платежей</span>
            <span class="text-[12.5px] text-brand">{{ scheduleOpen ? 'Свернуть' : 'Показать' }}</span>
          </button>
          <ScheduleTable v-if="scheduleOpen" :rows="activeSchedule" class="mt-2.5" />
        </div>
      </template>

      <Button class="mb-3 w-full" @click="emit('close')">Готово</Button>

      <DangerZone
        v-if="!authStore.isViewer"
        label="Удалить кредит"
        warning="Кредит исчезнет у обоих участников, и платёж перестанет учитываться в бюджете. Отменить нельзя."
        @confirm="() => { financeStore.removeCredit(activeCredit!.id); emit('close') }"
      />
    </template>
  </Sheet>
</template>
