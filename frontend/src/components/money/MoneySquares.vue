<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import SegmentGroup from '@/components/kit/SegmentGroup.vue'

/**
 * Сегмент «Денег» (пивот 3, Р-31; Блок 15, Р-91; вид — Блок 5 «Фидбек», Р-34, Figma `19:2`): Капитал · Долги · История —
 * `kit/SegmentGroup`, тот же вид и ползунок, что «Неделя | Месяц» (`PlanSwitch`, К-11, FG-09). Чисел на сегменте нет
 * (Р-116, Б17) — они повторяли экран под ним. Активный — по адресу; переход — `router.replace`: «назад» ведёт на
 * прошлую вкладку, а не перебирает части.
 */
const route = useRoute()
const router = useRouter()

const squares = [
  { key: '/money', label: 'Капитал' },
  { key: '/money/debts', label: 'Долги' },
  { key: '/money/history', label: 'История' },
]
</script>

<template>
  <SegmentGroup :items="squares" :active="route.path" label="Деньги" @pick="(to) => router.replace(to)" />
</template>
