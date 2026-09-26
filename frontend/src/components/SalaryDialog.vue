<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney } from '@/lib/money'
import { monthKey, monthTitle, monthFrom, addMonths } from '@/lib/dates'
import { salaryAt } from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  id: PersonId | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const financeStore = useFinanceStore()
const key = computed(() => monthKey())

const person = computed(() => financeStore.people.find((p) => p.id === props.id))

const planning = ref(false)
const newAmount = ref('')
const fromMonth = ref(addMonths(monthKey(), 1))
const reason = ref('')
const personName = ref(person.value?.name ?? '')

watch(
  () => person.value?.name,
  (name) => {
    if (name !== undefined) personName.value = name
  },
  { immediate: true },
)

const saved = useSavedMark(
  () => props.id ?? undefined,
  () => person.value?.updatedAt,
)

// Другой человек — чистая форма.
watch(
  () => props.id,
  () => {
    planning.value = false
    newAmount.value = ''
    reason.value = ''
    fromMonth.value = addMonths(monthKey(), 1)
    personName.value = person.value?.name ?? ''
  },
)

const current = computed(() => (person.value ? salaryAt(person.value, key.value) : 0))
const months = computed(() =>
  Array.from({ length: 13 }, (_, i) => addMonths(key.value, i)).map((m) => ({ value: m, label: monthTitle(m) })),
)
const planned = computed(() => parseMoney(newAmount.value))
const delta = computed(() => (planned.value > 0 ? planned.value - current.value : 0))
const history = computed(() =>
  [...(person.value?.salaryVersions ?? [])].sort((a, b) => b.from.localeCompare(a.from)),
)

function onNameBlur() {
  if (!person.value) return
  const v = personName.value.trim()
  if (v && v !== person.value.name) {
    financeStore.setPerson(person.value.id, { name: v })
  }
}

function onSalaryCommit(text: string) {
  if (!person.value) return
  const v = parseMoney(text)
  if (v > 0 && v !== current.value) {
    financeStore.correctSalary(person.value.id, v)
  }
}

function onPaydayCommit(text: string) {
  if (!person.value) return
  const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
  if (v !== person.value.payday) {
    financeStore.setPerson(person.value.id, { payday: v })
  }
}

// «Новый оклад» — сразу под пальцем (React `Budget.tsx:426-427` `autoFocus`), как PV-11.
const planRef = ref<HTMLElement | null>(null)
function startPlanning() {
  planning.value = true
  void nextTick(() => planRef.value?.querySelector('input')?.focus())
}

function handlePlanSubmit() {
  if (!person.value || planned.value <= 0) return
  financeStore.amendSalary(
    person.value.id,
    fromMonth.value,
    planned.value,
    reason.value.trim() || undefined,
  )
  planning.value = false
  newAmount.value = ''
  reason.value = ''
}

</script>

<template>
  <Sheet :open="!!person" :title="person?.name ?? ''" @close="emit('close')">
    <template #mark><SavedMark :on="saved" /></template>
    <template v-if="person">
      <Field label="Имя">
        <Input v-model="personName" @blur="onNameBlur" />
      </Field>

      <Field label="Оклад сейчас, ₸">
        <NumFieldBlur :initial="plain(current)" @commit="onSalaryCommit" />
      </Field>
      <p class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
        Это исправление: оклад был введён неверно. Если зарплата действительно меняется — не трогайте
        это поле, а запланируйте изменение ниже.
      </p>

      <Field label="День зарплаты">
        <NumFieldBlur :initial="String(person.payday)" kind="int" @commit="onPaydayCommit" />
      </Field>

      <div v-if="!planning" class="mb-3">
        <Button variant="outline" class="w-full bg-surface-2" @click="startPlanning">
          Запланировать изменение
        </Button>
      </div>

      <div v-else ref="planRef" class="mb-3 rounded-xl border border-brand p-3.5">
        <Field label="Новый оклад, ₸">
          <NumField v-model="newAmount" :placeholder="plain(current)" />
        </Field>

        <Field label="С какого месяца">
          <Select v-model="fromMonth" :options="months" />
        </Field>

        <Field label="Причина">
          <Input v-model="reason" placeholder="Повышение, смена работы…" />
        </Field>

        <div
          v-if="planned > 0 && delta !== 0"
          :class="
            cn(
              'mb-3 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed',
              delta > 0 ? 'bg-brand-soft text-ink-2' : 'bg-warn-soft text-ink-2',
            )
          "
        >
          <template v-if="delta > 0">
            С {{ monthFrom(fromMonth) }} доход вырастет на <b>{{ money(delta) }}</b> в месяц —
            {{ money(delta * 12) }} за год.
          </template>
          <template v-else>
            С {{ monthFrom(fromMonth) }} доход снизится на <b>{{ money(-delta) }}</b> в месяц.
            Свободный остаток пересчитается сам.
          </template>
        </div>

        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="planning = false">Отмена</Button>
          <Button class="flex-1" :disabled="planned <= 0" @click="handlePlanSubmit">
            Запланировать
          </Button>
        </div>
      </div>

      <div v-if="history.length > 1" class="mt-4 border-t border-line pt-3">
        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          История оклада
        </div>
        <div class="flex flex-col gap-1.5">
          <div v-for="v in history" :key="v.from" class="flex items-baseline gap-2 text-[13px]">
            <span class="text-ink-3">
              {{ v.from <= key ? 'с' : 'станет с' }} {{ monthFrom(v.from) }}
            </span>
            <b class="ml-auto num font-semibold text-ink">{{ money(v.amount) }}</b>
            <span v-if="v.reason" class="text-[12px] text-ink-3">{{ v.reason }}</span>
          </div>
        </div>
      </div>
    </template>
  </Sheet>
</template>
