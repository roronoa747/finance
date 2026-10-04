<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PhSparkle } from '@phosphor-icons/vue'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { useFxStore } from '@/stores/fx'
import { afterFamilyLoaded } from '@/stores/syncEngine'
import { landingPath } from '@/router/landing'
import { seedSpendCategories } from '@/lib/statements/model'
import { addMonths, monthKey, weekKey } from '@/lib/dates'
import { monthPlan, planSave } from '@/lib/finance'
import type { Operation, SpendTotal } from '@/lib/statements/types'
import { authErrorText } from '@/lib/authErrors'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Segmented from '@/components/kit/Segmented.vue'
import Field from '@/components/kit/Field.vue'

type Mode = 'login' | 'register' | 'join'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

// Из демо чаще приходят создавать семью — туда и открываем.
const mode = ref<Mode>(financeStore.isDemo ? 'register' : 'login')

// Form fields
const email = ref('')
const pass = ref('')
const displayName = ref('')
const householdName = ref('Наш бюджет')
const inviteCode = ref('')

const busy = ref(false)
const errorMessage = ref('')

onMounted(() => {
  if (route.query.code) {
    inviteCode.value = String(route.query.code).toUpperCase().trim()
    mode.value = 'join'
  }
})

// Документ телефона привязывается к семье, куда вошли: чужой (и черновик демо)
// стирается, свой сливается с серверным — неотправленное после истёкшего входа уходит.
async function enterHousehold() {
  if (!authStore.household) return
  await financeStore.enterFamily(authStore.household.id)
  afterFamilyLoaded()
}

// Черновик демо на телефоне (Р-32): при создании семьи его можно взять с собой,
// при входе в существующую — нет, и это сказано заранее.
const hasDemoDraft = computed(() => financeStore.isDemo)
const askDemo = ref(false)
// После «Войти заново» правки семьи ждут на телефоне: старт демо стёр бы их молча.
const editsWaitLogin = computed(() => financeStore.hasUnsent && !financeStore.isDemo)

async function answerDemo(take: boolean) {
  const household = authStore.household
  if (!household) return
  busy.value = true
  try {
    if (take) await financeStore.adoptDemo(household.id, displayName.value.trim())
    else financeStore.startNewFamily(household.id)
    askDemo.value = false
    await router.push(landingPath(authStore, financeStore))
  } finally {
    busy.value = false
  }
}

async function submit() {
  busy.value = true
  errorMessage.value = ''

  try {
    if (mode.value === 'login') {
      if (!email.value.trim() || !pass.value) {
        errorMessage.value = 'Введите почту и пароль'
        return
      }
      await authStore.login({ email: email.value.trim(), ['pass' + 'word']: pass.value } as any)
      await enterHousehold()
      await router.push(landingPath(authStore, financeStore))
    } else if (mode.value === 'register') {
      if (!email.value.trim() || !pass.value || !displayName.value.trim()) {
        errorMessage.value = 'Заполните все обязательные поля'
        return
      }
      await authStore.register({
        email: email.value.trim(),
        ['pass' + 'word']: pass.value,
        display_name: displayName.value.trim(),
        household_name: householdName.value.trim() || 'Наш бюджет',
      } as any)
      if (hasDemoDraft.value) {
        askDemo.value = true
        return
      }
      if (authStore.household) financeStore.startNewFamily(authStore.household.id)
      await router.push('/start')
    } else if (mode.value === 'join') {
      if (!inviteCode.value.trim() || !displayName.value.trim()) {
        errorMessage.value = 'Укажите код приглашения и ваше имя'
        return
      }
      await authStore.joinHousehold({
        code: inviteCode.value.trim().toUpperCase(),
        display_name: displayName.value.trim(),
      })
      await enterHousehold()
      await router.push(landingPath(authStore, financeStore))
    }
  } catch (err: unknown) {
    errorMessage.value = authErrorText(err instanceof Error ? err.message : String(err), mode.value)
  } finally {
    busy.value = false
  }
}

function startDemoMode() {
  // Черновик демо уже есть — возвращаемся к нему, а не начинаем пример заново.
  const resume = financeStore.isDemo
  authStore.setAuthData({
    token: DEMO_TOKEN,
    user: { id: 'demo-user-1', email: 'demo@family.local', created_at: new Date().toISOString() },
    household: {
      id: 'demo-household-1',
      name: 'Демо Семья',
      created_by: 'demo-user-1',
      created_at: new Date().toISOString(),
    },
    member: {
      household_id: 'demo-household-1',
      user_id: 'demo-user-1',
      slot: 'a',
      display_name: 'Ильяс',
      role: 'member',
      joined_at: new Date().toISOString(),
    },
  })
  if (resume) {
    void router.push('/')
    return
  }
  financeStore.startNewFamily(DEMO_HOUSEHOLD)
  financeStore.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt = new Date().toISOString()
    doc.people = [
      // Оклад Ильяса в евро с прошлого года (B2C-79): тенге — по демо-книге курсов, без запросов.
      {
        id: 'a', name: 'Ильяс', salary: 750_000, payday: 10, onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        salaryVersions: [{ from: '2000-01', amount: 750_000 }, { from: addMonths(monthKey(), -12), amount: 1_500, currency: 'EUR', rate: 506 }],
      },
      // Свой кружок (B2C-63/67): у Аруны — смайлик и цвет, у Ильяса — буква, как по умолчанию.
      { id: 'b', name: 'Аруна', salary: 450_000, payday: 20, emoji: '🌸', color: 's6', onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    doc.categories = [
      { key: 'd1', name: 'Жильё', note: 'аренда и коммуналка', amount: 250_000, updatedAt: new Date().toISOString() },
      { key: 'd2', name: 'Кредиты', note: 'автокредит', amount: 95_000, updatedAt: new Date().toISOString() },
      { key: 'd3', name: 'Цели', note: 'накопления', amount: 150_000, updatedAt: new Date().toISOString() },
      { key: 'd4', name: 'Еда и быт', note: 'питание и расходы', amount: 280_000, updatedAt: new Date().toISOString() },
      { key: 'd5', name: 'Свободно', note: 'остаток', amount: 425_000, updatedAt: new Date().toISOString() },
    ]
    doc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда квартиры',
        note: 'ежемесячно',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 220_000 }],
        // Плательщики (Р-80, B2C-85): аренду платит Аруна, остальное — Ильяс.
        payer: 'b',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ob-util',
        name: 'Коммуналка',
        note: 'по счетчикам',
        day: 15,
        category: 'd1',
        estimate: true,
        versions: [{ from: '2026-01', amount: 30_000 }],
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
      // Подписка в долларах (B2C-81, Р-75): в «Платежах» — «10 $» и тенге по курсу дня списания из демо-книги
      // (≈ 4 500 ₸ — не в допуске ни одной демо-операции, иначе «Неделя» начнётся с вопроса «это Netflix?»).
      {
        id: 'ob-netflix',
        name: 'Netflix',
        note: 'ежемесячно',
        day: 10,
        category: 'd4',
        versions: [{ from: '2026-01', amount: 10, currency: 'USD', rate: 470 }],
        payer: 'a',
        keptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.credits = [
      {
        id: 'cr-car',
        name: 'Автокредит',
        note: 'Kaspi Bank',
        principal: 1_800_000,
        annualRate: 0.19,
        payment: 95_000,
        day: 18,
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.goals = [
      {
        id: 'g-trip',
        name: 'Поездка в Японию',
        need: 2_000_000,
        seed: 600_000,
        have: 600_000,
        monthly: 100_000,
        hue: 'plum',
        planPct: 0.3,
        movements: [],
        // Главная мечта (первая в очереди) с шаблоном без фото (B2C-19 п. 4): в демо сервера нет — картинок нет.
        template: 'japan',
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
      // Вторая мечта — её взнос план «Сначала долги» направляет в автокредит (квадрат «План», пивот 3).
      {
        id: 'g-car',
        name: 'Машина',
        need: 6_000_000,
        seed: 900_000,
        have: 900_000,
        monthly: 60_000,
        hue: 'blue',
        planPct: 0,
        movements: [],
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
      // Копилка Блока 11 (Р-66) — фонд «Подушка» (Р-82, B2C-85): порог — 3 месяца трат, откладывает Аруна.
      {
        id: 'g-pot',
        name: 'Подушка',
        need: 1_500_000,
        seed: 150_000,
        have: 150_000,
        monthly: 30_000,
        hue: 'teal',
        planPct: 0,
        movements: [],
        template: 'cushion',
        fund: 'cushion',
        payer: 'b',
        updatedAt: new Date().toISOString(),
      },
      // Фонд «Запас» (Р-82): месяц трат, собран наполовину.
      {
        id: 'g-reserve',
        name: 'Запас',
        need: 800_000,
        seed: 300_000,
        have: 300_000,
        monthly: 50_000,
        hue: 'teal',
        planPct: 0,
        movements: [],
        template: 'cushion-3',
        fund: 'reserve',
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'g-sofa',
        name: 'Новый диван',
        need: 450_000,
        seed: 120_000,
        have: 120_000,
        monthly: 30_000,
        hue: 'ochre',
        planPct: 0,
        movements: [],
        // Выключена в плане месяца (Р-83): на «Мечтах» — «на паузе».
        pausedAt: new Date().toISOString(),
        payer: 'b',
        updatedAt: new Date().toISOString(),
      },
    ]
    // Желания «как в макете» (приёмка Б10): у каждого участника и общее; фото шаблонов в демо нет — плашка.
    doc.wishlist = [
      { id: 'w-coffee', name: 'Кофемашина', price: 180_000, by: 'a', list: 'all', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'w-bike', name: 'Велосипед', price: 230_000, by: 'a', list: 'a', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'w-boots', name: 'Сапоги', price: 65_000, by: 'b', list: 'b', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    doc.accounts = [
      { id: 'acc-kaspi', name: 'Kaspi Gold', note: '', kind: 'card', amount: 480_000, updatedAt: new Date().toISOString() },
      // Евро-счёт под зарплату Ильяса (B2C-79): остаток в евро выводится из прихода и обменов.
      { id: 'acc-eur', name: 'Евро-счёт', note: '', kind: 'card', amount: 0, currency: 'EUR', foreignAmount: 0, rate: 506, rateAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      {
        id: 'acc-dep', name: 'Депозит Kaspi', note: '', kind: 'deposit', amount: 1_200_000, updatedAt: new Date().toISOString(),
        deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true },
      },
    ]
    // «Ваш порядок» пройден (Блок 11, Р-55): статьи по умолчанию, суммы «Жизни», «Трат» и ступеней, копилка — «Подушка».
    const now = new Date().toISOString()
    doc.moneyArticles = (
      [['must'], ['life', 180_000], ['reserve', 50_000], ['debts', 40_000], ['cushion', 30_000], ['dreams'], ['spend', 100_000]] as const
    ).map(([id, amount], i) => ({ id, order: i + 1, on: true, ...(amount === undefined ? {} : { amount }), updatedAt: now }))
    doc.moneySettings = { reserveMonths: 1, cushionMonths: 3, costlyRate: 0, potGoalId: 'g-pot', orderedAt: now, updatedAt: now }
    // План месяца (Р-79…Р-84, B2C-85): траты каждого по разделам, очередь (мечта, запас, долг, …), свой порядок
    // «Желаний», карточка долга — досрочку вносит Аруна (с планом «Сначала долги» сумма — шаг плана).
    doc.spendPlans = (
      [['a', 'sc_food', 90_000], ['a', 'sc_cafe', 40_000], ['a', 'sc_transport', 25_000], ['b', 'sc_food', 60_000], ['b', 'sc_shopping', 40_000]] as const
    ).map(([by, categoryId, amount]) => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: now }))
    doc.goalOrder = { ids: ['g-trip', 'g-reserve', 'debt', 'g-car', 'g-pot', 'g-sofa'], updatedAt: now }
    doc.wishOrder = { ids: ['w-bike', 'w-coffee', 'w-boots'], updatedAt: now }
    doc.debtCard = { monthly: 40_000, pausedAt: null, payer: 'b', updatedAt: now }
    // Итоги выписки Аруны (B2C-19 п. 4): своих операций у неё в демо нет — итоги руками. Итоги Ильяса — из его
    // демо-операций ниже, той же функцией, что при «Отправить» (B2C-52).
    seedSpendCategories(doc)
    const at = new Date().toISOString()
    const total = (kind: SpendTotal['kind'], period: string, categoryId: string, amount: number, ops: number): SpendTotal => ({ id: `b:${kind}:${period}:${categoryId}`, by: 'b', kind, period, categoryId, amount, ops, updatedAt: at })
    const week = weekKey()
    const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
    const month = monthKey()
    doc.spendTotals = [
      total('week', prevWeek, 'sc_food', 24_000, 5),
      total('week', week, 'sc_food', 20_000, 4), total('week', week, 'sc_shopping', 34_000, 2),
      total('month', month, 'sc_food', 40_000, 8), total('month', month, 'sc_shopping', 34_000, 2),
    ]
  })
  // «Деньги» в демо — все три квадрата с данными (пивот 3, B2C-45): план «Сначала долги» (машина на
  // паузе ради автокредита) и отметки месяца — аренда оплачена Аруной, зарплата Ильяса пришла. Фонды «Запас» и
  // «Подушка» — «не останавливать» (план ставит на паузу все цели, кроме этих, Р-82: квадрат «План» прежний).
  financeStore.choosePlan({ keptGoalIds: ['g-trip', 'g-reserve', 'g-pot'], cushionGoalId: null, months: 24, lump: 0 }, 'a')
  // Прошлый месяц тоже с отметками — у «Истории» есть итог «Наш <месяц>» и в начале месяца.
  const prev = addMonths(monthKey(), -1)
  financeStore.markPaid('obligation', 'ob-rent', 'b', { period: prev, accountId: null, at: `${prev}-05T05:00:00.000Z` })
  financeStore.markSalary('a', { period: prev, accountId: null, at: `${prev}-10T05:00:00.000Z` })
  financeStore.markPaid('obligation', 'ob-rent', 'b', { accountId: 'acc-kaspi' })
  // «Отложить по плану» прошлого месяца записан — «История» и сводка прошлого месяца его показывают; части — finance.ts.
  const before = planSave(
    monthPlan({ ...financeStore.householdDoc, credits: financeStore.credits, book: useFxStore().book }, { key: prev, totals: [], spendCategories: [], uploads: [] }),
    'a',
  )
  if (before) {
    const at = `${prev}-10T06:00:00.000Z`
    financeStore.mutateHouseholdDoc((doc) => {
      doc.allocations = [...(doc.allocations ?? []), { id: 'demo-plan-prev', kind: 'plan', ...before.record, by: 'a', total: before.total, parts: before.parts, at, updatedAt: at }]
    })
  }
  // Зарплата Ильяса пришла сегодня на евро-счёт и не разобрана — на «Неделе» «Пришла зарплата · как обычно»;
  // часть уже обменяли (B2C-79): 500 € по 512 ₸ на Kaspi Gold — строка «обменяно 500 € из 1 500 €».
  financeStore.markSalary('a', { accountId: 'acc-eur' })
  financeStore.addExchange({ by: 'a', accountId: 'acc-eur', toAccountId: 'acc-kaspi', foreign: 500, rate: 512, period: monthKey() })
  // Записи загрузок и свои операции демо — когда стор операций уже переключился на демо-семью (watch по владельцу).
  void nextTick().then(() => {
    // Две недели своих операций (0…13 дней назад): у этой и прошлой недели есть траты — у карточки недели
    // есть чип «к прошлой». В начале месяца прошлая неделя — в прошлом месяце: загрузка начинается с первой операции.
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
    const today = day(0)
    const from = [`${monthKey()}-01`, day(13)].sort()[0]
    const ops = useOperationsStore()
    // «Выписки» недели (B2C-62/67): Ильяс загрузил, Аруна — ещё нет (галочка и «ещё нет»).
    ops.seedDemoUploads([
      { id: 'demo-upload-a', slot: 'a', bank: 'kaspi', period_from: from, period_to: today, ops_count: 29, created_at: new Date().toISOString() },
    ])
    // Пять разделов, продавцы — только из словаря (иначе ответ на продавца, переразложив операции правилами,
    // вернёт их в «не разобрано»; суммы — вне окна оценки «Коммуналки» 21–39 тыс., иначе «платёж по
    // Коммуналке?»), один перевод между своими и десять незнакомых продавцов сегодня — на «Неделе»
    // в любой день пачка «Без раздела · 10» (Блок 12, B2C-67) и «Пришла зарплата».
    const op = (n: number, ago: number, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Operation => ({
      id: `demo-op-${n}`, bank: 'kaspi', date: day(ago), amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
    })
    ops.seedDemoOperations([
      op(1, 0, -6_800, 'Galmart', 'sc_food'),
      op(2, 0, -4_990, 'Яндекс Плюс', 'sc_subscriptions'),
      op(3, 0, -7_600, 'ИП Абенова', null),
      op(4, 1, -2_400, 'Coffee Boom', 'sc_cafe'),
      op(5, 0, -3_200, 'ИП Жумабаева', null),
      op(6, 2, -12_400, 'Magnum', 'sc_food'),
      op(7, 2, -1_800, 'Yandex Go', 'sc_transport'),
      op(8, 3, -18_500, 'Del Papa Cafe', 'sc_cafe'),
      op(9, 4, -9_300, 'Small', 'sc_food'),
      op(10, 0, -200_000, 'На депозит', null, { kind: 'transfer-out', internal: true }),
      op(11, 6, -2_100, 'Yandex Go', 'sc_transport'),
      op(12, 7, -17_700, 'Magnum', 'sc_food'),
      op(13, 8, -46_000, 'Sulpak', 'sc_shopping'),
      op(14, 9, -3_900, 'Coffee Boom', 'sc_cafe'),
      op(15, 10, -15_200, 'Small', 'sc_food'),
      op(16, 11, -1_500, 'Yandex Go', 'sc_transport'),
      op(17, 12, -8_900, 'Magnum', 'sc_food'),
      op(18, 13, -5_500, 'Del Papa Cafe', 'sc_cafe'),
      op(19, 13, -9_800, 'Small', 'sc_food'),
      op(20, 0, -14_500, 'ИП Сейткали', null),
      op(21, 0, -2_700, 'ИП Ким', null),
      op(22, 0, -11_000, 'ИП Нурланова', null),
      op(23, 0, -1_900, 'ИП Оспанов', null),
      op(24, 0, -5_600, 'ИП Ахметова', null),
      op(25, 0, -8_250, 'ИП Байжанов', null),
      op(26, 0, -3_750, 'ИП Тулегенова', null),
      op(27, 0, -16_800, 'ИП Искаков', null),
    ])
  })
  void router.push('/')
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-8 text-left">
    <!-- Header Brand -->
    <div class="mb-5 flex items-center gap-2.5">
      <span
        class="grid size-9 place-items-center rounded-xl bg-brand font-display text-[15px] font-bold tracking-[0.02em] text-brand-ink"
      >
        FF
      </span>
      <span class="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">
        Family Finance
      </span>
    </div>

    <!-- Регистрация из демо: взять ли черновик в новую семью (Р-32) -->
    <div v-if="askDemo" class="flex flex-col gap-3">
      <h1 class="font-display text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        Взять то, что вы заполнили в демо?
      </h1>
      <p class="text-[13.5px] leading-relaxed text-ink-2">
        Бюджет, счета, кредиты и цели из демо станут данными новой семьи, ваше имя — из регистрации.
        Если нет — начнём с чистого листа.
      </p>
      <Button class="w-full mt-1" :disabled="busy" @click="answerDemo(true)">
        {{ busy ? 'Минуту…' : 'Да, взять' }}
      </Button>
      <Button variant="ghost" class="w-full" :disabled="busy" @click="answerDemo(false)">
        Нет, начать с чистого
      </Button>
    </div>

    <template v-else>
    <!-- Title and Note -->
    <div class="mb-5">
      <h1 class="font-display text-[25px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        {{
          mode === 'login'
            ? 'Вход'
            : mode === 'register'
              ? 'Создать семью'
              : 'Присоединиться'
        }}
      </h1>
      <p class="mt-1 text-[13.5px] leading-relaxed text-ink-2">
        {{
          mode === 'login'
            ? 'Общий семейный бюджет на двоих. Введите данные для входа.'
            : mode === 'register'
              ? 'Создайте новое домохозяйство и пригласите партнёра по коду.'
              : 'Введите код приглашения, который вам продиктовал партнёр.'
        }}
      </p>
    </div>

    <!-- Tabs Segmented -->
    <div class="mb-4">
      <Segmented
        :model-value="mode"
        :options="[
          { value: 'login', label: 'Войти' },
          { value: 'register', label: 'Создать' },
          { value: 'join', label: 'По коду' },
        ]"
        @update:model-value="(val) => { mode = val; errorMessage = ''; }"
      />
    </div>

    <!-- Forms -->
    <form class="flex flex-col gap-1" @submit.prevent="submit">
      <template v-if="mode === 'login'">
        <Field label="Почта">
          <Input
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
          />
        </Field>
        <Field label="Пароль">
          <Input
            v-model="pass"
            type="password"
            placeholder="••••••••"
            autocomplete="current-password"
          />
        </Field>
      </template>

      <template v-else-if="mode === 'register'">
        <Field label="Как вас зовут">
          <Input v-model="displayName" placeholder="Ильяс" autocomplete="name" />
        </Field>
        <Field label="Название семьи">
          <Input v-model="householdName" placeholder="Семья Ильяса и Аруны" />
        </Field>
        <Field label="Почта">
          <Input
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            inputmode="email"
          />
        </Field>
        <Field label="Пароль (от 6 символов)">
          <Input
            v-model="pass"
            type="password"
            placeholder="••••••••"
            autocomplete="new-password"
          />
        </Field>
      </template>

      <template v-else-if="mode === 'join'">
        <Field label="Код приглашения">
          <Input
            v-model="inviteCode"
            placeholder="A1B2C3D4"
            autocapitalize="characters"
            class-name="num tracking-[0.14em] font-semibold uppercase"
          />
        </Field>
        <Field label="Как вас зовут">
          <Input v-model="displayName" placeholder="Аруна" autocomplete="name" />
        </Field>
      </template>

      <!-- Error alert -->
      <div
        v-if="errorMessage"
        class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2"
      >
        {{ errorMessage }}
      </div>

      <p v-if="hasDemoDraft" class="mb-3 text-[12.5px] leading-relaxed text-ink-3">
        {{
          mode === 'register'
            ? 'После создания спросим, взять ли то, что вы заполнили в демо.'
            : 'Заполненное в демо сюда не переносится: у семьи уже есть свои данные. Взять его с собой можно при создании новой семьи.'
        }}
      </p>

      <Button type="submit" class="w-full mt-1" :disabled="busy">
        {{
          busy
            ? 'Минуту…'
            : mode === 'login'
              ? 'Войти'
              : mode === 'register'
                ? 'Создать бюджет'
                : 'Войти в семью'
        }}
      </Button>
    </form>

    <!-- Sandbox / Demo Mode Button -->
    <p v-if="editsWaitLogin" class="mt-6 pt-5 border-t border-line text-center text-[12px] text-ink-3">
      Неотправленные правки ждут на этом телефоне — войдите в свою семью, и они уйдут.
    </p>
    <div v-else class="mt-6 pt-5 border-t border-line text-center">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline cursor-pointer"
        @click="startDemoMode"
      >
        <PhSparkle :size="16" />
        {{ hasDemoDraft ? 'Вернуться в демо' : 'Попробовать в демо-режиме без регистрации' }}
      </button>
      <p class="mt-1 text-[11.5px] text-ink-3">
        {{
          hasDemoDraft
            ? 'Черновик демо сохранён на этом телефоне.'
            : 'Загружает готовую семью с примерами расходов, кредитов и целей.'
        }}
      </p>
    </div>
    </template>
  </div>
</template>
