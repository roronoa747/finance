<script setup lang="ts">
export interface LegendItem {
  key: string
  color: string
  name: string
  value: string
  sub?: string
}

defineProps<{
  items: LegendItem[]
}>()
</script>

<template>
  <div class="mt-3.5 flex flex-col gap-2.5">
    <div
      v-for="it in items"
      :key="it.key"
      class="flex items-center gap-2.5 text-[14px]"
    >
      <i class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: it.color }" />
      <span class="text-ink-2">{{ it.name }}</span>
      <span class="ml-auto font-medium num text-ink">
        {{ it.value }}
        <span v-if="it.sub" class="ml-1 text-[12px] font-normal text-ink-3">{{ it.sub }}</span>
      </span>
    </div>
  </div>
</template>
