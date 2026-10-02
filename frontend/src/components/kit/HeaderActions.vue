<script setup lang="ts">
import { inject } from 'vue'

/**
 * Действия экрана в шапке оболочки (DESIGN.md §5 `.topbar .right`: карандаш цели, «+» желаний,
 * «Пропустить»). Внутри `AppShell` — переносятся в его шапку; без оболочки (SSR-тесты экрана) —
 * остаются на месте.
 */
const inShell = inject<boolean>('ff-shell-actions', false)
</script>

<template>
  <Teleport defer to="#shell-actions" :disabled="!inShell">
    <slot />
  </Teleport>
</template>
