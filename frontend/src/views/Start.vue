<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PhAppleLogo, PhCopy, PhFileArrowUp, PhUserPlus } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useEventsStore } from '@/stores/events'
import { useApplePayStore } from '@/stores/applepay'
import { useOperationsStore, type Draft, type DraftFile } from '@/stores/operations'
import { readStatementFiles } from '@/lib/statements/read'
import { liveGoals } from '@/lib/finance'
import { usePhoto } from '@/lib/photos/usePhoto'
import { isDark } from '@/lib/theme'
import { useInvite } from '@/components/useInvite'
import type { PersonId } from '@/types/finance'
import GoalNew from '@/views/GoalNew.vue'
import Button from '@/components/ui/Button.vue'
import Callout from '@/components/kit/Callout.vue'
import Card from '@/components/kit/Card.vue'
import DreamHero from '@/components/kit/DreamHero.vue'
import Hint from '@/components/kit/Hint.vue'
import Stepper from '@/components/kit/Stepper.vue'

/**
 * Первый запуск «сначала траты» (DESIGN.md §2 `/start/*`, §6; B2C-19, бэклог «первый» Р-1…Р-6; Блок 5 «Фидбек», Р-30,
 * Р-35, Figma «Первый запуск · день 1» `19:156`): вступление из трёх образов → «На что копим?» (`GoalNew`) → «Тратьте
 * как обычно» (фото мечты; одна брендовая «Загрузить выписку», Apple Pay — второй путь на iPhone, тихо «Позже») →
 * пригласить партнёра → «Неделя» (если выписка была) или главный. Зарплату и план не спрашиваем: «Это ваш доход?» —
 * вопрос «Недели» (`decisionQueue income`), повторяющиеся списания — «нашли N в выписке» в «Платежах» «Месяца», план —
 * «Поставить план» через две недели выписок (Р-36). Шаг — в адресе (`/start/:step`), записи сразу (§8 п. 7):
 * перезагрузка не теряет ни шаг, ни ответы. Партнёр по коду — вступление и траты про себя: мечта общая.
 * Ничего не считается здесь: `firstRun.ts`, `finance.ts`.
 */
type Step = 'intro' | 'dream' | 'spend' | 'invite'
/** Адреса прежних потоков (перезагрузка у тех, кто был посреди них): выписка, зарплата и вопросы — шаг трат, «Ваш месяц» — партнёр. */
const OLD_STEPS: Record<string, Step> = { upload: 'spend', salary: 'spend', questions: 'spend', month: 'invite' }

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const financeStore = useFinanceStore()
const ops = useOperationsStore()
const ap = useApplePayStore()

const slot = computed<PersonId>(() => authStore.slot || 'a')
const knownName = computed(() => {
  const existing = financeStore.people.find((p) => p.id === slot.value)
  return existing?.name || authStore.member?.display_name || authStore.user?.email?.split('@')[0] || 'Участник'
})
// Партнёр по коду: семья уже настроена первым участником — от него нужны только свои траты.
// Считается по `setupDoneAt`, а не по своим данным. Первый участник закрыл приложение на шаге партнёра (код уже выдан,
// `setupDoneAt` ещё нет) — партнёра выдаёт чужой доход (FR-08).
const joining = computed(() => financeStore.setupDone || financeStore.people.some((p) => p.id !== slot.value && (p.salary ?? 0) > 0))
const steps = computed<Step[]>(() => (joining.value ? ['intro', 'spend'] : ['intro', 'dream', 'spend', 'invite']))
/**
 * `/start` без шага (новый вход, холодный запуск PWA посреди потока — гард ведёт сюда) и чужой шаг — первый
 * непройденный (FR-08): цель есть — траты (мечта второй раз не заводится), иначе — вступление.
 */
const resume = computed<Step>(() => (!joining.value && liveGoals(financeStore.goals).length ? 'spend' : 'intro'))
const step = computed<Step>(() => {
  const raw = String(route.params.step ?? '')
  const s = OLD_STEPS[raw] ?? (raw as Step)
  return steps.value.includes(s) ? s : resume.value
})
// «n из k» — по видимым шагам: вступление в счёт не входит (мечта, траты, партнёр).
const counted = computed<Step[]>(() => steps.value.filter((s) => s !== 'intro'))
const stepIndex = computed(() => counted.value.indexOf(step.value) + 1)

function go(next: Step) {
  void router.push(`/start/${next}`)
}

/* ------------------ Вступление: три образа (Р-1) ------------------ */
// Снимки лэндинга в теме экрана (`Landing.vue`); строки — свои, короче лэндинга (Р-9: утверждены владельцем на `/ux`).
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

/* ------------------ Шаг 2: «Тратьте как обычно» (Р-35) ------------------ */
/** Мечта семьи — фото и имя (первая цель очереди); без мечты — плитка без фото. */
const dream = computed(() => financeStore.heroGoal)
const dreamSrc = usePhoto(() => dream.value?.photoId)
/**
 * Путь: выписка (по умолчанию) или Apple Pay. Плитки выбора — только при двух путях (iPhone, где подключение доступно;
 * Р-10 «Хвостов»); с одним путём — без плиток, и пока `ap.load()` не ответил — тоже (на Android плитки не мигают).
 */
type Path = 'statement' | 'applepay'
const path = ref<Path>('statement')
const applePayShown = computed(() => ap.available && ap.isIPhone)
const chosen = computed<Path>(() => (applePayShown.value ? path.value : 'statement'))
onMounted(() => void ap.load())
/** Что выбрали на шаге — куда ведёт `finish`: выписка → «Неделя», Apple Pay → лист подключения. */
const uploaded = ref(false)
const applePayChosen = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const reading = ref(false)
const errors = ref<Draft['errors']>([])
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
/** Разобранная выписка — тем же путём, что «Неделя» (B2C-07): операции себе, итоги в документ; дальше — без вопросов. */
async function uploadParsed(files: DraftFile[]) {
  ops.setDraft(files, [])
  await ops.send()
  uploaded.value = true
  afterSpend()
}
function chooseApplePay() {
  applePayChosen.value = true
  afterSpend()
}
/** После трат (выписка, Apple Pay или «Позже»): новая семья — пригласить партнёра, партнёр по коду — главный. */
function afterSpend() {
  if (joining.value) finish()
  else go('invite')
}

/* ------------------ Шаг 3: партнёр ------------------ */
const { code: inviteCode, busy: inviteBusy, error: inviteError, copied, make: handleMakeInvite, copy: handleCopy } = useInvite()

/**
 * «Пропустить» в шапке (Р-4) — на необязательных шагах: вступление → первый шаг, мечта → траты («Мечты» потом
 * встретят пустым «Новая мечта»), траты → партнёр (= «Позже»), партнёр → главный. Код создан — «Готово» внизу делает то
 * же самое: второй кнопки с тем же действием нет (`/ux` Блока 1).
 */
const skippable = computed(() => step.value !== 'invite' || !inviteCode.value)
function skipStep() {
  if (step.value === 'intro') leaveIntro()
  else if (step.value === 'dream') go('spend')
  else if (step.value === 'spend') afterSpend()
  else if (step.value === 'invite') finish()
}

/**
 * Семья настроена (или партнёр прошёл своё): участник отмечен, дальше — «Неделя» с выпиской, лист Apple Pay или главный.
 * Не настроена — отмечается тем, кто закончил первым: партнёр, пришедший раньше возврата первого участника (FR-08), тоже.
 */
function finish() {
  financeStore.setPerson(slot.value, { name: knownName.value, onboardedAt: new Date().toISOString() })
  if (!financeStore.setupDone) financeStore.finishSetup()
  useEventsStore().track('first_run_done')
  void financeStore.syncHousehold()
  void router.push(uploaded.value ? '/week' : applePayChosen.value ? '/settings?applepay=1' : '/')
}

const titles: Record<Step, { title: string; sub: string }> = {
  // Заголовки вступления — на его экранах.
  intro: { title: '', sub: '' },
  // Заголовок «На что копим?» — у самого `GoalNew`.
  dream: { title: '', sub: '' },
  // Механика (выписка, PDF) — не в заголовке (правило 12, Р-9): только на кнопке.
  spend: { title: 'Тратьте как обычно', sub: 'Через пару недель покажем, куда уходит' },
  invite: { title: 'Пригласите партнёра', sub: 'Мечты и покупки — одни на двоих.' },
}
const title = computed(() => titles[step.value].title)
const sub = computed(() => titles[step.value].sub)
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col gap-4 px-5 pb-6 pt-5 text-left">
    <!--
      Шапка шага: «n из k» (у вступления — точки экранов) и тихое «Пропустить» справа на необязательных шагах (Р-4).
      Липкая — «Пропустить» видно и над сеткой 18 плиток мечты без прокрутки (FR-03). Дальше от угла (К-10, FG-09): коробка
      кнопки — по краю контента (20 px от края экрана), сверху ≥ 24 px; с вырезом — под строкой статуса
      (`env(safe-area-inset-top)`; без `viewport-fit=cover` он 0).
    -->
    <div class="sticky top-0 z-10 -mx-5 -mt-5 bg-canvas px-5 pb-2 pt-[max(24px,calc(env(safe-area-inset-top)_+_8px))]" data-start-head>
      <!-- Высота строки — по кнопке (32): без «Пропустить» полоса не прыгает вверх. -->
      <div class="flex min-h-8 items-center gap-3">
        <div v-if="step === 'intro'" class="flex flex-1 items-center gap-1.5" aria-hidden="true" data-intro-dots>
          <span v-for="(s, i) in INTRO" :key="s.key" class="h-1.5 rounded-full transition-all" :class="i === introPage ? 'w-5 bg-brand' : 'w-1.5 bg-track'" />
        </div>
        <!-- Один шаг (партнёр по коду) — без полосы: «1 из 1» ничего не говорит (`/ux` Блока 1). -->
        <Stepper v-else-if="counted.length > 1" :n="stepIndex" :k="counted.length" class="flex-1" />
        <span v-else class="flex-1" />
        <Button v-if="skippable" variant="ghost" size="sm" class="shrink-0" data-skip @click="skipStep">Пропустить</Button>
      </div>
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

    <!-- Шаг 1: на что копим (B2C-18) — первым (Р-2). -->
    <GoalNew v-else-if="step === 'dream'" next="/start/spend" />

    <!--
      Шаг 2: «Тратьте как обычно» — фото мечты, одна брендовая кнопка по пути, тихое «Позже». Плитки-пути — только на
      iPhone с Apple Pay (два пути); с одним путём выбирать нечего (Р-10 «Хвостов»).
    -->
    <template v-else-if="step === 'spend'">
      <DreamHero v-if="dream" size="preview" :line="dream.name" :src="dreamSrc" data-start-dream />
      <div v-else class="grid min-h-[180px] place-items-center rounded-card bg-surface-2 text-[15px] font-semibold text-ink-2" data-start-dream>Мечта</div>
      <div>
        <h1 class="type-h2-lg text-ink">{{ title }}</h1>
        <p class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{{ sub }}</p>
      </div>
      <div v-if="applePayShown" class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="press flex cursor-pointer flex-col items-center gap-1.5 rounded-[16px] border-[1.5px] px-3 py-4 text-[14px] font-semibold"
          :class="path === 'statement' ? 'border-ink bg-surface text-ink' : 'border-line bg-surface text-ink-2'"
          :aria-pressed="path === 'statement'"
          data-start-path="statement"
          @click="path = 'statement'"
        >
          <PhFileArrowUp :size="20" />Выписка
        </button>
        <button
          type="button"
          class="press flex cursor-pointer flex-col items-center gap-1.5 rounded-[16px] border-[1.5px] px-3 py-4 text-[14px] font-semibold"
          :class="path === 'applepay' ? 'border-ink bg-surface text-ink' : 'border-line bg-surface text-ink-2'"
          :aria-pressed="path === 'applepay'"
          data-start-path="applepay"
          @click="path = 'applepay'"
        >
          <PhAppleLogo :size="20" weight="fill" />Apple Pay
        </button>
      </div>
      <!-- Одна строка + подсказка (правило 12: пояснение длиннее строки — в Hint). -->
      <Callout v-if="chosen === 'statement'" tone="neutral" icon="lock">
        <span class="inline-flex items-center gap-1.5">Файл остаётся на телефоне <Hint>Kaspi или Freedom: «Выписка → PDF». На сервер попадают только продавец, дата, сумма и раздел — без номеров и ФИО.</Hint></span>
      </Callout>
      <Callout v-for="e in errors" :key="e.name" tone="warn">
        {{ e.name }}: {{ e.message }}<span v-if="e.detail" class="block text-[12px] text-ink-2">{{ e.detail }}</span>
      </Callout>
      <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
      <div class="mt-auto flex flex-col gap-2 pt-2">
        <Button v-if="chosen === 'statement'" size="lg" class="w-full" :disabled="reading" data-start-upload @click="fileInput?.click()">
          {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
        </Button>
        <Button v-else size="lg" class="w-full" data-start-applepay @click="chooseApplePay">Подключить Apple Pay</Button>
        <Button variant="outline" size="md" class="mx-auto flex w-fit" data-start-later @click="afterSpend">Позже</Button>
      </div>
    </template>

    <!-- Шаг 3: партнёр -->
    <template v-else-if="step === 'invite'">
      <div>
        <h1 class="type-h2-lg text-ink">{{ title }}</h1>
        <p class="mt-1.5 text-[14px] leading-relaxed text-ink-2">{{ sub }}</p>
      </div>
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
          <!-- Знак «?» — сразу за последним словом, «По коду» не рвётся (`/ux` Блока 1: было «По / коду» и знак сбоку). -->
          <p class="max-w-[300px] text-balance text-[12.5px] leading-relaxed text-ink-2">
            Продиктуйте партнёру — он выберет «По&nbsp;коду» <Hint class="align-middle">Партнёр открывает тот же адрес, входит через Google и выбирает «По коду». Код действует две недели и срабатывает один раз.</Hint>
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
