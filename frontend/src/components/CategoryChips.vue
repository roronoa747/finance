<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { spendColor } from '@/lib/palette'
import { liveSpendCategories } from '@/lib/finance'
import { OTHER_CATEGORY } from '@/lib/statements/dictionary'
import type { MerchantRule } from '@/lib/statements/types'
import Chip from '@/components/kit/Chip.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import NewCategoryChip from '@/components/NewCategoryChip.vue'

/**
 * «Куда отнести?» — ответы на продавца одним набором (B2C-15/21; «Неделя» и «История»): чипы
 * разделов (первые `top`, обычно шесть; «Ещё N ▾»), «Кому → что» (у перевода человеку — поле «что это»),
 * «Между своими», у вопроса о продавце — «Не помню» (`forgot`: «Прочее», Р-58), «+ Раздел» — новый раздел, ответ им
 * же (FB-03). Ответ — правило
 * `MerchantRule['to']`; что с ним делать (в разборе или задним числом), решает родитель.
 */
// `top` — сколько разделов видно до «Ещё N ▾» (док пачки — 3, как в макете: док не закрывает список). `current` — раздел
// операции сейчас (лист операции, FB-04): чип выбран и виден и свёрнутым.
const props = withDefaults(defineProps<{ counterparty?: boolean; forgot?: boolean; top?: number; current?: string | null }>(), { top: 6, current: null })
const emit = defineEmits<{ (e: 'choose', to: MerchantRule['to']): void }>()

const finance = useFinanceStore()
const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const more = ref(false)
const shown = computed(() => {
  if (more.value) return categories.value
  const top = categories.value.slice(0, props.top)
  const picked = categories.value.find((c) => c.id === props.current)
  return picked && !top.includes(picked) ? [...top, picked] : top
})
const personOpen = ref(false)
const personText = ref('')

function choose(to: MerchantRule['to']) {
  more.value = false
  personOpen.value = false
  emit('choose', to)
}
function savePerson() {
  const what = personText.value.trim()
  if (what) choose({ person: what })
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap gap-2">
      <Chip v-for="c in shown" :key="c.id" :on="c.id === current" :sw="spendColor(c)" @click="choose({ categoryId: c.id })">{{ c.name }}</Chip>
      <Chip v-if="!more && categories.length > shown.length" quiet @click="more = true">Ещё {{ categories.length - shown.length }} ▾</Chip>
      <NewCategoryChip @created="(id) => choose({ categoryId: id })" />
      <Chip v-if="counterparty" quiet @click="(personOpen = true), (personText = '')">Кому → что</Chip>
      <Chip quiet @click="choose({ internal: true })">Между своими</Chip>
      <Chip v-if="forgot" quiet @click="choose({ categoryId: OTHER_CATEGORY })">Не помню</Chip>
    </div>
    <div v-if="personOpen" class="flex gap-2">
      <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
      <Button size="sm" @click="savePerson">Запомнить</Button>
    </div>
  </div>
</template>
