import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '../src/router'
import { useFinanceStore, defaultSyncDoc } from '../src/stores/finance'
import { at, phone, screen, setOnline, type FakeServer } from './support/family'
import { screenMixin } from '../src/test/screenState'
import type { SyncDoc } from '../src/types/finance'
import { budgetAmounts, liveGoals, liveObligations, openCredits } from '../src/lib/finance'
import { HUES } from '../src/lib/palette'
import { isDark } from '../src/lib/theme'
import { money, plain } from '../src/lib/money'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import StrategyCompare from '../src/components/StrategyCompare.vue'

/**
 * Приёмка Блока 1 паритета: калькулятор «копить или гасить» и точные расчёты на
 * семье браузерного стенда. Два телефона — два стора Pinia на одном фейковом
 * сервере (как `block1-payments`), экраны — SSR на сторе телефона.
 *
 * Ожидаемые числа калькулятора, Ритуала, прогноза цели и вклада — НЕ из кода Vue:
 * они посчитаны независимо, прогоном React `simulateStrategy` / `prepayment` /
 * `deposit` (src/lib/finance.ts) с формулами React `StrategyCompare`
 * (Capital.tsx:1568-1589), и совпали с браузером до тенге.
 */
describe('e2e / PV Блок 1 — калькулятор и точные расчёты на двух телефонах', () => {
  let server: FakeServer
  const T0 = '2026-09-01T00:00:00.000Z'

  /** Калькулятор телефона с заданным стартовым состоянием (горизонт, галки). */
  async function strategy(pinia: Pinia, initial: { months?: 12 | 24 | 36; kept?: string[]; cushion?: boolean; useSaved?: boolean }) {
    setActivePinia(pinia)
    const store = useFinanceStore()
    const app = createSSRApp(StrategyCompare, {
      credits: openCredits(store.credits),
      goals: liveGoals(store.goals),
      obligations: liveObligations(store.obligations),
      monthKey: '2026-09',
      initial,
    })
    // Ссылки калькулятора — RouterLink (PV-15): нужен роутер.
    app.use(createRouter({ history: createMemoryHistory(), routes }))
    return renderToString(app)
  }

  /** Колонка калькулятора как её видит человек: накоплено, долг, проценты, срок. */
  /** Строка «закрыть кредит» в очереди «Месяца» (Блок 14, Р-82; Блок 15 — раздел «Цели и фонды»): какой долг досрочка закрывает первым. */
const debtsCard = async (p: { pinia: Pinia }) => {
  const html = await screen(p.pinia, Month, '/month', undefined, [screenMixin({ opened: 'queue' })])
  const at = html.indexOf('data-queue="debt"')
  return at < 0 ? '' : html.slice(at, at + 700)
}

const column = (title: string, savings: number, debt: number, interest: number, free: string) =>
    new RegExp(
      [title, 'накоплено', money(savings), 'долг', money(debt), 'процентов банку', money(interest), 'без процентных долгов', free]
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\S]*?'),
    )

  beforeEach(() => {
    vi.useFakeTimers()
    at('2026-09-25T04:00:00Z') // 09:00 по Алматы
    setOnline(true)
    server = {
      rev: 1,
      data: {
        ...defaultSyncDoc(),
        setupDoneAt: T0,
        people: [
          { id: 'a', name: 'Ильяс', salary: 900_000, payday: 10, onboardedAt: T0, updatedAt: T0 },
          { id: 'b', name: 'Аруна', salary: 600_000, payday: 20, onboardedAt: T0, updatedAt: T0 },
        ],
        categories: [
          { key: 'd1', name: 'Жильё', note: '', amount: 220_000, updatedAt: T0 },
          { key: 'd2', name: 'Кредиты', note: '', amount: 141_680, updatedAt: T0 },
          { key: 'd3', name: 'Цели', note: '', amount: 200_000, updatedAt: T0 },
          { key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: T0 },
        ],
        obligations: [
          {
            id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1',
            versions: [{ from: '2000-01', amount: 220_000 }, { from: '2027-06', amount: 200_000 }], updatedAt: T0,
          },
        ],
        // Беспроцентная — первой в документе: прежний Ритуал (`credits[0]`) предлагал досрочку по ней.
        credits: [
          { id: 'inst', name: 'Рассрочка', note: 'рассрочка', principal: 200_000, principalSetAt: T0, annualRate: 0, payment: 20_000, day: 25, updatedAt: T0 },
          { id: 'bank', name: 'Банк', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.18, payment: 91_680, day: 20, updatedAt: T0 },
          { id: 'cc', name: 'Кредитка', note: '', principal: 300_000, principalSetAt: T0, annualRate: 0.4, payment: 30_000, day: 15, updatedAt: T0 },
        ],
        goals: [
          { id: 'flat', name: 'Квартира', need: 6_000_000, seed: 800_000, have: 800_000, monthly: 150_000, hue: 'blue', planPct: 0, movements: [], updatedAt: T0 },
          { id: 'kid', name: 'Декрет', need: 2_000_000, seed: 300_000, have: 300_000, monthly: 50_000, hue: 'plum', planPct: 0, movements: [], updatedAt: T0 },
        ],
        accounts: [
          { id: 'card', name: 'Kaspi Gold', note: '', amount: 2_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 },
          {
            id: 'dep', name: 'Kaspi Депозит', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'deposit',
            deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true }, updatedAt: T0,
          },
        ],
      } as SyncDoc,
    }
  })

  afterEach(() => {
    isDark.value = false
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('PV-02: калькулятор — семь элементов и числа React до тенге на каждом переключении', async () => {
    const A = await phone(server)

    const capital = await screen(A.pinia, Money, '/money/debts')
    // Текст подсказки открывается по «?» — он проверен в браузере, в SSR она закрыта.
    expect(capital).toContain('Одинаковые траты, разный порядок')
    expect(capital).toContain('Горизонт')
    expect(capital).toMatch(/aria-pressed="true"[^>]*>Три</)
    expect(capital).toMatch(column('Копим как сейчас', 11_729_239, 0, 171_241, 'через 13 мес.'))
    expect(capital).toMatch(column('Сначала долги', 11_811_831, 0, 88_649, 'через 6 мес.'))
    expect(capital).toContain('Сначала долги выгоднее на')
    expect(capital).toContain(money(82_593))
    expect(capital).toContain('чистыми через 36 мес. — это деньги, которые не ушли банку')
    expect(capital).toContain('Что не останавливать')
    expect(capital).toContain(`${plain(150_000)}/мес`)
    // Подушка — месяц обязательных: аренда 220 000 + платежи 141 680 → до тысяч.
    expect(capital).toContain(`Сначала подушка — ${money(362_000)}`)
    expect(capital).toContain(`Вложить уже накопленное — ${money(738_000)}`)
    expect(capital).toContain('Беспроцентные долги — Рассрочка — досрочно не')

    // Переключения накопительно, как в браузере: Год → + «Декрет» → без подушки → + накопленное.
    const year = await strategy(A.pinia, { months: 12 })
    expect(year).toMatch(column('Копим как сейчас', 3_540_000, 10_724, 171_241, 'через 13 мес.'))
    expect(year).toContain(money(82_235))
    expect(year).toContain('чистыми через 12 мес.')
    const kept = await strategy(A.pinia, { months: 12, kept: ['kid'] })
    expect(kept).toContain(money(66_958))
    expect(kept).toContain(`Вложить уже накопленное — ${money(438_000)}`)
    const noCushion = await strategy(A.pinia, { months: 12, kept: ['kid'], cushion: false })
    expect(noCushion).toContain(money(103_318))
    // Сумма подушки видна и без галки.
    expect(noCushion).toContain(`Сначала подушка — ${money(362_000)}`)
    const lump = await strategy(A.pinia, { months: 12, kept: ['kid'], cushion: false, useSaved: true })
    expect(lump).toContain(money(159_847))
    expect(lump).toMatch(column('Сначала долги', 3_689_123, 0, 11_037, 'через 2 мес.'))
    const all = await strategy(A.pinia, { kept: ['flat', 'kid'] })
    expect(all).toContain('Все цели отмечены как неприкосновенные — направлять в долги нечего.')
    expect(all).not.toContain('Копим как сейчас')
    expect(all).not.toContain('Вложить уже накопленное')
  })

  it('PV-01: A закрывает Кредитку досрочкой — у обоих «Свободно» +30 000, «Кредиты» без неё, Ритуал и калькулятор — по открытым', async () => {
    const A = await phone(server)
    const B = await phone(server)

    // «Свободно» (d5) и «Кредиты» (d2) — budgetAmounts, которые печатал Бюджет (пивот 3: доли — в «Доходе»).
    const plan = (P: typeof A) => budgetAmounts({ ...P.store.householdDoc, credits: P.store.credits })
    expect(Math.round(plan(A).d5)).toBe(738_320)
    expect(plan(A).d2).toBe(141_680)
    // Досрочка — в самый дорогой открытый (40%), а не в первую по документу рассрочку.
    expect(await debtsCard(A)).toContain('Кредитка')

    at('2026-09-25T05:00:00Z')
    A.store.applyPrepayment('cc', 'a', { amount: 300_000, mode: 'term', accountId: 'card' })
    expect(A.store.credits.find((c) => c.id === 'cc')?.principal).toBe(0)
    await A.store.syncHousehold(A.client)
    await B.store.pullHousehold(B.client)

    for (const P of [A, B]) {
      expect(plan(P).d2).toBe(111_680)
      expect(Math.round(plan(P).d5)).toBe(768_320)
      const ritual = await debtsCard(P)
      // Закрытая Кредитка — не цель досрочки: следующий по ставке — «Банк».
      expect(ritual).toContain('Банк')
      expect(ritual).not.toContain('Кредитка')
      // (прежний Ритуал печатал «12 платежей, переплата» — расчёт остался в калькуляторе ниже)
      const capital = await screen(P.pinia, Money, '/money/debts')
      // Закрытый досрочкой долг платежа не ждёт — в «Платежах» его нет (B2C-42); в калькулятор он не входит:
      // подушка 332 000, выигрыш 48 987.
      expect(await screen(P.pinia, Money, '/money')).not.toContain('Кредитка')
      expect(capital).toContain(`Сначала подушка — ${money(332_000)}`)
      expect(capital).toMatch(column('Копим как сейчас', 11_020_320, 0, 100_160, 'через 12 мес.'))
      expect(capital).toMatch(column('Сначала долги', 11_069_307, 0, 51_173, 'через 5 мес.'))
      expect(capital).toContain(money(48_987))
    }
  })

  it('PV-03: форма долга — расхождение словами и цифрами, ставка «по сроку» 18,0%', async () => {
    const A = await phone(server)
    const form = (payment: string) =>
      screen(A.pinia, Money, '/money?add=debt', undefined, [
        screenMixin({ debtMode: 'term', debtPrincipal: '1 000 000', debtPayment: payment, debtTerm: '12' }),
      ])

    const bad = await form('10 000')
    for (const t of ['Без них', 'Знаю ставку', 'Знаю срок', 'Сколько платежей осталось', 'День платежа']) expect(bad).toContain(t)
    expect(bad).toContain(`12 платежей по ${plain(10_000)} — это ${plain(120_000)} ₸, а остаток вы указали ${plain(1_000_000)} ₸.`)
    expect(bad).toContain(`Не хватает ${plain(880_000)} ₸: похоже, платежей 100, а не 12.`)
    expect(bad).toContain('Записать всё равно можно: сохраним как рассрочку без процентов')
    expect(bad).not.toContain('Ставка получается')

    const good = await form('91 680')
    expect(good).toContain('Ставка получается')
    expect(good).toContain('18,0% годовых')
    expect(good).not.toContain('Записать всё равно можно')
  })

  it('PV-04: снятие больше накопленного — 0 у обоих телефонов, движение целиком, прогноз «дорожает вместе с рынком»', async () => {
    const A = await phone(server)
    const B = await phone(server)
    const kid = (p: typeof A) => p.store.goals.find((g) => g.id === 'kid')!

    expect(await screen(A.pinia, GoalDetail, '/goals/kid')).toContain(`около ${money(2_612_338)}`) // 34 взноса → к месяцу закрытия 33 мес. (B2C-18)

    // A снимает 500 000 из 300 000, B в это время офлайн пополняет на 100 000.
    at('2026-09-25T05:00:00Z')
    A.store.withdraw('kid', 500_000, 'a')
    expect(kid(A).have).toBe(0)
    setOnline(false)
    at('2026-09-25T05:10:00Z')
    B.store.contribute('kid', 100_000, 'b')
    expect(kid(B).have).toBe(400_000)
    setOnline(true)
    await A.store.syncHousehold(A.client)
    await B.store.syncHousehold(B.client)
    await A.store.pullHousehold(A.client)

    // 300 000 − 500 000 + 100 000 < 0 → 0 одной формулой у стора и слияния.
    for (const P of [A, B]) {
      expect(kid(P).have).toBe(0)
      expect(kid(P).movements.map((m) => m.amount).sort((x, y) => x - y)).toEqual([-500_000, 100_000])
      const detail = await screen(P.pinia, GoalDetail, '/goals/kid')
      expect(detail).toContain(`0 из ${money(2_000_000)}`)
      expect(detail).toContain('Цель дорожает вместе с рынком')
      expect(detail).toContain('10,2%')
      expect(detail).toContain(`около ${money(2_742_333)}`) // 2 000 000 / 50 000 = 40 взносов → 39 мес.
      expect(detail).not.toContain('Дисциплина накоплений')
    }
    expect(server.data.goals.find((g) => g.id === 'kid')?.have).toBe(0)
    expect(await screen(A.pinia, GoalDetail, '/goals/flat')).toContain(`около ${money(7_900_704)}`) // 35 взносов → 34 мес.
  })

  // Критик Б3 (правило 12): плашки про инфляцию и «ИИ-советника» свёрнуты в одну строку с подсказкой.
  it('PV-05: вклад — инфляция 10,2%, реальная доходность одной строкой', async () => {
    const A = await phone(server)
    // Вклад — лист счёта (B2C-42), расчёт свёрнут, но в SSR на месте.
    const html = await screen(A.pinia, Money, '/money?account=dep')
    // 14% с ежемесячной капитализацией = 14,9% эффективных; (1,149 / 1,102) − 1 = 4,3% (при 8% было бы 6,4%).
    expect(html).toContain('Реально ≈ 4,3% с учётом инфляции')
    expect(html).not.toContain('ИИ-советник')
    expect(html).not.toContain('Проценты считает приложение, а не банк')
  })

  // PV-06 (мастер: «Пропустить» не пишет введённое) снят вместе с мастером — первый запуск из выписки
  // пишет только подтверждённые ответы (B2C-19, `Start.test.ts`, e2e часть 4).

  it('PV-08: тёмная тема — «Ритм цели» тёмным оттенком цели (кольца списка ушли с плитками «Мечт», B2C-18)', async () => {
    const A = await phone(server)
    setActivePinia(A.pinia)
    A.store.contribute('flat', 10_000, 'a')
    A.store.contribute('kid', 10_000, 'b')
    isDark.value = true
    const dark = await screen(A.pinia, GoalDetail, '/goals/flat')
    expect(dark).toContain(`background:${HUES.blue.dark}`)
    expect(dark).not.toContain(HUES.blue.light)
    expect(await screen(A.pinia, GoalDetail, '/goals/kid')).toContain(`background:${HUES.plum.dark}`)
    isDark.value = false
    expect(await screen(A.pinia, GoalDetail, '/goals/flat')).toContain(`background:${HUES.blue.light}`)
  })
})
