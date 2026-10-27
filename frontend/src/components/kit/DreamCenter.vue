<script setup lang="ts">
import { PhHeart } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'

/**
 * Пустые «Мечты» (пивот 3, Р-42): «На что копим?» с одной брендовой «Выбрать мечту» (у viewer без кнопки). Главная мечта
 * рисуется обложкой `DreamHero size="cover"` (пачка 2 «Figma», FG-21) — ветка с фото квадратом отсюда убрана.
 */
withDefaults(defineProps<{ canPick?: boolean }>(), { canPick: true })

const emit = defineEmits<{ (e: 'pick'): void }>()
</script>

<template>
  <section class="fx-in flex flex-col items-center gap-3 self-center pt-2 text-center">
    <div class="grid size-[236px] place-items-center rounded-[32px] border border-dashed border-line-strong bg-surface text-ink-3" aria-hidden="true">
      <PhHeart :size="44" />
    </div>
    <h2 class="type-h2 text-ink">На что копим?</h2>
    <Button v-if="canPick" @click="emit('pick')">Выбрать мечту</Button>
  </section>
</template>
