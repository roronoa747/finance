<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
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
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { PhX } from '@phosphor-icons/vue'

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

const saved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | null = null
const lastSeenStamp = ref<string | undefined>(undefined)
const lastSeenId = ref<PersonId | null>(null)

watch(
  () => [props.id, person.value?.updatedAt] as const,
  ([newId, newStamp]) => {
    if (newId !== lastSeenId.value) {
      lastSeenId.value = newId
      lastSeenStamp.value = newStamp
      saved.value = false
      planning.value = false
      newAmount.value = ''
      reason.value = ''
      fromMonth.value = addMonths(monthKey(), 1)
      return
    }

    if (newStamp && newStamp !== lastSeenStamp.value) {
      lastSeenStamp.value = newStamp
      saved.value = true
      if (savedTimer) clearTimeout(savedTimer)
      savedTimer = setTimeout(() => {
        saved.value = false
      }, 1800)
    }
  },
)

const current = computed(() => (person.value ? salaryAt(person.value, key.value) : 0))
const months = computed(() => Array.from({ length: 13 }, (_, i) => addMonths(key.value, i)))
const planned = computed(() => parseMoney(newAmount.value))
const delta = computed(() => (planned.value > 0 ? planned.value - current.value : 0))
const history = computed(() =>
  [...(person.value?.salaryVersions ?? [])].sort((a, b) => b.from.localeCompare(a.from)),
)

function onNameBlur(e: FocusEvent) {
  if (!person.value) return
  const input = e.target as HTMLInputElement
  const v = input.value.trim()
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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeydown)
  }
})

onUnmounted(() => {
  if (savedTimer) clearTimeout(savedTimer)
  if (typeof document !== 'undefined') {
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <div
    v-if="person"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
    @click.self="emit('close')"
  >
    <div
      class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left"
    >
      <div class="mb-4 flex items-center justify-between">
        <h3 class="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
          {{ person.name }}
          <SavedMark :on="saved" />
        </h3>
        <button
          type="button"
          aria-label="Закрыть"
          class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
          @click="emit('close')"
        >
          <PhX :size="16" />
        </button>
      </div>

      <Field label="Имя">
        <Input :default-value="person.name" @blur="onNameBlur" />
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
        <Button variant="outline" class="w-full bg-surface-2" @click="planning = true">
          Запланировать изменение
        </Button>
      </div>

      <div v-else class="mb-3 rounded-xl border border-brand p-3.5">
        <Field label="Новый оклад, ₸">
          <NumField v-model="newAmount" :placeholder="plain(current)" />
        </Field>

        <Field label="С какого месяца">
          <select
            v-model="fromMonth"
            class="w-full rounded-md border border-input bg-surface-2 px-3 py-2 text-sm text-ink outline-none"
          >
            <option v-for="m in months" :key="m" :value="m">{{ monthTitle(m) }}</option>
          </select>
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
    </div>
  </div>
</template>
