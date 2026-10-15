<script setup lang="ts">
import Button from '@/components/ui/Button.vue'
import { useTip } from './tips'

/**
 * Подсказка у предмета (бэклог «первый» Р-7, FR-05): обёртка над предметом и пузырь со стрелкой к нему — одна-две
 * короткие строки и тихое «Понятно» (главная кнопка экрана остаётся одна). Показывается сама, пока `id` не увиден на
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
      :class="['fx-in relative flex items-center gap-3 rounded-inner bg-brand-soft py-2.5 pl-3.5 pr-2.5 text-ink', above ? 'order-first mb-2.5' : 'mt-2.5']"
      @click.stop
    >
      <!-- Стрелка к предмету — тот же тон; текст и кнопка над ней. -->
      <span :class="['absolute left-1/2 size-3 -translate-x-1/2 rotate-45 bg-brand-soft', above ? '-bottom-1.5' : '-top-1.5']" aria-hidden="true" />
      <p class="relative min-w-0 flex-1 text-[13.5px] leading-snug">{{ text }}</p>
      <Button variant="secondary" size="sm" class="relative" data-tip-ok @click="tip.done">Понятно</Button>
    </div>
  </div>
</template>
