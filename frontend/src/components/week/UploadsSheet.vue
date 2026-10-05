<script setup lang="ts">
import { computed } from 'vue'
import { useOperationsStore } from '@/stores/operations'
import { atLabel, weekRangeLabel } from '@/lib/dates'
import { plural } from '@/lib/utils'
import type { PersonId } from '@/types/finance'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'

/**
 * «Мои выписки» (Р-102; макет week-month.html «Нажал свой кружок»): свои загрузки — банк, период, число операций,
 * когда загрузил; новые сверху. Одна кнопка — «+ Загрузить выписку» (в листе — во всю ширину, правило 12).
 */
const props = defineProps<{ open: boolean; me: PersonId; busy?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'upload'): void }>()

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom' }
const store = useOperationsStore()
const mine = computed(() =>
  store.uploads.filter((u) => u.slot === props.me).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)),
)
</script>

<template>
  <Sheet :open="open" title="Мои выписки" @close="emit('close')">
    <div class="mb-3 flex flex-col" data-uploads>
      <p v-if="!mine.length" class="py-2 type-meta">Пока ни одной</p>
      <div v-for="u in mine" :key="u.id" class="flex items-center gap-2.5 border-t border-line py-[11px] first:border-t-0" data-upload>
        <span class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-[14px] font-bold text-ink-2" aria-hidden="true">
          {{ (BANKS[u.bank] ?? u.bank).slice(0, 1).toUpperCase() }}
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate text-[15.5px] font-semibold text-ink">{{ BANKS[u.bank] ?? u.bank }}</span>
          <span class="truncate text-[12.5px] text-ink-3 num">
            {{ weekRangeLabel({ from: u.period_from, to: u.period_to }) }} · {{ u.ops_count }} {{ plural(u.ops_count, 'операция', 'операции', 'операций') }}
          </span>
        </span>
        <span class="shrink-0 type-meta num">{{ atLabel(u.created_at) }}</span>
      </div>
    </div>
    <Button class="w-full" :disabled="busy" @click="emit('upload')">+ Загрузить выписку</Button>
  </Sheet>
</template>
