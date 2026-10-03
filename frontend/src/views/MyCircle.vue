<script setup lang="ts">
import { computed } from 'vue'
import Avatar from '@/components/kit/Avatar.vue'
import Card from '@/components/kit/Card.vue'
import { PERSON_COLORS, PERSON_EMOJI, oneEmoji, personColor, slotColor } from '@/lib/palette'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { PersonColor } from '@/types/finance'

/**
 * «Свой кружок» (Р-61, макет `money-breakdown.html` вопрос 4): большой кружок, «Смайлик» (буква имени + 11 + своя
 * плитка-поле: любой смайлик с клавиатуры, B2C-69) и «Цвет» (6 токенов). Только свой участник (маршрут — member);
 * выбор пишется сразу, синк — как у имени (`setPerson`).
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

// Свой смайлик (B2C-69): текущий не из списка — он и стоит в плитке-поле как выбранный.
const custom = computed(() => (emoji.value && !PERSON_EMOJI.includes(emoji.value) ? emoji.value : ''))
// Вставили один смайлик — он выбран сразу; буквы, цифры, два смайлика — поле возвращается к прежнему
// (пустое, если своего не было), ничего не пишется, без текста ошибки (правило 12).
function onOwnEmoji(e: Event) {
  const field = e.target as HTMLInputElement
  const own = oneEmoji(field.value)
  if (own) set({ emoji: own })
  else field.value = custom.value
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
        <!-- Последняя плитка — поле: нажал → клавиатура → вставил смайлик → выбран. Тот же квадрат, placeholder «＋». -->
        <label
          class="grid aspect-square cursor-text place-items-center rounded-[14px] bg-surface-2"
          :class="custom && 'outline outline-[2.5px] outline-ink'"
        >
          <input
            :value="custom"
            type="text"
            aria-label="Свой смайлик"
            placeholder="＋"
            autocomplete="off"
            enterkeyhint="done"
            class="size-full min-w-0 bg-transparent text-center text-[24px] leading-none text-ink outline-none placeholder:text-ink-3"
            @input="onOwnEmoji"
          />
        </label>
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
