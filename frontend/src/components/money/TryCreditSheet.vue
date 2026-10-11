<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { monthKey } from '@/lib/dates'
import { money, parseMoney } from '@/lib/money'
import { salariesLabel, tryCredit } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * «Прикинуть кредит» (PN-17, Р-11): сумма, срок, ставка или рассрочка → живой результат без кнопки «Посчитать»:
 * крупно платёж в месяц, строками — нагрузка, сдвиг главной мечты, переплата. Считает `tryCredit` (`finance.ts`) на
 * плане этого месяца; ничего не пишет — viewer видит так же.
 */
defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const finance = useFinanceStore()

const TERMS = [6, 12, 24, 36]
const sum = ref('')
const term = ref<number | 'own'>(12)
const ownTerm = ref('')
const mode = ref<'rate' | 'zero'>('rate')
const rate = ref('')

const months = computed(() => (term.value === 'own' ? parseMoney(ownTerm.value) : term.value))
const annualRate = computed(() => {
  if (mode.value === 'zero') return 0
  const v = parseFloat(rate.value.replace(',', '.'))
  return Number.isFinite(v) && v > 0 ? v / 100 : null
})

const result = computed(() => {
  const principal = parseMoney(sum.value)
  if (principal <= 0 || months.value <= 0 || annualRate.value === null) return null
  const { state, ctx } = finance.planInput(monthKey())
  return tryCredit(state, ctx, { principal, months: months.value, annualRate: annualRate.value })
})

// Пустая форма говорит, чего не хватает (`/ux` Б5): сумма есть, ставки нет — «Введите ставку», а не «сумму и срок».
const emptyHint = computed(() => {
  if (parseMoney(sum.value) <= 0) return 'Введите сумму'
  if (months.value <= 0) return 'Введите срок'
  return 'Введите ставку'
})

const monthsWord =(n: number) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
const heroLine = computed(() => {
  const h = result.value?.hero
  if (!h || h.delayMonths === null) return null
  if (h.delayMonths === Infinity) return `${h.name} не соберётся`
  if (h.delayMonths === 0) return `${h.name} не сдвинется`
  return `${h.name} отодвинется на ${monthsWord(h.delayMonths)}`
})
const overpayLine = computed(() => {
  const r = result.value
  if (!r) return null
  if (r.overpay <= 0) return 'Без переплаты'
  // «0,2 зарплаты» — как в статистике Капитала; 0 зарплат — единицы нет.
  return r.overpaySalaries ? `Переплата ${money(r.overpay)} · ${salariesLabel(r.overpaySalaries)}` : `Переплата ${money(r.overpay)}`
})
</script>

<template>
  <Sheet :open="open" title="Прикинуть кредит" @close="emit('close')">
    <Field label="Сколько, ₸">
      <NumField v-model="sum" placeholder="1 000 000" data-try-sum />
    </Field>

    <Field label="На сколько месяцев" group>
      <div class="flex flex-wrap gap-2" data-try-terms>
        <Chip v-for="t in TERMS" :key="t" :on="term === t" @click="term = t">{{ t }}</Chip>
        <Chip :on="term === 'own'" @click="term = 'own'">свой</Chip>
      </div>
    </Field>
    <Field v-if="term === 'own'" label="Месяцев">
      <NumField v-model="ownTerm" kind="int" placeholder="18" data-try-own />
    </Field>

    <Segmented
      v-model="mode"
      :options="[
        { value: 'rate', label: 'Знаю ставку' },
        { value: 'zero', label: 'Рассрочка 0 %' },
      ]"
      class="mb-3.5"
    />
    <Field v-if="mode === 'rate'" label="Ставка, % годовых">
      <NumField v-model="rate" kind="rate" placeholder="23,4" data-try-rate />
    </Field>

    <!-- Результат живой от ввода (Р-11): одна крупная цифра — платёж, строки — коротко (правило 12). -->
    <div v-if="result" class="flex flex-col gap-1.5 rounded-xl border border-card-border bg-surface-2 px-4 py-3.5" data-try-result>
      <div class="flex items-baseline gap-1.5">
        <span class="type-big num text-ink" data-try-payment>{{ money(result.payment) }}</span>
        <span class="type-meta">в месяц</span>
      </div>
      <p
        v-if="result.loadPct !== null"
        class="text-[14px] num"
        :class="result.loadPct >= 50 ? 'text-warn' : 'text-ink-2'"
        data-try-load
      >
        Нагрузка станет {{ result.loadPct }} % дохода · сейчас {{ result.loadNowPct }} %
      </p>
      <p v-if="heroLine" class="text-[14px] text-ink-2" data-try-hero>{{ heroLine }}</p>
      <p class="text-[14px] num text-ink-2" data-try-overpay>{{ overpayLine }}</p>
    </div>
    <p v-else class="text-[14px] text-ink-2" data-try-empty>{{ emptyHint }}</p>
  </Sheet>
</template>
