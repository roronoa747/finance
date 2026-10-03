<script setup lang="ts">
import { computed } from 'vue'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import { PERSON_COLORS, PERSON_EMOJI, personColor, slotColor } from '@/lib/palette'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { PersonColor } from '@/types/finance'

/**
 * «Свой кружок» (Р-61, макет `money-breakdown.html` вопрос 4): большой кружок, «Смайлик» (буква имени + 11) и «Цвет»
 * (6 токенов). Только свой участник (маршрут — member); выбор пишется сразу, синк — как у имени (`setPerson`).
 */
const auth = useAuthStore()
const finance = useFinanceStore()

const me = computed(() => finance.people.find((p) => p.id === auth.slot && !p.deletedAt) ?? null)
const letter = computed(() => (me.value?.name ?? '').slice(0, 1))
const emoji = computed(() => me.value?.emoji || null)
// Без выбора отмечен цвет слота — он и есть сейчас у кружка.
const color = computed<string>(() => me.value?.color ?? (me.value ? slotColor(me.value.id) : ''))

const set = (patch: { emoji?: string | null; color?: PersonColor }) => {
  if (auth.slot) finance.setPerson(auth.slot, patch)
}
</script>

<template>
  <div v-if="me" class="flex flex-col gap-3 pt-1">
    <div class="fx-in flex justify-center py-3">
      <Avatar :id="me.id" :name="me.name" :size="96" />
    </div>

    <Card class="flex flex-col gap-3">
      <span class="type-label">Смайлик</span>
      <div class="grid grid-cols-6 gap-2">
        <button
          v-for="e in [null, ...PERSON_EMOJI]"
          :key="e ?? 'letter'"
          type="button"
          :aria-pressed="emoji === e"
          :aria-label="e ?? `Буква ${letter}`"
          class="press grid aspect-square place-items-center rounded-[14px] bg-surface-2 leading-none cursor-pointer"
          :class="[emoji === e && 'outline outline-[2.5px] outline-ink', e ? 'text-[24px]' : 'text-[20px] font-semibold text-ink']"
          @click="set({ emoji: e })"
        >
          {{ e ?? letter }}
        </button>
      </div>
    </Card>

    <Card class="flex flex-col gap-3">
      <span class="type-label">Цвет</span>
      <div class="grid grid-cols-6 gap-2">
        <button
          v-for="c in PERSON_COLORS"
          :key="c"
          type="button"
          :aria-pressed="color === c"
          :aria-label="`Цвет ${PERSON_COLORS.indexOf(c) + 1}`"
          class="press aspect-square rounded-full cursor-pointer"
          :class="color === c && 'outline outline-[2.5px] outline-offset-2 outline-ink'"
          :style="{ background: personColor(me.id, c) }"
          @click="set({ color: c })"
        />
      </div>
    </Card>
  </div>
</template>
