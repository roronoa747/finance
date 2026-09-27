<script setup lang="ts">
/**
 * Большая цифра с подписью секции (DESIGN.md §5: старый герой «Свободно» → карточка с
 * `type-section` и `type-big`). Герой мечты с фото — `DreamHero`.
 */
defineProps<{
  label: string
  value: string
}>()
</script>

<template>
  <div class="rounded-card border border-card-border bg-surface p-5">
    <div class="type-section">{{ label }}</div>
    <div class="mt-2 type-big num text-ink">{{ value }}</div>
    <div v-if="$slots.default" class="mt-1.5 text-[13px] text-ink-2"><slot /></div>
  </div>
</template>
