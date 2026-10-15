<script setup lang="ts">
import { PhLightbulb } from '@phosphor-icons/vue'
import { useTip } from './tips'

/**
 * Подсказка у предмета (бэклог «первый» Р-7, FR-05): обёртка над предметом и пузырь со стрелкой к нему — синий кружок с
 * лампочкой, одна-две короткие строки и «Понятно» текстом (главная кнопка экрана остаётся одна). Тон — «спокойный синий»
 * (`--tip-soft`, рамка `--tip-line`, знак и «Понятно» — `--tip`; выбор владельца из шести снимков, 2026-10-15). Показывается сама, пока `id` не увиден на
 * этом устройстве (`ff_tips_seen`); «Понятно» или нажатие самого предмета — отметка навсегда. Одна за раз и не поверх
 * листа или тоста (`tips.ts`). Без затемнения: пузырь стоит в потоке под предметом (`above` — над ним), ничего не
 * закрывает и едет с ним при прокрутке. Чем `Hint` не подходит: тот — по запросу и закрывается нажатием мимо.
 */
const props = defineProps<{
  id: string
  text: string
  /** Пузырь над предметом (под ним — главная кнопка или конец экрана). */
  above?: boolean
}>()

const tip = useTip(props.id)

/** Нажатие предмета работает как обычно и закрывает пузырь (только показанный: ждущий своей очереди — нет). */
function onSubject() {
  if (tip.shown.value) tip.done()
}
</script>

<template>
  <div class="flex flex-col" @click="onSubject">
    <slot />
    <div
      v-if="tip.shown.value"
      role="status"
      :data-tip="id"
      :class="['fx-in relative flex items-center gap-3 rounded-2xl border border-tip-line bg-tip-soft py-2.5 pl-3 pr-1.5 text-ink', above ? 'order-first mb-2.5' : 'mt-2.5']"
      @click.stop
    >
      <!-- Стрелка к предмету — тот же тон и рамка с двух сторон; знак, текст и кнопка — над ней. -->
      <span
        :class="['absolute left-1/2 size-3 -translate-x-1/2 rotate-45 bg-tip-soft', above ? '-bottom-[7px] border-b border-r border-tip-line' : '-top-[7px] border-l border-t border-tip-line']"
        aria-hidden="true"
      />
      <span class="relative grid size-[30px] shrink-0 place-items-center rounded-full bg-tip text-surface" aria-hidden="true"><PhLightbulb :size="16" weight="fill" /></span>
      <p class="relative min-w-0 flex-1 text-[13.5px] leading-snug">{{ text }}</p>
      <button type="button" class="press relative shrink-0 cursor-pointer rounded-pill px-2.5 py-1.5 text-[14px] font-bold text-tip" data-tip-ok @click="tip.done">Понятно</button>
    </div>
  </div>
</template>
