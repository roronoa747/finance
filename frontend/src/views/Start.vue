<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCopy, PhFileArrowUp, PhUserPlus } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore, type Draft, type DraftFile } from '@/stores/operations'
import { parseStatement, StatementFormatError } from '@/lib/statements/parsers'
import { ruleFor, ruleMatchOf, periodOf } from '@/lib/statements/model'
import { beyondLimit, firstRunQuestions, type IncomeCandidate, type RecurringCandidate, type RecurringKind } from '@/lib/statements/firstRun'
import { budgetAmounts, spendRows } from '@/lib/finance'
import { money, parseMoney, plain } from '@/lib/money'
import { monthKey, MONTHS_NOM, parseMonthKey } from '@/lib/dates'
import { START_ANSWERED_KEY, readStorage, writeStorage } from '@/lib/storage'
import { useInvite } from '@/components/useInvite'
import type { PersonId } from '@/types/finance'
import GoalNew from '@/views/GoalNew.vue'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import Chip from '@/components/kit/Chip.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import Field from '@/components/kit/Field.vue'
import FreeCard from '@/components/kit/FreeCard.vue'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import Stepper from '@/components/kit/Stepper.vue'
import WeekCard, { type WeekSegment } from '@/components/kit/WeekCard.vue'

/**
 * Первый запуск из выписки (Р-7, DESIGN.md §2 `/start/*`, §6; B2C-19): загрузить выписку →
 * вопросы по одному (доход, повторяющиеся списания — не больше семи) → картина месяца → «На что
 * копим?» (`GoalNew`) → пригласить партнёра → главный. Шаг — в адресе (`/start/:step`), ответы
 * пишутся сразу (§8 п. 7): перезагрузка не теряет ни шаг, ни ответы. Партнёр по коду — только
 * выписка и вопросы про себя. Ничего не считается здесь: `firstRun.ts`, `finance.ts`.
 */
type Step = 'upload' | 'questions' | 'month' | 'dream' | 'invite'
const KEY_ANSWERED = START_ANSWERED_KEY

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const financeStore = useFinanceStore()
const ops = useOperationsStore()

const slot = computed<PersonId>(() => authStore.slot || 'a')
const knownName = computed(() => {
  const existing = financeStore.people.find((p) => p.id === slot.value)
  return existing?.name || authStore.member?.display_name || authStore.user?.email?.split('@')[0] || 'Участник'
})
// Партнёр по коду: семья уже настроена первым участником — от него нужны только свои выписка и доход.
// Считается по `setupDoneAt`, а не по данным: первая же запись дохода сделала бы первого участника «партнёром».
const joining = computed(() => financeStore.setupDone)
const steps = computed<Step[]>(() => (joining.value ? ['upload', 'questions'] : ['upload', 'questions', 'month', 'dream', 'invite']))
const step = computed<Step>(() => {
  const s = String(route.params.step ?? 'upload') as Step
  return steps.value.includes(s) ? s : 'upload'
})
const stepIndex = computed(() => steps.value.indexOf(step.value) + 1)

function go(next: Step) {
  void router.push(`/start/${next}`)
}
function after(current: Step): Step | null {
  const i = steps.value.indexOf(current)
  return steps.value[i + 1] ?? null
}

/* ------------------ Шаг 1: выписка ------------------ */
const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref(false)
const errors = ref<Draft['errors']>([])
const manual = ref(false)
const manualSalary = ref('')
const manualPayday = ref('10')

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  const ok: DraftFile[] = []
  const failed: Draft['errors'] = []
  try {
    for (const f of files) {
      let stage = 'загрузка'
      try {
        const { pdfToRows } = await import('@/lib/statements/pdf')
        stage = 'pdf.js'
        const rows = await pdfToRows(await f.arrayBuffer())
        stage = 'разбор'
        ok.push({ name: f.name, parsed: parseStatement(rows) })
      } catch (err) {
        if (err instanceof StatementFormatError) {
          failed.push({ name: f.name, message: err.code === 'empty' ? 'В файле не нашлось операций' : 'Пока понимаю выписки Kaspi и Freedom' })
          continue
        }
        console.error('Разбор выписки:', err)
        const detail = `${stage} — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`.slice(0, 160)
        failed.push({ name: f.name, message: 'Не получилось прочитать файл', detail })
      }
    }
    errors.value = failed
    if (ok.length) await uploadParsed(ok)
  } finally {
    reading.value = false
    input.value = ''
  }
}

/** Разобранная выписка — тем же путём, что «Неделя» (B2C-07): операции себе, итоги в документ. */
async function uploadParsed(files: DraftFile[]) {
  ops.setDraft(files, [])
  await ops.send()
  go('questions')
}

/** «Введу вручную»: доход и день зарплаты — картины месяца без выписки не будет, дальше к мечте. */
function manualNext() {
  const salary = parseMoney(manualSalary.value)
  if (salary <= 0) return
  financeStore.setPerson(slot.value, { name: knownName.value, salary, payday: clampDay(manualPayday.value, 10) })
  if (joining.value) finish()
  else go('dream')
}

const clampDay = (v: string | number, fallback: number) => Math.min(28, Math.max(1, (typeof v === 'number' ? v : parseMoney(v)) || fallback))

/* ------------------ Шаг 2: вопросы по одному ------------------ */
// Ответы — в документе (доход, обязательства, правила); какие вопросы уже показаны — на устройстве:
// «нет» записи не оставляет, а второй раз спрашивать не надо.
const answered = ref<string[]>(readStorage<string[]>(KEY_ANSWERED, []))
function markAnswered(key: string) {
  if (!answered.value.includes(key)) answered.value = [...answered.value, key]
  writeStorage(KEY_ANSWERED, answered.value)
}

const questions = computed(() => firstRunQuestions(ops.all))
const pending = computed(() =>
  questions.value.filter((q) => {
    const key = q.type === 'income' ? 'income' : q.candidate.key
    if (answered.value.includes(key)) return false
    // Правило уже есть (ответили и перезагрузили до записи ключа) — вопрос закрыт.
    const op = ops.all.find((o) => o.id === q.candidate.opIds[0])
    return !(op && ruleFor(op, financeStore.merchantRules))
  }),
)
const current = computed(() => pending.value[0] ?? null)
const progress = computed(() => ({ n: questions.value.length - pending.value.length + 1, k: questions.value.length }))
const later = computed(() => beyondLimit(ops.all))

const me = computed(() => financeStore.people.find((p) => p.id === slot.value))
const salaryKnown = computed(() => (me.value?.salary ?? 0) > 0)

// Поля карточки — от текущего вопроса: сумма и день дохода правятся, у кредита — остаток «если знаете».
const incomeSalary = ref('')
const incomePayday = ref('')
const recurringKind = ref<RecurringKind>('obligation')
const creditPrincipal = ref('')
watch(
  current,
  (q) => {
    if (!q) return
    if (q.type === 'income') {
      incomeSalary.value = plain(q.candidate.amount)
      incomePayday.value = String(q.candidate.day)
    } else {
      recurringKind.value = q.candidate.kind
      creditPrincipal.value = ''
    }
  },
  { immediate: true },
)

const KINDS: { value: RecurringKind; label: string }[] = [
  { value: 'credit', label: 'Кредит' },
  { value: 'rent', label: 'Аренда' },
  { value: 'utilities', label: 'Коммуналка' },
  { value: 'subscription', label: 'Подписка' },
  { value: 'obligation', label: 'Другое регулярное' },
]
const KIND_NAME: Record<RecurringKind, string | null> = { credit: null, rent: 'Аренда', utilities: 'Коммуналка', subscription: null, obligation: null }
const KIND_BUDGET: Record<RecurringKind, 'd1' | 'd2' | 'd4'> = { credit: 'd2', rent: 'd1', utilities: 'd1', subscription: 'd4', obligation: 'd4' }
const KIND_SPEND: Record<RecurringKind, string | null> = { credit: 'sc_credit', rent: 'sc_rent', utilities: 'sc_utilities', subscription: null, obligation: null }

const incomeMeta = (c: IncomeCandidate) => `${money(c.amount)} · ${c.day}-го · ${c.name}${c.count > 1 ? ` · ${c.count} раз` : ''}`
const recurringMeta = (c: RecurringCandidate) => `${money(c.amount)} · примерно ${c.day}-го${c.count > 1 ? ` · ${c.count} раз за период` : ''}`

/** «Да, это зарплата»: оклад и день — в участника; правило — когда отправитель назван или приход регулярный. */
function answerIncome(yes = true) {
  const q = current.value
  if (!q || q.type !== 'income') return
  if (yes) {
    const salary = parseMoney(incomeSalary.value)
    if (salary <= 0) return
    financeStore.setPerson(slot.value, { name: knownName.value, salary, payday: clampDay(incomePayday.value, q.candidate.day) })
    const op = ops.all.find((o) => o.id === q.candidate.opIds[0])
    if (op && (op.counterparty || q.candidate.regular)) {
      ops.answer(ruleMatchOf(op), { payment: { kind: 'salary', targetId: slot.value } })
      if (periodOf(op.date, 'month') === monthKey()) financeStore.markSalary(slot.value, { period: monthKey(), amount: salary, source: 'statement', opId: op.id })
    }
  }
  markAnswered('income')
  advance()
}

/**
 * «Записать»: кредит с известным остатком — кредит (ставка 0 — «по сроку», уточнят в Капитале);
 * без остатка — обязательство раздела «Кредиты» (кредит с остатком 0 платежа не ждёт). Аренда и
 * коммуналка — жильё, подписки и прочее регулярное — быт. Правило «это платёж по …» отмечает
 * следующие выписки само (Р-6); платёж этого месяца отмечается сразу.
 */
function answerRecurring(save = true) {
  const q = current.value
  if (!q || q.type !== 'recurring') return
  const c = q.candidate
  if (save) {
    const kind = recurringKind.value
    const principal = kind === 'credit' ? parseMoney(creditPrincipal.value) : 0
    let target: { kind: 'obligation' | 'credit'; id: string }
    if (kind === 'credit' && principal > 0) {
      target = { kind: 'credit', id: financeStore.addCredit({ name: c.name, note: 'из выписки', principal, annualRate: 0, payment: c.amount, day: c.day }) }
    } else {
      const name = KIND_NAME[kind] ?? c.name
      const note = kind === 'credit' ? 'платёж по кредиту — остаток и ставку уточните в Капитале' : name !== c.name ? c.name : ''
      target = { kind: 'obligation', id: financeStore.addObligation({ name, note, day: c.day, category: KIND_BUDGET[kind], amount: c.amount, estimate: kind === 'utilities' }) }
    }
    const op = ops.all.find((o) => o.id === c.opIds[0])
    if (op) {
      ops.answer(ruleMatchOf(op), { payment: { kind: target.kind, targetId: target.id, categoryId: KIND_SPEND[kind] ?? c.categoryId } })
      const period = periodOf(op.date, 'month')
      if (period === monthKey()) financeStore.markPaid(target.kind, target.id, slot.value, { period, amount: c.amount, source: 'statement', opId: op.id })
    }
  }
  markAnswered(c.key)
  advance()
}

/** «Потом»: остальные вопросы — позже в «Неделе». */
function skipRest() {
  for (const q of pending.value) markAnswered(q.type === 'income' ? 'income' : q.candidate.key)
  advance()
}

function advance() {
  if (pending.value.length) return
  if (!salaryKnown.value) return // без дохода дальше нельзя — короткая форма ниже
  const next = after('questions')
  if (next) go(next)
  else finish()
}

/** Дохода в выписке не нашлось — впишите: та же короткая форма, что у «Введу вручную». */
function manualAfterQuestions() {
  const salary = parseMoney(manualSalary.value)
  if (salary <= 0) return
  financeStore.setPerson(slot.value, { name: knownName.value, salary, payday: clampDay(manualPayday.value, 10) })
  advance()
}

/* ------------------ Шаг 3: картина месяца ------------------ */
const myTotals = computed(() => (financeStore.householdDoc.spendTotals ?? []).filter((t) => t.by === slot.value && t.kind === 'month' && !t.deletedAt && t.amount > 0))
// Месяц выписки — последний, за который есть итоги (выписку за прошлый месяц грузят в начале нового).
const pictureMonth = computed(() => myTotals.value.map((t) => t.period).sort().pop() ?? monthKey())
const monthName = computed(() => MONTHS_NOM[parseMonthKey(pictureMonth.value).month].toLowerCase())
const spendCategories = computed(() => financeStore.householdDoc.spendCategories ?? [])
// Суммы и доли — `spendRows` (finance.ts), экран только раскладывает строки в полосу.
const picture = computed(() => spendRows(financeStore.householdDoc.spendTotals ?? [], spendCategories.value, { kind: 'month', period: pictureMonth.value, by: slot.value }))
const segments = computed<WeekSegment[]>(() => picture.value.rows.map((r) => ({ id: r.categoryId, name: r.name, amount: r.amount, share: r.share, color: r.color })))
const free = computed(() => budgetAmounts({ ...financeStore.householdDoc, credits: financeStore.credits }).d5)

/* ------------------ Шаг 5: партнёр ------------------ */
const { code: inviteCode, busy: inviteBusy, error: inviteError, copied, make: handleMakeInvite, copy: handleCopy } = useInvite()

/** Семья настроена (или партнёр прошёл своё): участник отмечен, дальше — главный. */
function finish() {
  financeStore.setPerson(slot.value, { name: knownName.value, onboardedAt: new Date().toISOString() })
  if (!joining.value) financeStore.finishSetup()
  void financeStore.syncHousehold()
  void router.push('/')
}

const titles: Record<Step, { title: string; sub: string }> = {
  upload: { title: 'Загрузите первую выписку', sub: 'Приложение само найдёт зарплату, кредиты и подписки — вы только подтвердите.' },
  questions: { title: 'Нашли повторяющиеся', sub: 'Подтвердите по одному — дальше отметим сами.' },
  month: { title: 'Ваш месяц', sub: '' },
  dream: { title: '', sub: '' },
  invite: { title: 'Пригласите партнёра', sub: 'Бюджет общий: у второго будет свой вход и свой доход, а мечты и покупки — одни на двоих.' },
}
const title = computed(() => {
  if (step.value === 'upload') return joining.value ? 'Загрузите свою выписку' : titles.upload.title
  if (step.value === 'questions') return current.value ? `Нашли ${questions.value.length} ${plural(questions.value.length)}` : 'Доход'
  if (step.value === 'month') return `Ваш ${monthName.value}`
  return titles[step.value].title
})
const sub = computed(() => (step.value === 'questions' && !current.value ? 'В выписке зарплата не нашлась — впишите, без неё план месяца не сложится.' : titles[step.value].sub))
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'повторяющийся' : 'повторяющихся')
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-4 px-5 pb-6 pt-5 text-left">
    <Stepper :n="stepIndex" :k="steps.length" />

    <div v-if="title">
      <h1 class="type-h2-lg text-ink">{{ title }}</h1>
      <p v-if="sub" class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{{ sub }}</p>
    </div>

    <!-- Шаг 1: выписка -->
    <template v-if="step === 'upload'">
      <template v-if="!manual">
        <!-- Одна строка + подсказка (правило интерфейса: пояснение длиннее строки — в Hint). -->
        <Callout tone="neutral" icon="lock">
          <span class="inline-flex items-center gap-1.5">Файл остаётся на телефоне <Hint>На сервер попадают только продавец, дата, сумма и раздел — без номеров и ФИО.</Hint></span>
        </Callout>
        <Callout v-for="e in errors" :key="e.name" tone="warn">
          {{ e.name }}: {{ e.message }}<span v-if="e.detail" class="block text-[12px] text-ink-3">{{ e.detail }}</span>
        </Callout>
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <div class="mt-auto flex flex-col gap-2 pt-2">
          <Button size="lg" class="w-full" :disabled="reading" @click="fileInput?.click()">
            <PhFileArrowUp :size="18" />
            {{ reading ? 'Читаем выписку…' : 'Выбрать файл' }}
          </Button>
          <Button variant="ghost" class="w-full" @click="manual = true">Введу вручную</Button>
          <p class="text-center text-[12px] text-ink-3">PDF из приложения Kaspi или Freedom.</p>
        </div>
      </template>
      <template v-else>
        <Field label="Зарплата в месяц, ₸">
          <NumField v-model="manualSalary" placeholder="450 000" />
        </Field>
        <Field label="День зарплаты (1–28)">
          <NumField v-model="manualPayday" kind="int" placeholder="10" />
        </Field>
        <p class="text-[12.5px] leading-relaxed text-ink-3">Оклад без премий.</p>
        <div class="mt-auto flex flex-col gap-2 pt-2">
          <Button size="lg" class="w-full" :disabled="parseMoney(manualSalary) <= 0" @click="manualNext">Дальше</Button>
          <Button variant="ghost" class="w-full" @click="manual = false">Лучше загружу выписку</Button>
        </div>
      </template>
    </template>

    <!-- Шаг 2: вопросы по одному -->
    <template v-else-if="step === 'questions'">
      <template v-if="current && current.type === 'income'">
        <DecisionCard question="Это ваш доход?" :meta="incomeMeta(current.candidate)" :progress="progress" :actions="{ primary: 'Да, это зарплата', secondary: 'Нет' }" @primary="answerIncome(true)" @secondary="answerIncome(false)">
          <template #inner>
            <div class="flex gap-3">
              <Field label="Оклад, ₸" class="flex-1"><NumField v-model="incomeSalary" placeholder="450 000" /></Field>
              <Field label="День" class="w-24"><NumField v-model="incomePayday" kind="int" placeholder="10" /></Field>
            </div>
          </template>
        </DecisionCard>
      </template>
      <template v-else-if="current && current.type === 'recurring'">
        <DecisionCard :question="`${current.candidate.name} — это что?`" :meta="recurringMeta(current.candidate)" :progress="progress" :actions="{ primary: 'Записать', secondary: 'Нет, разовое', ghost: 'Потом' }" @primary="answerRecurring(true)" @secondary="answerRecurring(false)" @ghost="skipRest">
          <template #chips>
            <Chip v-for="k in KINDS" :key="k.value" :on="recurringKind === k.value" @click="recurringKind = k.value">{{ k.label }}</Chip>
          </template>
          <template v-if="recurringKind === 'credit'" #inner>
            <Field label="Остаток долга, ₸ — если знаете"><NumField v-model="creditPrincipal" placeholder="можно позже, в Капитале" /></Field>
          </template>
        </DecisionCard>
        <p v-if="later > 0" class="text-[12.5px] text-ink-3">Ещё {{ later }} — позже, в «Неделе».</p>
      </template>
      <template v-else-if="!salaryKnown">
        <Field label="Зарплата в месяц, ₸">
          <NumField v-model="manualSalary" placeholder="450 000" />
        </Field>
        <Field label="День зарплаты (1–28)">
          <NumField v-model="manualPayday" kind="int" placeholder="10" />
        </Field>
        <div class="mt-auto flex flex-col gap-2 pt-2">
          <Button size="lg" class="w-full" :disabled="parseMoney(manualSalary) <= 0" @click="manualAfterQuestions">{{ joining ? 'Готово' : 'Дальше' }}</Button>
        </div>
      </template>
      <!-- Все вопросы закрыты (перезагрузка после ответов) — просто дальше. -->
      <div v-else class="mt-auto pt-2">
        <Button size="lg" class="w-full" @click="advance">{{ joining ? 'Готово' : 'Дальше' }}</Button>
      </div>
    </template>

    <!-- Шаг 3: картина месяца -->
    <template v-else-if="step === 'month'">
      <WeekCard :total="picture.total" :segments="segments" :unknown="picture.unknown" :unknown-share="picture.unknownShare" :rows="5" />
      <FreeCard :amount="free" label="Свободно в месяц" note="Из свободного и складывается мечта — дальше выберем её." size="md" />
      <div class="mt-auto pt-2">
        <Button size="lg" class="w-full" @click="go('dream')">Дальше</Button>
      </div>
    </template>

    <!-- Шаг 4: на что копим (B2C-18) -->
    <GoalNew v-else-if="step === 'dream'" next="/start/invite" />

    <!-- Шаг 5: партнёр -->
    <template v-else-if="step === 'invite'">
      <div class="flex flex-col items-center gap-4 rounded-card border border-card-border bg-surface p-6 text-center">
        <span class="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><PhUserPlus :size="24" /></span>
        <template v-if="inviteCode">
          <div>
            <div class="text-[13px] text-ink-2">Код приглашения</div>
            <button type="button" class="mt-1 flex items-center justify-center gap-2 font-display text-[28px] font-semibold tracking-[0.14em] num text-ink cursor-pointer" @click="handleCopy">
              {{ inviteCode }}
              <PhCopy :size="18" class="text-ink-3" />
            </button>
          </div>
          <p class="inline-flex max-w-[280px] items-center gap-1.5 text-[12.5px] leading-relaxed text-ink-2">
            Продиктуйте партнёру — он выберет «По коду» <Hint>Партнёр открывает тот же адрес, регистрируется и выбирает «По коду». Код действует две недели и срабатывает один раз.</Hint>
          </p>
          <span v-if="copied" class="text-[12px] font-medium text-brand">Скопировано</span>
        </template>
        <template v-else>
          <p class="text-[13px] leading-relaxed text-ink-2">Короткий код — продиктовать вслух.</p>
          <Button class="w-full" :disabled="inviteBusy" @click="handleMakeInvite">{{ inviteBusy ? 'Минуту…' : 'Создать код' }}</Button>
          <p v-if="inviteError" role="alert" class="text-[12.5px] text-warn">{{ inviteError }}</p>
        </template>
      </div>
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" @click="finish">{{ inviteCode ? 'Готово' : 'Позже' }}</Button>
        <p v-if="!inviteCode" class="text-center text-[12px] text-ink-3">Один человек — тоже семья. Код есть и в настройках.</p>
      </div>
    </template>
  </div>
</template>
