<script lang="ts">
/** Ошибка пары дат: одна без другой или конец раньше начала; обе пусты — поездка без дат (копим как обычно). */
export function tripDatesError(from: string, to: string): string | undefined {
  if (!from && !to) return undefined
  if (!from || !to) return 'Нужны обе даты'
  return to < from ? 'Последний день — не раньше первого' : undefined
}
</script>

<script setup lang="ts">
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Input from '@/components/ui/Input.vue'

/**
 * Даты и бюджет поездки (PN-31, Р-14) — одни поля для «Новой мечты» и листа правки. Даты необязательны (родной выбор
 * даты телефона), бюджет пустой — сумма мечты. Ошибка дат — строкой под парой (`name` формы или `error`).
 * `budgetBlur` — лист правки пишет бюджет по уходу из поля, как остальные поля цели.
 */
// `fieldClass` — подложка полей от экрана: на фоне страницы «Новой мечты» — `bg-surface`; в листе — своя у `Input` (/ux Б9:
// `bg-surface` в листе сливался с листом).
defineProps<{ error?: string; fieldClass?: string }>()
const from = defineModel<string>('from', { required: true })
const to = defineModel<string>('to', { required: true })
const budget = defineModel<string>('budget', { required: true })
const emit = defineEmits<{ (e: 'budgetBlur'): void }>()
</script>

<template>
  <Field label="Даты поездки" name="tripDates" :error="error" group>
    <div class="grid grid-cols-2 gap-2.5" data-trip-fields>
      <Input v-model="from" type="date" aria-label="Первый день" :class="fieldClass" data-trip-from />
      <Input v-model="to" type="date" aria-label="Последний день" :class="fieldClass" data-trip-to />
    </div>
  </Field>
  <Field label="Бюджет поездки">
    <template #hint><Hint label="Что такое бюджет поездки">Сколько планируете потратить в поездке; пусто — как сумма мечты</Hint></template>
    <span class="contents" @focusout="emit('budgetBlur')">
      <NumField v-model="budget" placeholder="как сумма мечты" :class="fieldClass" data-trip-budget />
    </span>
  </Field>
</template>
