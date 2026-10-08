<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { cn } from '@/lib/utils'

/**
 * Три чипа «Денег» (пивот 3, Р-31; Блок 15, Р-91): Капитал · Долги · История. Чисел на чипах нет (Р-116, Б17) — они
 * повторяли экран под чипом: сумма капитала и долгов — крупно на своём экране, месяц истории — строкой там же.
 * Активный — по адресу; переход — `router.replace`: «назад» ведёт на прошлую вкладку, а не перебирает квадраты.
 */
const route = useRoute()
const router = useRouter()

const squares = [
  { to: '/money', title: 'Капитал' },
  { to: '/money/debts', title: 'Долги' },
  { to: '/money/history', title: 'История' },
]
</script>

<template>
  <div class="grid grid-cols-3 gap-2" role="group" aria-label="Деньги">
    <button
      v-for="s in squares"
      :key="s.to"
      type="button"
      :aria-current="route.path === s.to ? 'page' : undefined"
      :class="
        cn(
          'press h-11 min-w-0 truncate rounded-[14px] border px-2 text-center text-[14px] font-semibold cursor-pointer',
          route.path === s.to ? 'border-brand bg-brand-soft text-brand' : 'border-card-border bg-surface text-ink-2',
        )
      "
      @click="route.path !== s.to && router.replace(s.to)"
    >
      {{ s.title }}
    </button>
  </div>
</template>
