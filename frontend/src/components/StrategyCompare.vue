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
 */
import { computed, ref } from 'vue'
import { money, plain } from '@/lib/money'
import { simulateStrategy, strategyGain, strategyInputs } from '@/lib/finance'
import type { Credit, Goal, Obligation } from '@/types/finance'
import { cn } from '@/lib/utils'
import Field from '@/components/kit/Field.vue'
import Hint from '@/components/kit/Hint.vue'
import Segmented from '@/components/kit/Segmented.vue'

type Horizon = 12 | 24 | 36

const props = defineProps<{
  /** Открытые кредиты (`openCredits` от геттера стора). */
  credits: Credit[]
  goals: Goal[]
  obligations: Obligation[]
  monthKey: string
  /** Стартовое состояние — для SSR-тестов и сценариев. */
  initial?: { months?: Horizon; kept?: string[]; cushion?: boolean; useSaved?: boolean }
}>()

const months = ref<Horizon>(props.initial?.months ?? 36)
const kept = ref<string[]>(props.initial?.kept ?? [])
const cushion = ref(props.initial?.cushion ?? true)
const useSaved = ref(props.initial?.useSaved ?? false)

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
  </div>
</template>
