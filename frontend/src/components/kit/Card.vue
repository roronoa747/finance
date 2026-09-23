<script setup lang="ts">
withDefaults(
  defineProps<{
    flush?: boolean
    className?: string
  }>(),
  {
    flush: false,
    className: '',
  },
)
</script>

<template>
  <div
    :class="[
      'rounded-[18px] border border-line bg-surface',
      flush ? 'overflow-hidden p-0' : 'p-4',
      className,
    ]"
  >
    <slot />
  </div>
</template>
