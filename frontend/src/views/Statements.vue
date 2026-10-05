<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCaretLeft, PhCaretRight, PhCheck, PhListBullets, PhPlus, PhSquaresFour } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Avatar from '@/components/kit/Avatar.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import NumField from '@/components/kit/NumField.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tag from '@/components/kit/Tag.vue'
import SalaryRow from '@/components/SalaryRow.vue'
import SalaryExchange from '@/components/SalaryExchange.vue'
import UnknownBatch from '@/components/UnknownBatch.vue'
import PlanSwitch from '@/components/plan/PlanSwitch.vue'
import SectionSheet from '@/components/week/SectionSheet.vue'
import UploadsSheet from '@/components/week/UploadsSheet.vue'
import type { MatchCandidate } from '@/lib/statements/matching'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { money, moneyIn, parseMoney, plain } from '@/lib/money'
import { plural } from '@/lib/utils'
import { MONTHS_NOM, addDaysIso, monthKey, parseMonthKey, weekKey, weekRange, weekRangeLabel } from '@/lib/dates'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, unknownGroups } from '@/lib/statements/model'
import { readStatementFiles } from '@/lib/statements/read'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'
import {
  decisionQueue,
  firstWeek,
  myWeek,
  planFromSource,
  prevWeekKey,
  salaryExchange,
  startWeek,
  weekTrend,
  weekUploads,
  type Decision,
  type MyWeekRow,
} from '@/lib/finance'
import { readMonthEnd, readWeekView, writeMonthEnd, writePlanView, writeWeekView, type WeekView } from '@/lib/storage'

/**
 * «План · Неделя» (Блок 15, Р-95…Р-102; макет week-month.html «Неделя — мои траты»): только свои цифры. Верх —
 * одна строка: кружки участников с ✓ «загрузил за неделю» (свой — лист «Мои выписки»), «⊕» загрузки, «! N»
 * вопросов (лист, по одному), вид ☰ / ▦. Ниже — моя сумма недели крупно со сравнением и ‹ › по неделям, разделы — потрачено за
 * неделю и остаток до конца месяца от своей суммы плана (список полосами или плитки с кольцом), нажатие раздела —
 * лист с продавцами и операциями; тренд 8 недель — свёрнут. Цифр партнёра нет: его траты — в «Месяце». Главное
 * действие — «+ Загрузить», пока своей выписки за неделю нет; потом главной кнопки нет (правило 12). Считает
 * `finance.ts` (`myWeek`, `sectionWeek`, `weekTrend`); файл выписки разбирается на телефоне и никуда не уходит (Р-4).
 */
const auth = useAuthStore()
const finance = useFinanceStore()
/** Пришедшая валютная зарплата карточки «Пришла зарплата» (B2C-79): сумма в валюте и «Обменял». */
const fxOf = (d: Decision) => (d.salary ? salaryExchange(finance.payments, finance.fxExchanges, d.salary.person.id, d.salary.period) : null)
const store = useOperationsStore()
const route = useRoute()
const router = useRouter()

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploadButton = ref<HTMLElement | null>(null)

const people = computed(() => finance.people.filter((p) => !p.deletedAt))
const personName = (slot: string) => people.value.find((p) => p.id === slot)?.name ?? 'Участник'

/* ---------- черновик (предпросмотр) ---------- */
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const dismissedHints = ref<string[]>([])
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules).filter((h) => !dismissedHints.value.includes(h.counterparty)))
const foreign = computed(() => (store.draft?.files ?? []).reduce((a, f) => a + (f.parsed.skippedForeign ?? 0), 0))

/* ---------- неделя: моя, листается ‹ › (Р-102) ---------- */
const month = monthKey()
const nowWeek = weekKey()
const spendTotals = computed(() => finance.householdDoc.spendTotals ?? [])
const spendCategories = computed(() => finance.householdDoc.spendCategories ?? [])
const week = ref(startWeek(spendTotals.value, store.uploads, me.value, nowWeek))
// Загрузки приходят с сервера после открытия: пока неделю не листали — открываем ту, за которую есть выписка.
const turned = ref(false)
watch(
  () => store.uploads.length,
  () => {
    if (!turned.value) week.value = startWeek(spendTotals.value, store.uploads, me.value, nowWeek)
  },
)
const first = computed(() => firstWeek(spendTotals.value, me.value))
const canBack = computed(() => first.value !== null && week.value > first.value)
const canForward = computed(() => week.value < nowWeek)
function turn(step: -1 | 1) {
  turned.value = true
  week.value = step < 0 ? prevWeekKey(week.value) : weekKey(addDaysIso(weekRange(week.value).from, 7))
}

/** Мои траты недели — всё из `myWeek`: сумма, сравнение, разделы с остатком (одна дорога с «Месяцем»). */
const mine = computed(() => {
  const { state, ctx } = finance.planInput(month)
  return myWeek(state, { ...ctx, by: me.value, week: week.value, ops: store.all })
})
const restMonth = computed(() => MONTHS_NOM[parseMonthKey(mine.value.month).month].toLowerCase())
const hasPlan = computed(() => mine.value.rows.some((r) => r.plan !== null))
const barShare = (r: MyWeekRow) => (r.plan && r.spent !== null ? Math.max(0, Math.min(100, Math.round((r.spent / r.plan) * 100))) : 0)
const RING = 2 * Math.PI * 17
const letter = (r: MyWeekRow) => (r.categoryId === UNKNOWN_CATEGORY ? '?' : r.name.slice(0, 1).toUpperCase())

/** Строка загрузки (Р-96): кто загрузил выписку за неделю — только ✓, цифр партнёра нет. */
const uploadRows = computed(() => weekUploads(people.value, week.value, store.uploads))
const mineIn = computed(() => uploadRows.value.some((r) => r.person.id === me.value && r.day !== null))

/** Вид — список или плитки (Р-100), на устройстве. */
const view = ref<WeekView>(readWeekView())
function toggleView() {
  view.value = view.value === 'list' ? 'tiles' : 'list'
  writeWeekView(view.value)
}

/** Тренд 8 недель (Р-98) — свёрнут (правило 12). */
const trend = computed(() => weekTrend(spendTotals.value, spendCategories.value, me.value, week.value))
const trendMax = computed(() => Math.max(...trend.value.map((t) => t.amount)))
const trendOpen = ref(false)
const trendDay = (iso: string) => `${Number(iso.slice(8, 10))}.${iso.slice(5, 7)}`

/* ---------- листы: раздел (Р-101) и «Мои выписки» (Р-102) ---------- */
const sectionFor = ref<string | null>(null)
const sectionRow = computed(() => mine.value.rows.find((r) => r.categoryId === sectionFor.value) ?? null)
const uploadsOpen = ref(false)
function pickFile() {
  uploadsOpen.value = false
  fileInput.value?.click()
}
function toMonth() {
  writePlanView('month')
  void router.replace('/month')
}

/* ---------- решения по одному ---------- */
const monthOps = computed(() => store.all.filter((o) => o.date.startsWith(month)))

// «Остались деньги?» (Р-19): ответ — до конца месяца, на устройстве (раскладку остатка семьи проверяет очередь).
const answeredLocal = ref<string | null>(readMonthEnd())

// Незнакомые продавцы — пачкой (Р-58): в разборе — черновик (ответ — правило до отправки), иначе — месяц (раздел задним числом).
const unknownList = computed(() => unknownGroups(store.draft ? store.draftOps : monthOps.value))

/**
 * Одна очередь (Р-43, `decisionQueue`): сопоставление → продавцы пачкой → подписка → зарплата → «освободится» →
 * «остались деньги?»; на экране — первое неотложенное. В разборе — только пачка продавцов черновика.
 * «Потом» / «Позже» / «Подумать» — до следующего открытия экрана.
 */
const deferred = ref<string[]>([])
const queue = computed(() =>
  decisionQueue(
    finance.planInput(month).state,
    {
      me: auth.slot,
      canEdit: canUpload.value,
      matches: store.draft ? [] : store.pendingMatches,
      unknown: unknownList.value,
      answeredMonthEnd: answeredLocal.value,
    },
  ).filter((d) => !deferred.value.includes(d.key) && (!store.draft || d.kind === 'unknownBatch')),
)
const decision = computed(() => queue.value[0] ?? null)
const defer = (d: Decision) => {
  deferred.value = [...deferred.value, d.key]
  cancelling.value = false
}
/** Вопросы — в листе за «! N» (Р-97), по одному; кончились — лист закрывается сам. */
const questionsOpen = ref(false)
watch(
  () => queue.value.length,
  (n) => {
    if (!n && restSaved.value === null) questionsOpen.value = false
  },
)

// «N из M»: M — все решения, что были в очереди с открытия экрана (или начала разбора), — не тает при
// ответе; новые (например, «Пришла зарплата» после «Да, зарплата») её увеличивают. N — сколько позади + 1.
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

/** «Да»: отметка и правило; «Да, зарплата» — следующей карточкой «Пришла зарплата» (B2C-58: разбор одним нажатием). */
function acceptMatch(c: MatchCandidate) {
  void store.acceptMatch(c)
}

/** Ответ пачке — всем отмеченным разом: в разборе — до отправки, в неделе — задним числом одной отправкой. */
function answerBatch(matches: MerchantRule['match'][], to: MerchantRule['to']) {
  if (store.draft) store.answerAll(matches, to)
  else void store.recategorizeAll(matches, to)
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

/**
 * «Остались деньги?» (Р-86): сумма — разово по очереди целей сверху вниз (`planFromSource`), запись своим
 * источником (`rest`); отдельного экрана нет. Класть некуда — ответ просто записан.
 */
const restAmount = ref('')
const restSaved = ref<number | null>(null)
function answerRest(go: boolean) {
  answeredLocal.value = month
  writeMonthEnd(month)
  const amount = parseMoney(restAmount.value)
  if (!go || amount <= 0 || !auth.slot) return
  const { state, ctx } = finance.planInput(month)
  const src = planFromSource(state, { ...ctx, rawCredits: finance.householdDoc.credits }, { from: 'rest', amount, period: month })
  // Остаток месяца уже отложен (партнёр ответил раньше) — второй раз не пишется и «Отложено» не показывается.
  if (!src || src.mode !== 'once' || src.recorded) return
  finance.applyPlan(src, { by: auth.slot, note: 'остаток месяца' })
  restSaved.value = src.put
  setTimeout(() => {
    restSaved.value = null
    if (!queue.value.length) questionsOpen.value = false
  }, 2400)
}

// Ответы карточки: у подписки — шаг отмены.
const decisionActions = computed(() => {
  const d = decision.value
  if (!d) return null
  if (d.kind === 'keep' && cancelling.value) return d.cancel?.actions ?? null
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
}
function onGhost(d: Decision) {
  if (d.kind === 'keep' && cancelling.value) cancelling.value = false
  else if (d.kind === 'monthEnd') answerRest(false)
  else defer(d)
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
    // Пришли из «+» — после выбора файла адрес обычный.
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
  // открывает только по нажатию — ставим фокус на «⊕».
  if (route.query.upload === '1') uploadButton.value?.focus()
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <PlanSwitch v-if="!store.draft" view="week" :dot="finance.planDot" />
    <p v-if="auth.isDemo" class="px-1 text-[12px] text-ink-3">демо: только на этом телефоне</p>
    <input v-if="canUpload" ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />

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

    <!-- НЕДЕЛЯ — мои траты -->
    <template v-else>
      <Callout v-if="store.pendingCount" tone="neutral">{{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.</Callout>
      <Callout v-if="store.lastAutoMarked" tone="ok">Отмечено по выписке: {{ store.lastAutoMarked }} — снять можно в «Месяце».</Callout>

      <!-- Строка загрузки (Р-96): кружки с ✓ · ⊕ · «! N» · вид -->
      <div class="flex items-center gap-2.5" data-week-strip>
        <template v-for="r in uploadRows" :key="r.person.id">
          <button
            v-if="r.person.id === me"
            type="button"
            class="press relative shrink-0 cursor-pointer rounded-full"
            aria-label="Мои выписки"
            :data-uploaded="r.day !== null"
            data-my-uploads
            @click="uploadsOpen = true"
          >
            <Avatar :id="r.person.id" :name="r.person.name" :size="34" :class="r.day === null && 'opacity-35'" />
            <span v-if="r.day !== null" class="absolute -bottom-[3px] -right-[3px] grid size-4 place-items-center rounded-full border-2 border-canvas bg-ok text-surface" aria-hidden="true">
              <PhCheck :size="9" weight="bold" />
            </span>
          </button>
          <span v-else class="relative shrink-0" :title="r.person.name" :data-uploaded="r.day !== null" :data-partner="r.person.id">
            <Avatar :id="r.person.id" :name="r.person.name" :size="34" :class="r.day === null && 'opacity-35'" />
            <span v-if="r.day !== null" class="absolute -bottom-[3px] -right-[3px] grid size-4 place-items-center rounded-full border-2 border-canvas bg-ok text-surface" aria-hidden="true">
              <PhCheck :size="9" weight="bold" />
            </span>
          </span>
        </template>
        <template v-if="canUpload">
          <button
            v-if="!mineIn"
            ref="uploadButton"
            type="button"
            class="press flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill bg-brand text-brand-ink px-4 text-[15px] font-bold disabled:opacity-50"
            :disabled="reading"
            data-upload="lead"
            @click="fileInput?.click()"
          >
            <PhPlus :size="16" weight="bold" />{{ reading ? 'Читаем…' : 'Загрузить' }}
          </button>
          <button
            v-else
            ref="uploadButton"
            type="button"
            class="press grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-full border-2 border-dashed border-ink-3 text-ink-2 disabled:opacity-50"
            aria-label="Загрузить выписку"
            :disabled="reading"
            data-upload="quiet"
            @click="fileInput?.click()"
          >
            <PhPlus :size="16" weight="bold" />
          </button>
        </template>
        <button
          v-if="queue.length"
          type="button"
          class="press ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-pill bg-ok-soft px-[11px] py-1.5 text-[14px] font-bold text-ok num"
          :aria-label="`Вопросы: ${queue.length}`"
          data-bang
          @click="questionsOpen = true"
        >
          <span class="grid size-[18px] place-items-center rounded-full bg-ok text-[12px] text-surface" aria-hidden="true">!</span>{{ queue.length }}
        </button>
        <span v-else class="ml-auto" />
        <button
          type="button"
          class="press grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-[10px] bg-surface-2 text-ink-2"
          :aria-label="view === 'list' ? 'Плитками' : 'Списком'"
          data-view-toggle
          @click="toggleView"
        >
          <PhSquaresFour v-if="view === 'list'" :size="18" />
          <PhListBullets v-else :size="18" />
        </button>
      </div>

      <!-- Сумма недели: моя, крупно; сравнение с прошлой; ‹ › — недели -->
      <component :is="view === 'list' ? Card : 'div'" :tight="view === 'list' ? true : undefined" class="flex flex-col gap-1" :class="view === 'tiles' && 'px-1 pb-0.5 pt-1'" data-week-sum>
        <div class="flex items-center gap-1.5">
          <button type="button" class="press -ml-1.5 grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canBack" aria-label="Прошлая неделя" @click="turn(-1)">
            <PhCaretLeft :size="16" />
          </button>
          <span class="type-section" data-week-label>{{ weekRangeLabel(mine.range) }}</span>
          <button type="button" class="press grid size-7 cursor-pointer place-items-center text-ink-3 disabled:opacity-30" :disabled="!canForward" aria-label="Следующая неделя" @click="turn(1)">
            <PhCaretRight :size="16" />
          </button>
        </div>
        <div class="flex flex-wrap items-baseline gap-2.5">
          <span class="font-num text-[40px] font-bold leading-none num" :class="mine.total ? 'text-ink' : 'text-ink-3'" data-week-total>{{ money(mine.total) }}</span>
          <span
            v-if="mine.total && mine.pct !== null && mine.delta !== 0"
            class="whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[12.5px] font-bold num"
            :class="mine.delta > 0 ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'"
            data-week-delta
          >
            {{ mine.delta > 0 ? '↑' : '↓' }} {{ mine.pct }}%
          </span>
        </div>
        <span v-if="view === 'list' && mine.prev > 0" class="type-meta num" data-week-prev>прошлая неделя — {{ money(mine.prev) }}</span>
        <div v-if="!hasPlan && mine.rows.length" class="pt-1">
          <Button variant="secondary" size="sm" data-to-plan @click="toMonth">План трат — в «Месяце» ›</Button>
        </div>
      </component>

      <!-- Разделы списком: потрачено за неделю, полоса и остаток до конца месяца -->
      <Card v-if="view === 'list' && mine.rows.length" flush class="px-3.5 py-0.5" data-week-list>
        <button
          v-for="r in mine.rows"
          :key="r.categoryId"
          type="button"
          class="press flex w-full cursor-pointer flex-col gap-1.5 border-t border-line py-3 text-left first:border-t-0"
          :data-row="r.categoryId"
          @click="sectionFor = r.categoryId"
        >
          <span class="flex items-center gap-2.5">
            <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">{{ letter(r) }}</span>
            <span class="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">{{ r.name }}</span>
            <span class="w-4 text-center text-[12px] font-extrabold" :class="r.arrow === 'up' ? 'text-warn' : 'text-ok'" :data-arrow="r.arrow ?? ''" aria-hidden="true">
              {{ r.arrow === 'up' ? '↑' : r.arrow === 'down' ? '↓' : '' }}
            </span>
            <span class="font-num text-[16px] font-bold num text-ink" data-amount>{{ plain(r.amount) }}</span>
          </span>
          <template v-if="r.plan !== null && r.rest !== null">
            <span class="ml-[42px] block h-1.5 overflow-hidden rounded-pill bg-track">
              <i class="block h-full rounded-pill" :style="{ width: `${barShare(r)}%`, background: r.low ? 'var(--warn)' : r.color }" />
            </span>
            <span class="ml-[42px] text-[12.5px] text-ink-3 num" data-rest>
              <template v-if="r.rest >= 0">на {{ restMonth }} осталось <b class="font-semibold" :class="r.low ? 'text-warn' : 'text-ink-2'">{{ plain(r.rest) }}</b> из {{ plain(r.plan) }}</template>
              <template v-else>на {{ restMonth }} сверх плана <b class="font-semibold text-warn">{{ plain(-r.rest) }}</b></template>
            </span>
          </template>
          <span v-else-if="hasPlan && r.categoryId !== UNKNOWN_CATEGORY" class="ml-[42px] text-[12.5px] text-ink-3" data-rest>вне плана</span>
        </button>
      </Card>

      <!-- Разделы плитками: кольцо — сколько потрачено от плана месяца -->
      <div v-else-if="view === 'tiles' && mine.rows.length" class="grid grid-cols-2 gap-2.5" data-week-tiles>
        <button
          v-for="r in mine.rows"
          :key="r.categoryId"
          type="button"
          class="press flex min-w-0 cursor-pointer flex-col gap-2 rounded-[22px] border border-card-border bg-surface p-3.5 text-left"
          :data-row="r.categoryId"
          @click="sectionFor = r.categoryId"
        >
          <span class="flex h-11 w-full items-center justify-between">
            <span class="grid size-8 shrink-0 place-items-center rounded-[10px] text-[13px] font-bold text-on-photo" :style="{ background: r.color }" aria-hidden="true">{{ letter(r) }}</span>
            <svg v-if="r.plan !== null" class="size-11" viewBox="0 0 44 44" aria-hidden="true">
              <circle cx="22" cy="22" r="17" fill="none" stroke="var(--track)" stroke-width="6" />
              <circle
                cx="22"
                cy="22"
                r="17"
                fill="none"
                :stroke="r.low ? 'var(--warn)' : r.color"
                stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="`${((RING * barShare(r)) / 100).toFixed(1)} ${RING.toFixed(1)}`"
                transform="rotate(-90 22 22)"
              />
            </svg>
          </span>
          <span class="font-num text-[22px] font-bold leading-none num text-ink" data-amount>{{ plain(r.amount) }}</span>
          <span class="text-[12px] text-ink-3 num">
            {{ r.name }}<span v-if="r.arrow === 'up' || r.arrow === 'down'" :class="r.arrow === 'up' ? 'text-warn' : 'text-ok'"> · {{ r.arrow === 'up' ? '↑' : '↓' }}</span>
            <span v-if="r.plan !== null && r.rest !== null" :class="r.low && 'text-warn'" data-rest> · {{ r.rest >= 0 ? `ост. ${plain(r.rest)}` : `сверх ${plain(-r.rest)}` }}</span>
            <span v-else-if="hasPlan && r.categoryId !== UNKNOWN_CATEGORY" data-rest> · вне плана</span>
          </span>
        </button>
      </div>

      <!-- Тренд 8 недель — свёрнут -->
      <div v-if="trendMax > 0" data-week-trend>
        <button
          type="button"
          class="press flex w-full cursor-pointer items-center justify-between bg-surface px-4 py-3.5 text-left text-[15px] font-semibold text-ink-2"
          :class="trendOpen ? 'rounded-t-[20px]' : 'rounded-[20px]'"
          :aria-expanded="trendOpen"
          @click="trendOpen = !trendOpen"
        >
          <span>8 недель</span>
          <PhCaretRight :size="15" class="text-ink-3 transition-transform" :class="trendOpen && 'rotate-90'" />
        </button>
        <div v-if="trendOpen" class="flex h-[110px] items-end gap-[7px] rounded-b-[20px] bg-surface px-4 pb-3.5 pt-1" data-trend-bars>
          <div v-for="(t, i) in trend" :key="t.week" class="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <em v-if="t.amount > 0 && (i === trend.length - 1 || t.amount === trendMax)" class="text-[10px] not-italic text-ink-3 num">{{ Math.round(t.amount / 1000) }}к</em>
            <i class="block w-full rounded-b-[3px] rounded-t-[6px]" :class="i === trend.length - 1 ? 'bg-brand' : 'bg-surface-3'" :style="{ height: `${Math.round((t.amount / trendMax) * 70)}%` }" />
            <span class="text-[10.5px] text-ink-3 num">{{ trendDay(t.from) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Разбор: незнакомые продавцы черновика — пачкой на экране (Р-58) -->
    <UnknownBatch v-if="store.draft && decision?.kind === 'unknownBatch'" :groups="decision.groups ?? []" :progress="progress" @answer="answerBatch" @later="defer(decision!)" />

    <!-- Вопросы — за «! N» (Р-97): по одному, «N из M», «Потом» откладывает -->
    <Sheet :open="!store.draft && questionsOpen && (!!decision || restSaved !== null)" title="Вопросы" @close="questionsOpen = false">
      <!-- «Остались деньги?» — коротко «Отложено» на месте вопроса -->
      <div v-if="restSaved !== null" class="fx-in flex flex-col gap-1" aria-live="polite" data-rest-saved>
        <span class="type-label">Отложено</span>
        <span class="type-big-md num text-ink">{{ money(restSaved) }}</span>
      </div>

      <!-- Одно решение за раз (Р-43): первое из очереди `decisionQueue`; незнакомые продавцы — пачкой (Р-58) -->
      <UnknownBatch v-else-if="decision?.kind === 'unknownBatch'" bare :groups="decision.groups ?? []" :progress="progress" @answer="answerBatch" @later="defer(decision!)" />
      <DecisionCard
        v-else-if="decision"
        :key="decision.key"
        bare
        :eyebrow="decision.kind === 'allocate'"
        :question="decision.question"
        :meta="decision.kind === 'allocate' ? '' : decision.meta"
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
        <!-- «Пришла зарплата» (макет month-plan.html «Неделя»): сумма, тихое «Обменял»; главное — «К плану месяца» -->
        <template v-if="decision.kind === 'allocate'">
          <span v-if="fxOf(decision)" class="-mt-2.5 flex items-baseline gap-2">
            <span class="type-big num text-ink">{{ moneyIn(fxOf(decision)!.came, fxOf(decision)!.currency) }}</span>
            <span class="type-meta num">≈ {{ money(decision.amount ?? 0) }}</span>
          </span>
          <span v-else class="-mt-2.5 type-big num text-ink">{{ money(decision.amount ?? 0) }}</span>
          <SalaryExchange v-if="decision.salary" :person-id="decision.salary.person.id" :period="decision.salary.period" />
        </template>
        <template v-if="decision.kind === 'allocate'" #actions>
          <div class="flex w-full flex-col gap-1.5">
            <Button class="w-full" @click="onPrimary(decision!)">{{ decision.actions.primary }}</Button>
            <Button variant="ghost" class="w-full" @click="onGhost(decision!)">{{ decision.actions.ghost }}</Button>
          </div>
        </template>
        <!-- «Пришла» и лист «ещё» — SalaryRow (RP-10) -->
        <SalaryRow v-if="decision.kind === 'salary' && decision.salary" button :person-id="decision.salary.person.id" :period="decision.salary.period" />
      </DecisionCard>
    </Sheet>

    <!-- Разбор: одна брендовая «Отправить» и тихая «Отмена» (g2: «Дальше» / «Отмена»; «назад» шапки — то же) -->
    <div v-if="store.draft" class="flex flex-col gap-2 pt-1">
      <Button v-if="store.draftOps.length" size="lg" class="w-full" @click="store.send()">Отправить</Button>
      <Button variant="ghost" class="w-full" @click="store.cancelDraft()">Отмена</Button>
    </div>

    <SectionSheet :row="sectionRow" :week="week" :month-name="restMonth" @close="sectionFor = null" />
    <UploadsSheet :open="uploadsOpen" :me="me" :busy="reading" @close="uploadsOpen = false" @upload="pickFile" />
  </div>
</template>
