<script setup lang="ts">
import { computed } from 'vue'
import { imageLine, imageMath, type HabitImage, type InterestImage } from '@/lib/finance'
import { dayLabel } from '@/lib/dates'
import { plain } from '@/lib/money'
import Hint from '@/components/kit/Hint.vue'
import Button from '@/components/ui/Button.vue'

/**
 * Строка-образ (Р-24, Р-28, Р-31, AU-29): одна строка `--ink` 15 px — во что складывается привычка, без новой крупной
 * цифры; рядом «?» «Как посчитали» (цена с источником и датой и арифметика — `imageMath`, видно всем ролям) и справа
 * небольшая тихая кнопка действия — у своего предмета (правило 12); нет `label` (viewer, действия нет) — строка без
 * кнопки. Перенос уже сделан (`moved`, Х-9) — вместо кнопки тихое «✓ N в мечту», видно всем ролям. Все числа — `finance.ts`.
 */
const props = defineProps<{ image: HabitImage | InterestImage; label?: string | null; short?: boolean }>()
defineEmits<{ (e: 'act'): void }>()

/** `short` — в плашке «до плана», где мечта уже названа: «N % мечты» без имени. */
const line = computed(() => imageLine(props.image, { goalName: !props.short }))
/** Последнее слово строки — вместе с «?», чтобы «?» не переносился один на свою строку; «24 % мечты» — не рвётся у «%». */
const head = computed(() => line.value.replace(/(\d+ % )?\S+$/, ''))
const tail = computed(() => line.value.slice(head.value.length))
const math = computed(() => imageMath(props.image))
/** «✓ 7 000 в мечту» — перенос сделан. */
const moved = computed(() => ('habit' in props.image && props.image.moved ? `✓ ${plain(props.image.moved)} в мечту` : null))
/** Дата сверки цены: «17 октября 2026». */
const checked = computed(() => {
  const d = math.value.checkedAt
  return d ? `${dayLabel(Number(d.slice(8, 10)), d.slice(0, 7))} ${d.slice(0, 4)}` : ''
})
</script>

<template>
  <div class="flex items-center gap-2" data-image>
    <p class="min-w-0 flex-1 text-[15px] text-ink num">
      <span data-image-line>{{ head }}<span class="whitespace-nowrap">{{ tail }}</span></span><span class="whitespace-nowrap">&NoBreak;<span class="ml-1 inline-flex align-middle">
        <Hint label="Как посчитали">
          <span class="flex flex-col gap-1" data-image-math>
            <span v-if="math.item" class="font-semibold text-ink" data-image-item>{{ math.item }}</span>
            <span v-if="math.source" data-image-source>
              <a :href="math.source.url" target="_blank" rel="noopener" class="underline">{{ math.source.name }}</a><template v-if="checked">, {{ checked }}</template>
            </span>
            <span v-for="(l, i) in math.lines" :key="i" data-image-calc>{{ l }}</span>
          </span>
        </Hint>
      </span></span>
    </p>
    <span v-if="moved" class="shrink-0 whitespace-nowrap text-[14px] font-semibold text-ink-2 num" data-image-moved>{{ moved }}</span>
    <Button v-else-if="label" variant="secondary" size="sm" class="shrink-0" data-image-act @click="$emit('act')">{{ label }}</Button>
  </div>
</template>
