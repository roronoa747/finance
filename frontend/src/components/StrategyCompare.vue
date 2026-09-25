<script setup lang="ts">
/**
 * Копить или гасить — два сценария рядом (React `StrategyCompare`, Р-3, Р-21).
 *
 * Экран не решает за людей, а показывает оба исхода при одинаковых тратах. Три
 * вещи по умолчанию осторожны, иначе совет навредит: подушка набирается раньше
 * досрочек, цель можно оставить пополняемой (декрет — страховка, а не вложение),
 * беспроцентные рассрочки досрочно не гасятся. Какая цель — страховка, решают
 * люди галочкой: по названию не угадываем.
 *
 * Все числа — `strategyInputs` / `simulateStrategy` / `strategyGain`; компонент
 * только показывает.
 *
 * «Выбрать этот план» (PV-15, Р-4): выбор уходит событием `choose` — стор и переход
 * на экран плана у Капитала. С активным планом вместо выбора — его карточка.
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { money, plain } from '@/lib/money'
import { monthIn } from '@/lib/dates'
import {
  costliestCredits,
  pausedGoals,
  planExtra,
  planStartMonth,
  planStep,
  simulateStrategy,
  strategyGain,
  strategyInputs,
  type PlanStep,
} from '@/lib/finance'
import type { Credit, DebtPlan, Goal, Obligation } from '@/types/finance'
import { cn } from '@/lib/utils'
import Callout from '@/components/kit/Callout.vue'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Button from '@/components/ui/Button.vue'

type Horizon = 12 | 24 | 36

const props = defineProps<{
  /** Открытые кредиты (`openCredits` от геттера стора). */
  credits: Credit[]
  goals: Goal[]
  obligations: Obligation[]
  monthKey: string
  /** Стартовое состояние — для SSR-тестов и сценариев. */
  initial?: { months?: Horizon; kept?: string[]; cushion?: boolean; useSaved?: boolean; cushionGoalId?: string | null }
  /** Активный план семьи: вместо выбора — его карточка. */
  plan?: DebtPlan | null
  /** Шаг активного плана в этом месяце (`planStep` от стора). */
  step?: PlanStep | null
  /** Участник, а не viewer: может выбрать план (Р-12). */
  canChoose?: boolean
}>()

const emit = defineEmits<{
  (e: 'choose', opts: { keptGoalIds: string[]; cushionGoalId: string | null; months: Horizon; lump: number }): void
}>()

const months = ref<Horizon>(props.initial?.months ?? 36)
const kept = ref<string[]>(props.initial?.kept ?? [])
const cushion = ref(props.initial?.cushion ?? true)
const useSaved = ref(props.initial?.useSaved ?? false)
// Подушка плана — цель, которую отметили (Р-7): по названию не угадываем.
const cushionGoalId = ref<string | null>(props.initial?.cushionGoalId ?? null)

const HORIZONS = [
  { value: '12', label: 'Год' },
  { value: '24', label: 'Два' },
  { value: '36', label: 'Три' },
] as const
const horizon = computed({
  get: () => String(months.value) as '12' | '24' | '36',
  set: (v) => (months.value = Number(v) as Horizon),
})

const inputs = computed(() =>
  strategyInputs({
    credits: props.credits,
    goals: props.goals,
    obligations: props.obligations,
    key: props.monthKey,
    kept: kept.value,
    cushion: cushion.value,
    useSaved: useSaved.value,
  }),
)
const a = computed(() => {
  const x = inputs.value
  return simulateStrategy({ debts: x.debts, saving: x.saving, keep: x.saving, payDebts: false, start: x.start, months: months.value })
})
const b = computed(() => {
  const x = inputs.value
  return simulateStrategy({
    debts: x.debts,
    saving: x.saving,
    keep: x.keep,
    payDebts: true,
    start: x.start,
    months: months.value,
    buffer: x.buffer,
    lump: x.lump,
  })
})
const gain = computed(() => strategyGain(a.value, b.value))
const hasCostly = computed(() => inputs.value.debts.some((d) => d.annualRate > 0 && d.principal > 0))

const columns = computed(() => [
  { title: 'Копим как сейчас', r: a.value, strong: gain.value < 0 },
  { title: 'Сначала долги', r: b.value, strong: gain.value >= 0 },
])

function freeWhen(month: number | null): string {
  if (month === null) return 'не закрываются'
  return month === 0 ? 'уже' : `через ${month} мес.`
}

function toggleKept(id: string, on: boolean) {
  kept.value = on ? [...kept.value, id] : kept.value.filter((x) => x !== id)
}

/* ------------------ Выбрать этот план (PV-15) ------------------ */
// «Вложить накопленное» в плане не трогает цель-подушку: она для поломок, а не для долгов.
const planLump = computed(() =>
  useSaved.value
    ? strategyInputs({
        credits: props.credits,
        goals: props.goals,
        obligations: props.obligations,
        key: props.monthKey,
        kept: cushionGoalId.value ? [...kept.value, cushionGoalId.value] : kept.value,
        cushion: cushion.value,
        useSaved: true,
      }).lump
    : 0,
)
/**
 * План, который выберется сейчас, — только для пояснения: что встанет на паузу, какой
 * долг первый, шаг месяца. Начало — середина показанного месяца, чтобы шаг взял
 * «вложить накопленное» месяца старта.
 */
const draft = computed<DebtPlan>(() => ({
  id: 'draft',
  status: 'active',
  by: 'a',
  startedAt: `${props.monthKey}-15T12:00:00.000Z`,
  keptGoalIds: kept.value,
  cushionGoalId: cushionGoalId.value,
  creditIds: costliestCredits(props.credits).map((c) => c.id),
  months: months.value,
  lump: planLump.value,
  forecast: { gain: 0, savedInterest: 0, debtFreeMonth: null },
  updatedAt: '',
}))
const draftPaused = computed(() => pausedGoals(draft.value, props.goals))
// Сколько план будет направлять в долги каждый месяц; 0 — выбирать нечего (всё, кроме
// подушки, «не останавливать»): план назначал бы шаг «0 ₸».
const draftExtra = computed(() => planExtra(draft.value, props.goals, props.credits))
const draftStep = computed(() =>
  planStep(draft.value, { goals: props.goals, credits: props.credits, obligations: props.obligations }, props.monthKey),
)
const firstDebt = computed(() => costliestCredits(props.credits)[0])
const goalName = (id: string) => props.goals.find((g) => g.id === id)?.name ?? ''

function choose() {
  emit('choose', {
    keptGoalIds: [...kept.value],
    cushionGoalId: cushionGoalId.value,
    months: months.value,
    lump: planLump.value,
  })
}

/** Шаг активного плана в карточке — без упрёка, одной строкой. */
const stepLine = computed(() => {
  const s = props.step
  if (!s || s.kind === 'done') return 'долги с процентами закрыты'
  if (s.kind === 'cushion') return `шаг этого месяца — подушка, ${money(s.amount)}`
  return s.applied ? `шаг этого месяца внесён · ${money(s.amount)}` : `шаг этого месяца ${money(s.amount)}`
})
</script>

<template>
  <div v-if="hasCostly">
    <div class="mb-3 flex items-center gap-1.5 text-[13px] text-ink-2">
      Одинаковые траты, разный порядок
      <Hint>
        В обоих сценариях уходит одно и то же: платежи по долгам плюс {{ plain(inputs.saving) }} ₸ в цели.
        Разница только в том, куда идут деньги. «Сначала долги» направляет взносы в самый
        дорогой долг, а закрытый долг освобождает платёж для следующего.
      </Hint>
    </div>

    <Field label="Горизонт" group>
      <Segmented v-model="horizon" :options="[...HORIZONS]" />
    </Field>

    <template v-if="inputs.redirected > 0">
      <div class="mb-3 flex gap-2">
        <div
          v-for="col in columns"
          :key="col.title"
          :class="
            cn(
              'min-w-0 flex-1 rounded-xl border px-3 py-2.5',
              col.strong ? 'border-brand bg-brand-soft' : 'border-line bg-surface-2',
            )
          "
        >
          <div class="mb-1.5 text-[12px] font-semibold text-ink-2">{{ col.title }}</div>
          <div class="text-[11.5px] text-ink-2">накоплено</div>
          <div class="num text-[13.5px] font-semibold text-ink">{{ money(col.r.savings) }}</div>
          <div class="mt-1 text-[11.5px] text-ink-2">долг</div>
          <div class="num text-[13.5px] font-semibold text-ink">{{ money(col.r.debtLeft) }}</div>
          <div class="mt-1 text-[11.5px] text-ink-2">процентов банку</div>
          <div class="num text-[13.5px] font-semibold text-warn">{{ money(col.r.interestTotal) }}</div>
          <div class="mt-1 text-[11.5px] text-ink-2">без процентных долгов</div>
          <div class="text-[13px] font-medium text-ink">{{ freeWhen(col.r.debtFreeMonth) }}</div>
        </div>
      </div>

      <div class="mb-3 rounded-xl border border-line px-3.5 py-3">
        <div class="text-[12.5px] text-ink-2">
          {{ gain >= 0 ? 'Сначала долги выгоднее на' : 'Копить выгоднее на' }}
        </div>
        <div class="font-display text-[22px] font-semibold tracking-[-0.02em] num text-ink">
          {{ money(Math.abs(gain)) }}
        </div>
        <div class="text-[12.5px] text-ink-3">
          чистыми через {{ months }} мес. — это деньги, которые не ушли банку
        </div>
      </div>
    </template>
    <p
      v-else
      class="mb-3 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2"
    >
      Все цели отмечены как неприкосновенные — направлять в долги нечего. Снимите отметку
      с цели, которую можно поставить на паузу.
    </p>

    <div v-if="goals.length > 0" class="mb-3">
      <div class="mb-1.5 flex items-center gap-1.5 text-[12.5px] text-ink-3">
        Что не останавливать
        <Hint>
          Отметьте цели-страховки. Если декрет или другая обязательная трата ближе года,
          пауза там обойдётся дороже процентов: доход упадёт, а долги останутся.
        </Hint>
      </div>
      <div class="flex flex-col gap-2">
        <label v-for="g in goals" :key="g.id" class="flex items-center gap-2.5 text-[13.5px] text-ink">
          <input
            type="checkbox"
            :checked="kept.includes(g.id)"
            class="size-4 accent-[var(--brand)]"
            @change="toggleKept(g.id, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 flex-1 truncate">{{ g.name }}</span>
          <span class="shrink-0 text-[12.5px] text-ink-3 num">{{ plain(g.monthly) }}/мес</span>
        </label>
      </div>
    </div>

    <label class="mb-2 flex items-start gap-2.5 text-[13.5px] text-ink">
      <input v-model="cushion" type="checkbox" class="mt-0.5 size-4 accent-[var(--brand)]" />
      <span>
        Сначала подушка — {{ money(inputs.cushionSize) }}
        <span class="block text-[12px] text-ink-3">
          месяц обязательных списаний; без неё первая поломка вернёт вас на кредитную карту
        </span>
      </span>
    </label>

    <label v-if="inputs.movable > 0" class="mb-3 flex items-start gap-2.5 text-[13.5px] text-ink">
      <input v-model="useSaved" type="checkbox" class="mt-0.5 size-4 accent-[var(--brand)]" />
      <span>
        Вложить уже накопленное — {{ money(inputs.spare) }}
        <span class="block text-[12px] text-ink-3">
          из неотмеченных целей, подушка остаётся. Если это вклад с госпремией — сначала
          проверьте условия: премия может обыграть ставку.
        </span>
      </span>
    </label>

    <p v-if="inputs.interestFree.length > 0" class="text-[12px] leading-relaxed text-ink-3">
      Беспроцентные долги — {{ inputs.interestFree.map((c) => c.name).join(', ') }} — досрочно не
      гасятся: они ничего не стоят, а внесённые раньше срока деньги просто перестают быть
      доступными.
    </p>

    <!-- Активный план — его карточка вместо выбора (PV-15) -->
    <div v-if="plan" class="mt-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
      <div class="text-[13.5px] font-medium text-ink">План выбран в {{ monthIn(planStartMonth(plan)) }}</div>
      <div class="mt-0.5 text-[12.5px] text-ink-2 num">{{ stepLine }}</div>
      <RouterLink to="/plan" class="mt-1.5 inline-block text-[13px] font-medium text-brand">Открыть план →</RouterLink>
    </div>

    <!-- Выбрать этот план (Р-4, Р-7) -->
    <div v-else-if="inputs.redirected > 0" class="mt-3 border-t border-line pt-3">
      <Field label="Подушка — какая цель?" group>
        <div class="mb-3 flex flex-col gap-2">
          <label v-for="g in goals" :key="g.id" class="flex items-center gap-2.5 text-[13.5px] text-ink">
            <input
              type="radio"
              name="plan-cushion"
              :checked="cushionGoalId === g.id"
              class="size-4 accent-[var(--brand)]"
              @change="cushionGoalId = g.id"
            />
            <span class="min-w-0 flex-1 truncate">{{ g.name }}</span>
          </label>
          <label class="flex items-center gap-2.5 text-[13.5px] text-ink">
            <input
              type="radio"
              name="plan-cushion"
              :checked="cushionGoalId === null"
              class="size-4 accent-[var(--brand)]"
              @change="cushionGoalId = null"
            />
            Без подушки
          </label>
        </div>
      </Field>
      <!-- Р-7: подушки нет — план предлагает её завести. -->
      <Callout v-if="cushionGoalId === null" title="Заведите цель-подушку — план начнёт с неё" class="mb-3">
        Месяц обязательных списаний на отдельной цели: пока её нет, первая поломка вернёт
        вас на кредитную карту. <RouterLink to="/goals" class="font-medium text-brand">Завести цель</RouterLink>
      </Callout>

      <Button v-if="canChoose" class="w-full" :disabled="!draftExtra" @click="choose">Выбрать этот план</Button>
      <div class="mt-2 flex flex-col gap-1 text-[12.5px] leading-relaxed text-ink-2">
        <p v-if="!draftExtra">
          Плану нечего направлять в долги: кроме подушки, все цели отмечены «не останавливать».
        </p>
        <p v-else-if="draftPaused.length">
          На паузу встанут: {{ draftPaused.map((g) => g.name).join(', ') }} —
          <span class="num">{{ money(draftExtra) }}</span> в месяц.
          Взносы в них не пропадут: они пойдут в долги, а цели возобновятся сами.
        </p>
        <template v-if="draftExtra">
          <p v-if="firstDebt">Первым гасится «{{ firstDebt.name }}» — самый дорогой долг.</p>
          <p v-if="draftStep.kind === 'cushion'" class="num">
            Шаг этого месяца — пополнить подушку «{{ goalName(draftStep.goalId) }}» на {{ money(draftStep.amount) }}:
            до месяца обязательных списаний не хватает {{ money(draftStep.missing) }}.
          </p>
          <p v-else-if="draftStep.kind === 'prepay'" class="num">
            Шаг этого месяца — {{ money(draftStep.amount) }} досрочно в «{{ firstDebt?.name }}».
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
