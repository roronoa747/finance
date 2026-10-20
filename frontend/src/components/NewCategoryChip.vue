<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import Chip from '@/components/kit/Chip.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

/**
 * «+ Раздел» (FB-03, Р-3, Р-13): тихий чип в ряду разделов — нажатие открывает строку «имя · Готово» на всю ширину ряда
 * (ряд — `flex-wrap`). «Готово» заводит раздел в общем документе (`addSpendCategory`: дубль по имени — тот же раздел) и
 * отдаёт его id — родитель делает с ним то же, что с нажатием чипа. Пустое имя — ничего. Viewer чипа не видит.
 */
const emit = defineEmits<{ (e: 'created', id: string): void }>()

const auth = useAuthStore()
const finance = useFinanceStore()
const open = ref(false)
const name = ref('')
const row = ref<HTMLElement | null>(null)

function start() {
  open.value = true
  name.value = ''
  void nextTick(() => row.value?.querySelector('input')?.focus())
}

function done() {
  const id = finance.addSpendCategory(name.value)
  if (!id) return
  open.value = false
  emit('created', id)
}
</script>

<template>
  <template v-if="!auth.isViewer">
    <Chip quiet data-new-category @click="start">+ Раздел</Chip>
    <div v-if="open" ref="row" class="flex w-full gap-2" data-new-category-row>
      <Input v-model="name" placeholder="Подарки" maxlength="24" autocapitalize="sentences" class="min-w-0 flex-1" @keydown.enter.prevent="done" />
      <Button size="sm" data-new-category-done @click="done">Готово</Button>
    </div>
  </template>
</template>
