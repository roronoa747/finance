<script setup lang="ts">
import { computed } from 'vue'
import { moneyIn, parseMoney, plain } from '@/lib/money'
import { CURRENCY_SIGN } from '@/lib/fx'
import { advanceRest, rhythmDefaults } from '@/lib/finance'
import type { Currency, PayRhythm, Person } from '@/types/finance'
import Chip from '@/components/kit/Chip.vue'
import Field from '@/components/kit/Field.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import Segmented from '@/components/kit/Segmented.vue'

/**
 * Как приходит зарплата (понятность Р-5, PN-23) — один блок для «Изменить оклад» (`SalaryDialog`, пишет сразу) и
 * ручного ввода первого запуска (`Start.vue`, пишет при «Дальше»): ритм и поля по ритму — день зарплаты; день и сумма
 * аванса; день недели. Сам ничего не пишет — отдаёт правку `change` (поля `Person`). Аванс — в валюте оклада, остаток
 * считается (`salary − salary2`).
 */
type RhythmPatch = Partial<Pick<Person, 'payRhythm' | 'payday' | 'payday2' | 'salary2' | 'weekday'>>

const props = defineProps<{
  rhythm: PayRhythm
  payday: number
  payday2?: number
  salary2?: number
  weekday?: number
  /** Оклад в валюте оклада (у недели — за неделю): остаток после аванса. */
  salary: number
  currency: Currency
  /** Фон полей — первый запуск на фоне surface-2 даёт bg-surface. */
  fieldClass?: string
}>()

const emit = defineEmits<{ (e: 'change', patch: RhythmPatch): void }>()

const RHYTHMS: { value: PayRhythm; label: string }[] = [
  { value: 'month', label: 'Раз в месяц' },
  { value: 'advance', label: 'С авансом' },
  { value: 'week', label: 'Раз в неделю' },
]
const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

const sign = computed(() => CURRENCY_SIGN[props.currency])
const rest = computed(() => advanceRest(props.salary, props.salary2))

function pickRhythm(r: PayRhythm) {
  if (r === props.rhythm) return
  emit('change', rhythmDefaults(props, r, props.salary))
}

const day = (text: string) => Math.min(28, Math.max(1, parseMoney(text) || 1))

function onPayday(text: string) {
  const v = day(text)
  // Аванс и зарплата в один день — не ритм аванса; такой день не принимаем.
  if (v !== props.payday && !(props.rhythm === 'advance' && v === props.payday2)) emit('change', { payday: v })
}
function onPayday2(text: string) {
  const v = day(text)
  if (v !== props.payday2 && v !== props.payday) emit('change', { payday2: v })
}
function onSalary2(text: string) {
  const v = Math.max(0, parseMoney(text))
  if (v !== props.salary2) emit('change', { salary2: v })
}
</script>

<template>
  <div data-pay-rhythm>
    <Field label="Как приходит" group>
      <Segmented :model-value="rhythm" :options="RHYTHMS" @update:model-value="pickRhythm" />
    </Field>

    <Field v-if="rhythm === 'week'" label="День недели" group>
      <div class="flex flex-wrap gap-1.5" data-weekday>
        <Chip v-for="(w, i) in WEEKDAYS" :key="w" :on="weekday === i + 1" @click="emit('change', { weekday: i + 1 })">{{ w }}</Chip>
      </div>
    </Field>

    <template v-else-if="rhythm === 'advance'">
      <div class="grid grid-cols-2 gap-2.5">
        <Field label="День аванса">
          <NumFieldBlur :class="fieldClass" :initial="String(payday2 ?? '')" kind="int" data-payday2 @commit="onPayday2" />
        </Field>
        <Field :label="`Аванс, ${sign}`">
          <NumFieldBlur :class="fieldClass" :initial="plain(salary2 ?? 0)" :currency="currency" data-salary2 @commit="onSalary2" />
        </Field>
      </div>
      <Field label="День зарплаты">
        <NumFieldBlur :class="fieldClass" :initial="String(payday)" kind="int" data-payday @commit="onPayday" />
        <span class="text-[12.5px] text-ink-2 num" data-rest>остальное — {{ moneyIn(rest, currency) }}</span>
      </Field>
    </template>

    <Field v-else label="День зарплаты">
      <NumFieldBlur :class="fieldClass" :initial="String(payday)" kind="int" data-payday @commit="onPayday" />
    </Field>
  </div>
</template>
