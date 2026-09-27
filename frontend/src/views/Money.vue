<script setup lang="ts">
import { useRouter } from 'vue-router'
import { PhChartBar, PhCoins, PhCalendarBlank } from '@phosphor-icons/vue'
import Card from '@/components/kit/Card.vue'
import Row from '@/components/kit/Row.vue'

/**
 * «Деньги» — вход на второй уровень (DESIGN.md §2, §3; B2C-13). Список входов; карточка
 * «Свободно», «Впереди», «Мои операции» и «История» — B2C-21.
 */
const router = useRouter()

const entries = [
  { to: '/money/budget', title: 'Бюджет', note: 'план месяца, календарь платежей, список', icon: PhChartBar },
  { to: '/money/capital', title: 'Капитал', note: 'счета, обязательства, кредиты', icon: PhCoins },
  { to: '/money/plan', title: 'План «Сначала долги»', note: 'шаги месяца и прогноз', icon: PhCalendarBlank },
]
</script>

<template>
  <div class="flex flex-col gap-3 pt-1">
    <Card tight>
      <div class="flex flex-col">
        <Row v-for="e in entries" :key="e.to" :title="e.title" :note="e.note" clickable dense @click="router.push(e.to)">
          <template #icon><component :is="e.icon" :size="18" /></template>
        </Row>
      </div>
    </Card>
  </div>
</template>
