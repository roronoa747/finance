<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import { PhArrowLeft, PhPencilSimple, PhPlus, PhMinus } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, parseMoney, ratePct } from '@/lib/money'
import { INFLATION, goalDoneMonth, goalMonths, goalMonthly, indexedNeed, payableAccounts, planForecast } from '@/lib/finance'
import { addMonths, monthIn, monthKey, monthTitle } from '@/lib/dates'
import { contributionStreak } from '@/lib/finance'
import { hueColor } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import type { PersonId } from '@/types/finance'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import SavedMark from '@/components/kit/SavedMark.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import Callout from '@/components/kit/Callout.vue'
import { useSavedMark } from '@/components/kit/useSavedMark'
import Ring from '@/components/Ring.vue'
import GoalSheet from '@/components/goals/GoalSheet.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

type Mode = 'date' | 'amount'
const mode = ref<Mode>('date')

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const goalId = computed(() => route.params.id as string)
const goal = computed(() => financeStore.goals.find((g) => g.id === goalId.value))
const people = computed(() => financeStore.people)
// Пополнение и снятие двигают тенговую базу счёта: валютный счёт пересчитал бы её по
// курсу при следующей правке и молча потерял сдвиг. Удалённые счета — тоже не сюда.
const accounts = computed(() => payableAccounts(financeStore.accounts))

// План «Сначала долги» (PV-15): пауза выводится из плана, взнос цели не трогается (Р-9).
const plan = computed(() => financeStore.activePlan)
const paused = computed(() => financeStore.pausedGoalIds.has(goalId.value))
const planCushion = computed(() => !!plan.value && plan.value.cushionGoalId === goalId.value)

const remaining = computed(() => (goal.value ? Math.max(0, goal.value.need - goal.value.have) : 0))
const months = computed(() => (goal.value ? goalMonths(remaining.value, goal.value.monthly) : 1))
const progress = computed(() => (goal.value && goal.value.need > 0 ? goal.value.have / goal.value.need : 0))
// Заливка «Ритма цели» — оттенок цели для текущей темы.
const rhythmColor = computed(() => (goal.value ? hueColor(goal.value.hue, isDark.value) : ''))
// Во сколько обойдётся та же цель к сроку, если она дорожает вместе с рынком; взнос 0 — прогноза нет.
const indexed = computed(() => (goal.value ? indexedNeed(goal.value.need, months.value) : null))

// Цель на паузе стоит, пока план не закроет долги с процентами (Н-8 ревью Блока 3): дата —
// от месяца без процентных долгов по прогнозу плана; не закрываются — месяца нет.
const forecast = computed(() => (paused.value && plan.value ? planForecast(plan.value, financeStore.planState(), monthKey()) : null))
const doneMonth = computed(() => goalDoneMonth(months.value, monthKey(), forecast.value ?? undefined))
const doneTitle = computed(() => (doneMonth.value ? monthTitle(doneMonth.value) : paused.value ? 'После плана' : '—'))
const doneLine = computed(() =>
  doneMonth.value ? `Цель закроется в ${monthIn(doneMonth.value)}` : paused.value ? 'Цель закроется после плана' : '',
)

/* ------------------ Взнос полем (исключение из Р-2, владелец 2026-09-25) ------------------ */
// «Сохранено» — по самому взносу, а не по updatedAt цели: пополнение тоже меняет цель, но
// взнос оно не трогает.
const monthlySaved = useSavedMark(
  () => goal.value?.id,
  () => (goal.value ? String(goal.value.monthly) : undefined),
)
function onMonthly(text: string) {
  const v = parseMoney(text)
  if (goal.value && v > 0 && v !== goal.value.monthly) financeStore.setGoalMonthly(goal.value.id, v)
}

const streak = computed(() => (goal.value ? contributionStreak(goal.value.movements || []) : 0))
const filled = computed(() =>
  new Set((goal.value?.movements || []).filter((m) => m.amount > 0).map((m) => m.date.slice(0, 7))),
)
const last12 = computed(() =>
  Array.from({ length: 12 }, (_, i) => {
    const k = addMonths(monthKey(), i - 11)
    return { key: k, label: monthTitle(k), filled: filled.value.has(k) }
  }),
)

/* ------------------ Пополнение / Снятие ------------------ */
const openDepositModal = ref(false)
const depositOperation = ref<'deposit' | 'withdraw'>('deposit')
const depositAmount = ref('')
const depositBy = ref<PersonId>('a')
const depositAccountId = ref<string>('')
const depositNote = ref('')

function applyDeposit() {
  const v = parseMoney(depositAmount.value)
  if (!v || !goal.value) return

  if (depositOperation.value === 'deposit') {
    financeStore.contribute(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    // Сдвиг остатка, а не сверка: отметки оплат до взноса продолжают считаться.
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, -v)
  } else {
    financeStore.withdraw(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    if (depositAccountId.value) financeStore.shiftAccountAmount(depositAccountId.value, v)
  }

  depositAmount.value = ''
  depositNote.value = ''
  depositAccountId.value = ''
  openDepositModal.value = false
}

/* ------------------ Редактирование цели ------------------ */
// Поля окна пишутся сами по уходу из поля (`GoalSheet`); viewer окна не открывает (Р-12).
const openEditModal = ref(false)
</script>

<template>
  <div v-if="!goal" class="pt-6 text-center text-[14px] text-ink-3">
    Цель не найдена.
    <button class="text-brand font-medium cursor-pointer" @click="router.push('/goals')">
      К списку
    </button>
  </div>

  <div v-else class="flex flex-col gap-3.5 pt-1">
    <button
      type="button"
      class="flex items-center gap-1.5 self-start text-[13px] text-ink-2 hover:text-ink cursor-pointer"
      @click="router.push('/goals')"
    >
      <PhArrowLeft :size="15" /> Все цели
    </button>

    <Card>
      <div class="mb-4 flex items-center gap-3.5">
        <Ring :progress="progress" :plan="goal.planPct" :hue="goal.hue" :size="58" />
        <div class="min-w-0 flex-1">
          <div class="truncate font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
            {{ goal.name }}
          </div>
          <div class="text-[13px] text-ink-3 num">
            {{ plain(goal.have) }} из {{ plain(goal.need) }} ₸
          </div>
        </div>
        <button
          v-if="!authStore.isViewer"
          type="button"
          aria-label="Изменить цель"
          class="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer"
          @click="openEditModal = true"
        >
          <PhPencilSimple :size="17" />
        </button>
      </div>

      <Segmented
        v-model="mode"
        :options="[
          { value: 'date', label: 'Считаем от даты' },
          { value: 'amount', label: 'Считаем от суммы' },
        ]"
      />

      <div class="pb-1.5 pt-5 text-center">
        <div class="text-[12.5px] tracking-[0.03em] text-ink-3">
          {{ mode === 'date' ? 'Откладывать в месяц' : 'Цель будет достигнута' }}
        </div>
        <div class="mt-1 font-display text-[32px] font-semibold leading-tight tracking-[-0.025em] num text-ink">
          {{ mode === 'date' ? money(goal.monthly) : doneTitle }}
        </div>
        <div class="mt-1.5 text-[13px] text-ink-2">
          {{ mode === 'date' ? doneLine : `При взносе ${money(goal.monthly)} в месяц · ${months} мес.` }}
        </div>
        <div v-if="paused && doneMonth" class="text-[12px] text-ink-3">после плана</div>
      </div>

      <!-- Взнос вводится числом, а не ползунком (исключение из Р-2, владелец 2026-09-25). Viewer — только сумма. -->
      <div v-if="!authStore.isViewer" class="mt-4">
        <div class="-mb-3.5 flex justify-end">
          <SavedMark :on="monthlySaved" />
        </div>
        <Field label="Откладывать в месяц, ₸">
          <NumFieldBlur :initial="plain(goal.monthly)" @commit="onMonthly" />
        </Field>
      </div>

      <div class="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-2">
        Чтобы успеть за год, нужно {{ money(goalMonthly(remaining, 12)) }} в месяц.
      </div>
    </Card>

    <Callout v-if="paused" title="На паузе ради плана">
      Взнос {{ money(goal.monthly) }} идёт в досрочку самого дорогого долга — так семья отдаст банку
      меньше. Цель возобновится сама, когда долги с процентами закроются, или когда вы отмените план.
      <RouterLink to="/plan" class="font-medium text-brand">Открыть план</RouterLink>
    </Callout>
    <Callout v-else-if="planCushion" tone="good" title="Подушка плана: взносы продолжаются">
      Пока в ней меньше месяца обязательных списаний, шаг плана — пополнить её.
      <RouterLink to="/plan" class="font-medium text-brand">Открыть план</RouterLink>
    </Callout>

    <div class="flex gap-2">
      <Button
        class="flex-1"
        @click="
          depositOperation = 'deposit';
          openDepositModal = true;
        "
      >
        <PhPlus :size="16" weight="bold" /> Пополнить
      </Button>
      <Button
        variant="outline"
        class="flex-1 bg-surface-2"
        @click="
          depositOperation = 'withdraw';
          openDepositModal = true;
        "
      >
        <PhMinus :size="16" weight="bold" /> Снять
      </Button>
    </div>

    <Callout v-if="indexed !== null" title="Цель дорожает вместе с рынком">
      При инфляции {{ ratePct(INFLATION, 1) }} в год к моменту достижения
      такая же покупка будет стоить около {{ money(indexed) }}. Расчёт выше — в сегодняшних деньгах.
    </Callout>

    <!-- Ритм цели -->
    <Section title="Ритм цели" />
    <Card>
      <div class="mb-3 flex items-center gap-2.5">
        <b class="text-[14.5px] font-semibold text-ink">Пополняем без пропусков</b>
        <Hint>
          {{
            streak > 0
              ? 'Считается по взносам именно в эту цель, а не по общему плану.'
              : 'Закрасится, как только появится первый взнос в эту цель.'
          }}
        </Hint>
        <Tag v-if="streak > 0" tone="gold">{{ streak }} мес.</Tag>
      </div>
      <div class="flex gap-1.5">
        <i
          v-for="m in last12"
          :key="m.key"
          :title="m.label"
          class="h-[20px] flex-1 rounded transition-colors"
          :style="{ background: m.filled ? rhythmColor : 'var(--track)' }"
        />
      </div>
    </Card>

    <!-- История взносов -->
    <Section title="История цели" />
    <Card flush>
      <div
        v-for="m in (goal.movements || []).slice().reverse()"
        :key="m.id"
        class="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
      >
        <i class="size-2 shrink-0 rounded-full" :style="{ background: `var(--p${m.by})` }" />
        <div class="min-w-0 flex-1 text-left">
          <b class="block text-[14.5px] font-medium text-ink">
            {{ m.amount > 0 ? 'Пополнение' : 'Снятие' }}
          </b>
          <span class="block text-[12.5px] text-ink-3">
            {{ new Date(m.date).toLocaleDateString('ru-RU') }} ·
            {{ people.find((p) => p.id === m.by)?.name || 'Участник' }}
            <span v-if="m.note">· {{ m.note }}</span>
          </span>
        </div>
        <span
          :class="[
            'shrink-0 text-[14.5px] font-semibold num',
            m.amount > 0 ? 'text-brand' : 'text-ink-2',
          ]"
        >
          {{ m.amount > 0 ? '+' : '−' }}{{ plain(Math.abs(m.amount)) }} ₸
        </span>
      </div>
      <div v-if="!(goal.movements && goal.movements.length)" class="px-4 py-6 text-center text-[13px] text-ink-3">
        Взносов пока нет — история появится после первого пополнения
      </div>
    </Card>

    <!-- Окно: Пополнить / Снять -->
    <Sheet
      :open="openDepositModal"
      :title="depositOperation === 'deposit' ? 'Пополнить цель' : 'Снять средства'"
      @close="openDepositModal = false"
    >
      <Field label="Сумма, ₸">
        <NumField v-model="depositAmount" placeholder="10 000" class="mb-3" />
      </Field>

      <Field v-if="accounts.length > 0" :label="depositOperation === 'deposit' ? 'Списать со счёта (опционально)' : 'Зачислить на счёт (опционально)'">
        <Select
          v-model="depositAccountId"
          :options="[
            { value: '', label: 'Не списывать со счетов' },
            ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${money(a.amount)})` })),
          ]"
          class="mb-3"
        />
      </Field>

      <Field v-if="people.length > 1" label="Кто вносит" group>
        <Segmented v-model="depositBy" :options="people.map((p) => ({ value: p.id, label: p.name }))" />
      </Field>

      <Field label="Примечание">
        <Input v-model="depositNote" placeholder="Премия, накопления…" class="mb-3" />
      </Field>

      <Button :disabled="parseMoney(depositAmount) <= 0" class="w-full mt-2" @click="applyDeposit">
        {{ depositOperation === 'deposit' ? 'Пополнить' : 'Снять' }}
      </Button>
    </Sheet>

    <!-- Окно: Изменить цель -->
    <GoalSheet
      :goal-id="openEditModal && !authStore.isViewer ? goal.id : null"
      @close="openEditModal = false"
      @removed="router.push('/goals')"
    />
  </div>
</template>
