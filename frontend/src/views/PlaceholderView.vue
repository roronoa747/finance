<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Card from '@/components/kit/Card.vue'

const route = useRoute()

const title = computed(() => {
  if (route.path.startsWith('/budget')) return 'Бюджет и Календарь'
  if (route.path.startsWith('/goals')) return 'Цели и Покупки'
  if (route.path.startsWith('/capital')) return 'Капитал и Кредиты'
  if (route.path.startsWith('/ritual')) return 'Ритуал высвобождения'
  return 'Раздел в разработке'
})

const blockInfo = computed(() => {
  if (route.path.startsWith('/budget') || route.path.startsWith('/ritual')) {
    return 'Блок 4 бэклога: управление категориями, план месяца, календарь зарплат и ритуал высвобождения средств.'
  }
  return 'Блок 5 бэклога: счета, вклады, кредитные графики и досрочное погашение.'
})
</script>

<template>
  <div class="py-6 flex flex-col items-center text-center gap-4">
    <Card class="w-full py-8 px-6 flex flex-col items-center gap-3">
      <div class="size-12 rounded-2xl bg-brand-soft text-brand grid place-items-center font-display text-[18px] font-bold">
        FF
      </div>
      <h2 class="font-display text-[20px] font-semibold text-ink">{{ title }}</h2>
      <p class="text-[13.5px] leading-relaxed text-ink-2 max-w-[320px]">
        {{ blockInfo }}
      </p>
    </Card>
  </div>
</template>
