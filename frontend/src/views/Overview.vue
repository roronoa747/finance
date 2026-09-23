<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import {
  PhClock,
  PhPlus,
  PhUserPlus,
  PhCopy,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { money, plain, pct } from '@/lib/money'
import { monthKey, monthIn, monthFrom, dayLabel } from '@/lib/dates'
import {
  amountAt,
  budgetAmounts,
  dueIn,
  liveCredits,
  liveGoals,
  liveObligations,
  nextChange,
  salaryAt,
  untilPayday,
} from '@/lib/finance'
import { cn } from '@/lib/utils'
import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import Callout from '@/components/kit/Callout.vue'
import Hero from '@/components/kit/Hero.vue'
import Button from '@/components/ui/Button.vue'
import Bar, { type Seg } from '@/components/Bar.vue'
import Legend, { type LegendItem } from '@/components/Legend.vue'
import Ring from '@/components/Ring.vue'

const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()

const key = computed(() => monthKey())

const people = computed(() => financeStore.people)
const categories = computed(() => financeStore.categories)
const goals = computed(() => liveGoals(financeStore.goals))
const obligations = computed(() => liveObligations(financeStore.obligations))
const credits = computed(() => liveCredits(financeStore.credits))

// Суммы по разделам считаются из обязательств, кредитов и целей
const amounts = computed(() => budgetAmounts(financeStore.householdDoc))
const income = computed(() => amounts.value.income)
const free = computed(() => amounts.value.d5)
const spent = computed(() => income.value - free.value)

// Сегменты расходов по категориям для Bar и Legend
const segments = computed<Seg[]>(() => {
  const segs: Seg[] = categories.value
    .filter((c) => c.key !== 'd5')
    .map((c) => ({
      key: c.key,
      value: amounts.value[c.key as 'd1' | 'd2' | 'd3' | 'd4'] || 0,
      color: `var(--${c.key})`,
      label: c.name,
    }))

  segs.push({
    key: 'd5',
    value: Math.max(0, free.value),
    color: 'var(--d5)',
    label: 'Свободно',
  })
  return segs
})

const legendItems = computed<LegendItem[]>(() => {
  return segments.value.map((s) => ({
    key: s.key,
    color: s.color,
    name: s.label ?? '',
    value: money(s.value),
  }))
})

// Сегменты зарплат участников для первого Bar
const peopleSegments = computed<Seg[]>(() => {
  return people.value.map((p) => ({
    key: String(p.id),
    value: salaryAt(p, key.value),
    color: `var(--p${p.id})`,
    label: p.name,
  }))
})

// Событие «освободится N ₸»
const freed = computed(() => {
  return obligations.value
    .map((o) => ({ o, change: nextChange(o, key.value) }))
    .find((x) => x.change && x.change.delta < 0)
})

// Ближайшие списания «Впереди»
const upcoming = computed(() => {
  const items = [
    ...obligations.value
      .filter((o) => dueIn(o, key.value))
      .map((o) => ({
        id: o.id,
        name: o.name,
        day: o.day,
        value: amountAt(o, key.value),
        note: o.every === 'year' ? 'раз в год' : o.estimate ? 'оценка по сезону' : o.note,
        color: `var(--${o.category})`,
        estimate: o.estimate,
        to: `/capital?obligation=${o.id}`,
      })),
    ...credits.value.map((c) => ({
      id: c.id,
      name: c.name,
      day: c.day,
      value: c.payment,
      note: c.note || 'ежемесячный платёж',
      color: 'var(--d2)',
      estimate: false,
      to: `/capital?credit=${c.id}`,
    })),
  ]
  return items.sort((a, b) => a.day - b.day)
})

// Данные блока «До зарплаты»
const paydayInfo = computed(() => {
  return untilPayday(financeStore.householdDoc)
})

function dayWord(n: number) {
  const t = n % 10
  const h = n % 100
  if (h >= 11 && h <= 14) return 'дней'
  if (t === 1) return 'день'
  if (t >= 2 && t <= 4) return 'дня'
  return 'дней'
}

// Баннер приглашения
const inviteCode = ref<string | null>(null)
const inviteBusy = ref(false)
const copied = ref(false)

async function makeInvite() {
  inviteBusy.value = true
  try {
    const res = await authStore.createInvite()
    inviteCode.value = res.code
  } catch (e) {
    console.error(e)
  } finally {
    inviteBusy.value = false
  }
}

async function copyInvite() {
  if (!inviteCode.value) return
  try {
    await navigator.clipboard.writeText(inviteCode.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {}
}
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1 text-left">
    <!-- Invite Partner Banner (if single member) -->
    <div
      v-if="people.length < 2"
      class="rounded-[18px] border border-brand bg-surface p-4"
    >
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <PhUserPlus :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <b class="block font-display text-[15.5px] font-semibold text-ink">Пригласите партнёра</b>
          <p class="mt-1 text-[13px] leading-relaxed text-ink-2">
            Пока бюджет видите только вы. У второго будет свой вход, а цели и покупки — общие.
          </p>
        </div>
      </div>

      <div class="mt-3">
        <template v-if="inviteCode">
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-brand-soft py-3 font-display text-[22px] font-semibold tracking-[0.14em] num text-ink cursor-pointer"
            @click="copyInvite"
          >
            {{ inviteCode }}
            <PhCopy :size="16" class="text-ink-3" />
          </button>
          <p v-if="copied" class="mt-1.5 text-center text-[12px] text-brand">
            Скопировано
          </p>
        </template>
        <Button v-else class="w-full" :disabled="inviteBusy" @click="makeInvite">
          {{ inviteBusy ? 'Минуту…' : 'Создать код приглашения' }}
        </Button>
      </div>
    </div>

    <!-- Main Hero Card: Свободный остаток и полосы распределения -->
    <Card>
      <Hero :label="`Свободно в ${monthIn(key, false)}`" :value="money(free)" />
      <div class="flex flex-col gap-[7px]">
        <!-- Полоса доходов по людям -->
        <Bar :segments="peopleSegments" />

        <div class="flex justify-between text-[12px] text-ink-3">
          <span>Доход {{ money(income) }}</span>
          <span>распределено {{ pct(spent, income) }}%</span>
        </div>

        <!-- Полоса расходов по категориям -->
        <Bar thick :segments="segments" />
      </div>

      <Legend :items="legendItems" />
    </Card>

    <!-- Событие высвобождения средств -->
    <div
      v-if="freed && freed.change"
      class="rounded-[18px] border border-brand bg-surface p-4"
    >
      <div class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand">
        С {{ monthFrom(freed.change.from, false) }}
      </div>
      <h3 class="mb-1 font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">
        Освободится {{ money(Math.abs(freed.change.delta)) }} в месяц
      </h3>
      <p class="mb-3.5 text-[13px] text-ink-2">
        {{ freed.o.name }} снизится с {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸.
        За год это {{ money(Math.abs(freed.change.delta) * 12) }} — решите заранее, куда они пойдут.
      </p>
      <button
        type="button"
        class="w-full rounded-xl bg-brand px-4 py-2.5 text-[14px] font-semibold text-brand-ink active:translate-y-px cursor-pointer"
        @click="router.push('/ritual')"
      >
        Распределить
      </button>
    </div>

    <!-- Предупреждение: план не сходится -->
    <Callout v-if="free < 0" title="План пока не сходится">
      Расписано на {{ money(-free) }} больше, чем приходит.
      {{
        people.length < 2
          ? ' Скорее всего, доход второго участника ещё не внесён — пригласите его, и цифра сойдётся.'
          : ' Уменьшите любую строку в «Бюджете» — свободный остаток пересчитается сам.'
      }}
    </Callout>

    <!-- Подсказка: перед экономией будет пик -->
    <Callout v-if="freed && freed.change" title="Перед экономией будет пик">
      В месяц переезда платятся депозит, комиссия и перевозка — сверх обычных расходов.
      Экономия начнётся только со следующего месяца, и приложение не будет делать вид,
      что это не так.
    </Callout>

    <!-- Блок «До зарплаты» -->
    <template v-if="paydayInfo && paydayInfo.due.length">
      <Section title="До зарплаты" />
      <Card>
        <div class="flex items-baseline gap-2">
          <span class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
            {{ paydayInfo.inDays === 0 ? 'Сегодня' : `Через ${paydayInfo.inDays} ${dayWord(paydayInfo.inDays)}` }}
          </span>
          <span class="ml-auto text-[13px] text-ink-3">
            {{ dayLabel(paydayInfo.day, paydayInfo.key) }}
          </span>
        </div>
        <div class="mt-0.5 text-[13px] text-ink-2">
          {{ paydayInfo.who.name }} получит {{ money(paydayInfo.income) }}
        </div>

        <div class="mt-3 border-t border-line pt-3">
          <div class="flex items-baseline">
            <span class="text-[13px] text-ink-2">Списаний до неё</span>
            <b class="ml-auto num text-[14.5px] text-ink">{{ money(paydayInfo.dueTotal) }}</b>
          </div>
          <div class="mt-2 flex flex-col gap-1.5">
            <div
              v-for="d in paydayInfo.due"
              :key="d.id"
              class="flex items-baseline gap-2 text-[12.5px]"
            >
              <span class="text-ink-3">{{ dayLabel(d.day, d.when) }}</span>
              <span class="truncate text-ink-2">{{ d.name }}</span>
              <span class="ml-auto shrink-0 num text-ink">{{ plain(d.value) }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="paydayInfo.knowsCash"
          :class="
            cn(
              'mt-3 rounded-xl border px-3.5 py-3 text-[12.5px] leading-relaxed',
              paydayInfo.shortfall >= 0
                ? 'border-brand bg-brand-soft text-ink-2'
                : 'border-warn-line bg-warn-soft text-ink-2',
            )
          "
        >
          {{
            paydayInfo.shortfall >= 0
              ? `На счетах ${plain(paydayInfo.onAccounts)} ₸ — хватает, остаётся ${plain(paydayInfo.shortfall)} ₸.`
              : `На счетах ${plain(paydayInfo.onAccounts)} ₸ — не хватает ${plain(-paydayInfo.shortfall)} ₸. Перенесите платёж или возьмите из накоплений, но решите это сейчас, а не в день списания.`
          }}
        </div>
        <p v-else class="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          Хватит ли этого, приложение не знает: остаток на картах не заведён. Добавьте
          счёт в «Капитале» — и здесь появится ответ вместо списка.
        </p>
      </Card>
    </template>

    <!-- Секция «Впереди» -->
    <Section title="Впереди">
      <template #action>
        <RouterLink to="/budget" class="text-[13px] text-brand hover:underline">Календарь</RouterLink>
      </template>
    </Section>

    <Card flush>
      <Row
        v-for="u in upcoming"
        :key="u.id"
        :accent="u.color"
        :title="u.name"
        :note="`${dayLabel(u.day, key)} · ${u.note}`"
        :value="money(u.value)"
        :sub="u.estimate ? 'оценка' : undefined"
        @click="router.push(u.to)"
      >
        <template #icon>
          <PhClock :size="17" />
        </template>
      </Row>
    </Card>

    <!-- Секция «Цели» -->
    <Section title="Цели">
      <template #action>
        <RouterLink to="/goals" class="text-[13px] text-brand hover:underline">Все</RouterLink>
      </template>
    </Section>

    <div class="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      <RouterLink
        v-for="g in goals"
        :key="g.id"
        :to="`/goals/${g.id}`"
        class="w-[138px] shrink-0 rounded-2xl border border-line bg-surface p-3.5"
      >
        <Ring
          :progress="g.need ? g.have / g.need : 0"
          :plan="g.planPct"
          :hue="g.hue"
          :size="44"
        />
        <div class="mt-2 text-[13px] font-medium leading-tight text-ink">{{ g.name }}</div>
        <div class="mt-0.5 text-[12px] text-ink-3 num">
          {{ Math.round((g.need ? g.have / g.need : 0) * 100) }}% · {{ plain(g.have) }}
        </div>
      </RouterLink>

      <RouterLink
        v-if="!goals.length"
        to="/goals"
        class="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface px-4 py-4"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2">
          <PhPlus :size="17" weight="bold" />
        </span>
        <span class="text-[13.5px] leading-snug text-ink-2">
          Целей пока нет. Добавьте первую — приложение посчитает, сколько откладывать в месяц.
        </span>
      </RouterLink>
    </div>
  </div>
</template>
