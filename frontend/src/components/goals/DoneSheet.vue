<script setup lang="ts">
import { computed } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { doneLabel, doneTerm, liveGoals } from '@/lib/finance'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Момент «Сбылось» (PN-14, Р-13; макет `done.html`, ворота 2026-10-10): фото мечты, имя, «за N месяцев» от первого
 * взноса; брендовая «Поделиться» — карточка для сторис экрана цели (`StorySheet`, не копия), «Готово» — тихо закрыть.
 * Фото — то же, что у карточки сторис (`GoalDetail.storySrc`: своё, иначе шаблон с CDN), не своё вычисление.
 */
const props = defineProps<{ goalId: string | null; src?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'share'): void }>()

const finance = useFinanceStore()
const goal = computed(() => (props.goalId ? liveGoals(finance.goals).find((g) => g.id === props.goalId) : undefined))
const term = computed(() => (goal.value ? doneLabel(doneTerm(goal.value)) : ''))
</script>

<template>
  <!-- Слово момента — крупно под фото, как в макете; заголовок листа остаётся для диктора (`/ux` Б4). -->
  <Sheet :open="!!goal" title="Сбылось!" title-hidden @close="emit('close')">
    <div v-if="goal" class="flex flex-col items-center gap-1 text-center" data-done-sheet>
      <div class="relative mb-3.5 h-[300px] w-full overflow-hidden rounded-[22px] bg-surface-3">
        <img v-if="src" :src="src" alt="" class="size-full object-cover" />
        <span class="absolute bottom-3.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[14px] font-bold text-ok num">✓ 100 %</span>
      </div>
      <span class="type-sheet text-[34px] leading-[1.05] text-ink" aria-hidden="true">Сбылось!</span>
      <b class="type-h3 text-ink">{{ goal.name }}</b>
      <span class="text-[15px] text-ink-2" data-done-term>{{ term }}</span>
      <Button class="mt-4 w-full" data-done-share @click="emit('share')">Поделиться</Button>
      <Button variant="ghost" size="md" class="w-full" data-done-ok @click="emit('close')">Готово</Button>
    </div>
  </Sheet>
</template>
