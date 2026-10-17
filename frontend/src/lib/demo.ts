import { nextTick } from 'vue'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { useFxStore } from '@/stores/fx'
import { seedSpendCategories } from '@/lib/statements/model'
import { addMonths, monthKey, weekKey, weekRange } from '@/lib/dates'
import { monthPlan, planSave, termSnapOf } from '@/lib/finance'
import { templateById, templateCredit } from '@/lib/goalTemplates'
import { DEMO_PHOTO } from '@/lib/photos/store'
import type { Operation, SpendTotal } from '@/lib/statements/types'

/**
 * Разбор месяца демо-семьи (бэклог «ИИ», Р-10, AI-10): заранее написанный, без запроса — в демо «Разобрать» показывает
 * его с пометкой «Пример». Дисциплина Р-3: каждое число — из сводки демо (`buildMonthSummary`) и не зависит от дня
 * месяца (тест `demo.review.test.ts` сверяет на разных датах). Слова утвердил владелец (артефакт `/ux`, 2026-10-16):
 * короткий, как живой разбор; шаг 3 — досрочка в автокредит по плану «Сначала долги» уже идёт, совет её держать.
 */
export const DEMO_REVIEW = {
  good: 'На поездку в Японию уже собрано 600 000 ₸.',
  risk: 'Автокредит под 19% — самый дорогой долг.',
  steps: [
    { text: 'Разнести траты без раздела', screen: '/week' },
    { text: 'Сверить траты с планом', screen: '/month' },
    { text: 'Держать досрочку автокредита', screen: '/money/debts' },
  ],
}

/** День `ago` суток назад — как у демо-операций (`day` ниже): даты поездки и операции совпадают. */
const daysAgo = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)

/** Фото цели демо из бандла (`assets/demo`) с автором шаблона — как у цели, заведённой из шаблона (Р-28). */
function demoPhoto(file: string, template: string) {
  const t = templateById(template)
  return { photoId: DEMO_PHOTO + file, photoCredit: t ? templateCredit(t) : null }
}

/**
 * Демо (Р-32, «Попробовать»): документ-пример на телефоне, без сервера. Черновик уже есть —
 * возвращаемся к нему, а не начинаем пример заново. Дальше экран переходит на «/». После истёкшего
 * входа неотправленные правки семьи ждут на телефоне — демо их стёрло бы молча: `false`, ничего не тронуто.
 */
export function startDemo(): boolean {
  const authStore = useAuthStore()
  const financeStore = useFinanceStore()
  if (financeStore.hasUnsent && !financeStore.isDemo) return false
  // Черновик демо уже есть — возвращаемся к нему, а не начинаем пример заново.
  const resume = financeStore.isDemo
  authStore.setAuthData({
    token: DEMO_TOKEN,
    user: { id: 'demo-user-1', email: 'demo@family.local', created_at: new Date().toISOString() },
    household: {
      id: 'demo-household-1',
      // Люди демо — «Вы» и «Партнёр», без наших имён (Р-118).
      name: 'Семья',
      created_by: 'demo-user-1',
      created_at: new Date().toISOString(),
    },
    member: {
      household_id: 'demo-household-1',
      user_id: 'demo-user-1',
      slot: 'a',
      display_name: 'Вы',
      role: 'member',
      joined_at: new Date().toISOString(),
    },
  })
  if (resume) return true
  financeStore.startNewFamily(DEMO_HOUSEHOLD)
  financeStore.mutateHouseholdDoc((doc) => {
    doc.setupDoneAt = new Date().toISOString()
    doc.people = [
      // Оклад участника a в евро с прошлого года (B2C-79): тенге — по демо-книге курсов, без запросов.
      {
        id: 'a', name: 'Вы', salary: 750_000, payday: 10, onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        salaryVersions: [{ from: '2000-01', amount: 750_000 }, { from: addMonths(monthKey(), -12), amount: 1_500, currency: 'EUR', rate: 506 }],
      },
      // Свой кружок (B2C-63/67): у партнёра — свой цвет, у обоих — буква, как по умолчанию (макет Б17: «В», «П»).
      // Ритм «аванс и зарплата» (понятность Б7, PN-25): аванс 15-го 150 000, остаток 300 000 — 30-го; сумма месяца прежняя.
      { id: 'b', name: 'Партнёр', salary: 450_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 150_000, color: 's6', onboardedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
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
        // Плательщики (Р-80, B2C-85): аренду платит партнёр b, остальное — участник a.
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
      // Ещё две подписки (Блок 15, Р-93): в «Месяце» и «Деньгах» — одной строкой «Подписки · 3». «Яндекс Плюс»
      // списался сегодня (операция демо ниже) — за «!» вопрос «это платёж по Яндекс Плюс?»; у Spotify ответа
      // «оставить» ещё не было — там же «Оставить подписку?».
      {
        id: 'ob-yandex',
        name: 'Яндекс Плюс',
        note: 'ежемесячно',
        day: Math.min(new Date().getDate(), 28),
        category: 'd4',
        versions: [{ from: '2026-01', amount: 4_990 }],
        payer: 'a',
        keptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ob-spotify',
        name: 'Spotify',
        note: 'ежемесячно',
        day: 22,
        category: 'd4',
        versions: [{ from: '2026-01', amount: 2_990 }],
        payer: 'b',
        // «Чья» (понятность Б8, PN-29): подписка партнёра — раскрытые «Подписки» делятся на «Общие · 2» и «Партнёр · 1».
        who: 'b',
        updatedAt: new Date().toISOString(),
      },
      // Платёж людям (мелочи Р-5): в «Долгах» — строкой «Людям · 1», в плане месяца — обычный платёж.
      {
        id: 'ob-mom',
        name: 'Маме',
        note: 'ежемесячно',
        day: 5,
        category: 'd4',
        people: true,
        versions: [{ from: '2026-01', amount: 50_000 }],
        payer: 'b',
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
      // Второй долг с процентами (AU-08, Р-7): на «Долгах» — строка «первым — Автокредит: ставка 19 % — самая высокая».
      {
        id: 'cr-repair',
        name: 'Кредит на ремонт',
        note: 'Halyk',
        principal: 400_000,
        annualRate: 0.14,
        payment: 25_000,
        day: 8,
        payer: 'b',
        updatedAt: new Date().toISOString(),
      },
      // Долг человеку (мелочи Р-5): без процентов, «Отдал» в строке «Долгов»; план «Сначала долги» его не досрочит.
      {
        id: 'cr-bro',
        name: 'Брату',
        note: '',
        principal: 300_000,
        annualRate: 0,
        payment: 50_000,
        day: 25,
        person: true,
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
    ]
    doc.goals = [
      {
        id: 'g-trip',
        name: 'Поездка в Японию',
        need: 2_000_000,
        // Взнос этого месяца (PN-09): под героем «Мечт» — «ближе на 15 дней» (50 000 при 100 000 в месяц); накопленное
        // прежнее — `have` = `seed` + взносы.
        seed: 550_000,
        have: 600_000,
        monthly: 100_000,
        hue: 'plum',
        planPct: 0.3,
        movements: [{ id: 'demo-put-trip', date: `${monthKey()}-01T06:00:00.000Z`, amount: 50_000, by: 'a', note: 'отложил' }],
        // Фото демо — из приложения (Р-118): сервера в демо нет, картинка шаблона лежит в бандле.
        template: 'japan',
        ...demoPhoto('japan', 'japan'),
        payer: 'a',
        // Поездка (PN-32): прошла 26…20 дней назад — на экране цели «За поездку — N из M» (траты a — его демо-операции
        // этих дней, партнёра b — записью ниже). Дни — «N дней назад», как у операций: в даты всегда те же четыре строки, от
        // дня недели не зависит; «в пути» заменило бы у героя «ближе на 15 дней» и забрало бы сегодняшние «ИП …».
        from: daysAgo(26),
        to: daysAgo(20),
        budget: 400_000,
        updatedAt: new Date().toISOString(),
      },
      // Вторая мечта — её взнос план «Сначала долги» направляет в автокредит (квадрат «Долги», пивот 3).
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
        template: 'car',
        ...demoPhoto('car', 'car'),
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
      // Копилка Блока 11 (Р-66) — фонд «Подушка» (Р-82, B2C-85): порог — 3 месяца трат, откладывает партнёр b.
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
        ...demoPhoto('cushion', 'cushion'),
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
        ...demoPhoto('cushion-3', 'cushion-3'),
        fund: 'reserve',
        // Лежит на Kaspi Gold (Блок 16, Р-109): в «Цели · N» «Капитала» — «на Kaspi Gold», вне суммы.
        accountId: 'acc-kaspi',
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
        // Тема «Мебель» (PN-07) — новая тема видна в демо; картинка остаётся демо-файлом.
        template: 'furniture',
        photoId: DEMO_PHOTO + 'sofa',
        // Выключена в плане месяца (Р-83): на «Мечтах» — «на паузе».
        pausedAt: new Date().toISOString(),
        payer: 'b',
        updatedAt: new Date().toISOString(),
      },
      // Сбылась (PN-15, Р-13): четыре взноса, куплена три месяца назад — «за 4 месяца», альбом «Сбылось · 1»; деньги ушли
      // покупкой — в капитале и очереди её нет. Фото — то же, что у желания «Велосипед» (Mikkel Bech), автора у цели нет.
      {
        id: 'g-bike',
        name: 'Велосипед',
        need: 230_000,
        seed: 0,
        have: 230_000,
        monthly: 57_500,
        hue: 'green',
        planPct: 0,
        movements: [-7, -6, -5, -4].map((n) => ({
          id: `demo-put-bike${n}`,
          date: `${addMonths(monthKey(), n)}-12T06:00:00.000Z`,
          amount: 57_500,
          by: 'a' as const,
        })),
        template: 'sport',
        photoId: DEMO_PHOTO + 'bike',
        doneAt: `${addMonths(monthKey(), -3)}-12T08:00:00.000Z`,
        payer: 'a',
        updatedAt: new Date().toISOString(),
      },
    ]
    // Желания «как в макете» (приёмка Б10): у каждого участника и общее; фото — из приложения (Р-118), Unsplash:
    // велосипед — Mikkel Bech, кофемашина — Kevin Schmid, сапоги — Zac Wolff; диван у цели — картинка макета Б17.
    doc.wishlist = [
      { id: 'w-coffee', name: 'Кофемашина', photoId: DEMO_PHOTO + 'coffee', price: 180_000, by: 'a', list: 'all', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'w-bike', name: 'Велосипед', photoId: DEMO_PHOTO + 'bike', price: 230_000, by: 'a', list: 'a', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'w-boots', name: 'Сапоги', photoId: DEMO_PHOTO + 'boots', price: 65_000, by: 'b', list: 'b', bought: false, addedOn: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]
    doc.accounts = [
      { id: 'acc-kaspi', name: 'Kaspi Gold', note: '', kind: 'card', amount: 480_000, updatedAt: new Date().toISOString() },
      // Евро-счёт под зарплату участника a (B2C-79): остаток в евро выводится из прихода и обменов.
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
    // «Желаний», карточка долга — досрочку вносит партнёр b (с планом «Сначала долги» сумма — шаг плана).
    doc.spendPlans = (
      [['a', 'sc_food', 90_000], ['a', 'sc_cafe', 40_000], ['a', 'sc_transport', 25_000], ['b', 'sc_food', 60_000], ['b', 'sc_shopping', 40_000]] as const
    ).map(([by, categoryId, amount]) => ({ id: `${by}:${categoryId}`, by, categoryId, amount, updatedAt: now }))
    doc.goalOrder = { ids: ['g-trip', 'g-reserve', 'debt', 'g-car', 'g-pot', 'g-sofa'], updatedAt: now }
    doc.wishOrder = { ids: ['w-bike', 'w-coffee', 'w-boots'], updatedAt: now }
    doc.debtCard = { monthly: 40_000, pausedAt: null, payer: 'b', updatedAt: now }
    // Итоги выписки партнёра b (B2C-19 п. 4): своих операций у неё в демо нет — итоги руками. Итоги участника a — из его
    // демо-операций ниже, той же функцией, что при «Отправить» (B2C-52).
    seedSpendCategories(doc)
    const at = new Date().toISOString()
    const total = (kind: SpendTotal['kind'], period: string, categoryId: string, amount: number, ops: number): SpendTotal => ({ id: `b:${kind}:${period}:${categoryId}`, by: 'b', kind, period, categoryId, amount, ops, updatedAt: at })
    const week = weekKey()
    const prevWeek = weekKey(new Date(Date.now() - 7 * 86_400_000))
    const month = monthKey()
    // Три прошлых месяца b — для «обычно у вас» на «Месяце» (AU-03, Р-5): кафе обычно ~47 000 (в нём доставка), в этом
    // месяце — 95 000 (точка у «Кафе и рестораны» и «до плана» в мечту при любом дне месяца).
    const past = ([[-3, 70_000, 66_000, 44_000], [-2, 76_000, 78_000, 50_000], [-1, 73_000, 76_000, 47_000]] as const).flatMap(([n, food, shop, cafe]) => {
      const p = addMonths(month, n)
      return [total('month', p, 'sc_food', food, 11), total('month', p, 'sc_shopping', shop, 3), total('month', p, 'sc_cafe', cafe, 4)]
    })
    // Привычка b (AU-30, Р-24): доставка 4 раза в месяц на ~40 000 три прошлых месяца, как на настоящей выписке (Х-11) —
    // внутри её итогов «Кафе» (44–50 тыс.); итоги руками, как её итоги разделов. Такси a — из его демо-поездок ниже (тот
    // же `writeTotals`, что у выписки).
    doc.habitTotals = ([[-3, 38_000], [-2, 42_000], [-1, 40_000]] as const).map(([n, amount]) => {
      const period = addMonths(month, n)
      return { id: `b:${period}:delivery`, by: 'b' as const, period, habit: 'delivery' as const, count: 4, amount, updatedAt: at }
    })
    doc.spendTotals = [
      ...past,
      total('week', prevWeek, 'sc_food', 24_000, 5),
      total('week', week, 'sc_food', 20_000, 4), total('week', week, 'sc_shopping', 34_000, 2),
      total('month', month, 'sc_food', 40_000, 8), total('month', month, 'sc_shopping', 34_000, 2), total('month', month, 'sc_cafe', 95_000, 5),
    ]
    // Итог поездки партнёра b (PN-32) — руками, как её итоги разделов: общий итог «За поездку» — двоих.
    doc.tripSpends = [{ id: 'g-trip:b', goalId: 'g-trip', by: 'b', amount: 64_000, ops: 5, updatedAt: at }]
  })
  // «Деньги» в демо — все три квадрата с данными (пивот 3, B2C-45): план «Сначала долги» (машина на
  // паузе ради автокредита) и отметки месяца — аренда оплачена партнёром b, зарплата участника a пришла. Фонды «Запас» и
  // «Подушка» — «не останавливать» (план ставит на паузу все цели, кроме этих, Р-82: квадрат «Долги» прежний).
  financeStore.choosePlan({ keptGoalIds: ['g-trip', 'g-reserve', 'g-pot'], cushionGoalId: null, months: 24, lump: 0 }, 'a')
  // Прошлые три месяца с отметками — у «Истории» есть итог «Наш <месяц>» и список месяцев (Блок 16, Р-111); платежи
  // автокредита с телом — полоса «погашено» в «Долгах» (Р-110).
  const prev = addMonths(monthKey(), -1)
  for (const n of [3, 2, 1]) {
    const p = addMonths(monthKey(), -n)
    financeStore.markPaid('obligation', 'ob-rent', 'b', { period: p, accountId: null, at: `${p}-05T05:00:00.000Z` })
    financeStore.markSalary('a', { period: p, accountId: null, at: `${p}-10T05:00:00.000Z` })
    financeStore.markPaid('credit', 'cr-car', 'a', { period: p, accountId: null, at: `${p}-18T05:00:00.000Z` })
  }
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
      // Взносы той записи — в истории целей прошлого месяца (сводка «Отложили»); накопленное их уже включает:
      // `have` = `seed` + взносы, поэтому начальная сумма меньше на взнос.
      for (const c of before.contributions) {
        const g = doc.goals.find((x) => x.id === c.goalId)
        if (!g) continue
        g.movements = [...(g.movements ?? []), { id: `demo-plan-${c.goalId}`, date: at, amount: c.amount, by: 'a', note: 'по плану месяца' }]
        g.seed = (g.seed ?? g.have) - c.amount
      }
    })
  }
  // Зарплата участника a пришла сегодня на евро-счёт и не разобрана — на «Неделе» «Пришла зарплата · как обычно»;
  // часть уже обменяли (B2C-79): 500 € по 512 ₸ на Kaspi Gold — строка «обменяно 500 € из 1 500 €».
  financeStore.markSalary('a', { accountId: 'acc-eur' })
  financeStore.addExchange({ by: 'a', accountId: 'acc-eur', toAccountId: 'acc-kaspi', foreign: 500, rate: 512, period: monthKey() })
  // Снимок срока месяца (AU-08, Р-6): «на начало месяца» герою «Поездка» план давал на 40 000 больше, чем сейчас — у героя
  // «Мечт» метка «+2 недели · кафе и рестораны выше плана» (40 000 при 100 000 в месяц — 12 дней), на экране цели —
  // «Вернуть срок». Остальное в снимке — нынешний план (доход и платежи прежние — причина не «новый платёж»).
  {
    const at = `${monthKey()}-01T03:00:00.000Z`
    const snap = termSnapOf(monthPlan({ ...financeStore.householdDoc, credits: financeStore.credits, book: useFxStore().book }, { key: monthKey(), totals: [], spendCategories: [], uploads: [] }), at)
    snap.goals = snap.goals.map((g) => (g.goalId === 'g-trip' ? { ...g, given: g.given + 40_000 } : g))
    financeStore.mutateHouseholdDoc((doc) => {
      doc.termSnaps = [{ ...snap, updatedAt: at }]
    })
  }
  // Записи загрузок и свои операции демо — когда стор операций уже переключился на демо-семью (watch по владельцу).
  void nextTick().then(() => {
    // Девятнадцать недель своих операций (0…131 день назад, Блок 15, AU-03): у «Недели» есть сравнение с прошлой и тренд
    // «8 недель», у «Месяца» — «обычно у вас»; одна загрузка покрывает их все.
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
    const today = day(0)
    // Выписка a — с 1-го числа три месяца назад (AU-03): три полных месяца для «обычно у вас»; операции — ниже, до 131 дня.
    const from = `${addMonths(monthKey(), -3)}-01`
    const ops = useOperationsStore()
    // «Выписки» недели (B2C-62/67): участник a загрузил, партнёр b — ещё нет (галочка и «ещё нет»). У партнёра b — выписка
    // месяца до этой недели: план месяца показывает факт трат обоих (B2C-90); в первые дни месяца, когда
    // неделя начинается в прошлом, её выписка — с 1-го по сегодня, и галочки на «Неделе» две.
    const monthStart = `${monthKey()}-01`
    const weekStart = weekRange(weekKey()).from
    const arunaTo = weekStart > monthStart ? new Date(Date.parse(weekStart) - 86_400_000).toISOString().slice(0, 10) : today
    const prevEnd = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    ops.seedDemoUploads([
      { id: 'demo-upload-a', slot: 'a', bank: 'kaspi', period_from: from, period_to: today, ops_count: 95, created_at: new Date().toISOString() },
      { id: 'demo-upload-b-prev', slot: 'b', bank: 'kaspi', period_from: `${addMonths(monthKey(), -3)}-01`, period_to: prevEnd, ops_count: 54, created_at: new Date().toISOString() },
      { id: 'demo-upload-b', slot: 'b', bank: 'kaspi', period_from: monthStart, period_to: arunaTo, ops_count: 13, created_at: new Date().toISOString() },
    ])
    // Пять разделов, продавцы — только из словаря (иначе ответ на продавца, переразложив операции правилами,
    // вернёт их в «не разобрано»; суммы — вне окна оценки «Коммуналки» 21–39 тыс., иначе «платёж по
    // Коммуналке?»), один перевод между своими и десять незнакомых продавцов сегодня — на «Неделе»
    // в любой день пачка «Без раздела · 10» (Блок 12, B2C-67) и «Пришла зарплата».
    const op = (n: number, ago: number, amount: number, merchant: string, categoryId: string | null, extra: Partial<Operation> = {}): Operation => ({
      id: `demo-op-${n}`, bank: 'kaspi', date: day(ago), amount, kind: 'purchase', merchant, categoryId, internal: false, ...extra,
    })
    // Ещё семнадцать недель назад (14…131 день, Блок 15; AU-03 — до начала месяца три месяца назад): у тренда «8 недель»,
    // сравнения недель, остатка разделов и «обычно у вас» есть данные. Суммы — вне допусков платежей (подписки 3–5 тыс.,
    // «Коммуналка» 21–39 тыс.): вопросов не добавляют.
    const older = [1, 0.8, 1.15, 0.9, 1.3, 0.7, 1.05, 1.1, 0.95, 1.2, 0.85, 1, 0.9, 1.15, 0.8, 1.05, 1].flatMap((k, w) => {
      const ago = 14 + w * 7
      const sum = (n: number) => -Math.round((n * k) / 100) * 100
      return [
        op(100 + w * 4, ago + 1, sum(14_000), 'Magnum', 'sc_food'),
        op(101 + w * 4, ago + 4, sum(9_000), 'Small', 'sc_food'),
        op(102 + w * 4, ago + 2, sum(7_500), 'Del Papa Cafe', 'sc_cafe'),
        op(103 + w * 4, ago + 5, sum(1_700), 'Yandex Go', 'sc_transport'),
      ]
    })
    // Такси a (AU-30, Р-24): 14 поездок Yandex Go в каждом из трёх прошлых месяцев (5 600–6 900 ₸, с недельными
    // ~95 000 в месяц, как на настоящей выписке — Х-11; вне допуска подписки «Яндекс Плюс», вопросов не добавляют) —
    // вместе с недельными выше привычка «такси» держится 3 месяца: у «Транспорта» на «Месяце» есть образ. В дни прошедшей поездки (20–26 дней назад) поездок нет — её итог прежний (PN-32).
    const rides = [3, 2, 1]
      .flatMap((n) =>
        Array.from({ length: 14 }, (_, i) => ({
          ...op(600 + n * 20 + i, 0, -(5_600 + i * 100), 'Yandex Go', 'sc_transport'),
          date: `${addMonths(monthKey(), -n)}-${String(2 + i * 2).padStart(2, '0')}`,
        })),
      )
      .filter((r) => r.date < day(26) || r.date > day(20))
    ops.seedDemoOperations([
      ...older,
      ...rides,
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
  return true
}
