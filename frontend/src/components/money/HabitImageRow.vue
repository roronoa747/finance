<script setup lang="ts">
import { computed } from 'vue'
import { imageLine, imageMath, type HabitImage, type InterestImage } from '@/lib/finance'
import { dayLabel } from '@/lib/dates'
import { money } from '@/lib/money'
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
/**
 * Куски строки для переноса: «24 % мечты» не рвётся (`keep`), имя «Поездка в Японию» переносится целиком, если влезает
 * в строку (`name`, inline-block); последнее слово — вместе с «?», чтобы «?» не переносился один на свою строку.
 */
const parts = computed(() => {
  const s = line.value
  const out: { text: string; kind: 'plain' | 'keep' | 'name' }[] = []
  let at = 0
  for (const m of s.matchAll(/\d+ % \S+|«[^»]*»/g)) {
    if (m.index > at) out.push({ text: s.slice(at, m.index), kind: 'plain' })
    out.push({ text: m[0], kind: m[0].startsWith('«') ? 'name' : 'keep' })
    at = m.index + m[0].length
  }
  const rest = s.slice(at)
  const last = rest.search(/\S+$/)
  if (last < 0) {
    if (rest) out.push({ text: rest, kind: 'plain' })
  } else {
    if (last > 0) out.push({ text: rest.slice(0, last), kind: 'plain' })
    out.push({ text: rest.slice(last), kind: 'keep' })
  }
  return out
})
const math = computed(() => imageMath(props.image))
/** «✓ 7 000 в мечту» — перенос сделан. */
const moved = computed(() => ('habit' in props.image && props.image.moved ? `✓ ${money(props.image.moved)} в мечту` : null))
/** Дата сверки цены: «17 октября 2026». */
const checked = computed(() => {
  const d = math.value.checkedAt
  return d ? `${dayLabel(Number(d.slice(8, 10)), d.slice(0, 7))} ${d.slice(0, 4)}` : ''
})
</script>

<template>
  <div class="flex items-center gap-2" data-image>
    <p class="min-w-0 flex-1 text-[15px] text-ink num">
      <span data-image-line><template v-for="(p, i) in parts" :key="i"><template v-if="p.kind === 'plain'">{{ p.text }}</template><span v-else :class="p.kind === 'keep' ? 'whitespace-nowrap' : 'inline-block max-w-full'">{{ p.text }}</span></template></span><span class="whitespace-nowrap">&NoBreak;<span class="ml-1 inline-flex align-middle">
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
