<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { money, moneyIn } from '@/lib/money'
import { atLabel, dayLabel } from '@/lib/dates'
import type { SalaryLine } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import Hint from '@/components/kit/Hint.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Button from '@/components/ui/Button.vue'
import MarkSheet from '@/components/MarkSheet.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import SalaryRow from '@/components/SalaryRow.vue'

/**
 * Лист зарплаты (Р-97, Р-108) — один для «Месяца» и карточки «Зарплаты» «Капитала»: пришла или ждём, сумма, у своей
 * и ждём — «Пришла» (и «Другая сумма или счёт»); тихо — отметка пришедшей и «Изменить оклад». Строка — `monthSalaries`;
 * «Пришла» отмечена — лист закрывается сам (✓ уже у суммы в строке). Viewer открывает лист только для чтения: дата,
 * «хватает» и обмены живут лишь здесь (Р-116), кнопок у него нет.
 */
const props = defineProps<{ monthKey: string; line: SalaryLine | null }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const canEdit = computed(() => !auth.isViewer)
// Свою зарплату отмечает только сам участник (Р-13), когда её день настал или близко.
const mine = computed(() => canEdit.value && !!props.line && auth.slot === props.line.person)

/** Лист отметки пришедшей своей зарплаты (когда, счёт, другая сумма, снять) и лист оклада (сумма, день, валюта). */
const paid = ref<{ person: PersonId; name: string } | null>(null)
const edit = ref<PersonId | null>(null)
function next(to: 'paid' | 'edit') {
  const l = props.line
  emit('close')
  if (!l) return
  if (to === 'paid') paid.value = { person: l.person, name: l.name }
  else edit.value = l.person
}
watch(
  () => props.line?.came,
  (came, was) => {
    if (came && was === false) emit('close')
  },
)
</script>

<template>
  <Sheet :open="!!line" :title="line ? `Зарплата · ${line.name}` : ''" @close="emit('close')">
    <template v-if="line">
      <p class="font-num text-[28px] font-bold leading-tight num text-ink">{{ money(line.amount) }}</p>
      <p v-if="line.fx" class="type-meta num">{{ moneyIn(line.fx.amount, line.fx.currency) }}</p>
      <!-- Переехало со строк «Месяца» и «Капитала» (Р-116): дата, «хватает ли», обмены валютной. -->
      <div class="mb-1 mt-3 flex flex-col rounded-[16px] bg-surface-2 px-3.5">
        <div class="flex items-center justify-between gap-3 py-2.5 text-[14.5px]" data-salary-status>
          <span class="text-ink-2">Когда</span>
          <span class="font-semibold text-ink">{{ line.came && line.at ? `пришла ${atLabel(line.at)}` : `ждём ${dayLabel(line.payday, monthKey)}` }}</span>
        </div>
        <div class="flex items-center justify-between gap-3 border-t border-line py-2.5 text-[14.5px]">
          <span class="flex items-center gap-1 text-ink-2">Хватает<Hint label="Хватает ли">Зарплата минус свои платежи, траты, цели и фонды</Hint></span>
          <b class="font-num num" :class="line.left >= 0 ? 'text-ok' : 'text-warn'" data-left>{{ line.left > 0 ? `+${money(line.left)}` : money(line.left) }}</b>
        </div>
        <div v-if="line.came && line.foreign" class="border-t border-line py-2.5" data-salary-exchanges>
          <SalaryExchange :person-id="line.person" :period="monthKey" part="line" />
        </div>
      </div>
      <SalaryRow v-if="mine && line.open" button :person-id="line.person" :period="monthKey" />
      <div class="mt-2 flex flex-col gap-1.5">
        <Button v-if="mine && line.came" variant="ghost" class="w-full" data-salary-paid @click="next('paid')">Другая сумма или снять</Button>
        <Button v-if="canEdit" variant="ghost" class="w-full" data-salary-edit @click="next('edit')">Изменить оклад</Button>
      </div>
    </template>
  </Sheet>
  <MarkSheet
    v-if="paid"
    open="paid"
    kind="salary"
    :target-id="paid.person"
    :period="monthKey"
    :title="`Зарплата · ${paid.name}`"
    @close="paid = null"
  />
  <SalaryDialog v-if="canEdit" :id="edit" @close="edit = null" />
</template>
