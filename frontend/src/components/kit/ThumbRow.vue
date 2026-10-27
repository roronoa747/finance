<script setup lang="ts">
import { computed, useId } from 'vue'
import { useWideFit } from '@/lib/photos/fit'
import AdviceMark from '@/components/ai/AdviceMark.vue'

/**
 * Строка списка с мини-фото (макет dreams-week.html `.it`): фото 48 со скруглением 14 и тонкой рамкой поверх края
 * (`--line-strong`: светлое фото не сливается с белой карточкой — владелец, 2026-10-15, FR-09) (нет фото —
 * плашка `tone`, токен или цвет оттенка цели), название 16/600 в одну строку, под ним слот (полоса
 * цели или «сумма · чьё»), справа слот `end`. `clickable` — вся строка кнопка (цель); иначе действие
 * — в `end` (желание: «Открыть»). `index` — очередь появления (`fx-in`, `--i`). `mark` (строки мечт, бэклог «Разбор»,
 * RZ-11) — ✦ совета ИИ после названия: тогда кнопка строки — название, растянутое на строку (`row-open`), ✦ — рядом
 * своей кнопкой (кнопка в кнопке недопустима); без `mark` — прежняя строка-кнопка.
 */
const props = withDefaults(
  defineProps<{
    title: string
    src?: string | null
    tone?: string | null
    clickable?: boolean
    index?: number
    /** Широкое фото — целиком (B2C-73): у желаний; цели — на всю плитку. */
    fit?: boolean
    /** Черта сверху между строками; в сортируемом списке её держит строка списка (`SortableList`). */
    divided?: boolean
    /** Номер совета ИИ про эту мечту (`ai.markFor`) или null; не задан — прежняя строка-кнопка. */
    mark?: number | null
    /** Размер фото: цели — 48, желания — 56 (строка 80; пачка 2 «Figma», FG-21). */
    photo?: 48 | 56
  }>(),
  { src: null, tone: null, clickable: false, index: 0, fit: false, divided: true, mark: undefined, photo: 48 },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()
const wideFit = useWideFit(() => props.src)
const split = computed(() => props.clickable && props.mark !== undefined)
/** Разделённая строка: кнопка — только название; подпись и `end` (процент) читалка слышит описанием (`/ux` «Разбор» 3). */
const uid = useId()
</script>

<template>
  <component
    :is="clickable && !split ? 'button' : 'div'"
    :type="clickable && !split ? 'button' : undefined"
    class="fx-in flex w-full items-center gap-3 text-left"
    :class="[photo === 56 ? 'py-3' : 'py-[11px]', clickable && 'press cursor-pointer', split && 'relative', divided && 'border-t border-line first:border-t-0']"
    :style="{ '--i': index }"
    @click="clickable && emit('click', $event)"
  >
    <span class="block shrink-0 overflow-hidden rounded-[14px] bg-surface-3 outline -outline-offset-1 outline-line-strong" :class="photo === 56 ? 'size-14' : 'size-12'" :style="!src && tone ? { background: tone } : undefined">
      <img v-if="src" :src="src" alt="" :class="['size-full', fit ? wideFit.fit() : 'object-cover']" @load="wideFit.onLoad" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-[5px]">
      <span v-if="split" class="flex min-w-0 items-center">
        <button
          type="button"
          class="row-open min-w-0 truncate text-left text-[16px] font-semibold text-ink"
          data-row-open
          :aria-describedby="`${uid}-d ${uid}-e`"
        >{{ title }}</button>
        <AdviceMark :n="mark ?? null" />
      </span>
      <span v-else class="truncate text-[16px] font-semibold text-ink">{{ title }}</span>
      <span v-if="split" :id="`${uid}-d`" class="contents"><slot /></span>
      <slot v-else />
    </span>
    <span v-if="split" :id="`${uid}-e`" class="contents"><slot name="end" /></span>
    <slot v-else name="end" />
  </component>
</template>
