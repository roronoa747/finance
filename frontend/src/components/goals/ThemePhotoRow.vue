<script setup lang="ts">
import { templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'

/**
 * Ряд «другие фото» темы (B2C-64-а, PN-33): кружки 56 px под сеткой тем — в «Новой мечте» и в листе
 * «Фото мечты». Подписей нет — образ, не текст (правило 12); выбранное — обводкой бренда.
 */
defineProps<{ photos: GoalTemplate[]; selected: string | null | undefined }>()
const emit = defineEmits<{ (e: 'pick', t: GoalTemplate): void }>()
</script>

<template>
  <div class="flex gap-2" data-theme-photos>
    <button
      v-for="(v, i) in photos"
      :key="v.id"
      type="button"
      :aria-label="`Фото ${i + 1}`"
      :aria-pressed="selected === v.id"
      class="press size-14 shrink-0 overflow-hidden rounded-xl cursor-pointer"
      :class="selected === v.id && 'outline outline-[2.5px] outline-offset-2 outline-brand'"
      @click="emit('pick', v)"
    >
      <img :src="templateImageUrl(v, 160)" alt="" class="size-full object-cover" loading="lazy" />
    </button>
  </div>
</template>
