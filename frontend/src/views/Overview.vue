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
  budgetAmounts,
  liveCredits,
  liveGoals,
  liveObligations,
  nextChange,
  salaryAt,
  amountAt,
  dueIn,
  untilPayday,
  netWorth,
  cushionMonths,
  liquidCash,
  mandatoryMonthly,
} from '@/lib/finance'
import Card from '@/components/kit/Card.vue'
import Section from '@/components/kit/Section.vue'
import Row from '@/components/kit/Row.vue'
import Callout from '@/components/kit/Callout.vue'
import Button from '@/components/ui/Button.vue'
import MetricCard from '@/components/MetricCard.vue'
import CategoryBar, { type Segment } from '@/components/CategoryBar.vue'
import EmergencyBanner from '@/components/EmergencyBanner.vue'
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
const accounts = computed(() => financeStore.accounts)

// Расчёт бюджетов по доменным правилам finance.ts
const amounts = computed(() => budgetAmounts(financeStore.householdDoc))
const income = computed(() => amounts.value.income)
const free = computed(() => amounts.value.d5)
const spent = computed(() => income.value - free.value)

// Сегменты доходов по участникам
const peopleSegments = computed<Segment[]>(() => {
  return people.value.map((p) => ({
    key: p.id,
    value: salaryAt(p, key.value),
    color: `var(--p${p.id})`,
    label: p.name,
  }))
})

// Сегменты расходов по категориям
const categorySegments = computed<Segment[]>(() => {
  const segs: Segment[] = categories.value
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

// Совокупный капитал
const totalNetWorth = computed(() => {
  return netWorth(accounts.value, credits.value, goals.value)
})

// Подушка безопасности
const liquid = computed(() => liquidCash(accounts.value))
const mandatory = computed(() => mandatoryMonthly(categories.value))
const cushion = computed(() => cushionMonths(accounts.value, mandatory.value))

// Событие высвобождения средств (если платёж снизится в будущем)
const freed = computed(() => {
  return obligations.value
    .map((o) => ({ o, change: nextChange(o, key.value) }))
    .find((x) => x.change && x.change.delta < 0)
})

// Ближайшие списания
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
        to: '/budget',
      })),
    ...credits.value.map((c) => ({
      id: c.id,
      name: c.name,
      day: c.day,
      value: c.payment,
      note: c.note || 'ежемесячный платёж',
      color: 'var(--d2)',
      estimate: false,
      to: '/capital',
    })),
  ]
  return items.sort((a, b) => a.day - b.day)
})

// Данные до зарплаты
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
      class="rounded-2xl border border-brand/50 bg-surface p-4 shadow-xs"
    >
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <PhUserPlus :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <b class="block font-display text-[15.5px] font-semibold text-ink">Пригласите партнёра</b>
          <p class="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
            Пока бюджет видите только вы. У второго будет свой вход, а цели и покупки — общие.
          </p>
        </div>
      </div>

      <div class="mt-3">
        <template v-if="inviteCode">
          <button
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-brand-soft py-2.5 font-display text-[22px] font-semibold tracking-[0.14em] num text-ink cursor-pointer"
            @click="copyInvite"
          >
            {{ inviteCode }}
            <PhCopy :size="16" class="text-ink-3" />
          </button>
          <p v-if="copied" class="mt-1 text-center text-[12px] font-medium text-brand">
            Скопировано в буфер
          </p>
        </template>
        <Button v-else class="w-full" :disabled="inviteBusy" @click="makeInvite">
          {{ inviteBusy ? 'Создаём код…' : 'Создать код приглашения' }}
        </Button>
      </div>
    </div>

    <!-- Main Hero Card: Свободный остаток и полосы распределения -->
    <Card>
      <div class="text-[13px] font-medium text-ink-2">
        Свободно в {{ monthIn(key, false) }}
      </div>
      <div class="mb-3 font-display text-[38px] font-semibold leading-[1.1] tracking-[-0.03em] num text-ink">
        {{ money(free) }}
      </div>

      <div class="flex flex-col gap-2">
        <!-- Полоса доходов по людям -->
        <CategoryBar :segments="peopleSegments" />

        <div class="flex justify-between text-[12px] text-ink-3">
          <span>Доход <b class="num text-ink">{{ money(income) }}</b></span>
          <span>распределено <b class="num text-ink">{{ pct(spent, income) }}%</b></span>
        </div>

        <!-- Полоса расходов по категориям -->
        <CategoryBar thick :segments="categorySegments" show-legend />
      </div>
    </Card>

    <!-- 4 Key Metrics Grid -->
    <div class="grid grid-cols-2 gap-2.5">
      <MetricCard
        label="Капитал"
        :value="money(totalNetWorth)"
        :sub="totalNetWorth >= 0 ? 'Чистые активы' : 'Кредиты превышают счета'"
        :accent="totalNetWorth >= 0 ? 'var(--brand)' : 'var(--warn)'"
      />
      <MetricCard
        label="Доход месяца"
        :value="money(income)"
        sub="Сумма всех зарплат"
      />
      <MetricCard
        label="Обязательства"
        :value="money(spent)"
        sub="Жильё, долги, цели"
      />
      <MetricCard
        label="Свободный остаток"
        :value="money(free)"
        :trend="pct(free, income) + '%'"
        :trend-positive="free >= 0"
        :sub="free >= 0 ? 'Доступно в казну' : 'Дефицит бюджета'"
      />
    </div>

    <!-- Emergency Cushion Banner -->
    <EmergencyBanner
      :months="cushion"
      :cash="liquid"
      :monthly-mandatory="mandatory"
    />

    <!-- Freed Money Alert -->
    <div
      v-if="freed && freed.change"
      class="rounded-2xl border border-brand bg-surface p-4 shadow-xs"
    >
      <div class="mb-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-brand">
        С {{ monthFrom(freed.change.from, false) }}
      </div>
      <h3 class="mb-1 font-display text-[18px] font-semibold tracking-[-0.01em] text-ink">
        Освободится {{ money(Math.abs(freed.change.delta)) }} в месяц
      </h3>
      <p class="mb-3 text-[12.5px] leading-relaxed text-ink-2">
        {{ freed.o.name }} снизится с {{ plain(amountAt(freed.o, key)) }} до {{ plain(freed.change.amount) }} ₸.
        За год это {{ money(Math.abs(freed.change.delta) * 12) }} — решите заранее, куда они пойдут.
      </p>
      <Button class="w-full" @click="router.push('/ritual')">
        Распределить в ритуале
      </Button>
    </div>

    <!-- Deficit Warning Callout -->
    <Callout v-if="free < 0" title="План пока не сходится">
      Расписано на {{ money(-free) }} больше, чем приходит.
      {{
        people.length < 2
          ? ' Скорее всего, доход партнёра ещё не внесён — пригласите второго участника.'
          : ' Уменьшите необязательные траты в «Бюджете», и баланс сойдётся.'
      }}
    </Callout>

    <!-- Section: До зарплаты -->
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
          {{ paydayInfo.who.name }} получит <b class="num text-ink">{{ money(paydayInfo.income) }}</b>
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
              <span class="ml-auto shrink-0 num font-medium text-ink">{{ plain(d.value) }}</span>
            </div>
          </div>
        </div>

        <div
          v-if="paydayInfo.knowsCash"
          :class="[
            'mt-3 rounded-xl border p-3 text-[12.5px] leading-relaxed',
            paydayInfo.shortfall >= 0
              ? 'border-brand bg-brand-soft text-ink-2'
              : 'border-warn-line bg-warn-soft text-ink-2',
          ]"
        >
          <template v-if="paydayInfo.shortfall >= 0">
            На счетах {{ plain(paydayInfo.onAccounts) }} ₸ — хватает, остаётся {{ plain(paydayInfo.shortfall) }} ₸.
          </template>
          <template v-else>
            На счетах {{ plain(paydayInfo.onAccounts) }} ₸ — не хватает {{ plain(-paydayInfo.shortfall) }} ₸. Перенесите платёж или пополните счёт.
          </template>
        </div>
        <p v-else class="mt-3 text-[12px] leading-relaxed text-ink-3">
          Остаток на картах не заведён. Добавьте счёт в разделе «Капитал», чтобы видеть точный баланс.
        </p>
      </Card>
    </template>

    <!-- Section: Впереди (Календарь списаний) -->
    <Section title="Впереди">
      <template #action>
        <RouterLink to="/budget" class="text-[13px] font-medium text-brand hover:underline">
          Календарь
        </RouterLink>
      </template>
    </Section>

    <Card flush>
      <template v-if="upcoming.length">
        <Row
          v-for="u in upcoming"
          :key="u.id"
          :accent="u.color"
          :title="u.name"
          :note="`${dayLabel(u.day, key)} · ${u.note}`"
          :value="money(u.value)"
          :sub="u.estimate ? 'оценка' : undefined"
          clickable
          @click="router.push(u.to)"
        >
          <template #icon>
            <PhClock :size="17" />
          </template>
        </Row>
      </template>
      <div v-else class="p-4 text-center text-[13px] text-ink-3">
        Ближайших списаний нет
      </div>
    </Card>

    <!-- Section: Цели -->
    <Section title="Цели">
      <template #action>
        <RouterLink to="/goals" class="text-[13px] font-medium text-brand hover:underline">
          Все
        </RouterLink>
      </template>
    </Section>

    <div class="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
      <template v-if="goals.length">
        <div
          v-for="g in goals"
          :key="g.id"
          class="w-[145px] shrink-0 rounded-2xl border border-line bg-surface p-3.5 shadow-xs cursor-pointer hover:border-line-strong transition-all"
          @click="router.push('/goals')"
        >
          <Ring
            :progress="g.need ? g.have / g.need : 0"
            :plan="g.planPct"
            :hue="g.hue"
            :size="44"
          />
          <div class="mt-2 text-[13px] font-medium text-ink leading-tight truncate">
            {{ g.name }}
          </div>
          <div class="mt-0.5 text-[11.5px] text-ink-3 num">
            {{ Math.round((g.need ? g.have / g.need : 0) * 100) }}% · {{ plain(g.have) }}
          </div>
        </div>
      </template>

      <div
        v-else
        class="flex w-full items-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4 cursor-pointer hover:bg-surface-2 transition-colors"
        @click="router.push('/goals')"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-ink-2">
          <PhPlus :size="18" weight="bold" />
        </span>
        <span class="text-[13px] leading-snug text-ink-2">
          Целей пока нет. Добавьте первую — приложение посчитает, сколько откладывать.
        </span>
      </div>
    </div>
  </div>
</template>
