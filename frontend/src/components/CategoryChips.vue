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

/**
 * «Куда отнести?» — ответы на продавца одним набором (B2C-15/21; «Неделя» и «История»): чипы
 * разделов (первые `top`, обычно шесть; «Ещё N ▾»), «Кому → что» (у перевода человеку — поле «что это»),
 * «Между своими», у вопроса о продавце — «Не помню» (`forgot`: «Прочее», Р-58). Ответ — правило
 * `MerchantRule['to']`; что с ним делать (в разборе или задним числом), решает родитель.
 */
// `top` — сколько разделов видно до «Ещё N ▾» (док пачки — 3, как в макете: док не закрывает список).
const props = withDefaults(defineProps<{ counterparty?: boolean; forgot?: boolean; top?: number }>(), { top: 6 })
const emit = defineEmits<{ (e: 'choose', to: MerchantRule['to']): void }>()

const finance = useFinanceStore()
const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const more = ref(false)
const shown = computed(() => (more.value ? categories.value : categories.value.slice(0, props.top)))
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
      <Chip v-for="c in shown" :key="c.id" :sw="spendColor(c)" @click="choose({ categoryId: c.id })">{{ c.name }}</Chip>
      <Chip v-if="!more && categories.length > top" quiet @click="more = true">Ещё {{ categories.length - top }} ▾</Chip>
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
