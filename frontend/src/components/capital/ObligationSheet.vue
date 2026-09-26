<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { PhCalendarPlus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney } from '@/lib/money'
import { MONTHS_NOM, addMonths, dayLabel, monthFrom, monthKey, monthTitle, parseMonthKey } from '@/lib/dates'
import {
  amountAt,
  isSubscription,
  liveGroups,
  liveObligations,
  nextObligationDue,
  plannedChange,
  yearShare,
  type Due,
} from '@/lib/finance'
import type { Obligation, PersonId } from '@/types/finance'
import { categoryName, type CategoryKey } from '@/lib/palette'
import { cn } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import PaidRow from '@/components/PaidRow.vue'

/**
 * Окно обязательства Капитала (React `ObligationDialog`): «Оплатил», правка полей,
 * запланированное изменение суммы, «История суммы», удаление.
 */
const props = defineProps<{ obligationId: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())
const people = computed(() => financeStore.people)
const groups = computed(() => liveGroups(financeStore.obligations))
const activeObligation = computed(() =>
  liveObligations(financeStore.obligations).find((o) => o.id === props.obligationId),
)

// Разделы, куда кладётся платёж (как в форме нового платежа): цели и свободный остаток —
// не корзины.
const obBuckets = computed(() =>
  (['d1', 'd2', 'd4'] as CategoryKey[]).map((key) => ({ key, name: categoryName(financeStore.categories, key) })),
)

// Платёж для «Оплатил» берётся при открытии (как у кредита): отметка не перескакивает
// на следующий месяц. Правка дня или периодичности меняет график — снимок заново.
const obligationDue = ref<Due | null>(null)
watch(
  [
    () => activeObligation.value?.id,
    () => activeObligation.value?.day,
    () => activeObligation.value?.every,
    () => activeObligation.value?.month,
  ],
  () => {
    obligationDue.value = activeObligation.value
      ? nextObligationDue(activeObligation.value, financeStore.payments)
      : null
  },
  { immediate: true },
)
const obPlanning = ref(false)
const obNewAmount = ref('')
const obFromMonth = ref(addMonths(key.value, 1))
const obReason = ref('')

const obPlanRef = ref<HTMLElement | null>(null)
const obligationSaved = useSavedMark(
  () => activeObligation.value?.id,
  () => activeObligation.value?.updatedAt,
)

// Другое обязательство — чистая форма (React: сброс по id, а не по любой правке).
watch(
  () => activeObligation.value?.id,
  () => {
    const ob = activeObligation.value
    if (!ob) return
    obPlanning.value = false
    obNewAmount.value = ''
    obReason.value = ''
    obFromMonth.value = addMonths(key.value, 1)
  },
  { immediate: true },
)

const obCurrent = computed(() => (activeObligation.value ? amountAt(activeObligation.value, key.value) : 0))
const plannedObligationMonths = computed(() =>
  Array.from({ length: 13 }, (_, i) => addMonths(key.value, i)),
)
const obChange = computed(() =>
  plannedChange(obCurrent.value, parseMoney(obNewAmount.value), activeObligation.value?.every),
)
/** История суммы — новые сверху (React `ObligationDialog`). */
const obHistory = computed(() =>
  [...(activeObligation.value?.versions ?? [])].sort((a, b) => b.from.localeCompare(a.from)),
)

function editObligation(patch: Partial<Obligation>) {
  if (activeObligation.value) financeStore.updateObligation(activeObligation.value.id, patch)
}
function onObligationNameBlur(e: Event) {
  const v = (e.target as HTMLInputElement).value.trim()
  if (v && v !== activeObligation.value?.name) editObligation({ name: v })
}
// Поле следует за суммой документа (`NumFieldBlur`): после «Запланировать» с этого
// месяца или правки партнёра уход из поля не откатывает сумму к старому тексту.
function onObligationAmount(text: string) {
  const v = parseMoney(text)
  if (activeObligation.value && v > 0 && v !== obCurrent.value) {
    financeStore.correctObligation(activeObligation.value.id, v)
  }
}
function onObligationDay(text: string) {
  const v = Math.min(28, Math.max(1, parseMoney(text) || 1))
  if (v !== activeObligation.value?.day) editObligation({ day: v })
}
function setObligationEvery(v: 'month' | 'year') {
  const ob = activeObligation.value
  if (!ob || (ob.every ?? 'month') === v) return
  editObligation(v === 'year' ? { every: v, month: ob.month ?? parseMonthKey(key.value).month + 1 } : { every: v })
}
function setObligationWho(v: 'all' | PersonId) {
  if ((activeObligation.value?.who ?? 'all') !== v) editObligation({ who: v === 'all' ? null : v })
}
function startPlanning() {
  obPlanning.value = true
  void nextTick(() => obPlanRef.value?.querySelector('input')?.focus())
}
function planObligation() {
  const ob = activeObligation.value
  const planned = parseMoney(obNewAmount.value)
  if (!ob || planned <= 0) return
  financeStore.amendObligation(ob.id, obFromMonth.value, planned, obReason.value.trim() || undefined)
  obPlanning.value = false
  obNewAmount.value = ''
}
</script>

<template>
  <Sheet :open="!!activeObligation" :title="activeObligation?.name ?? ''" @close="emit('close')">
    <template #mark>
      <SavedMark :on="obligationSaved" />
    </template>
    <template v-if="activeObligation" #default="{ close }">
      <div v-if="obligationDue" class="mb-3 rounded-xl border border-line px-3">
        <PaidRow
          dense
          more
          kind="obligation"
          :target-id="activeObligation.id"
          :period="obligationDue.period"
          :title="`Платёж ${dayLabel(obligationDue.day, obligationDue.period)}`"
          :note="activeObligation.every === 'year' ? 'раз в год' : 'по графику'"
        />
      </div>

      <Field v-if="isSubscription(activeObligation) && groups.length && !authStore.isViewer" label="Группа">
        <Select
          :model-value="activeObligation.parentId ?? ''"
          :options="[{ value: '', label: 'Без группы' }, ...groups.map((g) => ({ value: g.id, label: g.name }))]"
          @update:model-value="(v) => financeStore.moveToGroup(activeObligation!.id, v || null)"
        />
      </Field>

      <!-- Viewer видит цифры и историю, но не правит (Р-12, матрица §3) -->
      <div
        v-if="authStore.isViewer"
        class="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-[13px] flex flex-col gap-1.5"
      >
        <div class="flex justify-between">
          <span class="text-ink-2">Сумма сейчас</span>
          <b class="num text-ink">{{ money(obCurrent) }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">День платежа</span>
          <b class="num text-ink">{{ activeObligation.day }}</b>
        </div>
        <div class="flex justify-between">
          <span class="text-ink-2">Как часто</span>
          <b class="text-ink">{{ activeObligation.every === 'year' ? 'раз в год' : 'каждый месяц' }}</b>
        </div>
      </div>
      <template v-else>
        <Field label="Название">
          <Input :default-value="activeObligation.name" class="mb-3" @blur="onObligationNameBlur" />
        </Field>

        <Field label="Сумма сейчас, ₸">
          <NumFieldBlur :initial="plain(obCurrent)" class="mb-1" @commit="onObligationAmount" />
        </Field>
        <p class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
          Это исправление: сумма была введена неверно. Если платёж меняется с какого-то месяца —
          не трогайте это поле, а запланируйте изменение ниже.
        </p>

        <Field label="День платежа">
          <NumFieldBlur :initial="String(activeObligation.day)" kind="int" class="mb-3" @commit="onObligationDay" />
        </Field>

        <Field label="Как часто" group>
          <Segmented
            :model-value="activeObligation.every === 'year' ? 'year' : 'month'"
            :options="[
              { value: 'month', label: 'Каждый месяц' },
              { value: 'year', label: 'Раз в год' },
            ]"
            @update:model-value="setObligationEvery"
          />
        </Field>

        <template v-if="activeObligation.every === 'year'">
          <Field label="Месяц списания" group>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="(m, i) in MONTHS_NOM"
                :key="m"
                type="button"
                :aria-pressed="(activeObligation.month ?? 1) === i + 1"
                :class="cn('rounded-lg border px-1 py-1.5 text-[12px] cursor-pointer', (activeObligation.month ?? 1) === i + 1 ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
                @click="editObligation({ month: i + 1 })"
              >
                {{ m.slice(0, 3) }}
              </button>
            </div>
          </Field>
          <p class="-mt-1 mb-3 text-[12px] leading-relaxed text-ink-3">
            В плане месяца этот платёж занимает {{ money(yearShare(obCurrent)) }} — годовая сумма
            делится на двенадцать.
          </p>
        </template>

        <Field v-if="people.length > 1" label="Чьё это" group>
          <Segmented
            :model-value="activeObligation.who ?? 'all'"
            :options="[{ value: 'all', label: 'Общее' }, ...people.map((p) => ({ value: p.id, label: p.name }))]"
            @update:model-value="setObligationWho"
          />
        </Field>

        <!-- Раздела в модалке React нет — исключение из Р-2: иначе испорченный раздел не поправить (Р-14). -->
        <Field label="В какой раздел бюджета" group>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="c in obBuckets"
              :key="c.key"
              type="button"
              :aria-pressed="activeObligation.category === c.key"
              :class="cn('rounded-lg border px-2.5 py-1.5 text-[12.5px] cursor-pointer', activeObligation.category === c.key ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line text-ink-2')"
              @click="editObligation({ category: c.key })"
            >
              {{ c.name }}
            </button>
          </div>
        </Field>

        <label class="mb-3 flex items-center gap-2.5 text-[13.5px] text-ink">
          <input
            type="checkbox"
            :checked="!!activeObligation.estimate"
            class="size-4 accent-[var(--brand)]"
            @change="editObligation({ estimate: ($event.target as HTMLInputElement).checked })"
          />
          Сумма плавает — показывать как оценку
        </label>

        <div v-if="!obPlanning" class="mb-3">
          <Button variant="outline" class="w-full bg-surface-2" @click="startPlanning">
            <PhCalendarPlus :size="16" /> Запланировать изменение
          </Button>
        </div>
        <div v-else ref="obPlanRef" class="mb-3 rounded-xl border border-brand p-3.5">
          <Field label="Новая сумма, ₸">
            <NumField v-model="obNewAmount" :placeholder="plain(obCurrent)" />
          </Field>
          <Field label="С какого месяца">
            <Select
              v-model="obFromMonth"
              :options="plannedObligationMonths.map((m) => ({ value: m, label: monthTitle(m) }))"
            />
          </Field>
          <Field label="Причина">
            <Input v-model="obReason" placeholder="Переезд, индексация…" />
          </Field>

          <div
            v-if="obChange.monthly !== 0"
            :class="cn('mb-3 rounded-xl px-3.5 py-3 text-[13px] leading-relaxed text-ink-2', obChange.monthly < 0 ? 'bg-brand-soft' : 'bg-warn-soft')"
          >
            <template v-if="obChange.monthly < 0">
              С {{ monthFrom(obFromMonth) }} освободится <b>{{ money(-obChange.monthly) }}</b> в месяц —
              {{ money(-obChange.yearly) }} за год. Приложение предложит решить, куда их направить.
            </template>
            <template v-else>
              С {{ monthFrom(obFromMonth) }} платёж вырастет на <b>{{ money(obChange.monthly) }}</b> в месяц.
            </template>
          </div>

          <p class="mb-3 text-[12px] leading-relaxed text-ink-3">
            Месяц, который выберете, оплачивается уже по новой сумме. Если переезд в середине
            месяца, ставьте следующий: за текущий вы платите по-старому.
          </p>

          <div class="flex gap-2">
            <Button variant="outline" class="flex-1" @click="obPlanning = false">Отмена</Button>
            <Button class="flex-1" :disabled="parseMoney(obNewAmount) <= 0" @click="planObligation">
              Запланировать
            </Button>
          </div>
        </div>
      </template>

      <template v-if="obHistory.length > 1">
        <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">История суммы</div>
        <div class="mb-3 flex flex-col gap-1.5">
          <div v-for="v in obHistory" :key="v.from" class="flex items-baseline gap-2 text-[13px]">
            <span class="text-ink-3">{{ v.from <= key ? 'с' : 'станет с' }} {{ monthFrom(v.from) }}</span>
            <b class="ml-auto num text-ink">{{ money(v.amount) }}</b>
            <span v-if="v.reason" class="text-[12px] text-ink-3">{{ v.reason }}</span>
          </div>
        </div>
      </template>

      <Button class="w-full mb-3" @click="close">Готово</Button>

      <DangerZone
        v-if="!authStore.isViewer"
        label="Удалить обязательство"
        warning="Обязательство исчезнет у обоих участников вместе с историей суммы. Отменить нельзя."
        @confirm="() => { financeStore.removeObligation(activeObligation!.id); emit('close') }"
      />
    </template>
  </Sheet>
</template>
