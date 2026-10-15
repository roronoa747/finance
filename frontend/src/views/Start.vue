<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhCopy, PhFileArrowUp, PhUserPlus } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useEventsStore } from '@/stores/events'
import { useOperationsStore, type Draft, type DraftFile } from '@/stores/operations'
import { readStatementFiles } from '@/lib/statements/read'
import { ruleFor, ruleMatchOf } from '@/lib/statements/model'
import { BUDGET_BY_KIND, firstRunQuestions, paymentOpOfMonth, salaryOpOfMonth, type IncomeCandidate, type RecurringCandidate, type RecurringKind } from '@/lib/statements/firstRun'
import { matchCandidates, matchCategory, nearestEvent, operationAt, SALARY_TOLERANCE } from '@/lib/statements/matching'
import type { Operation } from '@/lib/statements/types'
import { advanceDefault, monthlyFromWeekly, weeklyFromMonthly } from '@/lib/finance'
import { money, parseMoney, plain } from '@/lib/money'
import { addMonths, monthKey } from '@/lib/dates'
import { START_ANSWERED_KEY, readStorage, writeStorage } from '@/lib/storage'
import { isDark } from '@/lib/theme'
import { useInvite } from '@/components/useInvite'
import type { Person, PersonId } from '@/types/finance'
import { plural } from '@/lib/utils'
import GoalNew from '@/views/GoalNew.vue'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import Chip from '@/components/kit/Chip.vue'
import DecisionCard from '@/components/kit/DecisionCard.vue'
import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import Hint from '@/components/kit/Hint.vue'
import NumField from '@/components/kit/NumField.vue'
import PayRhythmFields from '@/components/PayRhythmFields.vue'
import Stepper from '@/components/kit/Stepper.vue'

/**
 * Первый запуск (DESIGN.md §2 `/start/*`, §6; B2C-19, бэклог «первый» Р-1…Р-6): вступление из трёх
 * образов → «На что копим?» (`GoalNew`) → зарплата и день руками → пригласить партнёра → главный. Выписка — не обязательна:
 * тихое «Есть PDF из банка» на шаге зарплаты раскрывает выбор файла, прочитанная выписка ведёт к
 * вопросам по одному (доход, повторяющиеся списания — не больше семи), они — подшаг зарплаты.
 * Шаг — в адресе (`/start/:step`), ответы пишутся сразу (§8 п. 7): перезагрузка не теряет ни шаг, ни
 * ответы. Партнёр по коду — вступление и зарплата (и выписка с вопросами) про себя: мечта общая.
 * Ничего не считается здесь: `firstRun.ts`, `finance.ts`.
 */
type Step = 'intro' | 'dream' | 'salary' | 'questions' | 'invite'
/** Адреса прежнего потока (перезагрузка у тех, кто был посреди него): выписка — шаг зарплаты, «Ваш месяц» — партнёр. */
const OLD_STEPS: Record<string, Step> = { upload: 'salary', month: 'invite' }
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
const steps = computed<Step[]>(() => (joining.value ? ['intro', 'salary', 'questions'] : ['intro', 'dream', 'salary', 'questions', 'invite']))
const step = computed<Step>(() => {
  const raw = String(route.params.step ?? '')
  const s = OLD_STEPS[raw] ?? (raw as Step)
  return steps.value.includes(s) ? s : steps.value[0]
})
// «n из k» — по видимым шагам: вступление в счёт не входит, вопросы — подшаг зарплаты, «n» на них не растёт.
const counted = computed<Step[]>(() => steps.value.filter((s) => s !== 'intro' && s !== 'questions'))
const stepIndex = computed(() => counted.value.indexOf(step.value === 'questions' ? 'salary' : step.value) + 1)

function go(next: Step) {
  void router.push(`/start/${next}`)
}
/** После зарплаты (с вопросами или без): партнёр по коду — главный, новая семья — пригласить партнёра. */
function afterSalary() {
  if (joining.value) finish()
  else go('invite')
}

/* ------------------ Вступление: три образа (Р-1) ------------------ */
// Снимки лэндинга в теме экрана (`Landing.vue`); строки — свои, короче лэндинга (Р-9: финальные слова — `/ux`).
const INTRO = [
  { key: 'dream', title: 'Мечта', line: 'Цель с фото — и видно, сколько осталось' },
  { key: 'free', title: 'Свободно', line: 'Сколько можно тратить до зарплаты' },
  { key: 'leaks', title: 'Утечки', line: 'Куда тихо уходят деньги' },
]
const introImg = (key: string) => `/landing/${key}-${isDark.value ? 'dark' : 'light'}.webp`
// Экран вступления — в состоянии: перезагрузка на `/start/intro` начинает с первого (допустимо, FR-02 п. 4).
const introPage = ref(0)
/** Вступление пройдено или пропущено — первый настоящий шаг; `replace`: «назад» к вступлению не ведёт. */
function leaveIntro() {
  void router.replace(`/start/${steps.value[1]}`)
}
function introNext() {
  if (introPage.value < INTRO.length - 1) introPage.value++
  else leaveIntro()
}
/** Свайп: влево — следующий экран, вправо — предыдущий; короче 40 px — не жест. */
const SWIPE = 40
function swipe(dx: number) {
  if (dx <= -SWIPE && introPage.value < INTRO.length - 1) introPage.value++
  else if (dx >= SWIPE && introPage.value > 0) introPage.value--
}
let touchX: number | null = null
const onTouchStart = (e: TouchEvent) => (touchX = e.touches[0]?.clientX ?? null)
function onTouchEnd(e: TouchEvent) {
  const x = e.changedTouches[0]?.clientX
  if (touchX !== null && x !== undefined) swipe(x - touchX)
  touchX = null
}

/* ------------------ Шаг 2: зарплата (и выписка опцией) ------------------ */
const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref(false)
const errors = ref<Draft['errors']>([])
/** «Есть PDF из банка»: выбор файла раскрыт на шаге зарплаты вместо полей. */
const pdf = ref(false)
const manualSalary = ref('')
const form = useFormCheck(() => [['salary', parseMoney(manualSalary.value) <= 0 && 'Введите зарплату']])
const manualPayday = ref('10')
/** Ритм ручного ввода (PN-23): тот же блок, что в «Изменить оклад»; пишется вместе с окладом. */
const manualRhythm = ref<Partial<Person>>({ payRhythm: 'month' })
const manualWeekly = computed(() => manualRhythm.value.payRhythm === 'week')
/**
 * Аванс — половина оклада, пока его не вписали руками (`/ux` Б7, наблюдение критика): «Дважды» до оклада оставлял
 * «Аванс 0» — и месяц одним приходом. Оклад набран «в месяц» или «за неделю» — по ритму в момент набора; ритм сменили
 * через неделю — тихая подсказка пересчёта, как в «Изменить оклад» (подпись поля меняется, а число — нет).
 */
const advanceTyped = ref(false)
const salaryWeekly = ref(false)
watch(manualSalary, () => {
  salaryWeekly.value = manualWeekly.value
  if (manualRhythm.value.payRhythm === 'advance' && !advanceTyped.value) {
    manualRhythm.value = { ...manualRhythm.value, salary2: advanceDefault(parseMoney(manualSalary.value)) }
  }
})
function onManualRhythm(patch: Partial<Person>) {
  if (patch.payday) manualPayday.value = String(patch.payday)
  if (patch.salary2 !== undefined && !patch.payRhythm) advanceTyped.value = true
  manualRhythm.value = { ...manualRhythm.value, ...patch }
}
const salaryHint = computed(() => {
  const a = parseMoney(manualSalary.value)
  if (a <= 0 || manualWeekly.value === salaryWeekly.value) return null
  return manualWeekly.value ? { amount: weeklyFromMonthly(a), per: 'за неделю' } : { amount: monthlyFromWeekly(a), per: 'в месяц' }
})
function useSalaryHint() {
  if (salaryHint.value) manualSalary.value = plain(salaryHint.value.amount)
}
/** Поля ритма в участника: месячный — без полей (документ как раньше). */
const rhythmFields = (): Partial<Person> => {
  const r = manualRhythm.value
  if (r.payRhythm === 'week') return { payRhythm: 'week', weekday: r.weekday }
  if (r.payRhythm === 'advance') return { payRhythm: 'advance', payday2: r.payday2, salary2: r.salary2 }
  return {}
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  try {
    const { ok, errors: failed } = await readStatementFiles(files)
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

/**
 * Зарплата руками — на своём шаге и в короткой форме после вопросов, когда в выписке дохода не нашлось:
 * оклад, день и ритм — в участника, дальше — партнёр (или главный); после вопросов — как ответ на них.
 */
function saveSalary() {
  const salary = parseMoney(manualSalary.value)
  if (salary <= 0) return
  financeStore.setPerson(slot.value, { name: knownName.value, salary, payday: clampDay(manualPayday.value, 10), ...rhythmFields() })
  if (step.value === 'questions') advance()
  else afterSalary()
}

const clampDay = (v: string | number, fallback: number) => Math.min(28, Math.max(1, (typeof v === 'number' ? v : parseMoney(v)) || fallback))

/* ------------------ Подшаг зарплаты: вопросы по одному ------------------ */
// Ответы — в документе (доход, обязательства, правила); какие вопросы уже показаны — на устройстве:
// «нет» записи не оставляет, а второй раз спрашивать не надо.
const answered = ref<string[]>(readStorage<string[]>(KEY_ANSWERED, []))
function markAnswered(key: string) {
  if (!answered.value.includes(key)) answered.value = [...answered.value, key]
  writeStorage(KEY_ANSWERED, answered.value)
}

const groupOps = (ids: string[]) => ids.map((id) => ops.all.find((o) => o.id === id)).filter((o): o is Operation => !!o)
/**
 * Повтор, который сопоставляется с обязательством или кредитом семьи (партнёр платит аренду,
 * заведённую первым участником), — не вопрос: «Записать» завёл бы второе такое же; отметку по
 * свежим строкам предложит «Неделя». Отвеченный остаётся в счёте «n из k».
 */
const inFamily = (c: RecurringCandidate) =>
  matchCandidates(groupOps(c.opIds), { obligations: financeStore.obligations, credits: financeStore.credits }, []).length > 0
const questions = computed(() =>
  firstRunQuestions(ops.all).filter((q) => q.type === 'income' || answered.value.includes(q.candidate.key) || !inFamily(q.candidate)),
)
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

const me = computed(() => financeStore.people.find((p) => p.id === slot.value))
const salaryKnown = computed(() => (me.value?.salary ?? 0) > 0)

// Поля карточки — от текущего вопроса: сумма и день дохода правятся, у кредита — остаток «если знаете».
// Сбрасываются только при смене вопроса (ключ), а не при новом объекте: вопросы пересобираются при
// каждой подмене документа — синк после ответа, возврат в приложение, фоновый круг — и стирали бы
// введённый остаток, выбранный чип и исправленный оклад (возврат приёмки 2 п. 1). Ключ дохода — с
// отправителем: вторая выписка (назад на загрузку) меняет кандидата, поля должны обновиться.
const incomeSalary = ref('')
const incomePayday = ref('')
const recurringKind = ref<RecurringKind>('obligation')
const creditPrincipal = ref('')
const questionKey = computed(() => (current.value ? `${current.value.type}:${current.value.candidate.key}` : null))
watch(
  questionKey,
  () => {
    const q = current.value
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

/** «по пятницам» — недельный приход (PN-24); иначе «24-го». */
const BY_WEEKDAY = ['', 'по понедельникам', 'по вторникам', 'по средам', 'по четвергам', 'по пятницам', 'по субботам', 'по воскресеньям']
const incomeWhen = (c: IncomeCandidate) => (c.rhythm === 'week' && c.weekday ? BY_WEEKDAY[c.weekday] : `${c.day}-го`)
const incomeMeta = (c: IncomeCandidate) => `${money(c.amount)} · ${incomeWhen(c)} · ${c.name}${c.count > 1 ? ` · ${c.count} ${plural(c.count, 'раз', 'раза', 'раз')}` : ''}`
const recurringMeta = (c: RecurringCandidate) => `${money(c.amount)} · примерно ${c.day}-го${c.count > 1 ? ` · ${c.count} раз за период` : ''}`

/**
 * «Да, это зарплата»: оклад и день — в участника; правило — когда отправитель назван или приход
 * регулярный. Отметка месяца — суммой и днём пришедшей операции в допуске оклада (премия в пределах
 * допуска ложится на свободное; `salaryOpOfMonth`), иначе месяц не отмечается.
 */
function answerIncome(yes = true) {
  const q = current.value
  if (!q || q.type !== 'income') return
  if (yes) {
    const salary = parseMoney(incomeSalary.value)
    if (salary <= 0) return
    // Еженедельный приход (PN-24): ритм «каждую неделю» и недельная сумма; иначе — месяц, как раньше.
    const weekly = q.candidate.rhythm === 'week' && q.candidate.weekday ? { payRhythm: 'week' as const, weekday: q.candidate.weekday } : {}
    financeStore.setPerson(slot.value, { name: knownName.value, salary, payday: clampDay(incomePayday.value, q.candidate.day), ...weekly })
    const op = ops.all.find((o) => o.id === q.candidate.opIds[0])
    if (op && (op.counterparty || q.candidate.regular)) {
      // Правило зарплаты без раздела — пересчитывать операции нечего.
      ops.answer(ruleMatchOf(op), { payment: { kind: 'salary', targetId: slot.value } })
      // Отметка — только приходом в допуске оклада (как правило «Недели»): мелкий перевод того же
      // отправителя в этом месяце — не зарплата, месяц остаётся неотмеченным.
      // Этот и прошлый месяц — как «Да» в «Неделе» (`acceptMatch`, хвост 959): иначе прошлый месяц займёт приход
      // другого отправителя вопросом «Это зарплата?», а «Да» на нём напишет второе правило зарплаты.
      if (q.candidate.rhythm === 'week') markWeeks(groupOps(q.candidate.opIds), salary)
      else for (const period of [addMonths(monthKey(), -1), monthKey()]) {
        const cur = salaryOpOfMonth(groupOps(q.candidate.opIds), salary, period)
        if (cur) financeStore.markSalary(slot.value, { period, amount: Math.abs(cur.amount), source: 'statement', opId: cur.id, at: operationAt(cur.date) })
      }
    }
  }
  markAnswered('income')
  advance()
}

/**
 * Недельный доход из выписки (PN-24): каждый приход этого и прошлого месяца в допуске недельной суммы — отметка своей
 * пятницы (`nearestEvent`, ключ — ISO-день); одна неделя — один приход.
 */
function markWeeks(list: Operation[], salary: number) {
  const p = financeStore.people.find((x) => x.id === slot.value)
  if (!p) return
  const from = `${addMonths(monthKey(), -1)}-01`
  for (const op of list) {
    if (op.date < from || op.amount <= 0 || Math.abs(op.amount - salary) > salary * SALARY_TOLERANCE) continue
    const near = nearestEvent(op.date, p)
    if (near && near.gap <= 3) financeStore.markSalary(slot.value, { period: near.event.period, amount: op.amount, source: 'statement', opId: op.id, at: operationAt(op.date) })
  }
}

/**
 * «Записать»: кредит с известным остатком — кредит со ставкой «неизвестна» (`rateUnknown`: Капитал
 * пишет «ставку уточните», а не «без процентов»);
 * без остатка — обязательство раздела «Кредиты» (кредит с остатком 0 платежа не ждёт). Аренда и
 * коммуналка — жильё, подписки и прочее регулярное — быт. Правило «это платёж по …» отмечает
 * следующие выписки само (Р-6) и сразу переносит операции группы в плановый раздел
 * (`recategorize`, как «Да, отметить» в «Неделе»): «Свободно по факту» не вычтет их второй раз.
 * Платёж этого месяца отмечается суммой и днём операции в допуске суммы (`paymentOpOfMonth`, как
 * правило платежа), до введённого остатка кредита — остаток он второй раз не уменьшает; строки в
 * допуске нет — месяц не отмечается.
 */
function answerRecurring(save = true) {
  const q = current.value
  if (!q || q.type !== 'recurring') return
  const c = q.candidate
  if (save) {
    // Отметка — не позже этого мгновения: сегодняшняя строка выписки встаёт до сверки остатка ниже.
    const before = Date.now() - 1
    const kind = recurringKind.value
    const principal = kind === 'credit' ? parseMoney(creditPrincipal.value) : 0
    let target: { kind: 'obligation' | 'credit'; id: string }
    if (kind === 'credit' && principal > 0) {
      target = { kind: 'credit', id: financeStore.addCredit({ name: c.name, note: 'из выписки', principal, annualRate: 0, rateUnknown: true, payment: c.amount, day: c.day }) }
    } else {
      const name = KIND_NAME[kind] ?? c.name
      const note = kind === 'credit' ? 'платёж по кредиту — остаток и ставку уточните в Капитале' : name !== c.name ? c.name : ''
      target = { kind: 'obligation', id: financeStore.addObligation({ name, note, day: c.day, category: BUDGET_BY_KIND[kind], amount: c.amount, estimate: kind === 'utilities' }) }
    }
    const op = ops.all.find((o) => o.id === c.opIds[0])
    if (op) {
      const goal = target.kind === 'credit' ? financeStore.credits.find((x) => x.id === target.id) : financeStore.obligations.find((x) => x.id === target.id)
      // Отметка — до пересчёта: итоги пишутся с ней, отмеченная строка не трата (хвосты 952/967).
      const cur = paymentOpOfMonth(groupOps(c.opIds), c.amount, monthKey(), kind === 'utilities')
      if (cur) financeStore.markPaid(target.kind, target.id, slot.value, { period: monthKey(), amount: Math.abs(cur.amount), source: 'statement', opId: cur.id, at: operationAt(cur.date, before) })
      void ops.recategorize(ruleMatchOf(op), { payment: { kind: target.kind, targetId: target.id, categoryId: goal ? matchCategory(target.kind, goal) : null } })
    }
  }
  markAnswered(c.key)
  advance()
}

/** «Потом»: остальные вопросы закрыты без записи. */
function skipRest() {
  for (const q of pending.value) markAnswered(q.type === 'income' ? 'income' : q.candidate.key)
  advance()
}

function advance() {
  if (pending.value.length) return
  if (!salaryKnown.value) return // без дохода дальше нельзя — короткая форма ниже
  afterSalary()
}

/** Поля зарплаты: свой шаг (кроме раскрытой выписки) и короткая форма, когда в выписке дохода не нашлось. */
const salaryForm = computed(() => (step.value === 'salary' && !pdf.value) || (step.value === 'questions' && !current.value && !salaryKnown.value))

/* ------------------ Шаг 3: партнёр ------------------ */
const { code: inviteCode, busy: inviteBusy, error: inviteError, copied, make: handleMakeInvite, copy: handleCopy } = useInvite()

/**
 * «Пропустить» в шапке (Р-4) — на необязательных шагах: вступление → первый шаг, мечта → зарплата («Мечты» потом
 * встретят пустым «Новая мечта»), вопросы → остальные закрыты без записи (без зарплаты — короткая форма), партнёр →
 * главный. Зарплата обязательна — там его нет; на короткой форме и «Дальше» после вопросов пропускать нечего.
 */
const skippable = computed(() => step.value === 'intro' || step.value === 'dream' || step.value === 'invite' || (step.value === 'questions' && !!current.value))
function skipStep() {
  if (step.value === 'intro') leaveIntro()
  else if (step.value === 'dream') go('salary')
  else if (step.value === 'questions') skipRest()
  else if (step.value === 'invite') finish()
}

/** Семья настроена (или партнёр прошёл своё): участник отмечен, дальше — главный. */
function finish() {
  financeStore.setPerson(slot.value, { name: knownName.value, onboardedAt: new Date().toISOString() })
  if (!joining.value) financeStore.finishSetup()
  useEventsStore().track('first_run_done')
  void financeStore.syncHousehold()
  void router.push('/')
}

/** Где взять PDF (тексты макета g3); значок — первая буква на тоне банка из токенов. */
const BANK_HOWTO = [
  { name: 'Kaspi', path: 'Мой банк → Выписка → PDF → Поделиться', tone: 'bg-destructive' },
  { name: 'Freedom', path: 'Счёт → Выписка → за 3 месяца → PDF', tone: 'bg-ok' },
]

const titles: Record<Step, { title: string; sub: string }> = {
  // Заголовки вступления — на его экранах.
  intro: { title: '', sub: '' },
  // Заголовок «На что копим?» — у самого `GoalNew`.
  dream: { title: '', sub: '' },
  // Выписка — механика, не заголовок (правило 12, Р-9): она только на тихой кнопке и внутри раскрытия.
  salary: { title: 'Зарплата', sub: 'Сколько и когда приходит' },
  questions: { title: 'Нашли повторяющиеся', sub: 'Подтвердите по одному — дальше отметим сами.' },
  invite: { title: 'Пригласите партнёра', sub: 'Мечты и покупки — одни на двоих.' },
}
// Раскрытый выбор файла (макет Б17): заголовок — про банк, путь к PDF — в подсказке у банка.
const PDF_TITLE = { title: 'Ваш банк', sub: 'Найдём зарплату, кредиты и подписки' }
const title = computed(() => {
  if (step.value === 'salary' && pdf.value) return PDF_TITLE.title
  if (step.value === 'questions') return current.value ? `Нашли ${questions.value.length} ${plural(questions.value.length, 'повторяющийся', 'повторяющихся', 'повторяющихся')}` : 'Доход'
  return titles[step.value].title
})
const sub = computed(() => {
  if (step.value === 'salary' && pdf.value) return PDF_TITLE.sub
  // Только над короткой формой: зарплату уже ввели руками — просить её снова не о чем.
  if (step.value === 'questions' && salaryForm.value) return 'В выписке зарплата не нашлась — впишите её.'
  if (step.value === 'questions' && !current.value) return ''
  return titles[step.value].sub
})
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-4 px-5 pb-6 pt-5 text-left">
    <!--
      Шапка шага: «n из k» (у вступления — точки экранов) и тихое «Пропустить» справа на необязательных шагах (Р-4).
      Липкая — «Пропустить» видно и над сеткой 18 плиток мечты без прокрутки (FR-03).
    -->
    <div class="sticky top-0 z-10 -mx-5 -mt-5 bg-canvas px-5 pb-2 pt-5" data-start-head>
      <!-- Высота строки — по кнопке (32): без «Пропустить» (зарплата) полоса не прыгает вверх. -->
      <div class="flex min-h-8 items-center gap-3">
        <div v-if="step === 'intro'" class="flex flex-1 items-center gap-1.5" aria-hidden="true" data-intro-dots>
          <span v-for="(s, i) in INTRO" :key="s.key" class="h-1.5 rounded-full transition-all" :class="i === introPage ? 'w-5 bg-brand' : 'w-1.5 bg-track'" />
        </div>
        <Stepper v-else :n="stepIndex" :k="counted.length" class="flex-1" />
        <Button v-if="skippable" variant="ghost" size="sm" class="-mr-2 shrink-0" data-skip @click="skipStep">Пропустить</Button>
      </div>
    </div>

    <div v-if="title">
      <h1 class="type-h2-lg text-ink">{{ title }}</h1>
      <p v-if="sub" class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{{ sub }}</p>
    </div>

    <!-- Вступление: три образа лентой — листаются свайпом и «Дальше» (Р-1). -->
    <template v-if="step === 'intro'">
      <div class="-mx-5 overflow-hidden" @touchstart.passive="onTouchStart" @touchend="onTouchEnd">
        <div class="flex transition-transform duration-300" :style="{ transform: `translateX(-${introPage * 100}%)` }">
          <section v-for="(s, i) in INTRO" :key="s.key" class="w-full shrink-0 px-5" :aria-hidden="i !== introPage" data-intro-page>
            <img
              :src="introImg(s.key)"
              :alt="s.title"
              width="390"
              height="300"
              :loading="i === 0 ? undefined : 'lazy'"
              class="aspect-[13/10] w-full rounded-card border border-line bg-surface object-cover object-top"
            />
            <h1 class="mt-5 type-h2-lg text-ink">{{ s.title }}</h1>
            <p class="mt-1.5 text-[15px] leading-relaxed text-ink-2">{{ s.line }}</p>
          </section>
        </div>
      </div>
      <div class="mt-auto pt-2">
        <Button size="lg" class="w-full" @click="introNext">Дальше</Button>
      </div>
    </template>

    <!-- Шаг 1: на что копим (B2C-18) — первым, до зарплаты (Р-2). -->
    <GoalNew v-else-if="step === 'dream'" next="/start/salary" />

    <!-- Шаг 2: зарплата руками; та же форма — после вопросов, когда в выписке дохода не нашлось. -->
    <template v-else-if="salaryForm">
      <!-- Поля ручного ввода — одним блоком: отступы между ними ровные (14 px, как в «Изменить оклад»), не 14 и 30 (`/ux` Б7). -->
      <div data-manual-income>
        <Field :label="manualWeekly ? 'Зарплата за неделю, ₸' : 'Зарплата в месяц, ₸'" name="salary">
          <NumField v-model="manualSalary" placeholder="450 000" class="bg-surface" />
        </Field>
        <Button v-if="salaryHint" variant="ghost" size="sm" class="-mt-2 mb-2 -ml-2" data-week-hint @click="useSalaryHint">≈ {{ plain(salaryHint.amount) }} {{ salaryHint.per }}</Button>
        <PayRhythmFields
          :rhythm="manualRhythm.payRhythm ?? 'month'"
          :payday="clampDay(manualPayday, 10)"
          :payday2="manualRhythm.payday2"
          :salary2="manualRhythm.salary2"
          :weekday="manualRhythm.weekday"
          :salary="parseMoney(manualSalary)"
          currency="KZT"
          field-class="bg-surface"
          @change="onManualRhythm"
        />
        <p class="text-[12.5px] leading-relaxed text-ink-2">Оклад без премий.</p>
      </div>
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" @click="form.submit(saveSalary)">{{ joining ? 'Готово' : 'Дальше' }}</Button>
        <!-- Выписка — опция, не главная (Р-2): тихо, под главной. -->
        <Button v-if="step === 'salary'" variant="ghost" size="md" class="w-full" @click="pdf = true">Есть PDF из банка</Button>
      </div>
    </template>

    <!-- Шаг 2, раскрыто «Есть PDF из банка»: выбор файла. -->
    <template v-else-if="step === 'salary'">
      <!-- Откуда взять файл (g3 «Шаг 2 — первая выписка»): банк и путь в его приложении одной строкой. -->
      <Card tight>
        <div v-for="b in BANK_HOWTO" :key="b.name" class="flex items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
          <span class="grid size-9 shrink-0 place-items-center rounded-[10px] text-[12px] font-bold text-on-photo" :class="b.tone" aria-hidden="true">{{ b.name[0] }}</span>
          <span class="min-w-0 flex-1 font-medium text-ink">{{ b.name }}</span>
          <Hint :label="`Выписка ${b.name}`">{{ b.path }}</Hint>
        </div>
      </Card>
      <!-- Одна строка + подсказка (правило интерфейса: пояснение длиннее строки — в Hint). -->
      <Callout tone="neutral" icon="lock">
        <span class="inline-flex items-center gap-1.5">Файл остаётся на телефоне <Hint>На сервер попадают только продавец, дата, сумма и раздел — без номеров и ФИО.</Hint></span>
      </Callout>
      <Callout v-for="e in errors" :key="e.name" tone="warn">
        {{ e.name }}: {{ e.message }}<span v-if="e.detail" class="block text-[12px] text-ink-2">{{ e.detail }}</span>
      </Callout>
      <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button size="lg" class="w-full" :disabled="reading" @click="fileInput?.click()">
          <PhFileArrowUp :size="18" />
          {{ reading ? 'Читаем выписку…' : 'Выбрать файл' }}
        </Button>
        <Button variant="ghost" size="md" class="w-full" @click="pdf = false">Назад</Button>
      </div>
    </template>

    <!-- Подшаг зарплаты: вопросы по одному -->
    <template v-else-if="step === 'questions'">
      <template v-if="current && current.type === 'income'">
        <DecisionCard question="Это ваш доход?" :meta="incomeMeta(current.candidate)" :progress="progress" :actions="{ primary: 'Да, это зарплата', secondary: 'Нет' }" @primary="answerIncome(true)" @secondary="answerIncome(false)">
          <template #inner>
            <div class="flex gap-3">
              <Field :label="current.candidate.rhythm === 'week' ? 'За неделю, ₸' : 'Оклад, ₸'" class="flex-1"><NumField v-model="incomeSalary" placeholder="450 000" /></Field>
              <Field v-if="current.candidate.rhythm !== 'week'" label="День" class="w-24"><NumField v-model="incomePayday" kind="int" placeholder="10" /></Field>
            </div>
          </template>
        </DecisionCard>
      </template>
      <template v-else-if="current && current.type === 'recurring'">
        <!-- «Потом» — «Пропустить» в шапке (FR-03). -->
        <DecisionCard :question="`${current.candidate.name} — это что?`" :meta="recurringMeta(current.candidate)" :progress="progress" :actions="{ primary: 'Записать', secondary: 'Нет, разовое' }" @primary="answerRecurring(true)" @secondary="answerRecurring(false)">
          <template #chips>
            <Chip v-for="k in KINDS" :key="k.value" :on="recurringKind === k.value" @click="recurringKind = k.value">{{ k.label }}</Chip>
          </template>
          <template v-if="recurringKind === 'credit'" #inner>
            <Field label="Остаток долга, ₸ — если знаете"><NumField v-model="creditPrincipal" placeholder="можно позже, в Капитале" /></Field>
            <p class="text-[12px] text-ink-2">Ставку уточните потом в Капитале.</p>
          </template>
        </DecisionCard>
      </template>
      <!-- Все вопросы закрыты (перезагрузка после ответов) — просто дальше. -->
      <div v-else class="mt-auto pt-2">
        <Button size="lg" class="w-full" @click="advance">{{ joining ? 'Готово' : 'Дальше' }}</Button>
      </div>
    </template>

    <!-- Шаг 3: партнёр -->
    <template v-else-if="step === 'invite'">
      <Card class="flex flex-col items-center gap-4 p-6 text-center">
        <span class="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand"><PhUserPlus :size="24" /></span>
        <template v-if="inviteCode">
          <div>
            <div class="text-[13px] text-ink-2">Код приглашения</div>
            <button type="button" class="mt-1 flex items-center justify-center gap-2 type-h2-lg tracking-[0.14em] num text-ink cursor-pointer" @click="handleCopy">
              {{ inviteCode }}
              <PhCopy :size="18" class="text-ink-3" />
            </button>
          </div>
          <p class="inline-flex max-w-[280px] items-center gap-1.5 text-[12.5px] leading-relaxed text-ink-2">
            Продиктуйте партнёру — он выберет «По коду» <Hint>Партнёр открывает тот же адрес, входит через Google и выбирает «По коду». Код действует две недели и срабатывает один раз.</Hint>
          </p>
          <span v-if="copied" class="text-[12px] font-medium text-brand">Скопировано</span>
        </template>
        <template v-else>
          <p class="inline-flex items-center gap-1.5 text-[13px] leading-relaxed text-ink-2">
            Короткий код — продиктовать вслух <Hint>Один человек — тоже семья: «Пропустить» вверху. Код есть и в настройках.</Hint>
          </p>
          <p v-if="inviteError" role="alert" class="text-[12.5px] text-warn">{{ inviteError }}</p>
        </template>
      </Card>
      <!-- Внизу одна главная кнопка (FR-03): до кода — «Создать код», с кодом — «Готово»; без партнёра — «Пропустить» вверху. -->
      <div class="mt-auto pt-2">
        <Button v-if="inviteCode" size="lg" class="w-full" @click="finish">Готово</Button>
        <Button v-else size="lg" class="w-full" :disabled="inviteBusy" @click="handleMakeInvite">{{ inviteBusy ? 'Минуту…' : 'Создать код' }}</Button>
      </div>
    </template>
  </div>
</template>
