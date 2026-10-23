<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

/**
 * Сегмент «Денег» (пивот 3, Р-31; Блок 15, Р-91; вид — Блок 5 «Фидбек», Р-34, Figma `19:2`): Капитал · Долги · История —
 * группа кнопок того же вида, что «Неделя | Месяц» (`PlanSwitch`), без коробок с рамкой. Чисел на сегменте нет (Р-116,
 * Б17) — они повторяли экран под ним. Активный — по адресу; переход — `router.replace`: «назад» ведёт на прошлую
 * вкладку, а не перебирает части.
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
  <div class="flex gap-1 rounded-[14px] bg-surface-2 p-1" role="group" aria-label="Деньги">
    <button
      v-for="s in squares"
      :key="s.to"
      type="button"
      :aria-current="route.path === s.to ? 'page' : undefined"
      class="press min-w-0 flex-1 cursor-pointer truncate rounded-[10px] p-[9px] text-center text-[14.5px] font-semibold"
      :class="route.path === s.to ? 'bg-surface text-ink' : 'text-ink-2'"
      @click="route.path !== s.to && router.replace(s.to)"
    >
      {{ s.title }}
    </button>
  </div>
</template>
