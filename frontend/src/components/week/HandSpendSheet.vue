<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { liveSpendCategories } from '@/lib/finance'
import { parseMoney, plain } from '@/lib/money'
import { spendColor } from '@/lib/palette'
import { todayIso } from '@/lib/dates'
import { handId, handOperation, isHand } from '@/lib/statements/model'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Chip from '@/components/kit/Chip.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import NewCategoryChip from '@/components/NewCategoryChip.vue'
import Toggle from '@/components/kit/Toggle.vue'
import Hint from '@/components/kit/Hint.vue'

/**
 * «Трата» руками (бэклог «Ручная трата», Р-1, Р-2): сумма и раздел — обязательны, заметка «что / где» и дата (сегодня)
 * — нет. Одна главная кнопка «Сохранить» (`--brand`). Трата — обычная личная операция (`store.saveHand`): «Неделя»,
 * разделы, «Месяц», итог раздела партнёру, разбор. `opId` — правка своей ручной траты; «Удалить» — тихо внизу.
 * Строку выписки или с телефона этот лист не открывает. Деньги — целые тенге (`parseMoney`), итоги считает `finance.ts`.
 */
const props = defineProps<{ open: boolean; opId?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', date: string): void }>()

const finance = useFinanceStore()
const store = useOperationsStore()
const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const editing = computed(() => {
  const op = props.opId ? store.ops[props.opId] : undefined
  return op && isHand(op) ? op : null
})

const amount = ref('')
const categoryId = ref<string | null>(null)
const note = ref('')
const date = ref(todayIso())
const oneOff = ref(false)
/**
 * Разделов до «Ещё N ▾» — шесть, как у ответов «Куда отнести?» (`CategoryChips`): все 18 сталкивали «Сохранить» за
 * край экрана. Выбранный раздел из хвоста (правка) виден и свёрнутым.
 */
const TOP = 6
const more = ref(false)
const shown = computed(() => {
  if (more.value) return categories.value
  const top = categories.value.slice(0, TOP)
  const picked = categories.value.find((c) => c.id === categoryId.value)
  return picked && !top.includes(picked) ? [...top, picked] : top
})
const body = ref<HTMLElement | null>(null)
const form = useFormCheck(() => [
  ['amount', parseMoney(amount.value) <= 0 && 'Введите сумму'],
  ['category', !categoryId.value && 'Выберите раздел'],
  ['date', (!date.value || date.value > todayIso()) && 'Дата — сегодня или раньше'],
])

watch(
  () => [props.open, props.opId] as const,
  ([open]) => {
    if (!open) return
    const op = editing.value
    amount.value = op ? plain(-op.amount) : ''
    categoryId.value = op?.categoryId ?? null
    note.value = op?.note ?? ''
    date.value = op?.date ?? todayIso()
    // Отметка живёт в правках (`opEdits`), в копии её нет — берём наложенную (`store.all`).
    oneOff.value = !!(op && store.all.find((o) => o.id === op.id)?.oneOff)
    more.value = false
    form.reset()
    // Новая трата — курсор сразу в сумме (Android откроет клавиатуру сам; iOS — по касанию поля).
    if (!op) void nextTick(() => body.value?.querySelector<HTMLInputElement>('[data-hand-amount] input, input[data-hand-amount]')?.focus())
  },
  { immediate: true },
)

function save() {
  const id = categoryId.value
  if (!id) return
  const name = categories.value.find((c) => c.id === id)?.name ?? ''
  const op = handOperation({ id: editing.value?.id ?? handId(), amount: parseMoney(amount.value), categoryId: id, date: date.value, note: note.value }, name)
  void store.saveHand(op, { oneOff: oneOff.value })
  emit('saved', op.date)
  emit('close')
}

function remove() {
  if (editing.value) void store.removeHand(editing.value.id)
  emit('close')
}
</script>

<template>
  <Sheet :open="open && (!opId || !!editing)" title="Трата" @close="emit('close')">
    <div ref="body" data-hand-sheet>
      <Field label="Сколько, ₸" name="amount">
        <NumField v-model="amount" placeholder="2 500" data-hand-amount />
      </Field>
      <Field label="Раздел" name="category" group>
        <div class="flex flex-wrap gap-2" data-hand-categories>
          <Chip v-for="c in shown" :key="c.id" :on="categoryId === c.id" :sw="spendColor(c)" :data-hand-category="c.id" @click="categoryId = c.id">{{ c.name }}</Chip>
          <Chip v-if="!more && categories.length > shown.length" quiet data-hand-more @click="more = true">Ещё {{ categories.length - shown.length }} ▾</Chip>
          <NewCategoryChip @created="(id) => (categoryId = id)" />
        </div>
      </Field>
      <Field label="Что или где">
        <Input v-model="note" placeholder="Магнум" maxlength="60" autocapitalize="sentences" data-hand-note />
      </Field>
      <Field label="Когда" name="date">
        <Input v-model="date" type="date" :max="todayIso()" data-hand-date />
      </Field>
      <!-- «Разовая» (FB-08, Р-16): автошкола, диван — в факт месяца, не в «обычно» раздела -->
      <div class="mb-3.5 flex items-center justify-between gap-3" data-hand-oneoff>
        <span class="flex items-center gap-1 text-[13.5px] font-medium text-ink">
          Разовая
          <Hint label="Про разовую" data-hand-oneoff-hint>Включите для редкой покупки — автошкола, диван: она войдёт в траты месяца, но не в обычные траты раздела</Hint>
        </span>
        <Toggle v-model="oneOff" label="Разовая" tone="ok" />
      </div>
      <Button size="lg" class="w-full" :class="editing && 'mb-3'" data-hand-save @click="form.submit(save)">Сохранить</Button>
      <DangerZone v-if="editing" label="Удалить трату" warning="Трата уйдёт из недели и итогов." @confirm="remove" />
    </div>
  </Sheet>
</template>
