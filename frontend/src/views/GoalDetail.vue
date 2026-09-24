<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhArrowLeft, PhPencilSimple, PhPlus, PhMinus, PhX } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, parseMoney } from '@/lib/money'
import { goalMonths, goalMonthly } from '@/lib/finance'
import { addMonths, monthAfter, monthInAfter, monthKey, monthTitle } from '@/lib/dates'
import { contributionStreak } from '@/lib/finance'
import { HUES, HUE_KEYS, hueColor, type HueKey } from '@/lib/palette'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Tag from '@/components/kit/Tag.vue'
import Callout from '@/components/kit/Callout.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Ring from '@/components/Ring.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'

type Mode = 'date' | 'amount'
const mode = ref<Mode>('date')

const router = useRouter()
const route = useRoute()
const financeStore = useFinanceStore()

const goalId = computed(() => route.params.id as string)
const goal = computed(() => financeStore.goals.find((g) => g.id === goalId.value))
const people = computed(() => financeStore.people)
const accounts = computed(() => financeStore.accounts)

const remaining = computed(() => (goal.value ? Math.max(0, goal.value.need - goal.value.have) : 0))
const months = computed(() => (goal.value ? goalMonths(remaining.value, goal.value.monthly) : 1))
const progress = computed(() => (goal.value && goal.value.need > 0 ? goal.value.have / goal.value.need : 0))

const minMonthly = computed(() => (goal.value ? Math.max(5_000, Math.round((goal.value.monthly * 0.4) / 5_000) * 5_000) : 5_000))
const maxMonthly = computed(() => (goal.value ? Math.max(minMonthly.value + 5_000, Math.round((goal.value.monthly * 2.6) / 5_000) * 5_000) : 100_000))

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
    if (depositAccountId.value) {
      const acc = accounts.value.find((a) => a.id === depositAccountId.value)
      if (acc) {
        financeStore.setAccountAmount(acc.id, Math.max(0, acc.amount - v))
      }
    }
  } else {
    financeStore.withdraw(goal.value.id, v, depositBy.value, depositNote.value.trim() || undefined)
    if (depositAccountId.value) {
      const acc = accounts.value.find((a) => a.id === depositAccountId.value)
      if (acc) {
        financeStore.setAccountAmount(acc.id, acc.amount + v)
      }
    }
  }

  depositAmount.value = ''
  depositNote.value = ''
  depositAccountId.value = ''
  openDepositModal.value = false
}

/* ------------------ Редактирование цели ------------------ */
const openEditModal = ref(false)
const editName = ref('')
const editNeed = ref('')
const editMonthly = ref('')
const editHue = ref<HueKey>('blue')

function openEdit() {
  if (!goal.value) return
  editName.value = goal.value.name
  editNeed.value = plain(goal.value.need)
  editMonthly.value = plain(goal.value.monthly)
  editHue.value = goal.value.hue
  openEditModal.value = true
}

function saveEdit() {
  if (!goal.value) return
  const n = parseMoney(editNeed.value)
  const m = parseMoney(editMonthly.value)
  if (!editName.value.trim() || n <= 0) return

  financeStore.updateGoal(goal.value.id, {
    name: editName.value.trim(),
    need: n,
    monthly: m > 0 ? m : goal.value.monthly,
    hue: editHue.value,
  })
  openEditModal.value = false
}
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
          type="button"
          aria-label="Изменить цель"
          class="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer"
          @click="openEdit"
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
          {{ mode === 'date' ? money(goal.monthly) : monthAfter(months - 1) }}
        </div>
        <div class="mt-1.5 text-[13px] text-ink-2">
          {{
            mode === 'date'
              ? `Цель закроется в ${monthInAfter(months - 1)}`
              : `При взносе ${money(goal.monthly)} в месяц · ${months} мес.`
          }}
        </div>
      </div>

      <!-- Ползунок / выбор ежемесячного платежа -->
      <div class="mt-4 flex flex-col gap-1.5">
        <div class="flex items-center justify-between text-[12px] text-ink-3">
          <span>{{ money(minMonthly) }}</span>
          <span class="font-medium text-ink num">{{ money(goal.monthly) }}/мес</span>
          <span>{{ money(maxMonthly) }}</span>
        </div>
        <input
          type="range"
          :min="minMonthly"
          :max="maxMonthly"
          :step="5000"
          :value="Math.min(maxMonthly, Math.max(minMonthly, goal.monthly))"
          class="w-full accent-[var(--brand)] cursor-pointer"
          @input="(e) => financeStore.setGoalMonthly(goal!.id, Number((e.target as HTMLInputElement).value))"
        />
      </div>

      <div class="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-2">
        Чтобы успеть за год, нужно {{ money(goalMonthly(remaining, 12)) }} в месяц.
      </div>
    </Card>

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

    <Callout title="Дисциплина накоплений" tone="good">
      Регулярные пополнения помогают закрыть цель быстрее и защитить сбережения.
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
          :style="{ background: m.filled ? hueColor(goal.hue, false) : 'var(--track)' }"
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

    <!-- МОДАЛКА: Пополнить / Снять -->
    <div
      v-if="openDepositModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="openDepositModal = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">
            {{ depositOperation === 'deposit' ? 'Пополнить цель' : 'Снять средства' }}
          </h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="openDepositModal = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Сумма, ₸">
          <NumField v-model="depositAmount" placeholder="10 000" class="mb-3" />
        </Field>

        <Field v-if="accounts.length > 0" :label="depositOperation === 'deposit' ? 'Списать со счёта (опционально)' : 'Зачислить на счёт (опционально)'">
          <select
            v-model="depositAccountId"
            class="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink mb-3"
          >
            <option value="">Не списывать со счетов</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.name }} ({{ money(a.amount) }})
            </option>
          </select>
        </Field>

        <Field v-if="people.length > 1" label="Кто вносит">
          <div class="flex gap-2 mb-3">
            <button
              v-for="p in people"
              :key="p.id"
              type="button"
              :class="cn('rounded-xl border px-3 py-2 text-[13px] flex-1 cursor-pointer', depositBy === p.id ? 'border-brand bg-brand-soft text-brand font-medium' : 'border-line text-ink-2')"
              @click="depositBy = p.id"
            >
              {{ p.name }}
            </button>
          </div>
        </Field>

        <Field label="Примечание">
          <Input v-model="depositNote" placeholder="Премия, накопления…" class="mb-3" />
        </Field>

        <Button :disabled="parseMoney(depositAmount) <= 0" class="w-full mt-2" @click="applyDeposit">
          {{ depositOperation === 'deposit' ? 'Пополнить' : 'Снять' }}
        </Button>
      </div>
    </div>

    <!-- МОДАЛКА: Редактировать цель -->
    <div
      v-if="openEditModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      @click.self="openEditModal = false"
    >
      <div class="max-h-[88dvh] w-full max-w-[420px] overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl text-left">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="font-display text-[17px] font-semibold text-ink">Изменить цель</h3>
          <button
            type="button"
            aria-label="Закрыть"
            class="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer"
            @click="openEditModal = false"
          >
            <PhX :size="16" />
          </button>
        </div>

        <Field label="Название">
          <Input v-model="editName" class="mb-3" />
        </Field>
        <Field label="Сколько нужно, ₸">
          <NumField v-model="editNeed" class="mb-3" />
        </Field>
        <Field label="Откладывать в месяц, ₸">
          <NumField v-model="editMonthly" class="mb-3" />
        </Field>

        <Field label="Цвет">
          <div class="flex flex-wrap gap-2 mb-3">
            <button
              v-for="h in HUE_KEYS"
              :key="h"
              type="button"
              :class="cn('size-[28px] rounded-[9px] border-2 cursor-pointer transition-transform', editHue === h ? 'border-ink scale-110' : 'border-transparent')"
              :style="{ background: HUES[h].light }"
              @click="editHue = h"
            />
          </div>
        </Field>

        <Button class="w-full mb-3" @click="saveEdit">Сохранить</Button>

        <DangerZone
          label="Удалить цель"
          warning="Цель исчезнет вместе с историей взносов. Это действие нельзя отменить."
          @confirm="() => { financeStore.removeGoal(goal!.id); router.push('/goals') }"
        />
      </div>
    </div>
  </div>
</template>
