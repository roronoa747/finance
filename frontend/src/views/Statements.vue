<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhFileArrowUp } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import { buttonVariants } from '@/components/ui/button'
import Input from '@/components/ui/Input.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import Chip from '@/components/kit/Chip.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Select from '@/components/kit/Select.vue'
import Tag from '@/components/kit/Tag.vue'
import WeekCard from '@/components/kit/WeekCard.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import type { MatchCandidate } from '@/lib/statements/matching'
import { matchKey } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore, type Draft, type DraftFile } from '@/stores/operations'
import { money, parseMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { dayLabel, monthFrom, monthKey, monthTitle, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { DEFAULT_SPEND_CATEGORIES, UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, picture, pictureTotal, ruleMatchOf, unknownGroups, type UnknownGroup } from '@/lib/statements/model'
import { parseStatement, StatementFormatError } from '@/lib/statements/parsers'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  allocationFor,
  keepCard,
  keepQuestions,
  monthEndAsk,
  salaryOpen,
  spendCategoryName,
  spendRows,
  untilPayday,
  weekPicture,
  weekTag,
  weekVersusPrev,
} from '@/lib/finance'
import { readMonthEnd, writeMonthEnd } from '@/lib/storage'

/**
 * «Неделя» (DESIGN.md §2 g2, §3; B2C-07 → B2C-21): что за неделя и кто загрузил, загрузка и
 * предпросмотр, решения по одному (сопоставления Р-6, незнакомые продавцы, «оставить подписку?»,
 * «остались деньги?»), «пришла зарплата — разложить?» → `/week/salary`, итог недели по выпискам
 * обоих, «без выписки <имя>», разделы за неделю и месяц, прошлые недели, загрузки семьи. Файл
 * разбирается на телефоне и никуда не уходит (Р-4); считает `finance.ts` / `lib/statements`.
 */
const auth = useAuthStore()
const finance = useFinanceStore()
const store = useOperationsStore()
const route = useRoute()
const router = useRouter()

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom' }
const INTERNAL = '__internal'
const PERSON = '__person'
const TOP_CHIPS = 6

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadBox = ref<HTMLElement | null>(null)
const openCategory = ref<string | null>(null)
const personFor = ref<string | null>(null)
const personText = ref('')

const categories = computed(() => {
  const list = finance.householdDoc.spendCategories?.filter((c) => !c.deletedAt)
  return (list?.length ? list : DEFAULT_SPEND_CATEGORIES).slice().sort((a, b) => a.order - b.order)
})
const categoryName = (id: string) => spendCategoryName(categories.value, id)
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (slot: string) => people.value.find((p) => p.id === slot)?.name ?? 'Участник'
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

/* ---------- черновик (предпросмотр) ---------- */
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const unknown = computed(() => unknownGroups(store.draftOps))
const dismissedHints = ref<string[]>([])
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules).filter((h) => !dismissedHints.value.includes(h.counterparty)))

/* ---------- неделя и месяц ---------- */
const week = weekKey()
const month = monthKey()
const spendTotals = computed(() => finance.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const pic = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week, store.uploads))
const hasUploads = computed(() => store.uploads.length > 0)
// Шапка и тег недели — те же, что на главном (`weekRangeLabel`, `weekTag`).
const weekTitle = computed(() => `Эта неделя · ${weekRangeLabel(pic.value.range)}`)
const picTag = computed(() => weekTag(pic.value, people.value.length))
const weekSegments = computed(() => pic.value.rows.map((r) => ({ id: r.categoryId, name: r.name, amount: r.amount, share: r.share, color: r.color })))
// Итог недели против прошлой (§6): «на N % меньше прошлой» / «больше».
const weekTotalOf = (key: string) => spendRows(spendTotals.value, [], { kind: 'week', period: key }).total
const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
const versusPrev = computed<{ text: string; tone: 'ok' | 'warn' | 'neutral' } | null>(() => {
  const vs = weekVersusPrev(spendTotals.value, week, prevWeek)
  if (!vs) return null
  const { delta } = vs
  if (delta === 0) return { text: 'как на прошлой', tone: 'neutral' }
  return delta < 0 ? { text: `на ${-delta} % меньше прошлой`, tone: 'ok' } : { text: `на ${delta} % больше прошлой`, tone: 'warn' }
})
const missing = computed(() => pic.value.missing.map((p) => p.name))
const mineThisWeek = computed(() => {
  const { from, to } = pic.value.range
  return store.uploads.some((u) => u.slot === me.value && u.period_to >= from && u.period_from <= to)
})
// Разделы за неделю и месяц по итогам обоих (B2C-07): раскрытие — свои продавцы раздела и раздел задним числом.
// Таблица — за «Подробнее» (правило 12: расчёты свёрнуты, `<details>` как у цели), главный поток — итог недели.
const rows = computed(() => picture(spendTotals.value, week, month))
const totals = computed(() => pictureTotal(rows.value))
const monthOps = computed(() => store.all.filter((o) => o.date.startsWith(month)))
const openGroups = computed(() =>
  openCategory.value === null ? [] : unknownGroups(monthOps.value, openCategory.value === UNKNOWN_CATEGORY ? null : openCategory.value),
)
// Прошлые недели — итоги обоих, четыре назад.
const pastWeeks = computed(() =>
  [1, 2, 3, 4]
    .map((i) => weekKey(new Date(Date.now() - i * 7 * 86_400_000)))
    .map((key) => ({ key, label: weekRangeLabel(weekRange(key)), total: weekTotalOf(key) }))
    .filter((w) => w.total > 0),
)

/* ---------- решения по одному ---------- */
const groupKey = (g: UnknownGroup) => JSON.stringify(g.match)

// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве; раскладка остатка месяца
// в общем документе (её ключ — на семью) — тоже ответ: партнёр второй раз не спрашивается.
const answeredLocal = ref<string | null>(readMonthEnd())
const answeredMonthEnd = computed(() =>
  allocationFor(finance.allocations, { source: 'rest', sourceId: month, period: month }) ? month : answeredLocal.value,
)
// «Разложить» с главного (`/week?rest=1`) — карточка остатка первой; после ответа — обычная очередь.
const restFirst = computed(() => route.query.rest === '1' && canUpload.value && monthEndAsk(answeredMonthEnd.value))

// 1. Сопоставления с отметками (Р-6, B2C-15).
const deferredMatches = ref<string[]>([])
const matchQueue = computed(() => store.pendingMatches.filter((c) => !deferredMatches.value.includes(matchKey(c))))
const match = computed<MatchCandidate | null>(() => (canUpload.value && !restFirst.value ? (matchQueue.value[0] ?? null) : null))
const matchActions = computed(() =>
  match.value?.kind === 'salary'
    ? { primary: 'Да, зарплата', secondary: 'Нет', ghost: 'Потом' }
    : { primary: 'Да, отметить', secondary: 'Нет, это другое', ghost: 'Потом' },
)
function deferMatch(c: MatchCandidate) {
  deferredMatches.value = [...deferredMatches.value, matchKey(c)]
}

// 2. Незнакомые продавцы месяца — по одному; чипы разделов, «Ещё N», «Кому → что», «Между своими».
const deferredUnknown = ref<string[]>([])
const skipUnknown = ref(false)
const unknownQueue = computed(() => (canUpload.value && !skipUnknown.value ? unknownGroups(monthOps.value).filter((g) => !deferredUnknown.value.includes(groupKey(g))) : []))
const unknownCard = computed(() => (match.value || restFirst.value ? null : (unknownQueue.value[0] ?? null)))
const unknownTotal = computed(() => unknownGroups(monthOps.value).length)
const moreChips = ref(false)
const chipCategories = computed(() => (moreChips.value ? categories.value : categories.value.slice(0, TOP_CHIPS)))
const lastDate = (g: UnknownGroup) => {
  const last = monthOps.value
    .filter((o) => {
      const m = ruleMatchOf(o)
      return m.merchant === g.match.merchant && m.counterparty === g.match.counterparty
    })
    .map((o) => o.date)
    .sort()
    .at(-1)
  return last ? dayLabel(Number(last.slice(8, 10)), last.slice(0, 7)) : ''
}
const unknownMeta = (g: UnknownGroup) => `${g.count} раз · ${money(g.amount)}${lastDate(g) ? ` · последний — ${lastDate(g)}` : ''}`
function deferUnknown(g: UnknownGroup) {
  deferredUnknown.value = [...deferredUnknown.value, groupKey(g)]
  personFor.value = null
}

// 3. «Оставить подписку?» (Р-20) — по правилам keepQuestions; «Подумать» — до следующего открытия.
// Тексты и «за год» — `keepCard`, как на главном: у годовой — цена продления, «N % пути до мечты».
const deferredKeep = ref<string[]>([])
const keep = computed(() =>
  canUpload.value && !match.value && !unknownCard.value && !restFirst.value
    ? (keepQuestions(finance.obligations).find((o) => !deferredKeep.value.includes(o.id)) ?? null)
    : null,
)
const keepText = computed(() => (keep.value ? keepCard(keep.value, finance.goals, finance.payments) : null))
const cancelling = ref(false)
function onKeep(action: 'keep' | 'cancel' | 'later') {
  const o = keep.value
  if (!o) return
  if (action === 'later') {
    deferredKeep.value = [...deferredKeep.value, o.id]
    cancelling.value = false
    return
  }
  if (action === 'cancel') {
    if (!cancelling.value) {
      cancelling.value = true
      return
    }
    finance.removeObligation(o.id)
  } else finance.keepSubscription(o.id)
  cancelling.value = false
}

// 4. «Остались деньги?» — последние дни месяца (ответ — `answeredMonthEnd` выше).
const monthEnd = computed(
  () => restFirst.value || (canUpload.value && !match.value && !unknownCard.value && !keep.value && monthEndAsk(answeredMonthEnd.value)),
)
const restAmount = ref('')
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (go && amount > 0) void router.push(`/week/salary?from=rest&amount=${amount}&period=${month}`)
}

// «Пришла зарплата <имя> — разложить?» (RP-10): ближайшая зарплата — своя, её день настал или близко.
const paydayInfo = computed(() =>
  untilPayday({ people: finance.people, obligations: finance.obligations, credits: finance.credits, accounts: finance.householdAccounts, payments: finance.payments }),
)
const salaryHere = computed(() => {
  const info = paydayInfo.value
  if (!info || auth.isViewer || auth.slot !== info.who.id) return false
  return salaryOpen(info.who, finance.payments, info.key)
})

/* ---------- ответы разбора ---------- */
const options = (g: UnknownGroup) => [
  { value: '', label: 'Раздел…' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
  { value: INTERNAL, label: 'Внутренний перевод — не трата' },
  ...(g.match.counterparty ? [{ value: PERSON, label: 'Кому → что…' }] : []),
]

function ruleTarget(value: string): MerchantRule['to'] | null {
  if (!value) return null
  if (value === INTERNAL) return { internal: true }
  return { categoryId: value }
}

function choose(g: UnknownGroup, value: string, retro = false) {
  if (value === PERSON) {
    personFor.value = groupKey(g)
    personText.value = ''
    return
  }
  const to = ruleTarget(value)
  if (!to) return
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
  moreChips.value = false
}

function savePerson(g: UnknownGroup, retro = false) {
  const what = personText.value.trim()
  if (!what) return
  const to = { person: what }
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
  personFor.value = null
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  const ok: DraftFile[] = []
  const errors: Draft['errors'] = []
  try {
    for (const f of files) {
      let stage = 'загрузка'
      try {
        // pdf.js — ленивым чанком, только когда выбрали файл; сбой загрузки чанка (вышла новая
        // версия, старого чанка на сервере нет) — тоже ошибка файла, а не тишина.
        const { pdfToRows } = await import('@/lib/statements/pdf')
        stage = 'pdf.js'
        const rows = await pdfToRows(await f.arrayBuffer())
        stage = 'разбор'
        ok.push({ name: f.name, parsed: parseStatement(rows) })
      } catch (err) {
        if (err instanceof StatementFormatError) {
          errors.push({ name: f.name, message: err.code === 'empty' ? 'В файле не нашлось операций' : 'Пока понимаю выписки Kaspi и Freedom' })
          continue
        }
        // Тип и текст ошибки движка или pdf.js — без содержимого выписки.
        console.error('Разбор выписки:', err)
        const detail = `${stage} — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 160)
        errors.push({ name: f.name, message: 'Не получилось прочитать файл', detail })
      }
    }
    store.setDraft(ok, errors)
  } finally {
    reading.value = false
    input.value = ''
  }
}

onMounted(() => {
  void store.loadUploads()
  void store.pull()
  // «Загрузить выписку» из листа «+» (`/week?upload=1`, B2C-13): окно выбора файла браузер
  // открывает только по нажатию — подводим к кнопке и ставим на неё фокус.
  if (route.query.upload === '1') uploadBox.value?.querySelector('button')?.focus()
})
</script>

<template>
  <div class="flex flex-col gap-3.5 pt-1 text-left">
    <p v-if="auth.isDemo" class="px-1 text-[12px] text-ink-3">демо: только на этом телефоне</p>

    <!-- РАЗБОР: предпросмотр → вопросы → отправка -->
    <template v-if="store.draft">
      <Section title="Разбор" />
      <Card v-for="f in store.draft.files" :key="f.name" tight class="text-[13.5px] text-ink-2">
        <b class="font-semibold text-ink">{{ BANKS[f.parsed.bank] }}</b>
        · {{ shortDate(f.parsed.from) }}–{{ shortDate(f.parsed.to) }}
        · {{ f.parsed.operations.length }} операций
        <span v-if="f.parsed.skippedForeign" class="block text-[12.5px] text-ink-3">
          В валюте — {{ f.parsed.skippedForeign }}: их пока не считаем.
        </span>
      </Card>
      <Callout v-for="e in store.draft.errors" :key="e.name" tone="warn" role="alert">
        {{ e.name }}: {{ e.message }}
        <span v-if="e.detail" class="mt-1 block break-all text-[11.5px] text-ink-3">{{ e.detail }}</span>
      </Callout>

      <template v-if="store.draftOps.length">
        <Card tight class="text-[13.5px]">
          <div class="flex justify-between"><span class="text-ink-2">Операций</span><b class="num text-ink">{{ summary.total }}</b></div>
          <p v-if="summary.already" class="mt-1 text-[12.5px] text-ink-3">
            {{ summary.already === summary.total ? `Все ${summary.total} уже были — ничего не удвоится` : `Из них уже были: ${summary.already}` }}
          </p>
          <p v-if="store.draftAutoMatches.length" class="mt-1 text-[12.5px] text-ink-3">
            Отметится по выписке: {{ store.draftAutoMatches.length }} — платежи, которые вы уже подтверждали.
          </p>
          <div class="mt-2 flex justify-between"><span class="text-ink-2">Списания</span><span class="num text-ink">{{ money(summary.spent) }}</span></div>
          <div class="flex justify-between"><span class="text-ink-2">Поступления</span><span class="num text-ink">{{ money(summary.received) }}</span></div>
          <div class="flex justify-between"><span class="text-ink-2">Между своими</span><span class="num text-ink-3">{{ money(summary.internal) }}</span></div>
        </Card>

        <!-- Подсказка о партнёре (DESIGN.md §6) — тихие кнопки: главная в разборе одна, «Отправить» -->
        <DecisionCard
          v-for="h in hints"
          :key="h.counterparty"
          question="Это перевод партнёру?"
          :meta="`«${h.label}» — похоже, это ${personName(h.person)}. Тогда переводы между вами — не траты.`"
          :actions="{ secondary: `Да, это ${personName(h.person)}`, ghost: 'Нет' }"
          @secondary="store.answer({ counterparty: h.counterparty }, { internal: true })"
          @ghost="dismissedHints = [...dismissedHints, h.counterparty]"
        />

        <template v-if="unknown.length">
          <Section title="Незнакомое — куда отнести" />
          <Card flush>
            <div v-for="g in unknown" :key="groupKey(g)" class="border-b border-line px-3.5 py-3 last:border-b-0">
              <div class="mb-2 flex items-baseline justify-between gap-2 text-[13.5px]">
                <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                <span class="shrink-0 num text-ink-2">{{ g.count }} · {{ money(g.amount) }}</span>
              </div>
              <Select model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v)" />
              <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
                <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
                <Button size="sm" @click="savePerson(g)">Запомнить</Button>
              </div>
            </div>
          </Card>
          <p class="px-1 text-[12px] text-ink-3">Можно пропустить — останется «не разобрано».</p>
        </template>
      </template>

      <div class="flex gap-2">
        <Button v-if="store.draftOps.length" class="flex-1" @click="store.send()">Отправить</Button>
        <Button variant="outline" class="flex-1" @click="store.cancelDraft()">Отмена</Button>
      </div>
    </template>

    <!-- НЕДЕЛЯ -->
    <template v-else>
      <Section :title="weekTitle">
        <template v-if="picTag" #action>
          <Tag :tone="picTag.tone">{{ picTag.text }}</Tag>
        </template>
      </Section>

      <!-- Загрузка: своей выписки за неделю ещё нет — карточка-приглашение; есть — кнопка -->
      <template v-if="canUpload">
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <div ref="uploadBox">
          <Card v-if="!mineThisWeek" tight class="border-brand">
            <b class="block text-[15px] font-semibold text-ink">Ваша выписка ещё не загружена</b>
            <p class="mt-0.5 text-[13px] text-ink-2">PDF из приложения Kaspi или Freedom. Разбор на телефоне, файл никуда не уходит.</p>
            <!-- Ниже карточка решения со своей главной кнопкой — загрузка тихая (одна брендовая на экране) -->
            <Button class="mt-3 w-full" :variant="match || keep || monthEnd ? 'secondary' : 'default'" :disabled="reading" @click="fileInput?.click()">
              <PhFileArrowUp :size="16" />
              {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
            </Button>
          </Card>
          <template v-else>
            <Button variant="secondary" class="w-full" :disabled="reading" @click="fileInput?.click()">
              <PhFileArrowUp :size="16" />
              {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
            </Button>
            <p class="mt-1.5 px-1 text-[12px] text-ink-3">PDF из приложения Kaspi или Freedom. Файл остаётся на телефоне.</p>
          </template>
        </div>
      </template>
      <Callout v-if="store.pendingCount" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>
      <Callout v-if="store.lastAutoMarked" tone="ok">Отмечено по выписке: {{ store.lastAutoMarked }} — снять можно в «Деньгах».</Callout>

      <!-- Решения по одному (DESIGN.md §5): сопоставление → незнакомый продавец → подписка → остаток месяца -->
      <DecisionCard
        v-if="match"
        :question="match.question"
        :meta="match.meta"
        :progress="matchQueue.length > 1 ? { n: 1, k: matchQueue.length } : null"
        :actions="matchActions"
        @primary="store.acceptMatch(match)"
        @secondary="store.declineMatch(match)"
        @ghost="deferMatch(match)"
      />

      <DecisionCard
        v-else-if="unknownCard"
        :question="`${unknownCard.label} — куда отнести?`"
        :meta="unknownMeta(unknownCard)"
        :progress="unknownTotal > 1 ? { n: unknownTotal - unknownQueue.length + 1, k: unknownTotal } : null"
        :actions="{ ghost: 'Потом', secondary: unknownQueue.length > 1 ? 'Пропустить все' : undefined }"
        @ghost="deferUnknown(unknownCard)"
        @secondary="skipUnknown = true"
      >
        <template #chips>
          <Chip v-for="c in chipCategories" :key="c.id" @click="choose(unknownCard, c.id, true)">{{ c.name }}</Chip>
          <Chip v-if="!moreChips && categories.length > TOP_CHIPS" quiet @click="moreChips = true">Ещё {{ categories.length - TOP_CHIPS }} ▾</Chip>
          <Chip v-if="unknownCard.match.counterparty" quiet @click="choose(unknownCard, PERSON, true)">Кому → что</Chip>
          <Chip quiet @click="choose(unknownCard, INTERNAL, true)">Между своими</Chip>
        </template>
        <template v-if="personFor === groupKey(unknownCard)" #inner>
          <div class="flex gap-2">
            <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
            <Button size="sm" @click="savePerson(unknownCard, true)">Запомнить</Button>
          </div>
        </template>
        <p class="text-[12px] text-ink-3">Ответ запомним — следующие выписки разложатся сами. Снять можно в настройках.</p>
      </DecisionCard>

      <DecisionCard
        v-else-if="keep && keepText"
        :question="keepText.question"
        :meta="keepText.meta"
        :actions="cancelling ? { primary: 'Отменить подписку', ghost: 'Не сейчас' } : { primary: 'Оставить', secondary: 'Отписаться', ghost: 'Подумать' }"
        @primary="onKeep(cancelling ? 'cancel' : 'keep')"
        @secondary="onKeep('cancel')"
        @ghost="cancelling ? (cancelling = false) : onKeep('later')"
      >
        <template #inner>{{ keepText.inner }}</template>
      </DecisionCard>

      <DecisionCard
        v-else-if="monthEnd"
        question="Остались деньги?"
        :meta="`Конец ${monthFrom(month, false)} — остаток разложим в мечты`"
        :actions="{ primary: 'Разложить', ghost: 'Нет' }"
        :disabled="false"
        @primary="answerRest(true)"
        @ghost="answerRest(false)"
      >
        <template #inner>
          <NumField v-model="restAmount" placeholder="50 000" aria-label="Сколько осталось, ₸" />
        </template>
      </DecisionCard>

      <!-- Пришла зарплата — разложить (RP-10) -->
      <Card v-if="salaryHere && paydayInfo" class="border-brand">
        <h3 class="type-h3 text-ink">Пришла зарплата {{ paydayInfo.who.name }} — разложить?</h3>
        <p class="mt-0.5 text-[13px] text-ink-2">{{ money(paydayInfo.income) }} · отметьте — и разложим свободное по мечтам.</p>
        <SalaryRow button :person-id="paydayInfo.who.id" :period="paydayInfo.key" />
      </Card>

      <!-- Итог недели -->
      <WeekCard
        v-if="hasUploads"
        :total="pic.total"
        :tag="versusPrev"
        :segments="weekSegments"
        :unknown="pic.unknown"
        :unknown-share="pic.unknownShare"
        :rows="5"
      />
      <EmptyState v-else title="Картины недели пока нет" text="Загрузите первую выписку — картина появится здесь." />
      <p v-if="hasUploads && missing.length" class="px-1 text-[12.5px] text-ink-3">За эту неделю без выписки {{ missing.join(', ') }}.</p>

      <!-- Разделы за неделю и месяц — за «Подробнее» (правило 12); раскрытие — свои продавцы и раздел задним числом -->
      <details v-if="rows.length">
        <summary :class="cn(buttonVariants({ variant: 'ghost' }), 'flex w-full list-none [&::-webkit-details-marker]:hidden')">Подробнее: по разделам</summary>
        <Card flush class="mt-2">
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-3.5 py-2 text-[12px] text-ink-3">
            <span>Раздел</span><span class="w-[86px] text-right">Неделя</span><span class="w-[96px] text-right">{{ monthTitle(month).split(' ')[0] }}</span>
          </div>
          <template v-for="r in rows" :key="r.categoryId">
            <button
              type="button"
              class="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 px-3.5 py-2 text-left text-[13.5px] cursor-pointer hover:bg-surface-2"
              @click="openCategory = openCategory === r.categoryId ? null : r.categoryId"
            >
              <span :class="r.categoryId === UNKNOWN_CATEGORY ? 'text-ink-3' : 'text-ink'">{{ categoryName(r.categoryId) }}</span>
              <span class="w-[86px] text-right num text-ink-2">{{ r.week ? money(r.week) : '—' }}</span>
              <span class="w-[96px] text-right num text-ink">{{ money(r.month) }}</span>
            </button>
            <div v-if="openCategory === r.categoryId" class="flex flex-col gap-2 border-y border-line bg-surface-2 px-3.5 py-3">
              <p v-if="!openGroups.length" class="text-[12.5px] text-ink-3">Здесь только ваши траты — у партнёра они в его телефоне.</p>
              <div v-for="g in openGroups" :key="groupKey(g)">
                <div class="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                  <span class="shrink-0 num text-ink-3">{{ money(g.amount) }}</span>
                </div>
                <Select v-if="canUpload" model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v, true)" />
                <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
                  <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
                  <Button size="sm" @click="savePerson(g, true)">Запомнить</Button>
                </div>
              </div>
            </div>
          </template>
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-t border-line px-3.5 py-2 text-[13.5px] font-semibold">
            <span class="text-ink">Всего</span>
            <span class="w-[86px] text-right num text-ink">{{ money(totals.week) }}</span>
            <span class="w-[96px] text-right num text-ink">{{ money(totals.month) }}</span>
          </div>
        </Card>
      </details>

      <!-- Прошлые недели -->
      <template v-if="pastWeeks.length">
        <Section title="Прошлые недели" />
        <Card flush>
          <div v-for="w in pastWeeks" :key="w.key" class="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2.5 text-[13.5px] last:border-b-0">
            <span class="text-ink">{{ w.label }}</span>
            <span class="num text-ink-2">{{ money(w.total) }}</span>
          </div>
        </Card>
      </template>

      <!-- Загрузки семьи -->
      <template v-if="store.uploads.length">
        <Section title="Загрузки" />
        <Card flush>
          <div v-for="u in store.uploads" :key="u.id" class="flex items-baseline justify-between gap-2 border-b border-line px-3.5 py-2.5 text-[13.5px] last:border-b-0">
            <span class="text-ink">{{ personName(u.slot) }} · {{ BANKS[u.bank] ?? u.bank }}</span>
            <span class="num text-ink-3">{{ shortDate(u.period_from) }}–{{ shortDate(u.period_to) }} · {{ u.ops_count }}</span>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
