<script setup lang="ts">
import { computed } from 'vue'
import { useOperationsStore } from '@/stores/operations'
import { useFlash } from '@/components/kit/useFlash'
import Toast from '@/components/kit/Toast.vue'
import NewObligationSheet from '@/components/capital/NewObligationSheet.vue'
import NewDebtSheet from '@/components/capital/NewDebtSheet.vue'

/**
 * «В платежи» (FB-09, Р-6, Р-17): форма «Регулярный платёж» поверх листа, заполненная повтором продавца строки
 * (`recurringFor`: имя — поле, его можно переписать; сумма и день — из выписки); «Добавить» → платёж, отметка месяца этой
 * строкой и правило по продавцу (`addToPayments`), тост «Добавлено в платежи». Строка кредита (TL-03, Р-3) — лист кредита
 * («Банку», платёж и день из выписки, спрашивает остаток). Один вход для листа операции и листов раздела «Недели» и «Месяца».
 */
const props = withDefaults(defineProps<{ opId: string | null; z?: number }>(), { z: 70 })
const emit = defineEmits<{ (e: 'close'): void; (e: 'added'): void }>()

const store = useOperationsStore()
const op = computed(() => (props.opId ? (store.all.find((o) => o.id === props.opId) ?? null) : null))
const prefill = computed(() => (op.value ? store.recurringFor(op.value) : null))
const credit = computed(() => (prefill.value?.kind === 'credit' ? { name: prefill.value.name, payment: prefill.value.amount, day: prefill.value.day } : null))
const { note, flash } = useFlash()

function created(id: string) {
  const o = op.value
  if (!o) return
  void store.addToPayments(o.id, id)
  flash('Добавлено в платежи')
  emit('added')
}
</script>

<template>
  <NewObligationSheet :open="!!prefill && !credit" :prefill="prefill" :z="z" @created="created" @close="emit('close')" />
  <NewDebtSheet :open="!!credit" :prefill="credit" :z="z" @created="created" @close="emit('close')" />
  <Toast v-if="note">{{ note }}</Toast>
</template>
