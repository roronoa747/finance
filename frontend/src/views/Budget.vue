<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowDown, PhArrowUp } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { money, plain, pct, parseMoney } from '@/lib/money'
import {
  WEEKDAYS,
  dayLabel,
  daysInMonth,
  leadingBlanks,
  monthFrom,
  monthKey,
  monthTitle,
  today,
} from '@/lib/dates'
import {
  amountAt,
  budgetAmounts,
  dueIn,
  liveCredits,
  liveObligations,
  nextSalaryChange,
  paidFor,
  salaryAt,
  type ScheduledKind,
} from '@/lib/finance'
import type { PersonId } from '@/types/finance'
import { cn } from '@/lib/utils'

import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import Callout from '@/components/kit/Callout.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Stat from '@/components/kit/Stat.vue'
import Hint from '@/components/kit/Hint.vue'
import NumFieldBlur from '@/components/kit/NumFieldBlur.vue'
import Bar from '@/components/Bar.vue'
import Legend from '@/components/Legend.vue'
import SalaryDialog from '@/components/SalaryDialog.vue'
import PaidRow from '@/components/PaidRow.vue'

const DERIVED_NOTE: Record<string, string> = {
  d1: 'сумма обязательств по жилью',
  d2: 'платежи по кредитам',
  d3: 'взносы по всем целям',
}

type ViewMode = 'plan' | 'calendar' | 'list'

const props = withDefaults(
  defineProps<{
    initialView?: ViewMode
  }>(),
  {
    initialView: 'plan',
  },
)

interface EventItem {
  id: string
  day: number
  name: string
  note: string
  value: number
  color: string
  income: boolean
  estimate?: boolean
  /** Платёж по графику — отмечается «Оплатил». */
  pay?: ScheduledKind
  open: () => void
}

const view = ref<ViewMode>(props.initialView)
const salaryFor = ref<PersonId | null>(null)
const selected = ref(today().day)

const router = useRouter()
const financeStore = useFinanceStore()

const key = computed(() => monthKey())
const people = computed(() => financeStore.people)
const categories = computed(() => financeStore.categories)
const obligations = computed(() => liveObligations(financeStore.obligations))
const credits = computed(() => liveCredits(financeStore.credits))

const amounts = computed(() => budgetAmounts(financeStore.householdDoc))
const income = computed(() => amounts.value.income)
const free = computed(() => amounts.value.d5)

const events = computed<EventItem[]>(() => {
  const items: EventItem[] = [
    ...people.value.map((p) => ({
      id: `pay-${p.id}`,
      day: p.payday,
      name: `Зарплата · ${p.name}`,
      note: 'оклад',
      value: salaryAt(p, key.value),
      color: `var(--p${p.id})`,
      income: true,
      open: () => {
        salaryFor.value = p.id
      },
    })),
    ...obligations.value
      .filter((o) => dueIn(o, key.value))
      .map((o) => ({
        id: o.id,
        day: o.day,
        name: o.name,
        note: o.every === 'year' ? 'раз в год' : o.estimate ? 'оценка по сезону' : o.note,
        value: amountAt(o, key.value),
        color: `var(--${o.category})`,
        income: false,
        estimate: o.estimate,
        pay: 'obligation' as const,
        open: () => {
          void router.push(`/capital?obligation=${o.id}`)
        },
      })),
    // Закрытый долг в этом месяце не платится, если его не закрыли этим же платежом.
    ...credits.value
      .filter((c) => c.principal > 0 || paidFor(financeStore.payments, 'credit', c.id, key.value))
      .map((c) => ({
        id: c.id,
        day: c.day,
        name: c.name,
        note: c.note,
        value: c.payment,
        color: 'var(--d2)',
        income: false,
        pay: 'credit' as const,
        open: () => {
          void router.push(`/capital?credit=${c.id}`)
        },
      })),
    {
      id: 'goals',
      day: 1,
      name: 'Взносы в цели',
      note: 'по плану месяца',
      value: amounts.value.d3,
      color: 'var(--d3)',
      income: false,
      open: () => {
        void router.push('/goals')
      },
    },
  ]
  return items.sort((a, b) => a.day - b.day)
})

const obligationsTotal = computed(() =>
  events.value.filter((e) => !e.income && e.id !== 'goals').reduce((a, e) => a + e.value, 0),
)
const savedTotal = computed(() => amounts.value.d3)

const dayEvents = computed(() => events.value.filter((e) => e.day === selected.value))

function handleD4Commit(text: string) {
  financeStore.setCategoryAmount('d4', parseMoney(text))
}
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1 text-left">
    <Segmented
      v-model="view"
      :options="[
        { value: 'plan', label: 'План' },
        { value: 'calendar', label: 'Календарь' },
        { value: 'list', label: 'Список' },
      ]"
    />

    <!-- РЕЖИМ 1: ПЛАН -->
    <template v-if="view === 'plan'">
      <Card>
        <div class="text-[13px] text-ink-2">Доход семьи · оклады без бонусов</div>
        <div class="mb-3.5 mt-0.5 font-display text-[30px] font-semibold tracking-[-0.025em] num text-ink">
          {{ money(income) }}
        </div>
        <Bar
          :segments="
            people.map((p) => ({
              key: String(p.id),
              value: salaryAt(p, key),
              color: `var(--p${p.id})`,
              label: p.name,
            }))
          "
        />
        <div class="mt-3.5 flex flex-col gap-3">
          <button
            v-for="p in people"
            :key="p.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg py-1 text-left hover:bg-surface-2 transition-colors cursor-pointer"
            @click="salaryFor = p.id"
          >
            <i class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: `var(--p${p.id})` }" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] text-ink-2">
                {{ p.name }} · {{ p.payday }} числа
              </span>
              <span v-if="nextSalaryChange(p, key)" class="block text-[12px] text-brand">
                с {{ monthFrom(nextSalaryChange(p, key)!.from) }} — {{ money(nextSalaryChange(p, key)!.amount) }}
              </span>
            </span>
            <span class="shrink-0 text-right">
              <span class="block text-[14.5px] font-semibold num text-ink">
                {{ money(salaryAt(p, key)) }}
              </span>
              <span class="block text-[12px] text-ink-3 num">
                {{ pct(salaryAt(p, key), income) }}%
              </span>
            </span>
          </button>
        </div>
        <p v-if="people.length > 1" class="mt-3 border-t border-line pt-3 text-[12.5px] text-ink-3">
          Зарплаты приходят в разные дни, поэтому месяц закрывается 1-го числа, а не в день получки.
          Провал между {{ people[0].payday }} и {{ people[1].payday }} числом виден в календаре.
        </p>
      </Card>

      <Section title="Куда уходит" />
      <Card>
        <div class="flex flex-col">
          <div
            v-for="c in categories.filter((cat) => cat.key !== 'd5')"
            :key="c.key"
            class="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
          >
            <i
              class="min-h-[34px] w-[3px] self-stretch rounded-sm"
              :style="{ background: `var(--${c.key})` }"
            />
            <div class="min-w-0 flex-1">
              <div class="text-[14.5px] font-medium text-ink">{{ c.name }}</div>
              <div class="text-[12.5px] text-ink-3">
                {{ c.key !== 'd4' ? DERIVED_NOTE[c.key] : c.note }}
              </div>
            </div>
            <div class="text-right">
              <div v-if="c.key !== 'd4'" class="text-[15px] font-semibold num text-ink">
                {{ money(amounts[c.key as 'd1' | 'd2' | 'd3' | 'd4'] || 0) }}
              </div>
              <div v-else>
                <NumFieldBlur
                  :initial="plain(c.amount)"
                  :aria-label="c.name"
                  class-name="h-9 w-[118px] bg-surface-2 text-right"
                  @commit="handleD4Commit"
                />
              </div>
              <div class="mt-0.5 text-[12px] font-medium text-brand num">
                {{ pct(amounts[c.key as 'd1' | 'd2' | 'd3' | 'd4'] || 0, income) }}% дохода
              </div>
            </div>
          </div>

          <!-- Свободно -->
          <div class="flex items-center gap-3 pt-3">
            <i
              class="min-h-[34px] w-[3px] self-stretch rounded-sm"
              style="background: var(--d5)"
            />
            <div class="min-w-0 flex-1">
              <div class="text-[14.5px] font-medium text-ink">Свободно</div>
              <div class="text-[12.5px] text-ink-3">считается само — это остаток</div>
            </div>
            <div class="text-right">
              <div class="text-[15px] font-semibold num text-ink">{{ money(free) }}</div>
              <div class="mt-0.5 text-[12px] font-medium text-brand num">
                {{ pct(free, income) }}% дохода
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[12.5px] text-ink-3">
          Откуда эти суммы
          <Hint>
            Жильё, кредиты и цели считаются из того, что вы уже завели: меняются они в «Капитале» и в
            целях. Руками задаётся только «еда и быт» — единственная статья, которую мы намеренно не
            отслеживаем по операциям.
          </Hint>
        </div>
      </Card>

      <Callout v-if="free < 0" title="План не сходится">
        Расписано больше, чем приходит, на {{ money(-free) }}. Уменьшите любую строку — свободный
        остаток пересчитается сам.
      </Callout>
    </template>

    <!-- РЕЖИМ 2: КАЛЕНДАРЬ -->
    <template v-if="view === 'calendar'">
      <div class="grid grid-cols-2 gap-2.5">
        <Stat label="Отложено" :value="money(savedTotal)" color="var(--d3)" />
        <Stat label="На обязательства" :value="money(obligationsTotal)" color="var(--d2)" />
      </div>

      <Card>
        <div class="mb-1 grid grid-cols-7 gap-0.5">
          <span
            v-for="w in WEEKDAYS"
            :key="w"
            class="text-center text-[11px] tracking-[0.04em] text-ink-3"
          >
            {{ w }}
          </span>
        </div>
        <div class="grid grid-cols-7 gap-0.5">
          <span
            v-for="i in leadingBlanks(key)"
            :key="`b${i}`"
            class="aspect-square"
          />
          <button
            v-for="day in daysInMonth(key)"
            :key="day"
            type="button"
            :aria-pressed="selected === day"
            :class="
              cn(
                'flex aspect-square flex-col items-center justify-center gap-[3px] rounded-[10px] border border-transparent text-[13px] transition-colors cursor-pointer',
                events.filter((e) => e.day === day).length ? 'font-medium text-ink' : 'text-ink-2',
                selected === day && 'border-line-strong bg-surface-3',
              )
            "
            @click="selected = day"
          >
            {{ day }}
            <span class="flex h-[5px] gap-0.5">
              <i
                v-for="e in events.filter((ev) => ev.day === day).slice(0, 3)"
                :key="e.id"
                class="size-[5px] rounded-full"
                :style="{ background: e.color }"
              />
            </span>
          </button>
        </div>
        <Legend
          :items="[
            ...people.map((p) => ({
              key: String(p.id),
              color: `var(--p${p.id})`,
              name: `Зарплата · ${p.name}`,
              value: '',
            })),
            { key: 'd1', color: 'var(--d1)', name: 'Жильё', value: '' },
            { key: 'd2', color: 'var(--d2)', name: 'Кредит', value: '' },
            { key: 'd3', color: 'var(--d3)', name: 'Отложено в цели', value: '' },
          ]"
        />
      </Card>

      <div class="mt-1 flex items-baseline gap-2 px-0.5">
        <b class="font-display text-[14px] font-semibold text-ink">{{ dayLabel(selected, key) }}</b>
        <span v-if="!dayEvents.length" class="text-[12.5px] text-ink-3">движений нет</span>
      </div>

      <Card v-if="dayEvents.length > 0" flush>
        <template v-for="e in dayEvents" :key="e.id">
          <PaidRow
            v-if="e.pay"
            :kind="e.pay"
            :target-id="e.id"
            :period="key"
            :accent="e.color"
            :title="e.name"
            :note="e.note"
            :estimate="e.estimate"
            clickable
            @open="e.open"
          >
            <template #icon>
              <PhArrowDown :size="15" weight="bold" />
            </template>
          </PaidRow>
          <Row
            v-else
            :accent="e.color"
            :title="e.name"
            :note="e.note"
            clickable
            @click="e.open"
          >
            <template #icon>
              <PhArrowUp v-if="e.income" :size="15" weight="bold" />
              <PhArrowDown v-else :size="15" weight="bold" />
            </template>
            <template #value>
              <span
                class="block text-[14.5px] font-semibold num"
                :style="{ color: e.income ? 'var(--brand)' : undefined }"
              >
                {{ e.income ? '+' : '−' }}{{ plain(e.value) }}
              </span>
            </template>
          </Row>
        </template>
      </Card>

      <Card>
        <div class="mb-3 flex items-center gap-2.5">
          <b class="text-[14.5px] font-semibold text-ink">Нагрузка на доход</b>
        </div>

        <div class="mb-3">
          <div class="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span class="text-ink-2">Кредиты</span>
            <b class="num text-ink">{{ pct(amounts.d2, income) }}% · {{ money(amounts.d2) }}</b>
          </div>
          <div class="flex h-3 overflow-hidden rounded-md bg-track">
            <span
              class="block h-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, (amounts.d2 / (income || 1)) * 100)}%`,
                background: 'var(--d2)',
              }"
            />
          </div>
          <div class="mt-1 text-[11.5px] text-ink-3">до 30% считается комфортным</div>
        </div>

        <div>
          <div class="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span class="text-ink-2">Вместе с жильём</span>
            <b class="num text-ink">
              {{ pct(amounts.d1 + amounts.d2, income) }}% · {{ money(amounts.d1 + amounts.d2) }}
            </b>
          </div>
          <div class="flex h-3 overflow-hidden rounded-md bg-track">
            <span
              class="block h-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, (amounts.d1 / (income || 1)) * 100)}%`,
                background: 'var(--d1)',
              }"
            />
            <span
              class="block h-full transition-all duration-300"
              :style="{
                width: `${Math.min(100, (amounts.d2 / (income || 1)) * 100)}%`,
                background: 'var(--d2)',
              }"
            />
          </div>
          <div class="mt-1 text-[11.5px] text-ink-3">до 50% — обычный ориентир для пары</div>
        </div>

        <p class="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-2">
          Обязательные платежи — {{ money(obligationsTotal) }} из {{ money(income) }} дохода. Это
          то, что уходит независимо от ваших решений в этом месяце.
        </p>
      </Card>
    </template>

    <!-- РЕЖИМ 3: СПИСОК -->
    <template v-if="view === 'list'">
      <Card flush>
        <template v-for="e in events" :key="e.id">
          <PaidRow
            v-if="e.pay"
            :kind="e.pay"
            :target-id="e.id"
            :period="key"
            :accent="e.color"
            :title="e.name"
            :note="`${dayLabel(e.day, key)}${e.note ? ` · ${e.note}` : ''}`"
            :estimate="e.estimate"
            clickable
            @open="e.open"
          >
            <template #icon>
              <PhArrowDown :size="15" weight="bold" />
            </template>
          </PaidRow>
          <Row
            v-else
            :accent="e.color"
            :title="e.name"
            :note="`${dayLabel(e.day, key)} · ${e.note}`"
            :sub="e.estimate ? 'оценка' : undefined"
            clickable
            @click="e.open"
          >
            <template #icon>
              <PhArrowUp v-if="e.income" :size="15" weight="bold" />
              <PhArrowDown v-else :size="15" weight="bold" />
            </template>
            <template #value>
              <span
                class="block text-[14.5px] font-semibold num"
                :style="{ color: e.income ? 'var(--brand)' : undefined }"
              >
                {{ e.income ? '+' : '−' }}{{ plain(e.value) }}
              </span>
            </template>
          </Row>
        </template>
      </Card>
    </template>

    <SalaryDialog :id="salaryFor" @close="salaryFor = null" />

    <div class="pb-2 text-center text-[12px] text-ink-3">{{ monthTitle(key) }}</div>
  </div>
</template>
