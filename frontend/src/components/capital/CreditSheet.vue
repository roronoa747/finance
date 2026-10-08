<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, rateField, ratePct } from '@/lib/money'
import { MONTHS_PRE, monthInAfter, monthKey, parseMonthKey } from '@/lib/dates'
import { creditOutlook, creditSchedule, creditTotals, lastAccountFor, liveCredits, paidFor, planSchedule } from '@/lib/finance'
import type { Credit } from '@/types/finance'
import { plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import ScheduleTable from '@/components/ScheduleTable.vue'
import MarkSheet from '@/components/MarkSheet.vue'

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
/*
 * Ставку назвали у кредита «ставка неизвестна» (хвост 958): отметки до неё тело не писали — остаток стоит, каким его
 * ввели. Подсказка «Сверьте остаток с банком» у поля остатка; сверка (новый остаток — якорь `principalSetAt`) её
 * убирает. Прошлые отметки задним числом не делятся.
 */
const reconcile = ref(false)
watch(() => props.creditId, () => (reconcile.value = false))
function onCreditPrincipal(text: string) {
  reconcile.value = false
  const v = parseMoney(text)
  if (v > 0 && v !== activeCredit.value?.principal) editCredit({ principal: v })
}
function onCreditPayment(text: string) {
  const v = parseMoney(text)
  if (v > 0 && v !== activeCredit.value?.payment) editCredit({ payment: v })
}
function onCreditRate(text: string) {
  const v = parseFloat(text.replace(',', '.'))
  // Ноль законен: рассрочка без процентов. Ставку назвали — она больше не «неизвестна» (B2C-19).
  if (!Number.isFinite(v) || v < 0) return
  if (activeCredit.value?.rateUnknown) reconcile.value = true
  editCredit({ annualRate: v / 100, ...(activeCredit.value?.rateUnknown ? { rateUnknown: null } : {}) })
}
function onCreditDay(text: string) {
  const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
  if (v !== activeCredit.value?.day) editCredit({ day: v })
}

/*
 * Долг человеку (мелочи Р-5, макет people-debts.html): без банковских полей; «Отдаю сейчас» (по умолчанию платёж
 * месяца) и «Отдал» — одна главная; отдано в этом месяце — зелёная строка, у участника нажатие — лист отметки
 * (другая сумма или снять). Одна отметка на месяц — `markPaid` того же пути, что «Оплатил».
 */
const key = computed(() => monthKey())
const given = computed(() => (activeCredit.value ? paidFor(financeStore.payments, 'credit', activeCredit.value.id, key.value) : null))
const giveText = ref('')
// Платёж поправили в этом же листе — «Отдаю сейчас» следует за ним.
watch(() => [props.creditId, activeCredit.value?.payment], () => (giveText.value = activeCredit.value ? plain(activeCredit.value.payment) : ''), { immediate: true })
/** Лист отметки: «mark» — счёт спросить впервые, «paid» — правка отданного. */
const markOpen = ref<'mark' | 'paid' | null>(null)
watch(() => props.creditId, () => (markOpen.value = null))
const giveAmount = computed(() => parseMoney(giveText.value) || activeCredit.value?.payment || 0)
function give() {
  const c = activeCredit.value
  if (!c) return
  const last = lastAccountFor(financeStore.payments, c.id, financeStore.accounts)
  if (last === undefined) markOpen.value = 'mark'
  else financeStore.markPaid('credit', c.id, authStore.slot ?? 'a', { period: key.value, amount: giveAmount.value, accountId: last })
}

</script>

<template>
  <Sheet :open="!!activeCredit" :title="activeCredit?.name ?? ''" @close="emit('close')">
    <template #mark>
      <!-- «За всё время» — подсказкой у названия (Б17), не абзацем над полями. -->
      <Hint v-if="activeCredit && activeCreditTotals && activeCreditTotals.count > 0 && !activeCredit.rateUnknown && !activeCredit.person" label="За всё время" data-credit-totals>
        <span class="num">
          За всё время: в долг {{ money(activeCreditTotals.body) }}, банку {{ money(activeCreditTotals.interest) }}
          ({{ activeCreditTotals.count }} {{ plural(activeCreditTotals.count, 'платёж', 'платежа', 'платежей') }})
        </span>
      </Hint>
      <SavedMark :on="creditSaved" />
    </template>
    <!-- Долг человеку: остаток крупно, «Отдал» — одна главная; ставки, графика и досрочки нет (мелочи Р-5). -->
    <template v-if="activeCredit?.person" #default>
      <div class="mb-3.5 flex flex-col gap-1" data-person-debt>
        <span class="font-num text-[34px] font-bold leading-none num text-ink">{{ money(activeCredit.principal) }}</span>
        <span v-if="activeCredit.principal > 0 && activeCreditOutlook?.closes" class="type-meta num" data-credit-closes>
          закроется в {{ monthInAfter(activeCreditOutlook.months) }}
        </span>
      </div>

      <component
        :is="authStore.isViewer ? 'div' : 'button'"
        v-if="given"
        :type="authStore.isViewer ? undefined : 'button'"
        class="mb-3.5 flex w-full items-center justify-between gap-3 rounded-xl bg-ok-soft px-3.5 py-3 text-left text-[14px] font-semibold text-ok"
        :class="!authStore.isViewer && 'press cursor-pointer'"
        data-person-given
        @click="!authStore.isViewer && (markOpen = 'paid')"
      >
        <span>✓ Отдал в {{ MONTHS_PRE[parseMonthKey(key).month] }}</span>
        <span class="num">{{ money(given.amount) }}</span>
      </component>
      <Field v-else-if="!authStore.isViewer && activeCredit.principal > 0" label="Отдаю сейчас, ₸">
        <span class="flex items-center gap-2">
          <NumField v-model="giveText" class="min-w-0 flex-1" />
          <Button class="shrink-0" data-person-give @click="give">Отдал</Button>
        </span>
      </Field>

      <div v-if="authStore.isViewer" class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1.5">
        <div class="flex justify-between">
          <span class="text-ink-2">В месяц</span>
          <b class="num text-ink">{{ money(activeCredit.payment) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">День</span>
          <b class="num text-ink">{{ activeCredit.day }}</b>
        </div>
      </div>
      <template v-else>
        <Field label="Кому">
          <Input :default-value="activeCredit.name" @blur="onCreditNameBlur" />
        </Field>
        <div class="grid grid-cols-2 gap-2.5">
          <Field label="Осталось, ₸">
            <NumFieldBlur :initial="plain(activeCredit.principal)" @commit="onCreditPrincipal" />
          </Field>
          <Field label="В месяц, ₸">
            <NumFieldBlur :initial="plain(activeCredit.payment)" @commit="onCreditPayment" />
          </Field>
        </div>
        <Field label="День">
          <NumFieldBlur :initial="String(activeCredit.day)" kind="int" @commit="onCreditDay" />
        </Field>
        <DangerZone
          label="Удалить долг"
          warning="Долг исчезнет у обоих участников, и платёж перестанет учитываться в бюджете. Отменить нельзя."
          @confirm="() => { financeStore.removeCredit(activeCredit!.id); emit('close') }"
        />
      </template>
    </template>
    <template v-else-if="activeCredit" #default="{ close }">
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
          <b class="num text-ink">{{ activeCredit.rateUnknown ? 'уточните' : ratePct(activeCredit.annualRate, 1) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">День платежа</span>
          <b class="num text-ink">{{ activeCredit.day }}</b>
        </div>
      </div>
      <template v-else>
        <Field label="Остаток долга, ₸">
          <NumFieldBlur :initial="plain(activeCredit.principal)" @commit="onCreditPrincipal" />
        </Field>
        <p v-if="reconcile" class="-mt-2 mb-3.5 text-[13px] text-warn" data-credit-reconcile>Сверьте остаток с банком</p>
        <Field label="Платёж в месяц, ₸">
          <NumFieldBlur :initial="plain(activeCredit.payment)" @commit="onCreditPayment" />
        </Field>
        <div class="grid grid-cols-2 gap-2.5">
          <Field label="Ставка, % годовых">
            <NumFieldBlur
              :initial="activeCredit.rateUnknown ? '' : rateField(activeCredit.annualRate)"
              kind="rate"
              :placeholder="activeCredit.rateUnknown ? 'уточните' : ''"
              @commit="onCreditRate"
            />
          </Field>
          <Field label="День платежа">
            <NumFieldBlur :initial="String(activeCredit.day)" kind="int" @commit="onCreditDay" />
          </Field>
        </div>
      </template>

      <!-- Срок — сюда со строк «Капитала» и «Долгов» (Р-116). Закрытый долг (остаток 0) выводов не ждёт. Ставку не знаем
           (кредит из выписки) — срок и переплата с нулём врут: вместо них одна строка. -->
      <p v-if="activeCredit.rateUnknown && activeCredit.principal > 0" class="-mt-1 mb-3.5 text-[13px] text-warn">
        Ставку уточните — без неё срок и переплату не посчитать.
      </p>
      <template v-else-if="activeCredit.principal > 0 && activeCreditOutlook">
        <p v-if="activeCreditOutlook.closes" class="-mt-1 mb-3.5 text-[13px] text-ink-2 num" data-credit-closes>
          закроется в {{ monthInAfter(activeCreditOutlook.months) }}
        </p>
        <p v-else class="-mt-1 mb-3.5 text-[13px] text-warn" data-credit-closes>
          При таком платеже долг не закрывается — проверьте остаток, платёж и ставку.
        </p>
      </template>

      <template v-if="!authStore.isViewer">
        <Field label="Название">
          <Input :default-value="activeCredit.name" @blur="onCreditNameBlur" />
        </Field>
        <Field label="Примечание">
          <Input :default-value="activeCredit.note" @blur="onCreditNoteBlur" />
        </Field>
      </template>

      <!-- График платежей (Р-8) и переплата — свёрнуты; платёж меньше процентов — графика нет, есть строка выше -->
      <div v-if="activeCredit.principal > 0 && activeCreditOutlook?.closes && !activeCredit.rateUnknown" class="mb-3.5 rounded-xl border border-line px-3.5 py-2.5">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
          :aria-expanded="scheduleOpen"
          @click="scheduleOpen = !scheduleOpen"
        >
          <span class="text-[13.5px] font-medium text-ink">График платежей</span>
          <span class="text-[12.5px] text-brand">{{ scheduleOpen ? 'Свернуть' : 'Показать' }}</span>
        </button>
        <template v-if="scheduleOpen">
          <div class="mt-2.5 flex justify-between text-[13px]">
            <span class="text-ink-2">Платежей осталось</span>
            <b class="num text-ink">{{ activeCreditOutlook.months }}</b>
          </div>
          <div class="mt-1 flex justify-between text-[13px]">
            <span class="text-ink-2">Переплата до конца</span>
            <b class="num text-warn">{{ money(activeCreditOutlook.overpay) }}</b>
          </div>
          <ScheduleTable :rows="activeSchedule" class="mt-2.5" />
        </template>
      </div>

      <!-- Одна главная внизу (правило 12); досрочка — тихо под ней. Без ставки калькулятор врал бы «экономия 0» (B2C-19). -->
      <Button class="w-full" @click="close">Готово</Button>
      <Button v-if="!activeCredit.rateUnknown" variant="ghost" size="md" class="mt-2 w-full" data-credit-payoff @click="emit('payoff', activeCredit.id)">
        Посчитать досрочно
      </Button>

      <DangerZone
        v-if="!authStore.isViewer"
        label="Удалить кредит"
        warning="Кредит исчезнет у обоих участников, и платёж перестанет учитываться в бюджете. Отменить нельзя."
        @confirm="() => { financeStore.removeCredit(activeCredit!.id); emit('close') }"
      />
    </template>
  </Sheet>
  <MarkSheet
    v-if="activeCredit?.person && markOpen"
    :open="markOpen"
    kind="credit"
    :target-id="activeCredit.id"
    :period="key"
    :title="activeCredit.name"
    :amount="giveAmount"
    :first-time="markOpen === 'mark'"
    @close="markOpen = null"
  />
</template>
