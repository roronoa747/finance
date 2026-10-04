<script setup lang="ts">
import { CURRENCIES, CURRENCY_SIGN } from '@/lib/fx'
import type { Currency } from '@/types/finance'
import { cn } from '@/lib/utils'

/** Чипы валюты суммы (Р-70, Р-75): знак из одной таблицы `CURRENCY_SIGN`, выбранная — брендовой обводкой. */
const model = defineModel<Currency>({ required: true })
</script>

<template>
  <div class="grid grid-cols-5 gap-2">
    <button
      v-for="c in CURRENCIES"
      :key="c"
      type="button"
      :aria-label="c"
      :aria-pressed="model === c"
      :class="cn('rounded-xl border px-2 py-2 text-[13px] transition-colors cursor-pointer', model === c ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line bg-surface-2 text-ink-2')"
      @click="model = c"
    >
      {{ CURRENCY_SIGN[c] }}
    </button>
  </div>
</template>
