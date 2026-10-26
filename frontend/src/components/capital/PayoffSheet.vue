<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { PhCaretRight } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { atLabel } from '@/lib/dates'
import {
  afterAnchor,
  creditOutlook,
  halfOverpayExtra,
  liveCredits,
  paymentSplit,
  payoffChips,
  payoffLadder,
  prepayOutcome,
} from '@/lib/finance'
import type { Payment } from '@/types/finance'
import { cn, plural } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import PrepaySheet from './PrepaySheet.vue'

/**
 * Калькулятор досрочного погашения (React `PayoffDialog`): вывод, чипы, лесенка отдачи, применённые досрочки со
 * снятием. Вносят досрочку листом `PrepaySheet` (F2-04) — отсюда тихой «Внёс досрочно» с суммой калькулятора. Шаг плана
 * «Сначала долги» отсюда не вносится (Блок 16, Р-110: «Изменить режим» убран — шаг записывает «Отложил» в «Месяце»).
 */
const props = defineProps<{ creditId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

// Кредит без ставки (B2C-19) калькулятор не открывает и по адресу `?payoff=`: срок и экономия с нулём врут.
const activePayoffCredit = computed(() => liveCredits(financeStore.credits).find((c) => c.id === props.creditId && !c.rateUnknown))

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

/* Вносят досрочку из одного места — листа `PrepaySheet` (F2-04, Р-3): здесь в «Разово» с суммой — тихая «Внёс досрочно». */
const prepayAmount = ref<number | null>(null)
const removingPrepay = ref<string | null>(null)
const canPrepay = computed(
  () => !authStore.isViewer && payoffMode.value === 'once' && (activePayoffCredit.value?.principal ?? 0) > 0 && parseMoney(payoffAmount.value) > 0,
)
const creditPrepays = computed(() =>
  financeStore.payments
    .filter((p) => p.kind === 'prepay' && !p.deletedAt && p.targetId === props.creditId)
    .sort((a, b) => b.at.localeCompare(a.at)),
)
// Взнос записан — калькулятор снова чистый, как после прежнего «Применить»: та же сумма с «Внёс досрочно» звала бы
// внести её второй раз.
let prepaysBefore = 0
function openPrepay() {
  prepaysBefore = creditPrepays.value.length
  prepayAmount.value = parseMoney(payoffAmount.value)
}
function closePrepay() {
  if (creditPrepays.value.length > prepaysBefore) payoffAmount.value = ''
  prepayAmount.value = null
}

// Другой кредит — чистый калькулятор (React `PayoffDialog`).
watch(
  () => props.creditId,
  () => {
    payoffAmount.value = ''
    payoffMode.value = 'monthly'
    prepayAmount.value = null
    removingPrepay.value = null
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

      <Field :label="payoffMode === 'monthly' ? 'Сколько добавите к платежу' : 'Сколько внесёте разом'">
        <!-- Пояснение — в «?» у подписи, а не абзацем под полем (FG-25, 51:873). -->
        <template #hint><Hint label="Какую сумму вписать">Сумма, которую действительно можете добавлять каждый месяц — больше приложение не предложит</Hint></template>
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

      <!-- Итог — одна крупная цифра без коробки (FG-25): «−N мес.» и строка переплаты; «осталось N платежей» и пояснение — в «?». -->
      <div v-if="payoffResult" class="mb-3" data-payoff-result>
        <div class="flex items-center gap-1.5">
          <span v-if="payoffResult.sooner" class="font-num text-[28px] font-bold leading-tight num text-ink" data-payoff-months>−{{ payoffResult.monthsSaved }} мес.</span>
          <span v-else class="text-[15px] text-ink-2" data-payoff-months>Срок почти не изменится</span>
          <Hint label="Что меняется">
            Останется {{ payoffResult.monthsAfter }} {{ plural(payoffResult.monthsAfter, 'платёж', 'платежа', 'платежей') }} вместо {{ payoffResult.monthsNow }}.<template v-if="payoffHalf">
            Половину переплаты снимает уже добавка в {{ money(payoffHalf) }} — дальше каждая следующая тысяча даёт меньше предыдущей.</template>
          </Hint>
        </div>
        <div class="text-[14px] text-ok num" data-payoff-saved>переплата меньше на {{ money(payoffResult.saved) }}</div>
      </div>

      <Button
        v-if="canPrepay"
        variant="outline"
        size="md"
        class="-mt-1 mb-3 mx-auto flex w-fit"
        data-payoff-prepay
        @click="openPrepay"
      >
        Внёс досрочно
      </Button>

      <div v-if="creditPrepays.length > 0" class="mb-3">
        <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">
          Досрочные взносы
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
          <div class="text-ink-2 num">
            в долг {{ money(paymentSplit(p, activePayoffCredit, 0).body) }} · банку
            {{ money(paymentSplit(p, activePayoffCredit, 0).interest) }}
          </div>
          <div class="flex items-baseline gap-2">
            <span v-if="(p.saved ?? 0) > 0" class="text-brand">не отдадим банку <span class="num">{{ money(p.saved ?? 0) }}</span></span>
            <button
              v-if="!authStore.isViewer && removingPrepay !== p.id"
              type="button"
              class="ml-auto text-ink-2 hover:underline cursor-pointer"
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
                @click="() => { financeStore.removePrepayment(p.id); removingPrepay = null }"
              >
                Снять
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- Лесенка отдачи — свёрнута под «Подробнее ›» (FG-25: сложное скрыто); пояснение — в «?» у итога. -->
      <details v-if="ladder.length > 0" class="group mb-3" data-payoff-ladder>
        <summary class="flex cursor-pointer list-none items-center gap-1 py-1 text-[14px] text-ink-2 [&::-webkit-details-marker]:hidden">
          Подробнее <PhCaretRight :size="13" class="text-ink-3 transition-transform group-open:rotate-90" />
        </summary>
        <div class="mb-1.5 mt-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-2">
          Отдача падает
        </div>
        <div class="flex flex-col gap-1 text-[12.5px]">
          <div
            v-for="item in ladder"
            :key="item.extra"
            class="flex items-center justify-between border-b border-line/60 py-1"
          >
            <span class="num text-ink-2">+{{ money(item.extra) }}</span>
            <span class="num text-ink-2">−{{ item.monthsSaved }} мес.</span>
            <span class="num font-medium text-brand">{{ money(item.saved) }}</span>
          </div>
        </div>
      </details>

      <Button class="w-full" @click="emit('close')">Закрыть</Button>
    </template>
  </Sheet>
  <!-- «Подробнее» в листе взноса ведёт сюда же — просто закрыть его. -->
  <PrepaySheet
    :credit-id="prepayAmount !== null ? (activePayoffCredit?.id ?? null) : null"
    :amount="prepayAmount ?? undefined"
    @close="closePrepay"
    @payoff="closePrepay"
  />
</template>
