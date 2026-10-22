<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PhCaretRight, PhPencilSimple } from '@phosphor-icons/vue'
import { useOperationsStore } from '@/stores/operations'
import { money, plain } from '@/lib/money'
import { dayWeekdayLabel, weekRange, weekRangeLabel } from '@/lib/dates'
import { sectionWeek, type MyWeekRow } from '@/lib/finance'
import { plural } from '@/lib/utils'
import Sheet from '@/components/kit/Sheet.vue'

/**
 * Лист раздела «Недели» (Р-101; макет week-month.html «Нажал „Такси“»): сумма за неделю, к прошлой, остаток на
 * месяц, топ продавцов и свои операции по дням — первые пять, остальные за «Ещё N». Строка — кнопка: ручная трата —
 * `edit` (лист «Трата», бэклог «Ручная трата», Р-2), строка выписки и с телефона — `open` (лист операции `OpSheet`,
 * FB-04, Р-14); у возврата — «вернули N» мелко. Всё считает
 * `sectionWeek` / `myWeek` (`finance.ts`). Времени операции в выписке нет — строка без него. Операции — вместе с
 * выпиской, которая ещё ждёт тост (`store.shown`): лист сходится со строкой раздела и до отправки.
 */
const props = defineProps<{ row: MyWeekRow | null; week: string; monthName: string }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'edit', id: string): void; (e: 'open', id: string): void }>()

const store = useOperationsStore()
const all = ref(false)
watch(
  () => props.row?.categoryId,
  () => (all.value = false),
)
const detail = computed(() =>
  props.row ? sectionWeek(store.shown, { week: props.week, categoryId: props.row.categoryId, ...(all.value ? { limit: Infinity } : {}) }) : null,
)
</script>

<template>
  <Sheet :open="!!row" :title="row?.name ?? ''" @close="emit('close')">
    <template v-if="row && detail">
      <p class="font-num text-[32px] font-bold leading-tight num text-ink" data-section-total>{{ money(row.amount) }}</p>
      <p class="mb-3 type-meta num" data-section-meta>
        {{ weekRangeLabel(weekRange(week)) }}
        <template v-if="row.prev > 0 && row.delta !== 0">
          · <span :class="row.delta > 0 ? 'text-warn' : 'text-ok'">{{ row.delta > 0 ? '↑' : '↓' }} {{ plain(Math.abs(row.delta)) }}</span> к прошлой
        </template>
        <!-- «из N» переехало сюда со строки «Недели» (Р-116). -->
        <template v-if="row.rest !== null"> · на {{ monthName }} {{ row.rest >= 0 ? 'осталось' : 'сверх плана' }} {{ plain(Math.abs(row.rest)) }}<template v-if="row.rest >= 0 && row.plan !== null"> из {{ plain(row.plan) }}</template></template>
      </p>

      <div v-if="detail.tops.length" class="mb-1 flex flex-col gap-1.5 rounded-[14px] bg-surface-2 px-3 py-2.5" data-section-tops>
        <div v-for="t in detail.tops" :key="t.name" class="flex justify-between gap-2 text-[13.5px] text-ink">
          <span class="min-w-0 truncate">{{ t.name }}</span>
          <span class="shrink-0 text-ink-2 num">{{ t.count }} {{ plural(t.count, 'раз', 'раза', 'раз') }} · {{ plain(t.amount) }}</span>
        </div>
      </div>

      <div class="flex flex-col" data-section-ops>
        <template v-for="d in detail.days" :key="d.date">
          <p class="pb-1 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">{{ dayWeekdayLabel(d.date) }}</p>
          <!-- Строка — кнопка: ручная (карандаш) — лист «Трата», выписка и телефон (шеврон) — лист операции (FB-04). -->
          <button
            v-for="o in d.ops"
            :key="o.id"
            type="button"
            class="press flex w-full cursor-pointer items-center gap-2 border-t border-line py-[7px] text-left text-[14.5px] text-ink"
            :aria-label="o.hand ? `Поправить: ${o.name}` : o.name"
            :data-hand-op="o.hand ? o.id : undefined"
            :data-section-op="o.hand ? undefined : o.id"
            @click="o.hand ? emit('edit', o.id) : emit('open', o.id)"
          >
            <span class="min-w-0 flex-1 truncate">{{ o.name }}</span>
            <span v-if="o.refund" class="shrink-0 type-meta num" data-refund>вернули {{ plain(o.refund) }}</span>
            <b class="font-num font-semibold num">{{ plain(o.amount) }}</b>
            <PhPencilSimple v-if="o.hand" :size="14" class="shrink-0 text-ink-3" aria-hidden="true" />
            <PhCaretRight v-else :size="14" class="shrink-0 text-ink-3" aria-hidden="true" />
          </button>
        </template>
      </div>
      <button
        v-if="detail.more"
        type="button"
        class="press flex w-full cursor-pointer items-center justify-between px-0.5 py-2 text-left text-[15px] font-semibold text-ink-2"
        data-section-more
        @click="all = true"
      >
        <span class="num">Ещё {{ detail.more.count }} · {{ money(detail.more.amount) }}</span>
        <PhCaretRight :size="15" class="text-ink-3" />
      </button>
      <p v-if="!detail.count" class="py-2 type-meta">За эту неделю трат нет</p>
    </template>
  </Sheet>
</template>
