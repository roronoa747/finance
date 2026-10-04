<script setup lang="ts">
import { computed } from 'vue'
import type { PersonId } from '@/types/finance'
import { memberColor } from '@/lib/palette'
import { useFinanceStore } from '@/stores/finance'

/**
 * Аватар участника (DESIGN.md §5): свой кружок (Р-61) — смайлик и цвет, выбранные участником; без выбора — первая
 * буква имени на `--pa`/`--pb`. Участника берёт из документа по `id` — у всех экранов один вид. 30 в шапке, 34 в
 * списках, 96 — экран «Свой кружок».
 */
const props = withDefaults(
  defineProps<{
    id: PersonId
    name: string
    size?: 24 | 30 | 34 | 96
  }>(),
  { size: 30 },
)

const finance = useFinanceStore()
const person = computed(() => finance.people.find((p) => p.id === props.id && !p.deletedAt))
const emoji = computed(() => person.value?.emoji || null)
// Обводка холстом — у кружков в ряду (шапка, списки); у большого на экране кружка её нет. Смайлик — крупнее буквы (макет `.av.emo`).
// Свой смайлик с клавиатуры (B2C-69) бывает флагом или семьёй через ZWJ: один глиф в строку, лишнее режется кружком.
const BOX = { 24: 'size-6', 30: 'size-[30px] border-2 border-canvas', 34: 'size-[34px] border-2 border-canvas', 96: 'size-24' }
const FONT = { letter: { 24: 'text-[11px]', 30: 'text-[12px]', 34: 'text-[12px]', 96: 'text-[40px]' }, emoji: { 24: 'text-[13px]', 30: 'text-[16px]', 34: 'text-[18px]', 96: 'text-[48px]' } }
</script>

<template>
  <span
    class="grid shrink-0 place-items-center rounded-full overflow-hidden whitespace-nowrap font-semibold leading-none text-dot-ink"
    :class="[BOX[size], FONT[emoji ? 'emoji' : 'letter'][size]]"
    :style="{ background: memberColor(finance.people, id) }"
    :title="name"
  >
    {{ emoji ?? name.slice(0, 1) }}
  </span>
</template>
