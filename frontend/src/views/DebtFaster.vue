<script setup lang="ts">
import PlanSquare from '@/components/money/PlanSquare.vue'

/**
 * «Закрыть быстрее» (Б17, макет polish-b17 «Как закрыть быстрее»): свой экран со стрелкой «назад» вместо раскрывашки на
 * «Долгах». Сверху — один переключатель «Сначала долги» и одна крупная цифра; ставки, проценты, «Копить или гасить?»
 * и «Шаги по месяцам» — за «Подробнее» (`PlanSquare`). Всё считает `finance.ts`.
 */
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <PlanSquare />
  </div>
</template>
