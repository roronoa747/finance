<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhArrowLeft } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import { INFLATION, deposit as calcDeposit, realRate } from '@/lib/finance'

import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Segmented from '@/components/kit/Segmented.vue'
import Callout from '@/components/kit/Callout.vue'
import Hint from '@/components/kit/Hint.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Input from '@/components/ui/Input.vue'

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
// Viewer видит условия вклада цифрами, но не правит и не удаляет (Р-13, матрица §3; возврат приёмки п. 3).
const authStore = useAuthStore()

const accountId = computed(() => route.params.id as string)
const account = computed(() =>
  financeStore.accounts.find((a) => a.id === accountId.value),
)

/** Личный вклад партнёр не видит — предупреждение без «у обоих участников». */
const removeWarning = computed(() => {
  const isPrivate = financeStore.privateAccounts.some((a) => a.id === accountId.value)
  return `Вклад исчезнет${isPrivate ? '' : ' у обоих участников'} вместе с условиями. Отменить нельзя.`
})

// «Сохранено» — по `updatedAt` записи: горит, когда правка легла в документ, и гаснет (PV-23 п. 3).
const saved = useSavedMark(() => account.value?.id, () => account.value?.updatedAt)

const depositData = computed(() => account.value?.deposit)

const calcResult = computed(() => {
  if (!account.value || !depositData.value) return null
  return calcDeposit({
    principal: account.value.amount,
    annualRate: depositData.value.annualRate,
    months: depositData.value.months,
    monthlyTopUp: depositData.value.monthlyTopUp,
    capitalize: depositData.value.capitalize,
  })
})

const realEffective = computed(() =>
  calcResult.value ? realRate(calcResult.value.effectiveRate, INFLATION) : 0,
)

function onNameBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (account.value && v && v !== account.value.name) {
    financeStore.updateAccount(account.value.id, { name: v })
  }
}

function onNoteBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (account.value && v !== account.value.note) {
    financeStore.updateAccount(account.value.id, { note: v })
  }
}

function onAmountCommit(text: string) {
  if (account.value) {
    financeStore.setAccountAmount(account.value.id, parseMoney(text))
  }
}

function onRateCommit(text: string) {
  if (account.value) {
    const v = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''))
    if (Number.isFinite(v)) {
      financeStore.setDeposit(account.value.id, { annualRate: v / 100 })
    }
  }
}

function onMonthlyTopUpCommit(text: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { monthlyTopUp: parseMoney(text) })
  }
}

function onMonthsCommit(text: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { months: Math.max(1, parseMoney(text)) })
  }
}

function onCapitalizeChange(v: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { capitalize: v === 'yes' })
  }
}
</script>

<template>
  <div v-if="!account || !depositData" class="pt-6 text-center text-[14px] text-ink-3">
    Вклад не найден.
    <button class="text-brand font-medium cursor-pointer" @click="router.push('/money/capital')">
      К капиталу
    </button>
  </div>

  <div v-else class="flex flex-col gap-3.5 pt-1">
    <button
      type="button"
      class="flex items-center gap-1.5 self-start text-[13px] text-ink-2 hover:text-ink cursor-pointer"
      @click="router.push('/money/capital')"
    >
      <PhArrowLeft :size="15" /> Капитал
    </button>

    <Card>
      <div class="mb-4 flex items-center gap-2">
        <span class="font-display text-[18px] font-semibold text-ink">{{ account.name }}</span>
        <SavedMark :on="saved" />
      </div>

      <!-- Viewer: цифры без полей и без «Удалить вклад» — как в окне счёта Капитала -->
      <div v-if="authStore.isViewer" class="flex flex-col gap-1.5 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
        <div v-if="account.note" class="flex justify-between gap-3">
          <span class="text-ink-2">Примечание</span>
          <b class="truncate text-ink">{{ account.note }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Сумма на счёте</span>
          <b class="num text-ink">{{ money(account.amount) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Ставка</span>
          <b class="num text-ink">{{ ratePct(depositData.annualRate, 1) }} годовых</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Пополнение в месяц</span>
          <b class="num text-ink">{{ money(depositData.monthlyTopUp) }}</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Срок</span>
          <b class="num text-ink">{{ depositData.months }} мес.</b>
        </div>
        <div class="flex justify-between gap-3">
          <span class="text-ink-2">Капитализация</span>
          <b class="text-ink">{{ depositData.capitalize ? 'ежемесячно' : 'в конце срока' }}</b>
        </div>
      </div>

      <template v-else>
        <Field label="Название">
          <Input :default-value="account.name" class="mb-3" @blur="onNameBlur" />
        </Field>

        <Field label="Примечание">
          <Input :default-value="account.note" class="mb-3" @blur="onNoteBlur" />
        </Field>

        <Field label="Сумма на счёте, ₸">
          <NumFieldBlur :initial="plain(account.amount)" class="mb-3" @commit="onAmountCommit" />
        </Field>

        <Field label="Ставка, % годовых">
          <NumFieldBlur
            :initial="(depositData.annualRate * 100).toString().replace('.', ',')"
            kind="rate"
            class="mb-3"
            @commit="onRateCommit"
          />
        </Field>

        <Field label="Пополнение в месяц, ₸">
          <NumFieldBlur
            :initial="plain(depositData.monthlyTopUp)"
            class="mb-3"
            @commit="onMonthlyTopUpCommit"
          />
        </Field>

        <Field label="Срок, месяцев">
          <NumFieldBlur
            :initial="String(depositData.months)"
            kind="int"
            class="mb-3"
            @commit="onMonthsCommit"
          />
        </Field>

        <Field label="Капитализация">
          <Segmented
            :model-value="depositData.capitalize ? 'yes' : 'no'"
            :options="[
              { value: 'yes', label: 'Ежемесячно' },
              { value: 'no', label: 'В конце срока' },
            ]"
            class="mb-3"
            @update:model-value="onCapitalizeChange"
          />
        </Field>

        <DangerZone
          label="Удалить вклад"
          :warning="removeWarning"
          @confirm="() => { financeStore.removeAccount(account!.id); router.push('/money/capital') }"
        />
      </template>
    </Card>

    <!-- Итоговые показатели вклада -->
    <Card v-if="calcResult">
      <div class="pb-1.5 pt-1 text-center">
        <div class="text-[12.5px] text-ink-3">Будет на счёте через {{ depositData.months }} мес.</div>
        <div class="mt-1 font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] num text-ink">
          {{ money(Math.round(calcResult.future)) }}
        </div>
        <div class="mt-1.5 text-[13px] text-ink-2">
          Начислено процентов: {{ money(Math.round(calcResult.interest)) }}
        </div>
      </div>
      <div class="mt-2.5 flex items-center border-t border-line pt-3.5 text-[13.5px]">
        <span class="text-ink-2">Эффективная ставка</span>
        <b class="ml-auto num text-ink">{{ ratePct(calcResult.effectiveRate) }}</b>
      </div>
      <div class="flex items-center py-2 text-[13.5px]">
        <span class="text-ink-2">Ваши взносы</span>
        <b class="ml-auto num text-ink">{{ money(calcResult.contributed) }}</b>
      </div>
      <div class="flex items-center text-[13.5px]">
        <span class="text-ink-2">Заработал банк</span>
        <b class="ml-auto num text-brand">{{ money(Math.round(calcResult.interest)) }}</b>
      </div>
    </Card>

    <!-- Реальная доходность — одна строка, пояснение в подсказке (правило 12); механика расчёта не объясняется -->
    <Callout v-if="calcResult" tone="neutral" icon="none">
      <span class="inline-flex items-center gap-2">
        Реально ≈ {{ ratePct(realEffective, 1) }} с учётом инфляции
        <Hint>
          При инфляции {{ ratePct(INFLATION, 1) }} эффективная ставка {{ ratePct(calcResult.effectiveRate, 1) }}
          оставляет примерно {{ ratePct(realEffective, 1) }} настоящих. Это не повод не копить — это повод не
          путать номинал с доходом.
        </Hint>
      </span>
    </Callout>
  </div>
</template>
