<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretDown, PhFileArrowUp } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import EmptyState from '@/components/kit/EmptyState.vue'
import NumField from '@/components/kit/NumField.vue'
import Section from '@/components/kit/Section.vue'
import Select from '@/components/kit/Select.vue'
import Tag from '@/components/kit/Tag.vue'
import WeekCard from '@/components/kit/WeekCard.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import CategoryChips from '@/components/CategoryChips.vue'
import type { MatchCandidate } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { money, parseMoney } from '@/lib/money'
import { plural } from '@/lib/utils'
import { monthKey, monthTitle, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, picture, pictureTotal, ruleMatchOf, unknownGroups, type UnknownGroup } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  decisionQueue,
  salaryAllocationPath,
  type Decision,
  liveSpendCategories,
  spendCategoryName,
  spendRows,
  weekPicture,
  weekTag,
  weekVersusPrev,
} from '@/lib/finance'
import { readMonthEnd, writeMonthEnd } from '@/lib/storage'

/**
 * «Неделя» (DESIGN.md §2 g2, §3; B2C-07 → B2C-21): что за неделя и кто загрузил, загрузка и
 * предпросмотр, решения по одному (сопоставления Р-6, незнакомые продавцы, «оставить подписку?»,
 * «остались деньги?», «пришла зарплата?», «разложить?» → `/week/salary`), итог недели по выпискам
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

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadBox = ref<HTMLElement | null>(null)
const openCategory = ref<string | null>(null)
const personFor = ref<string | null>(null)
const personText = ref('')

const categories = computed(() => liveSpendCategories(finance.householdDoc.spendCategories))
const categoryName = (id: string) => spendCategoryName(categories.value, id)
const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (slot: string) => people.value.find((p) => p.id === slot)?.name ?? 'Участник'

/* ---------- черновик (предпросмотр) ---------- */
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const dismissedHints = ref<string[]>([])
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules).filter((h) => !dismissedHints.value.includes(h.counterparty)))

/* ---------- неделя и месяц ---------- */
const week = weekKey()
const month = monthKey()
const spendTotals = computed(() => finance.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const pic = computed(() => weekPicture(spendTotals.value, spendCategories.value, people.value, week, store.uploads))
// Даты недели и чьи выписки — в подписи шапки (`AppShell`, как на главном: `weekRangeLabel`, `weekTag`).
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
const mineThisWeek = computed(() => {
  const { from, to } = pic.value.range
  return store.uploads.some((u) => u.slot === me.value && u.period_to >= from && u.period_from <= to)
})
/** Карточка итога недели: все разделы (g2), «Не разобрано» — сумма недели обоих (разбор — в очереди решений). */
const weekCardProps = computed(() => ({
  total: pic.value.total,
  tag: versusPrev.value,
  segments: weekSegments.value,
  unknown: pic.value.unknown,
  unknownShare: pic.value.unknownShare,
  rows: weekSegments.value.length,
  unknownRow: {},
}))
// Разделы за неделю и месяц по итогам обоих (B2C-07): раскрытие — свои продавцы раздела и раздел задним числом.
// Таблица — за «Подробнее» (правило 12: расчёты свёрнуты, `<details>` как у цели), главный поток — итог недели.
const rows = computed(() => picture(spendTotals.value, week, month))
const totals = computed(() => pictureTotal(rows.value))
const monthOps = computed(() => store.all.filter((o) => o.date.startsWith(month)))
const openGroups = computed(() =>
  openCategory.value === null ? [] : unknownGroups(monthOps.value, openCategory.value === UNKNOWN_CATEGORY ? null : openCategory.value),
)
// Прошлые недели — итоги обоих, четыре назад; подпись — чьи выписки (g2 «обе выписки»).
const pastWeeks = computed(() =>
  [1, 2, 3, 4]
    .map((i) => weekKey(new Date(Date.now() - i * 7 * 86_400_000)))
    .map((key) => ({
      key,
      label: weekRangeLabel(weekRange(key)),
      total: weekTotalOf(key),
      meta: weekTag(weekPicture(spendTotals.value, spendCategories.value, people.value, key, store.uploads), people.value.length)?.text ?? '',
    }))
    .filter((w) => w.total > 0),
)
// Загрузки этой недели — карточка «<имя> · банк · период · N операций» в состоянии «до загрузки» (g2).
const weekUploads = computed(() => {
  const { from, to } = pic.value.range
  return store.uploads.filter((u) => u.period_to >= from && u.period_from <= to)
})
// Загрузка видна, пока своей выписки за неделю нет, и по «+» → «Загрузить выписку» (`?upload=1`);
// в итоге недели её нет (g2 «Неделя — итог»): ещё одна выписка — из листа «+».
const showUpload = computed(() => canUpload.value && (!mineThisWeek.value || route.query.upload === '1'))
const foreign = computed(() => (store.draft?.files ?? []).reduce((a, f) => a + (f.parsed.skippedForeign ?? 0), 0))

/* ---------- решения по одному ---------- */
const groupKey = (g: UnknownGroup) => JSON.stringify(g.match)

// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве (раскладку остатка семьи проверяет очередь).
const answeredLocal = ref<string | null>(readMonthEnd())

// Незнакомые продавцы: в разборе — черновик (ответ — правило до отправки), иначе — месяц (раздел задним числом).
// «Последний — <дата>» — из тех же операций, что и группы (хвост (а) критика Б9).
const unknownOps = computed(() => (store.draft ? store.draftOps : monthOps.value))
const lastOf = (g: UnknownGroup) =>
  unknownOps.value
    .filter((o) => {
      const m = ruleMatchOf(o)
      return m.merchant === g.match.merchant && m.counterparty === g.match.counterparty
    })
    .map((o) => o.date)
    .sort()
    .at(-1)
const skipUnknown = ref(false)
const unknownList = computed(() => (skipUnknown.value ? [] : unknownGroups(unknownOps.value).map((g) => ({ ...g, last: lastOf(g) }))))

/**
 * Одна очередь (Р-43, `decisionQueue`): сопоставление → продавец → подписка → зарплата → «освободится» →
 * «остались деньги?»; на экране — первое неотложенное. В разборе — только продавцы черновика.
 * «Потом» / «Позже» / «Подумать» — до следующего открытия экрана.
 */
const deferred = ref<string[]>([])
const queue = computed(() =>
  decisionQueue(
    { ...finance.householdDoc, credits: finance.credits },
    {
      me: auth.slot,
      canEdit: canUpload.value,
      matches: store.draft ? [] : store.pendingMatches,
      unknown: unknownList.value,
      answeredMonthEnd: answeredLocal.value,
    },
  ).filter((d) => !deferred.value.includes(d.key) && (!store.draft || d.kind === 'unknown')),
)
const decision = computed(() => queue.value[0] ?? null)
const defer = (d: Decision) => {
  deferred.value = [...deferred.value, d.key]
  cancelling.value = false
}

// «N из M»: M — все решения, что были в очереди с открытия экрана (или начала разбора), — не тает при
// ответе; новые (например, «разложить?» после «Да, зарплата») её увеличивают. N — сколько позади + 1.
const seen = ref<string[]>([])
watch(
  [() => queue.value.map((d) => d.key), () => !!store.draft],
  ([keys, draft], prev) => {
    const base = prev && prev[1] !== draft ? [] : seen.value
    seen.value = [...base, ...keys.filter((k) => !base.includes(k))]
  },
  { immediate: true },
)
const progress = computed(() => (seen.value.length > 1 ? { n: seen.value.length - queue.value.length + 1, k: seen.value.length } : null))

/** «Да»: отметка и правило; «Да, зарплата» — сразу раскладка, как после ручного «Пришла» (B2C-21 п. 1). */
function acceptMatch(c: MatchCandidate) {
  void store.acceptMatch(c)
  if (c.kind === 'salary') void router.push(salaryAllocationPath(c.targetId as PersonId, c.period))
}

/** Ответ карточки незнакомого продавца: в разборе — до отправки, в неделе — задним числом. */
function answerUnknown(g: UnknownGroup, to: MerchantRule['to']) {
  if (store.draft) store.answer(g.match, to)
  else void store.recategorize(g.match, to)
}

// «Оставить подписку?» (Р-20): «Отписаться» — шаг подтверждения (`keepCard().cancel`).
const cancelling = ref(false)
function onKeep(d: Decision, action: 'keep' | 'cancel') {
  const o = d.obligation
  if (!o) return
  if (action === 'cancel') {
    if (!cancelling.value) {
      cancelling.value = true
      return
    }
    finance.removeObligation(o.id)
  } else finance.keepSubscription(o.id)
  cancelling.value = false
}

const restAmount = ref('')
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (go && amount > 0) void router.push(`/week/salary?from=rest&amount=${amount}&period=${month}`)
}

/** Главное действие экрана (правило 12): первое решение, иначе — загрузка своей выписки. */
const uploadLead = computed(() => !decision.value)

// Ответы карточки: у продавца — чипы и тихая «Пропустить все» (ещё продавцы в очереди), у подписки — шаг отмены.
const decisionActions = computed(() => {
  const d = decision.value
  if (!d) return null
  if (d.kind === 'keep' && cancelling.value) return d.cancel?.actions ?? null
  if (d.kind === 'unknown') return { ...d.actions, secondary: queue.value.filter((x) => x.kind === 'unknown').length > 1 ? 'Пропустить все' : undefined }
  return d.actions
})
function onPrimary(d: Decision) {
  if (d.kind === 'match' && d.match) acceptMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, cancelling.value ? 'cancel' : 'keep')
  else if (d.kind === 'monthEnd') answerRest(true)
  else if (d.to) void router.push(d.to)
}
function onSecondary(d: Decision) {
  if (d.kind === 'match' && d.match) void store.declineMatch(d.match)
  else if (d.kind === 'keep') onKeep(d, 'cancel')
  else if (d.kind === 'unknown') skipUnknown.value = true
}
function onGhost(d: Decision) {
  if (d.kind === 'keep' && cancelling.value) cancelling.value = false
  else if (d.kind === 'monthEnd') answerRest(false)
  else defer(d)
}

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

/** Ответ в «Разделах за месяц» — всегда задним числом (ответ разбора — `answerUnknown`). */
function choose(g: UnknownGroup, value: string) {
  if (value === PERSON) {
    personFor.value = groupKey(g)
    personText.value = ''
    return
  }
  const to = ruleTarget(value)
  if (to) void store.recategorize(g.match, to)
}

function savePerson(g: UnknownGroup) {
  const what = personText.value.trim()
  if (!what) return
  void store.recategorize(g.match, { person: what })
  personFor.value = null
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  try {
    const { ok, errors } = await readStatementFiles(files)
    store.setDraft(ok, errors)
    deferred.value = []
    skipUnknown.value = false
    // Пришли из «+» — после выбора файла адрес обычный: в итоге недели загрузки снова нет.
    if (route.query.upload === '1') void router.replace('/week')
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

    <!-- РАЗБОР (g2 «Разбор — предпросмотр»): сводка → решения по одному → «Отправить». Банк и период — в шапке. -->
    <template v-if="store.draft">
      <Callout v-for="e in store.draft.errors" :key="e.name" tone="warn" role="alert">
        {{ e.name }}: {{ e.message }}
        <span v-if="e.detail" class="mt-1 block break-all text-[11.5px] text-ink-3">{{ e.detail }}</span>
      </Callout>

      <template v-if="store.draftOps.length">
        <Card class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <span class="type-h3 num text-ink">{{ summary.total }} {{ plural(summary.total, 'операция', 'операции', 'операций') }}</span>
            <Tag v-if="summary.already" tone="neutral">{{ summary.already === summary.total ? 'все уже были' : `${summary.already} уже были` }}</Tag>
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-3 py-3 first:pt-0"><span class="flex-1 font-medium text-ink">Списания</span><span class="money text-ink">{{ money(summary.spent) }}</span></div>
            <div class="flex items-center gap-3 border-t border-line py-3"><span class="flex-1 font-medium text-ink">Поступления</span><span class="money text-ok">{{ money(summary.received) }}</span></div>
            <div class="flex items-center gap-3 border-t border-line py-3">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">Между своими</span><span class="block type-meta">переводы между своими счетами — не траты</span></span>
              <span class="money text-ink-3">{{ money(summary.internal) }}</span>
            </div>
            <div v-if="store.draftAutoMatches.length" class="flex items-center gap-3 border-t border-line py-3">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">Отметится по выписке — {{ store.draftAutoMatches.length }}</span><span class="block type-meta">платежи, которые вы уже подтверждали</span></span>
            </div>
            <div v-if="foreign" class="flex items-center gap-3 border-t border-line py-3 last:pb-0">
              <span class="min-w-0 flex-1"><span class="block font-medium text-ink">В валюте — {{ foreign }}</span><span class="block type-meta">их пока не считаем</span></span>
            </div>
          </div>
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
      </template>
    </template>

    <!-- НЕДЕЛЯ -->
    <template v-else>
      <!-- Загрузка (g2 «Неделя — до загрузки»): своей выписки за неделю ещё нет или пришли из «+» -->
      <template v-if="canUpload">
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <div v-if="showUpload" ref="uploadBox">
          <Card :class="uploadLead ? 'border-brand' : undefined">
            <EmptyState :title="mineThisWeek ? 'Ещё одна выписка' : 'Ваша выписка ещё не загружена'" text="PDF из приложения Kaspi или Freedom. Разбор на телефоне, файл никуда не уходит.">
              <!-- При решении загрузка тихая: брендовое только у главного -->
              <Button :variant="uploadLead ? 'default' : 'secondary'" :disabled="reading" @click="fileInput?.click()">
                <PhFileArrowUp :size="16" />
                {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
              </Button>
            </EmptyState>
          </Card>
        </div>
      </template>
      <Callout v-if="store.pendingCount" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>
      <Callout v-if="store.lastAutoMarked" tone="ok">Отмечено по выписке: {{ store.lastAutoMarked }} — снять можно в «Деньгах».</Callout>
    </template>

    <!-- Одно решение за раз (Р-43): первое из очереди `decisionQueue`; в разборе — продавцы черновика -->
    <DecisionCard
      v-if="decision"
      :key="decision.key"
      lead
      :question="decision.question"
      :meta="decision.meta"
      :progress="progress"
      :actions="decisionActions"
      @primary="onPrimary(decision)"
      @secondary="onSecondary(decision)"
      @ghost="onGhost(decision)"
    >
      <template v-if="decision.kind === 'keep'" #inner>{{ cancelling ? decision.cancel?.inner : decision.inner }}</template>
      <template v-else-if="decision.kind === 'monthEnd'" #inner>
        <NumField v-model="restAmount" placeholder="50 000" aria-label="Сколько осталось, ₸" />
      </template>
      <template v-if="decision.group">
        <CategoryChips :counterparty="!!decision.group.match.counterparty" @choose="(to) => answerUnknown(decision!.group!, to)" />
        <p class="text-[12px] text-ink-3">Ответ запомним — следующие выписки разложатся сами. Снять можно в настройках.</p>
      </template>
      <!-- «Пришла» и лист «ещё» — SalaryRow (RP-10) -->
      <SalaryRow v-if="decision.kind === 'salary' && decision.salary" button :person-id="decision.salary.person.id" :period="decision.salary.period" />
    </DecisionCard>

    <!-- Разбор: одна брендовая «Отправить» и тихая «Отмена» (g2: «Дальше» / «Отмена») -->
    <div v-if="store.draft" class="flex flex-col gap-2 pt-1">
      <Button v-if="store.draftOps.length" size="lg" class="w-full" @click="store.send()">Отправить</Button>
      <Button variant="ghost" class="w-full" @click="store.cancelDraft()">Отмена</Button>
    </div>

    <template v-else>
      <!-- Итог недели -->
      <!-- Итог недели (g2 «Неделя — итог»): все разделы и «Не разобрано» строкой; разделы за месяц с продавцами —
           свёрнуты внутри той же карточки (правило 12). За неделю никто не загружал — карточки итога нет (без «0 ₸»). -->
      <component
        :is="pic.uploaded.length ? WeekCard : Card"
        v-if="pic.uploaded.length || rows.length"
        v-bind="pic.uploaded.length ? weekCardProps : {}"
      >
        <details v-if="rows.length" :class="pic.uploaded.length ? 'border-t border-line pt-3' : ''">
          <summary class="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
            Разделы за {{ monthTitle(month).split(' ')[0].toLowerCase() }}
            <PhCaretDown :size="16" class="shrink-0 text-ink-3" />
          </summary>
          <div class="-mx-5 mt-2">
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-5 py-2 text-[12px] text-ink-3">
            <span>Раздел</span><span class="w-[86px] text-right">Неделя</span><span class="w-[96px] text-right">{{ monthTitle(month).split(' ')[0] }}</span>
          </div>
          <template v-for="r in rows" :key="r.categoryId">
            <button
              type="button"
              class="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 px-5 py-2 text-left text-[13.5px] cursor-pointer hover:bg-surface-2"
              @click="openCategory = openCategory === r.categoryId ? null : r.categoryId"
            >
              <span :class="r.categoryId === UNKNOWN_CATEGORY ? 'text-ink-3' : 'text-ink'">{{ categoryName(r.categoryId) }}</span>
              <span class="w-[86px] text-right num text-ink-2">{{ r.week ? money(r.week) : '—' }}</span>
              <span class="w-[96px] text-right num text-ink">{{ money(r.month) }}</span>
            </button>
            <div v-if="openCategory === r.categoryId" class="flex flex-col gap-2 border-y border-line bg-surface-2 px-5 py-3">
              <p v-if="!openGroups.length" class="text-[12.5px] text-ink-3">Здесь только ваши траты — у партнёра они в его телефоне.</p>
              <div v-for="g in openGroups" :key="groupKey(g)">
                <div class="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                  <span class="shrink-0 num text-ink-3">{{ money(g.amount) }}</span>
                </div>
                <Select v-if="canUpload" model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v)" />
                <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
                  <Input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1" />
                  <Button size="sm" @click="savePerson(g)">Запомнить</Button>
                </div>
              </div>
            </div>
          </template>
          <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-t border-line px-5 pt-2 text-[13.5px] font-semibold">
            <span class="text-ink">Всего</span>
            <span class="w-[86px] text-right num text-ink">{{ money(totals.week) }}</span>
            <span class="w-[96px] text-right num text-ink">{{ money(totals.month) }}</span>
          </div>
          </div>
        </details>
      </component>
      <!-- Viewer, пока за неделю никто не загружал, — пустое состояние; участник видит карточку загрузки выше. -->
      <Card v-if="!pic.uploaded.length && !canUpload"><EmptyState title="Картины недели пока нет" /></Card>

      <!-- Кто уже загрузил за эту неделю (g2 «Неделя — до загрузки»: «Дана · Freedom · 1–21 сентября · 212 операций») -->
      <Card v-if="!mineThisWeek && weekUploads.length" tight>
        <div v-for="u in weekUploads" :key="u.id" class="flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
          <Avatar :id="u.slot || 'c'" :name="personName(u.slot)" :size="34" />
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-ink">{{ personName(u.slot) }}</span>
            <span class="block truncate type-meta">{{ BANKS[u.bank] ?? u.bank }} · {{ weekRangeLabel({ from: u.period_from, to: u.period_to }) }} · {{ u.ops_count }} {{ plural(u.ops_count, 'операция', 'операции', 'операций') }}</span>
          </span>
          <Tag tone="ok">готово</Tag>
        </div>
      </Card>

      <!-- Прошлые недели (g2): даты, чьи выписки, сумма -->
      <template v-if="pastWeeks.length">
        <Section title="Прошлые недели" />
        <Card tight>
          <div v-for="(w, i) in pastWeeks" :key="w.key" class="fx-in flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0" :style="{ '--i': i }">
            <span class="min-w-0 flex-1">
              <span class="block font-medium text-ink">{{ w.label }}</span>
              <span v-if="w.meta" class="block type-meta">{{ w.meta }}</span>
            </span>
            <span class="money whitespace-nowrap text-ink">{{ money(w.total) }}</span>
          </div>
        </Card>
      </template>
    </template>
  </div>
</template>
