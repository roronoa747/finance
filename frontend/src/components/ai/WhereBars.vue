<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { openPath } from '@/lib/aiFacts'
import type { WhereRow } from '@/lib/finance'
import { plain } from '@/lib/money'
import { useGrow } from '@/lib/motion'

/**
 * «Куда ушло» картинкой (бэклог «Разбор», Р-4, RZ-08): раздел — строкой, одна цифра — факт месяца; под ней полоса на долю
 * `share`: обычная — тихая (`--ink-3`), выше обычного — `--warn` и точка у названия, как на «Месяце» (тот же порог). Цвета
 * разделов палитры с `--warn` почти совпадают — «выше обычного» не читалось бы (стенд RZ-08). Риски — «обычно» (`--ink`)
 * и план (`--brand`), их числа — в листе раздела (правило 12: нет шумных цифр). Нажатие строки — лист раздела «Месяца»
 * (`/month?cat=<id>`, Р-18) у любой роли: это чтение. Геометрию считает `whereRows` (`finance.ts`), здесь — показ.
 */
/** `play` — расти сейчас: отчёт монтирует все карточки сразу и включает рост, когда «Куда ушло» впервые видно (`/ux`). */
const props = withDefaults(defineProps<{ rows: WhereRow[]; play?: boolean }>(), { play: true })

const grown = useGrow()
const pct = (share: number) => `${Math.max(0, Math.min(1, share)) * 100}%`
const legend = computed(() => ({ usual: props.rows.some((r) => r.usualShare !== null), plan: props.rows.some((r) => r.planShare !== null) }))
</script>

<template>
  <div class="flex flex-col" data-where-bars>
    <RouterLink
      v-for="r in rows"
      :key="r.categoryId"
      :to="openPath({ kind: 'cat', id: r.categoryId, name: r.name })"
      class="press flex flex-col gap-1.5 py-2.5"
      :data-where-row="r.categoryId"
      :data-over="r.over || undefined"
    >
      <span class="flex items-baseline justify-between gap-3 text-[15px]">
        <span class="min-w-0 truncate text-ink" data-where-name>
          {{ r.name
          }}<template v-if="r.over"><span class="ml-1.5 inline-block size-2 rounded-full bg-brand align-middle" data-where-dot aria-hidden="true" /><span class="sr-only">, больше обычного</span></template>
        </span>
        <b class="whitespace-nowrap font-semibold text-ink num">{{ plain(r.amount) }}</b>
      </span>
      <span class="relative block h-[10px] w-full rounded-pill bg-track" aria-hidden="true">
        <i
          class="absolute inset-y-0 left-0 block rounded-pill transition-[width] duration-(--motion-fill) ease-(--ease-out)"
          :class="r.over ? 'bg-warn' : 'bg-ink-3'"
          :style="{ width: grown && play ? pct(r.share) : '0%' }"
          data-where-fill
        />
        <!-- Обводка цветом фона: риска плана на `--warn` / `--ink-3` и «обычно» на `--warn` в тёмной теме — 1,2–1,6 : 1 (`/ux`). -->
        <i v-if="r.usualShare !== null" class="absolute -inset-y-[3px] block w-[2px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-canvas" :style="{ left: pct(r.usualShare) }" data-where-usual />
        <i v-if="r.planShare !== null" class="absolute -inset-y-[3px] block w-[2px] -translate-x-1/2 rounded-full bg-brand ring-2 ring-canvas" :style="{ left: pct(r.planShare) }" data-where-plan />
      </span>
    </RouterLink>
    <!-- Легенда рисок — одной строкой, только того, что нарисовано. -->
    <p v-if="legend.usual || legend.plan" class="mt-2 flex items-center gap-3 text-[12.5px] text-ink-2" data-where-legend>
      <span v-if="legend.usual" class="flex items-center gap-1.5"><i class="block h-3 w-[2px] rounded-full bg-ink" aria-hidden="true" />обычно</span>
      <span v-if="legend.plan" class="flex items-center gap-1.5"><i class="block h-3 w-[2px] rounded-full bg-brand" aria-hidden="true" />план</span>
    </p>
  </div>
</template>
