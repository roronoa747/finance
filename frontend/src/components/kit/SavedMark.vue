<script setup lang="ts">
// Живая область постоянна, а текст появляется в ней: так озвучка его произносит, а в
// заголовке окна и в innerText отметки нет, пока она не горит.
defineProps<{
  on: boolean
}>()
</script>

<template>
  <span aria-live="polite" class="text-[12px] font-normal text-brand">
    <Transition
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200"
      leave-to-class="opacity-0"
    >
      <span v-if="on">Сохранено</span>
    </Transition>
  </span>
</template>
