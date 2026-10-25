<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhLightbulb } from '@phosphor-icons/vue'
import { TIP_SEEN_MS, useTip } from './tips'

/**
 * Подсказка у предмета (бэклог «первый» Р-7, FR-05): обёртка над предметом и пузырь со стрелкой к нему — синий кружок с
 * лампочкой, одна-две короткие строки и «Понятно» текстом (главная кнопка экрана остаётся одна). Тон — «спокойный синий»
 * (`--tip-soft`, рамка `--tip-line`, знак и «Понятно» — `--tip`; выбор владельца из шести снимков, 2026-10-15). Показывается сама, пока `id` не увиден на
 * этом устройстве (`ff_tips_seen`); «Понятно», нажатие самого предмета или 4 с на экране — отметка навсегда. Одна за раз и не поверх
 * листа или тоста (`tips.ts`). Без затемнения: пузырь стоит в потоке под предметом (`above` — над ним), ничего не
 * закрывает и едет с ним при прокрутке. Чем `Hint` не подходит: тот — по запросу и закрывается нажатием мимо.
 */
const props = defineProps<{
  id: string
  text: string
  /** Пузырь над предметом (под ним — главная кнопка или конец экрана). */
  above?: boolean
  /** Предмета ещё нет (пустая неделя) — пузырь ждёт его появления и очередь не держит (FR-06 п. 2). */
  wait?: boolean
}>()

const tip = useTip(props.id, () => !props.wait)
const root = ref<HTMLElement | null>(null)
const bubble = ref<HTMLElement | null>(null)

/**
 * Нажатие предмета работает как обычно и закрывает пузырь (только показанный: ждущий своей очереди — нет). Слушаем в
 * перехвате, до обработчика предмета: настоящее нажатие между обработчиками выполняет микрозадачи — предмет, открывший
 * лист («Неделя» — раздел), успел бы перерисовать экран и спрятать пузырь до всплытия (возврат приёмки Блока 2). Нативный
 * слушатель, а не `@click.capture`: Vue сверяет метку события с навешиванием, и вложенный обработчик предмета при равной
 * метке отбросился бы. Нажатия в самом пузыре — не предмет.
 */
function onSubject(e: MouseEvent) {
  if (bubble.value?.contains(e.target as Node)) return
  if (tip.shown.value) tip.done()
}
onMounted(() => root.value?.addEventListener('click', onSubject, true))
onBeforeUnmount(() => root.value?.removeEventListener('click', onSubject, true))

/**
 * Показанная — значит увиденная (F2-Х3, Р-13 «Figma», вариант составителя): пузырь, простоявший на экране `TIP_SEEN_MS`
 * подряд, отмечается сам — ушёл со вкладки, не ответив, второй раз его не будет. Таймер идёт только пока пузырь показан:
 * под листом или тостом (`holdTips`) и пока предмета нет (`wait`) `shown` ложно — таймер сброшен.
 */
let seenTimer: ReturnType<typeof setTimeout> | null = null
const stopSeen = () => {
  if (seenTimer) clearTimeout(seenTimer)
  seenTimer = null
}
watch(
  () => tip.shown.value,
  (on) => {
    stopSeen()
    if (on) seenTimer = setTimeout(() => tip.done(), TIP_SEEN_MS)
  },
  { immediate: true },
)
onBeforeUnmount(stopSeen)
</script>

<template>
  <div ref="root" class="flex flex-col">
    <slot />
    <div
      v-if="tip.shown.value"
      ref="bubble"
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
