<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { parseMoney, plain } from '@/lib/money'
import { todayIso } from '@/lib/dates'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'

/**
 * «Заметка» себе с датой (Блок 5 «Фидбек», Р-33; Figma `19:127`): текст (обязателен, до 80 знаков), дата (сегодня по
 * умолчанию) и сумма по желанию. Живёт в личном документе (`finance.addNote` / `setNote`), всплывает карточкой на
 * «Неделе» своей даты; партнёр и viewer не видят. Деньги заметки нигде не считаются — только подпись. Одна главная
 * кнопка «Сохранить» (подтверждение в листе — правило 12); `noteId` — правка, «Удалить» — тихо внизу.
 */
const props = defineProps<{ open: boolean; noteId?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', date: string): void }>()

const finance = useFinanceStore()
const editing = computed(() => (props.noteId ? (finance.notes.find((n) => n.id === props.noteId) ?? null) : null))

const text = ref('')
const date = ref(todayIso())
const amount = ref('')
const form = useFormCheck(() => [
  ['text', !text.value.trim() && 'Напишите, о чём заметка'],
  ['date', !date.value && 'Выберите дату'],
])

watch(
  () => [props.open, props.noteId] as const,
  ([open]) => {
    if (!open) return
    const n = editing.value
    text.value = n?.text ?? ''
    date.value = n?.date ?? todayIso()
    amount.value = n?.amount ? plain(n.amount) : ''
    form.reset()
  },
  { immediate: true },
)

function save() {
  const patch = { text: text.value, date: date.value, amount: amount.value.trim() ? parseMoney(amount.value) : null }
  if (editing.value) finance.setNote(editing.value.id, patch)
  else finance.addNote(patch)
  emit('saved', date.value)
  emit('close')
}

function remove() {
  if (editing.value) finance.removeNote(editing.value.id)
  emit('close')
}
</script>

<template>
  <Sheet :open="open && (!noteId || !!editing)" title="Заметка" @close="emit('close')">
    <div data-note-sheet>
      <Field label="Что" name="text">
        <Input v-model="text" placeholder="Продлить страховку" maxlength="80" autocapitalize="sentences" data-note-text />
      </Field>
      <div class="flex gap-2">
        <Field label="Когда" name="date" class="min-w-0 flex-1">
          <Input v-model="date" type="date" data-note-date />
        </Field>
        <Field label="Сумма" class="min-w-0 flex-1">
          <NumField v-model="amount" placeholder="60 000" data-note-amount />
        </Field>
      </div>
      <p class="mb-4 text-[13px] text-ink-2">Всплывёт на своей неделе. Видите только вы.</p>
      <Button size="lg" class="w-full" :class="editing && 'mb-3'" data-note-save @click="form.submit(save)">Сохранить</Button>
      <DangerZone v-if="editing" label="Удалить заметку" warning="Заметка уйдёт с недели." data-note-remove @confirm="remove" />
    </div>
  </Sheet>
</template>
