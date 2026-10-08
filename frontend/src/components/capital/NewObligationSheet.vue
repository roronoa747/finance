<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money, parseMoney } from '@/lib/money'
import { MONTHS_NOM, monthKey, parseMonthKey } from '@/lib/dates'
import { yearShare } from '@/lib/finance'
import { CURRENCY_SIGN } from '@/lib/fx'
import type { Currency, PersonId } from '@/types/finance'
import { categoryName, type CategoryKey } from '@/lib/palette'
import { cn } from '@/lib/utils'

import CurrencyChips from '@/components/kit/CurrencyChips.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NbRateLine from '@/components/kit/NbRateLine.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { useNbRate } from '@/components/kit/useNbRate'

/**
 * Новый регулярный платёж — подписка или услуга (бывшее окно Капитала, PV-11). Сумма — в валюте платежа
 * (Р-75, чипы, тенге по умолчанию); у валютного — тихая строка «≈ N ₸ по курсу Нацбанка», курс версии —
 * Нацбанк сегодня (нет — поле курса руками). «Людям» (мелочи Р-5) — платёж маме, алименты, школа: строкой «Людям · N»
 * в «Долгах»; `people` — открыть с включённым (из «+ Людям»).
 */
const props = defineProps<{ open: boolean; people?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const people = computed(() => financeStore.people)

const obPeople = ref(false)
watch(() => props.open, (v) => { if (v) obPeople.value = !!props.people }, { immediate: true })
const obName = ref('')
const obAmount = ref('')
const obEvery = ref<'month' | 'year'>('month')
const obMonth = ref(String(parseMonthKey(monthKey()).month + 1))
const obDay = ref('10')
const obWho = ref<'all' | PersonId>('all')
const obCategory = ref<CategoryKey>('d4')
const obEstimate = ref(false)
const obCurrency = ref<Currency>('KZT')
const nb = useNbRate(obCurrency, () => props.open)
/** Сумма в тенге по курсу (тенговая — как введена). */
const obTenge = computed(() => nb.tenge(parseMoney(obAmount.value)))

// Разделы, куда кладётся платёж (React `AddObligationDialog`): цели и свободный
// остаток — не корзины. Разделы заводятся лениво — имя берётся из запасных.
const obBuckets = computed(() =>
  (['d1', 'd2', 'd4'] as CategoryKey[]).map((key) => ({ key, name: categoryName(financeStore.categories, key) })),
)

const form = useFormCheck(() => [
  ['name', !obName.value.trim() && (obPeople.value ? 'Введите, кому' : 'Введите название')],
  ['amount', parseMoney(obAmount.value) <= 0 ? 'Введите сумму' : !nb.ok.value && 'Нет курса — попробуйте позже'],
])

function createObligation() {
  financeStore.addObligation({
    name: obName.value.trim(),
    note: obEvery.value === 'year' ? 'раз в год' : 'ежемесячно',
    day: Math.min(28, Math.max(1, parseMoney(obDay.value) || 1)),
    category: obCategory.value,
    estimate: obEstimate.value,
    every: obEvery.value,
    month: obEvery.value === 'year' ? Math.min(12, Math.max(1, parseMoney(obMonth.value) || 1)) : undefined,
    who: obWho.value === 'all' ? null : obWho.value,
    amount: parseMoney(obAmount.value),
    fx: nb.foreign.value ? { currency: obCurrency.value, rate: nb.rate.value } : undefined,
    people: obPeople.value,
  })
  obName.value = ''
  obAmount.value = ''
  obEstimate.value = false
  obCurrency.value = 'KZT'
  nb.manual.value = ''
  emit('close')
}
</script>

<template>
  <Sheet :open="open" title="Регулярный платёж" @close="emit('close')">
    <div class="mb-3.5 flex items-center justify-between gap-3">
      <span class="flex items-center gap-1 text-[13.5px] font-medium text-ink">
        Людям
        <Hint label="Людям">Маме, алименты, школа — строкой «Людям» в «Долгах»</Hint>
      </span>
      <Toggle v-model="obPeople" label="Людям" tone="ok" />
    </div>

    <Field :label="obPeople ? 'Кому' : 'Что оплачиваем'" name="name">
      <Input v-model="obName" :placeholder="obPeople ? 'Например, маме или школе' : 'Например, интернет или абонемент'" />
    </Field>

    <Field label="Как часто" group>
      <Segmented
        v-model="obEvery"
        :options="[
          { value: 'month', label: 'Каждый месяц' },
          { value: 'year', label: 'Раз в год' },
        ]"
        class="mb-3"
      />
    </Field>

    <Field label="Валюта" group>
      <CurrencyChips v-model="obCurrency" />
    </Field>

    <Field :label="`${obEvery === 'year' ? 'Сумма за год' : 'Сумма в месяц'}, ${CURRENCY_SIGN[obCurrency]}`" name="amount">
      <NumField v-model="obAmount" :currency="obCurrency" placeholder="5 000" />
    </Field>
    <NbRateLine :amount="parseMoney(obAmount)" :currency="obCurrency" :nb="nb" />

    <p v-if="obEvery === 'year' && obTenge > 0" class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-2">
      В плане месяца это займёт {{ money(yearShare(obTenge)) }} — годовая сумма
      делится на двенадцать, чтобы не завышать одиннадцать месяцев и не удивляться на двенадцатый.
    </p>

    <Field v-if="obEvery === 'year'" label="Месяц списания" group>
      <div class="grid grid-cols-4 gap-1.5">
        <button
          v-for="(m, i) in MONTHS_NOM"
          :key="m"
          type="button"
          :aria-pressed="parseMoney(obMonth) === i + 1"
          :class="cn('rounded-lg border px-1 py-1.5 text-[12px] cursor-pointer', parseMoney(obMonth) === i + 1 ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
          @click="obMonth = String(i + 1)"
        >
          {{ m.slice(0, 3) }}
        </button>
      </div>
    </Field>

    <Field label="День платежа">
      <NumField v-model="obDay" kind="int" />
    </Field>

    <Field v-if="people.length > 1" label="Чьё это" group>
      <div class="flex gap-1.5 mb-3">
        <button
          type="button"
          :class="cn('rounded-lg border px-3 py-1.5 text-[12.5px] cursor-pointer', obWho === 'all' ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
          @click="obWho = 'all'"
        >
          Общее
        </button>
        <button
          v-for="p in people"
          :key="p.id"
          type="button"
          :class="cn('rounded-lg border px-3 py-1.5 text-[12.5px] cursor-pointer', obWho === p.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
          @click="obWho = p.id"
        >
          {{ p.name }}
        </button>
      </div>
    </Field>

    <Field label="В какой раздел бюджета" group>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="c in obBuckets"
          :key="c.key"
          type="button"
          :aria-pressed="obCategory === c.key"
          :class="cn('rounded-lg border px-2.5 py-1.5 text-[12.5px] cursor-pointer', obCategory === c.key ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
          @click="obCategory = c.key"
        >
          {{ c.name }}
        </button>
      </div>
    </Field>

    <label class="mb-3 flex items-center gap-2.5 text-[13.5px] text-ink">
      <input v-model="obEstimate" type="checkbox" class="size-4 accent-[var(--brand)]" />
      Сумма плавает — показывать как оценку
    </label>

    <Button class="w-full mt-2" @click="form.submit(createObligation)">
      Добавить
    </Button>
  </Sheet>
</template>
