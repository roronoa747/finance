<script setup lang="ts">
/**
 * Выбор счёта списания (ревью Блока 3, Н-6): кнопки счетов с остатками и «Не списывать —
 * только отметить». `undefined` — ещё не выбран, `null` — не списывать, иначе id счёта.
 * Подсказка под кнопками — слотом. Один для отметки оплаты (`PaidRow`) и шага плана
 * (`PlanStepAction`); окно досрочки держит свой `Select` внутри длинной формы — это RP-10
 * (хвост Н-11 `развитие-приложения`).
 */
import type { Account } from '@/types/finance'
import { money } from '@/lib/money'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'

defineProps<{ accounts: Account[] }>()
const model = defineModel<string | null | undefined>()
</script>

<template>
  <Field label="С какого счёта" group>
    <button
      v-for="a in accounts"
      :key="a.id"
      type="button"
      :class="
        cn(
          'flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-[13.5px] transition-colors cursor-pointer',
          model === a.id ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2',
        )
      "
      @click="model = a.id"
    >
      <span class="truncate">{{ a.name }}</span>
      <span class="shrink-0 num">{{ money(a.amount) }}</span>
    </button>
    <button
      type="button"
      :class="
        cn(
          'rounded-xl border px-3 py-2.5 text-left text-[13.5px] transition-colors cursor-pointer',
          model === null ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2',
        )
      "
      @click="model = null"
    >
      Не списывать — только отметить
    </button>
    <slot />
  </Field>
</template>
