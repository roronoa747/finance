<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhArrowLeft } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import { INFLATION, deposit as calcDeposit, realRate } from '@/lib/finance'

import Card from '@/components/kit/Card.vue'
import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Callout from '@/components/kit/Callout.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Input from '@/components/ui/Input.vue'

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()

const accountId = computed(() => route.params.id as string)
const account = computed(() =>
  financeStore.accounts.find((a) => a.id === accountId.value),
)

const saved = ref(false)

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
    saved.value = true
  }
}

function onNoteBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (account.value && v !== account.value.note) {
    financeStore.updateAccount(account.value.id, { note: v })
    saved.value = true
  }
}

function onAmountCommit(text: string) {
  if (account.value) {
    financeStore.setAccountAmount(account.value.id, parseMoney(text))
    saved.value = true
  }
}

function onRateCommit(text: string) {
  if (account.value) {
    const v = parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''))
    if (Number.isFinite(v)) {
      financeStore.setDeposit(account.value.id, { annualRate: v / 100 })
      saved.value = true
    }
  }
}

function onMonthlyTopUpCommit(text: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { monthlyTopUp: parseMoney(text) })
    saved.value = true
  }
}

function onMonthsCommit(text: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { months: Math.max(1, parseMoney(text)) })
    saved.value = true
  }
}

function onCapitalizeChange(v: string) {
  if (account.value) {
    financeStore.setDeposit(account.value.id, { capitalize: v === 'yes' })
    saved.value = true
  }
}
</script>

<template>
  <div v-if="!account || !depositData" class="pt-6 text-center text-[14px] text-ink-3">
    Вклад не найден.
    <button class="text-brand font-medium cursor-pointer" @click="router.push('/capital')">
      К капиталу
    </button>
  </div>

  <div v-else class="flex flex-col gap-3.5 pt-1">
    <button
      type="button"
      class="flex items-center gap-1.5 self-start text-[13px] text-ink-2 hover:text-ink cursor-pointer"
      @click="router.push('/capital')"
    >
      <PhArrowLeft :size="15" /> Капитал
    </button>

    <Card>
      <div class="mb-4 flex items-center gap-2">
        <span class="font-display text-[18px] font-semibold text-ink">{{ account.name }}</span>
        <SavedMark :on="saved" />
      </div>

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
        warning="Вклад исчезнет вместе с условиями и балансом. Отменить нельзя."
        @confirm="() => { financeStore.removeAccount(account!.id); router.push('/capital') }"
      />
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

    <template v-if="calcResult">
      <Callout title="Реальная доходность ниже той, что на витрине">
        При инфляции {{ ratePct(INFLATION, 1) }} эффективная ставка
        {{ ratePct(calcResult.effectiveRate, 1) }} оставляет примерно {{ ratePct(realEffective, 1) }} настоящих.
        Это не повод не копить — это повод не путать номинал с доходом.
      </Callout>

      <Callout title="Проценты считает приложение, а не банк">
        Формула аннуитета и капитализации работает офлайн, на ваших цифрах. Когда появится
        ИИ-советник, он получит уже посчитанный результат и будет только объяснять его словами —
        считать деньги модели не доверяем.
      </Callout>
    </template>
  </div>
</template>
