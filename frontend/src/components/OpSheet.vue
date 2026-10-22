<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney, plain } from '@/lib/money'
import { dayLabel } from '@/lib/dates'
import { ruleMatchOf, shortMerchant } from '@/lib/statements/model'
import type { MerchantRule, Operation } from '@/lib/statements/types'
import Sheet from '@/components/kit/Sheet.vue'
import Chip from '@/components/kit/Chip.vue'
import NumField from '@/components/kit/NumField.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import AddPaymentSheet from '@/components/AddPaymentSheet.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'

/**
 * Лист своей операции (FB-04, Р-10, Р-12): заголовок — продавец коротко или получатель; строкой — день и сумма (с
 * возвратом — «· вернули N»); заметка «Что это было» (личный документ, `editOp`: по уходу из поля и по закрытию);
 * чипы «куда отнести?» с «+ Раздел» (ответ — правило по продавцу задним числом, `recategorize`; текущий раздел выбран);
 * ниже тихий чип «Мне вернули»: приход ±14 дней (`refundsFor`) или «Наличными» с суммой. Главной кнопки нет — ответ
 * чипом (правило 12). Один лист на ленту «Недели», листы разделов «Недели» и «Месяца» и «Историю»; ручная трата сюда не
 * попадает (её лист — «Трата»). `z` — поверх другого листа. В ряд к «Мне вернули» — тихие «Разовая» (FB-08) и
 * «В платежи».
 */
const props = withDefaults(defineProps<{ opId: string | null; z?: number }>(), { z: 50 })
const emit = defineEmits<{ (e: 'close'): void }>()

const store = useOperationsStore()
const op = computed<Operation | null>(() => (props.opId ? (store.shown.find((o) => o.id === props.opId) ?? store.all.find((o) => o.id === props.opId) ?? null) : null))
const title = computed(() => (op.value ? (op.value.counterparty ?? shortMerchant(op.value.merchant)) : ''))
const spend = computed(() => (op.value && op.value.amount < 0 ? -op.value.amount : 0))

/* ---------- заметка ---------- */
const memo = ref('')
const refundMode = ref<'pick' | 'cash' | null>(null)
const cash = ref('')
watch(
  () => props.opId,
  () => {
    memo.value = op.value?.memo ?? ''
    refundMode.value = null
    cash.value = ''
  },
  { immediate: true },
)
function saveMemo() {
  const o = op.value
  if (o && memo.value.trim() !== (o.memo ?? '')) store.editOp(o.id, { memo: memo.value })
}
function close() {
  saveMemo()
  emit('close')
}

/* ---------- куда отнести ---------- */
function choose(to: MerchantRule['to']) {
  const o = op.value
  saveMemo()
  if (o) void store.recategorize(ruleMatchOf(o), to)
  emit('close')
}

/* ---------- «Разовая» (FB-08, Р-16): факт месяца — да, раздел, «обычно» и находки — нет ---------- */
function toggleOneOff() {
  const o = op.value
  if (o) store.editOp(o.id, { oneOff: o.oneOff ? null : true })
}

/* ---------- «В платежи» (FB-09, Р-17): у повтора продавца без правила платежа и отметки ---------- */
const recurring = computed(() => (op.value ? store.recurringFor(op.value) : null))
const payFor = ref<string | null>(null)
watch(
  () => props.opId,
  () => (payFor.value = null),
)

/* ---------- «Мне вернули» (Р-12) ---------- */
const incomes = computed(() => (op.value && refundMode.value === 'pick' ? store.refundsFor(op.value).slice(0, 5) : []))
const incomeLabel = (i: Operation) =>
  `${i.counterparty ? `От ${i.counterparty}` : shortMerchant(i.merchant)} · ${dayLabel(Number(i.date.slice(8, 10)), i.date.slice(0, 7))} · ${plain(i.amount)}`
function toggleRefund() {
  const o = op.value
  if (!o) return
  if (o.refund) {
    store.editOp(o.id, { refund: null })
    refundMode.value = null
  } else refundMode.value = refundMode.value ? null : 'pick'
}
function pickIncome(i: Operation) {
  const o = op.value
  if (!o) return
  store.editOp(o.id, { refund: { amount: Math.min(i.amount, spend.value), opId: i.id } })
  refundMode.value = null
}
function startCash() {
  refundMode.value = 'cash'
  cash.value = plain(spend.value)
}
function saveCash() {
  const o = op.value
  if (!o) return
  const amount = Math.min(parseMoney(cash.value), spend.value)
  store.editOp(o.id, { refund: amount > 0 ? { amount } : null })
  refundMode.value = null
}
</script>

<template>
  <Sheet :open="!!op" :z="z" :title="title" @close="close">
    <template v-if="op">
      <p class="mb-3 type-meta num" data-op-meta>
        {{ dayLabel(Number(op.date.slice(8, 10)), op.date.slice(0, 7)) }} · {{ money(Math.abs(op.amount)) }}<template v-if="op.refund"> · вернули {{ plain(op.refund.amount) }}</template>
      </p>
      <Input v-model="memo" placeholder="Что это было" maxlength="60" autocapitalize="sentences" class="mb-3 w-full" data-op-memo @blur="saveMemo" />
      <!-- Подпись «Раздел» — как в форме «Трата»: без неё чипы читались как теги; что ответ уводит все траты продавца — в «?». -->
      <Field label="Раздел" group class="!mb-0">
        <template #hint>
          <Hint label="Про раздел" data-op-category-hint>Нажмите на раздел, чтобы перенести туда все прошлые и будущие траты у этого продавца</Hint>
        </template>
        <CategoryChips :counterparty="!!op.counterparty" :current="op.internal ? null : op.categoryId" @choose="choose" />
      </Field>
      <div v-if="spend" class="mt-3 flex flex-wrap gap-2 border-t border-line pt-3" data-op-extra>
        <Chip quiet :on="!!op.refund" data-op-refund @click="toggleRefund">Мне вернули</Chip>
        <Chip quiet :on="!!op.oneOff" data-op-oneoff @click="toggleOneOff">Разовая</Chip>
        <Chip v-if="recurring" quiet data-op-pay @click="payFor = op.id">В платежи</Chip>
      </div>
      <p v-if="op.oneOff && spend" class="mt-1.5 type-meta" data-op-oneoff-note>не входит в обычные траты</p>
      <div v-if="refundMode === 'pick'" class="mt-2 flex flex-col gap-2" data-op-refund-pick>
        <Chip v-for="i in incomes" :key="i.id" class="justify-start" :data-op-income="i.id" @click="pickIncome(i)">{{ incomeLabel(i) }}</Chip>
        <div>
          <Chip quiet data-op-cash @click="startCash">Наличными</Chip>
        </div>
      </div>
      <div v-else-if="refundMode === 'cash'" class="mt-2 flex items-center gap-2" data-op-cash-row>
        <NumField v-model="cash" class="min-w-0 flex-1" aria-label="Сколько вернули" />
        <Button size="sm" data-op-cash-done @click="saveCash">Готово</Button>
      </div>
    </template>
  </Sheet>
  <AddPaymentSheet :op-id="payFor" :z="z + 20" @close="payFor = null" @added="close" />
</template>
