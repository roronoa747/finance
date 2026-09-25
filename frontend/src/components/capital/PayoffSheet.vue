<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import {
  afterAnchor,
  creditOutlook,
  halfOverpayExtra,
  lastAccountFor,
  liveCredits,
  lumpPlan,
  payableAccounts,
  paymentSplit,
  payoffChips,
  payoffLadder,
  stepDue,
  prepayOutcome,
  type LumpMode,
} from '@/lib/finance'
import type { Payment } from '@/types/finance'
import { cn, plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Калькулятор досрочного погашения (React `PayoffDialog`) и применение досрочки
 * к кредиту (RP-08): вывод, чипы, лесенка отдачи, применённые досрочки со снятием.
 * `plan` — открыто из шага плана «Изменить режим» (PV-16): сумма шага подставлена,
 * разовый взнос, запись — с id плана (Р-10: режим можно сменить, план считается от факта).
 */
const props = defineProps<{ creditId: string | null; plan?: { id: string; amount: number; creditId: string } | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

const activePayoffCredit = computed(() => liveCredits(financeStore.credits).find((c) => c.id === props.creditId))
// Досрочка — тенговая сумма: у валютного счёта тенге по курсу, и следующая правка курса
// или суммы в валюте молча стёрла бы сдвиг.
const payAccounts = computed(() => payableAccounts(financeStore.accounts))

const payoffMode = ref<'monthly' | 'once'>('monthly')
const payoffAmount = ref('')

// Остаток 0 — долг закрыт отметками или досрочкой: выводов нет, шапка пишет «долг закрыт»,
// а окно открывается по-прежнему — в нём снимают досрочку, закрывшую долг.
const payoffOutlook = computed(() => (activePayoffCredit.value ? creditOutlook(activePayoffCredit.value) : null))
const payoffHalf = computed(() =>
  activePayoffCredit.value
    ? halfOverpayExtra(
        activePayoffCredit.value.principal,
        activePayoffCredit.value.annualRate,
        activePayoffCredit.value.payment,
      )
    : null,
)
const chips = computed(() => (activePayoffCredit.value ? payoffChips(activePayoffCredit.value) : []))
const payoffResult = computed(() => {
  const v = parseMoney(payoffAmount.value)
  return activePayoffCredit.value && v > 0 ? prepayOutcome(activePayoffCredit.value, v, payoffMode.value) : null
})
const ladder = computed(() => (activePayoffCredit.value ? payoffLadder(activePayoffCredit.value) : []))

/* ------------------ Применить досрочку (RP-08) ------------------ */
const applyMode = ref<LumpMode>('term')
// '' — счёт не выбран, 'none' — «не списывать», иначе id счёта.
const applyAccount = ref('')
const applyDone = ref<Payment | null>(null)
const removingPrepay = ref<string | null>(null)

const applyPlan = computed(() => {
  const c = activePayoffCredit.value
  const v = parseMoney(payoffAmount.value)
  return c && v > 0 ? lumpPlan(c.principal, c.annualRate, c.payment, v, applyMode.value) : null
})
const creditPrepays = computed(() =>
  financeStore.payments
    .filter((p) => p.kind === 'prepay' && !p.deletedAt && p.targetId === props.creditId)
    .sort((a, b) => b.at.localeCompare(a.at)),
)

// Шаг плана — только для своего кредита (окно могли открыть потом для другого).
const stepPlan = computed(() => (props.plan && props.plan.creditId === props.creditId ? props.plan : null))
// Шаг ещё ждёт оплаты в этом кредите (его мог внести партнёр, пока окно открыто, или его
// сняли здесь же) — выводится из документа, не флагом окна. Иначе запись идёт без id
// плана: шаг месяца один (Р-4).
const planPending = computed(
  () =>
    !!stepPlan.value &&
    financeStore.activePlan?.id === stepPlan.value.id &&
    stepDue(financeStore.planStepNow())?.creditId === stepPlan.value.creditId,
)

// Другой кредит — чистый калькулятор (React `PayoffDialog`); счёт по умолчанию —
// прошлой оплаты этого кредита (Р-5). Из шага плана — разовый взнос на сумму шага.
watch(
  [() => props.creditId, () => props.plan?.id],
  ([id]) => {
    payoffAmount.value = stepPlan.value ? plain(stepPlan.value.amount) : ''
    payoffMode.value = stepPlan.value ? 'once' : 'monthly'
    applyMode.value = 'term'
    applyDone.value = null
    removingPrepay.value = null
    const last = id ? lastAccountFor(financeStore.payments, id, financeStore.accounts) : undefined
    applyAccount.value = last === undefined ? '' : (last ?? 'none')
  },
  { immediate: true },
)

// Снятие обещает только то, что сделает стор (как `unmarkNote` у отметок): остаток
// и счёт возвращаются, если досрочка после их ручной сверки, платёж — если его с
// тех пор не меняли.
function prepayUndoNote(p: Payment): string {
  const c = activePayoffCredit.value
  const acc = p.accountId ? financeStore.accounts.find((a) => a.id === p.accountId) : undefined
  const parts = ['Досрочка уйдёт из списка и счётчика']
  if (c && afterAnchor(p, c.principalSetAt)) parts.push('остаток долга — к прежнему')
  if (p.accountId && (!acc || afterAnchor(p, acc.amountSetAt))) parts.push('деньги вернутся на счёт')
  if (p.prevPayment !== undefined && c?.payment === p.newPayment) parts.push('платёж — к прежнему')
  return parts.join(', ') + '.'
}

function applyPrepay() {
  const c = activePayoffCredit.value
  if (!c || !applyPlan.value || !applyAccount.value) return
  applyDone.value = financeStore.applyPrepayment(c.id, authStore.slot ?? 'a', {
    amount: parseMoney(payoffAmount.value),
    mode: applyMode.value,
    accountId: applyAccount.value === 'none' ? null : applyAccount.value,
    ...(planPending.value && stepPlan.value ? { planId: stepPlan.value.id } : {}),
  })
  payoffAmount.value = ''
}
</script>

<template>
  <Sheet :open="!!activePayoffCredit" title="Досрочное погашение" @close="emit('close')">
    <template v-if="activePayoffCredit">
      <div class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1">
        <div class="font-medium text-ink">{{ activePayoffCredit.name }}</div>
        <div class="flex justify-between">
          <span class="text-ink-2">Осталось платежей</span>
          <b class="num text-ink">{{ payoffOutlook?.closes ? payoffOutlook.months : '—' }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">Переплата, если не трогать</span>
          <b class="num text-warn">
            {{
              payoffOutlook?.closes
                ? money(payoffOutlook.overpay)
                : activePayoffCredit.principal > 0
                  ? 'долг не закрывается'
                  : 'долг закрыт'
            }}
          </b>
        </div>
      </div>

      <p v-if="planPending" class="-mt-1 mb-3 text-[12.5px] leading-relaxed text-ink-2">
        Шаг плана — {{ money(stepPlan?.amount ?? 0) }}. Можно «снизить платёж» вместо «сократить срок»: план
        пересчитается от факта.
      </p>

      <Field label="Как вносите" group>
        <Segmented
          v-model="payoffMode"
          :options="[
            { value: 'monthly', label: 'Каждый месяц' },
            { value: 'once', label: 'Разово' },
          ]"
          class="mb-3"
        />
      </Field>

      <Field :label="payoffMode === 'monthly' ? 'Сколько добавите к платежу, ₸' : 'Сколько внесёте разом, ₸'">
        <NumField v-model="payoffAmount" :placeholder="plain(chips[0] ?? 5000)" class="mb-2" />
      </Field>

      <div v-if="chips.length > 0 && payoffMode === 'monthly'" class="mb-3 flex flex-wrap gap-1.5">
        <button
          v-for="v in chips"
          :key="v"
          type="button"
          :class="cn('rounded-lg border px-2.5 py-1 text-[12px] num transition-colors cursor-pointer', parseMoney(payoffAmount) === v ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
          @click="payoffAmount = plain(v)"
        >
          +{{ plain(v) }}
          <span v-if="v === payoffHalf" class="ml-1 text-[10.5px]">половина переплаты</span>
        </button>
      </div>

      <div v-if="payoffResult" class="mb-3 rounded-xl border border-brand bg-brand-soft p-3.5">
        <div class="font-display text-[18px] font-semibold text-brand">
          {{
            payoffResult.sooner
              ? `Закроется на ${payoffResult.monthsSaved} мес. раньше`
              : 'Срок почти не изменится'
          }}
        </div>
        <div class="mt-0.5 text-[13px] font-medium text-ink num">
          экономия {{ money(payoffResult.saved) }}
        </div>
        <div class="mt-1 text-[12px] text-ink-2">
          Останется {{ payoffResult.monthsAfter }}
          {{ plural(payoffResult.monthsAfter, 'платёж', 'платежа', 'платежей') }}
          вместо {{ payoffResult.monthsNow }}.
        </div>
      </div>
      <p v-else class="mb-3 text-[12.5px] leading-relaxed text-ink-3">
        Впишите сумму, которую действительно можете внести. Приложение не станет предлагать
        больше — считать по деньгам, которых нет, смысла нет.
      </p>

      <!-- Применить разовую досрочку (Р-6) -->
      <div
        v-if="payoffMode === 'once' && applyPlan && !authStore.isViewer"
        class="mb-3 rounded-xl border border-line p-3.5"
      >
        <div class="mb-2 text-[13px] font-medium text-ink">Применить к кредиту</div>
        <Segmented
          v-model="applyMode"
          :options="[
            { value: 'term', label: 'Сократить срок' },
            { value: 'payment', label: 'Снизить платёж' },
          ]"
          class="mb-3"
        />
        <div class="mb-3 flex flex-col gap-1.5 text-[13px]">
          <div class="flex justify-between">
            <span class="text-ink-2">Остаток долга</span>
            <b class="num text-ink">{{ money(applyPlan.left) }}</b>
          </div>
          <div v-if="applyPlan.left === 0" class="text-ink-2">Долг закроется этим взносом.</div>
          <!-- Платёж не покрывает проценты (Р-11): сравнивать не с чем, платёж прежний в обоих режимах. -->
          <div v-else-if="applyPlan.openEnded" class="flex justify-between">
            <span class="text-ink-2">Платежей останется</span>
            <b class="num text-ink">{{ Number.isFinite(applyPlan.months) ? applyPlan.months : '—' }}</b>
          </div>
          <div v-else-if="applyMode === 'term'" class="flex justify-between">
            <span class="text-ink-2">Платежей останется</span>
            <b class="num text-ink">{{ applyPlan.months }} вместо {{ applyPlan.monthsBefore }}</b>
          </div>
          <div v-else class="flex justify-between">
            <span class="text-ink-2">Платёж</span>
            <b class="num text-ink">{{ money(applyPlan.payment) }} вместо {{ money(activePayoffCredit.payment) }}</b>
          </div>
        </div>
        <div v-if="applyPlan.openEnded" class="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-ink-2">
          При текущем платеже долг не закрывается — экономию не считаем
        </div>
        <div v-else class="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-[13px] text-ink-2">
          Не отдадим банку <b class="num text-brand">{{ money(applyPlan.saved) }}</b>
        </div>
        <Field label="Откуда списать">
          <Select v-model="applyAccount">
            <option value="" disabled>Выберите счёт…</option>
            <option v-for="a in payAccounts" :key="a.id" :value="a.id">
              {{ a.name }} · {{ money(a.amount) }}
            </option>
            <option value="none">Не списывать — только отметить</option>
          </Select>
        </Field>
        <Button class="w-full" :disabled="!applyAccount" @click="applyPrepay">Применить досрочку</Button>
      </div>

      <div
        v-if="applyDone"
        class="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3 text-[13px] text-ink-2"
      >
        Досрочка применена<template v-if="(applyDone.saved ?? 0) > 0">: не отдадим банку
        <b class="num text-brand">{{ money(applyDone.saved ?? 0) }}</b></template>.
      </div>

      <div v-if="creditPrepays.length > 0" class="mb-3">
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          Применённые досрочки
        </div>
        <div
          v-for="p in creditPrepays"
          :key="p.id"
          class="border-b border-line py-2 text-[12.5px] last:border-b-0"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-ink-2">
              {{ atLabel(p.at) }} · {{ p.mode === 'payment' ? 'снизили платёж' : 'сократили срок' }}{{ p.planId ? ' · по плану' : '' }}
            </span>
            <b class="ml-auto num text-ink">{{ money(p.amount) }}</b>
          </div>
          <div class="text-ink-3 num">
            в долг {{ plain(paymentSplit(p, activePayoffCredit, 0).body) }} · банку
            {{ plain(paymentSplit(p, activePayoffCredit, 0).interest) }}
          </div>
          <div class="flex items-baseline gap-2">
            <span v-if="(p.saved ?? 0) > 0" class="text-brand">не отдадим банку <span class="num">{{ money(p.saved ?? 0) }}</span></span>
            <button
              v-if="!authStore.isViewer && removingPrepay !== p.id"
              type="button"
              class="ml-auto text-ink-3 hover:underline cursor-pointer"
              @click="removingPrepay = p.id"
            >
              Снять
            </button>
          </div>
          <div v-if="removingPrepay === p.id" class="mt-2 rounded-xl border border-line bg-surface-2 p-3">
            <p class="mb-2 leading-relaxed text-ink-2">{{ prepayUndoNote(p) }}</p>
            <div class="flex gap-2">
              <Button variant="outline" class="flex-1 bg-surface" @click="removingPrepay = null">Отмена</Button>
              <Button
                class="flex-1"
                @click="() => { financeStore.removePrepayment(p.id); removingPrepay = null; applyDone = null }"
              >
                Снять
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Лесенка отдачи -->
      <div v-if="ladder.length > 0" class="mb-3">
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          Отдача падает
        </div>
        <div class="flex flex-col gap-1 text-[12.5px]">
          <div
            v-for="item in ladder"
            :key="item.extra"
            class="flex items-center justify-between border-b border-line/60 py-1"
          >
            <span class="num text-ink-2">+{{ plain(item.extra) }}</span>
            <span class="num text-ink-3">−{{ item.monthsSaved }} мес.</span>
            <span class="num font-medium text-brand">{{ money(item.saved) }}</span>
          </div>
        </div>
        <p v-if="payoffHalf" class="mt-2 text-[12.5px] leading-relaxed text-ink-3">
          Половину переплаты снимает уже добавка в {{ money(payoffHalf) }} — дальше каждая
          следующая тысяча даёт меньше предыдущей. Если больших сумм нет, начинать стоит отсюда.
        </p>
      </div>

      <Button class="w-full" @click="emit('close')">Закрыть</Button>
    </template>
  </Sheet>
</template>
