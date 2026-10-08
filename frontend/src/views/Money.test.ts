import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { apiClient } from '@/api/client'
import {
  budgetAmounts,
  budgetInterest,
  debtAdvice,
  netWorth,
  planFact,
  planOutlook,
  cushionMonths,
  liquidCash,
  nextChange,
  untilPayday,
  amountTotal,
  capitalGoals,
  liveAccounts,
  openDebt,
} from '@/lib/finance'
import { money, moneyIn, plain, rateField } from '@/lib/money'
import { monthIn, monthInAfter } from '@/lib/dates'
import type { Obligation, Payment, SyncDoc } from '@/types/finance'
import type { Operation } from '@/lib/statements/types'
import { authAs, planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Money from './Money.vue'
import Month from './Month.vue'
import DebtFaster from './DebtFaster.vue'

/** Ряд квадратов «Денег» целиком: каждый квадрат — своя обёртка (подсказка «Капитала» рядом с кнопкой). */
function squaresOf(html: string) {
  const at = html.indexOf('aria-label="Деньги"')
  const tag = /<(\/?)div\b/g
  tag.lastIndex = at
  let depth = 1
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[1] ? -1 : 1
    if (!depth) return html.slice(at, m.index)
  }
  return html.slice(at)
}

describe('views/Money.vue — финансовые показатели (расчёты бывшего Обзора, B2C-14)', () => {
  const storageMap = new Map<string, string>()
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, val: string) => storageMap.set(key, String(val)),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage)
    mockLocalStorage.clear()
    setActivePinia(createPinia())
  })

  it('корректно рассчитывает совокупный капитал (netWorth) при наличии нескольких счетов, депозитов и кредитов', () => {
    const store = useFinanceStore()

    // 1. Активы: 2 карты + 1 депозит
    store.householdDoc.accounts = [
      { id: 'acc-1', name: 'Kaspi Gold', note: '', kind: 'card', amount: 350_000, updatedAt: '' },
      { id: 'acc-2', name: 'Halyk Bonus', note: '', kind: 'card', amount: 150_000, updatedAt: '' },
      { id: 'acc-3', name: 'Депозит Kaspi', note: '', kind: 'deposit', amount: 1_200_000, updatedAt: '' },
    ]

    // 2. Накопления в целях (без привязанного счёта)
    store.householdDoc.goals = [
      {
        id: 'g-vacation',
        name: 'Отпуск',
        need: 800_000,
        seed: 200_000,
        have: 200_000,
        monthly: 50_000,
        hue: 'teal',
        planPct: 0.25,
        movements: [],
        updatedAt: '',
      },
    ]

    // 3. Долги: автокредит и рассрочка
    store.householdDoc.credits = [
      {
        id: 'cr-auto',
        name: 'Автокредит',
        note: '',
        principal: 1_400_000,
        annualRate: 0.19,
        payment: 75_000,
        day: 15,
        updatedAt: '',
      },
      {
        id: 'cr-phone',
        name: 'Рассрочка телефон',
        note: '',
        principal: 200_000,
        annualRate: 0,
        payment: 20_000,
        day: 10,
        updatedAt: '',
      },
    ]

    // Активы: 350k + 150k + 1.2M + 200k (цель) = 1.9M ₸
    // Обязательства по долгам: 1.4M + 200k = 1.6M ₸
    // Капитал: 1.9M - 1.6M = 300 000 ₸
    const total = netWorth(store.accounts, store.credits, store.goals)
    expect(total).toBe(300_000)
  })

  it('корректно рассчитывает месячную дельту (доходы минус расходы) и свободный остаток', () => {
    const store = useFinanceStore()

    // Доходы семьи
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: '' },
      { id: 'b', name: 'Аруна', salary: 400_000, payday: 20, updatedAt: '' },
    ]

    // Жилье (d1)
    store.householdDoc.obligations = [
      {
        id: 'ob-rent',
        name: 'Аренда',
        note: '',
        day: 5,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 250_000 }],
        updatedAt: '',
      },
    ]

    // Кредит (d2)
    store.householdDoc.credits = [
      {
        id: 'cr-1',
        name: 'Кредит',
        note: '',
        principal: 500_000,
        annualRate: 0.2,
        payment: 50_000,
        day: 12,
        updatedAt: '',
      },
    ]

    // Цель (d3)
    store.householdDoc.goals = [
      {
        id: 'g-1',
        name: 'Цель',
        need: 600_000,
        seed: 0,
        have: 0,
        monthly: 100_000,
        hue: 'blue',
        planPct: 0,
        movements: [],
        updatedAt: '',
      },
    ]

    // Быт (d4)
    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 250_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd3', name: 'Цели', note: '', amount: 100_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd5', name: 'Свободно', note: '', amount: 0, updatedAt: '' },
    ]

    // Доход = 700k + 400k = 1 100 000 ₸
    // Расходы: d1(250k) + d2(50k) + d3(100k) + d4(200k) = 600 000 ₸
    // Свободно d5 = 1 100 000 - 600 000 = 500 000 ₸
    const amounts = budgetAmounts(store.householdDoc)
    expect(amounts.income).toBe(1_100_000)
    expect(amounts.d1).toBe(250_000)
    expect(amounts.d2).toBe(50_000)
    expect(amounts.d3).toBe(100_000)
    expect(amounts.d4).toBe(200_000)
    expect(amounts.d5).toBe(500_000)
  })

  it('рассчитывает подушку безопасности (cushionMonths) и статус покрытия', () => {
    const store = useFinanceStore()

    store.householdDoc.accounts = [
      { id: 'a1', name: 'Карта Kaspi', note: '', kind: 'card', amount: 600_000, updatedAt: '' },
      { id: 'a2', name: 'Наличные', note: '', kind: 'cash', amount: 150_000, updatedAt: '' },
      { id: 'a3', name: 'Депозит долгосрочный', note: '', kind: 'deposit', amount: 2_000_000, updatedAt: '' },
    ]

    store.householdDoc.categories = [
      { key: 'd1', name: 'Жильё', note: '', amount: 200_000, updatedAt: '' },
      { key: 'd2', name: 'Кредиты', note: '', amount: 50_000, updatedAt: '' },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: '' },
    ]

    // Месяц обязательных расходов — числом (его считает planMandatory; ревью Блока 3 Н-7).
    const mandatory = 400_000

    // Ликвидные средства (карты + нал, без депозита): 600k + 150k = 750 000 ₸
    const cash = liquidCash(store.accounts)
    expect(cash).toBe(750_000)

    // Подушка: 750 000 / 400 000 = 1.9 месяца
    const months = cushionMonths(store.accounts, mandatory)
    expect(months).toBe(1.9)
  })

  it('рассчитывает событие высвобождения средств (nextChange) при планируемом снижении платежа', () => {
    const obligation = {
      id: 'ob-rent',
      name: 'Аренда квартиры',
      note: '',
      day: 5,
      category: 'd1' as const,
      versions: [
        { from: '2026-01', amount: 300_000 },
        { from: '2026-10', amount: 220_000, reason: 'Переезд в меньшую квартиру' },
      ],
      updatedAt: '',
    }

    const change = nextChange(obligation, '2026-09')
    expect(change).not.toBeNull()
    expect(change?.from).toBe('2026-10')
    expect(change?.amount).toBe(220_000)
    // Освободится: 220 000 - 300 000 = -80 000 (delta отрицательная, высвобождение)
    expect(change?.delta).toBe(-80_000)
  })

  it('рассчитывает график до зарплаты (untilPayday)', () => {
    const store = useFinanceStore()
    store.householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 15, updatedAt: '' },
    ]
    store.householdDoc.obligations = [
      {
        id: 'ob-util',
        name: 'Коммуналка',
        note: '',
        day: 10,
        category: 'd1',
        versions: [{ from: '2026-01', amount: 35_000 }],
        updatedAt: '',
      },
    ]

    const payday = untilPayday(store.householdDoc, { day: 8, key: '2026-09' })
    expect(payday).not.toBeNull()
    expect(payday?.who.name).toBe('Ильяс')
    expect(payday?.inDays).toBe(7) // с 8-го до 15-го
    expect(payday?.due).toHaveLength(1)
    expect(payday?.due[0].name).toBe('Коммуналка')
    expect(payday?.dueTotal).toBe(35_000)
  })

  describe('Блок 15 (B2C-97, Р-91): «Деньги» — капитал без месяца: Капитал · Долги · История, «Счета» и «Платежи» справочником', () => {
    // Текст как его видит человек: теги — пробел, переводы строк и пробелы шаблона схлопнуты (NBSP сумм остаются).
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    /** Текст открытого листа где угодно на экране (до конца разметки). */
    const dialog2 = (html: string) => {
      expect(html).toContain('role="dialog"')
      return text(html.slice(html.indexOf('role="dialog"')))
    }
    const squares = squaresOf
    const brand = (html: string) =>
      [...html.matchAll(/<button[^>]*class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim())

    // Семья `planFamilyDoc`: Ильяс 700 000 (10-го), Аруна 500 000 (20-го), аренда 220 000 (5-го), три долга
    // (15-го, 22-го, 25-го), еда и быт 150 000. «Сейчас» — 12 сентября.
    async function family(role: 'member' | 'viewer' = 'member', extra: Partial<SyncDoc> = {}) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs(role, 'a'))
      useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
      vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
      await useOperationsStore().loadUploads()
      return useFinanceStore()
    }
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('Капитал: чистых крупно (итоги — в подсказке), «Счета», «Кредиты» (остаток; ставка и срок — в листе кредита) и «Платежи»; месячного нет — ни плана, ни «Подробнее», ни «До зарплаты», ни «Дохода» и «Трат», ни «Оплатил»; брендовой кнопки нет', async () => {
      const store = await family()
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      const worth = netWorth(store.accounts, store.credits, store.goals)
      const raw = await renderScreen(Money, '/money')
      const html = text(raw)
      // Слова «Капитал» над суммой нет — оно на чипе; сумма одна, рядом — подсказка (Р-116).
      expect(raw).toMatch(new RegExp(`data-worth[^>]*>${money(worth)}<`))
      expect(raw).toContain('aria-label="Что такое капитал"')
      // «Кредиты» — без итога у заголовка (он — «долги» в подсказке у капитала): 969 500 + 300 000 + 240 000 = 1 509 500.
      const credits = text(raw.slice(raw.indexOf('data-credits'), raw.indexOf('data-payments')))
      expect(openDebt(store.credits)).toBe(1_509_500)
      expect(html).not.toContain(money(1_509_500))
      // Строка кредита — вид и остаток; ставки и срока нет (Р-116) — они в листе кредита.
      expect(credits).toContain(`Кредит кредит ${money(969_500)}`)
      expect(credits).not.toMatch(/33 %|до [а-я]+ 20\d\d/)
      expect(credits).toContain(`Рассрочка рассрочка ${money(240_000)}`)
      const loanSheet = await renderScreen(Money, '/money?credit=loan')
      expect(loanSheet).toContain(`value="${rateField(store.credits.find((c) => c.id === 'loan')!.annualRate)}"`)
      // Рассрочка 0 %: 240 000 / 20 000 = 12 платежей — в листе: срок строкой, число — в раскрытом «Графике платежей» (Б17).
      expect(text(await renderScreen(Money, '/money?credit=inst'))).toContain(`закроется в ${monthInAfter(12)}`)
      expect(text(await renderScreen(Money, '/money?credit=inst', undefined, [screenMixin({ scheduleOpen: true })]))).toMatch(/Платежей осталось\s*12/)
      // «Платежи» — без суммы месяца у заголовка (220 000 + 58 000 + 25 000 + 20 000 — раздел «Платежи» в «Месяце»).
      expect(html).not.toContain('/ мес')
      expect(store.monthPlanOf('2026-09').duesTotal).toBe(323_000)
      // Месяц живёт в «План · Месяц»: здесь его нет совсем.
      for (const gone of ['До зарплаты', 'Подробнее', 'Доход', 'обязательное', 'нагрузка', 'остаток по плану', 'Остаётся', 'Отложим', 'Осталось в', 'оплачено', 'Оплатил', 'Пришла зарплата', 'Сентябрь', 'Цели и фонды', 'из 150 000']) {
        expect(html, gone).not.toContain(gone)
      }
      for (const attr of ['data-month-nav', 'data-more', 'data-rest', 'data-sections', 'data-dues-total']) expect(raw).not.toContain(attr)
      expect(raw).not.toContain('<details')
      // Правило 12: «Деньги» — справочник, главной кнопки нет ни в одном квадрате; у долгового плана она только внутри
      // свёрнутого расчёта «Копить или гасить?» экрана «Закрыть быстрее» (сложное скрыто).
      const shown = (h: string) => h.replace(/<details[\s\S]*<\/details>/g, '')
      for (const path of ['/money', '/money/debts', '/money/history']) expect(brand(shown(await renderScreen(Money, path))), path).toEqual([])
      expect(brand(shown(await renderScreen(DebtFaster, '/money/debts/faster')))).toEqual([])
    })

    it('чипы: Капитал · Долги · История — без чисел и подписей (Р-116; числа — на своих экранах); активный — по адресу', async () => {
      const store = await family()
      const worth = netWorth(store.accounts, store.credits, store.goals)
      let html = await renderScreen(Money, '/money')
      expect(text(squares(html))).toMatch(/> Капитал Долги История\s*$/)
      expect(squares(html)).not.toContain(plain(worth))
      expect(squares(html).match(/aria-current="page"/g)).toHaveLength(1)
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*Капитал/)
      // Подсказка «Что такое капитал» — не на чипе, а у суммы капитала (одна на экране).
      expect(squares(html)).not.toContain('Что такое капитал')
      expect(html.match(/aria-label="Что такое капитал"/g)).toHaveLength(1)
      html = await renderScreen(Money, '/money/debts')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*Долги/)
      // Остаток долгов — на экране «Долгов», не на чипе.
      expect(html).toMatch(new RegExp(`data-debts-total[^>]*>${money(1_540_000)}<`))
      // Списки — только у Капитала.
      expect(text(html)).not.toContain('Счета')
      store.householdDoc.credits = []
      html = await renderScreen(Money, '/money/history')
      expect(text(squares(html))).not.toContain('долгов нет')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*История/)
    })

    it('«Долги» (бывший «План»; Блок 16, Р-110): сумма остатков и ссылка «Как закрыть быстрее» на свой экран (Б17); отметок месяца нет; без долгов — «Долгов нет»', async () => {
      const store = await family()
      const raw = await renderScreen(Money, '/money/debts')
      let html = text(raw)
      // Слова «Долги» над суммой нет — оно на чипе (Р-116).
      expect(html).toContain(`Капитал Долги История ${money(1_540_000)}`)
      // Долговой план — не здесь, а на экране «Закрыть быстрее»: на «Долгах» только ссылка.
      expect(raw).toMatch(/<a[^>]*href="\/money\/debts\/faster"[^>]*data-debts-calc|<a[^>]*data-debts-calc[^>]*href="\/money\/debts\/faster"/)
      expect(html).toContain('Как закрыть быстрее')
      expect(html).not.toContain('Самая дорогая')
      expect(text(await renderScreen(DebtFaster, '/money/debts/faster'))).toContain('Самая дорогая ставка')
      expect(html).not.toContain('оплачено')
      expect(html).not.toContain('чистых')
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      html = text(await renderScreen(Money, '/money/debts'))
      expect(html).not.toContain('в сентябре оплачено')
      store.householdDoc.credits = []
      html = text(await renderScreen(Money, '/money/debts'))
      expect(html).toContain('Долгов нет')
    })

    describe('«Счета» и «Платежи» одним списком, листы', () => {
      // Списки — после карточки капитала: от «Счета» до конца экрана (листы в SSR на месте, закрытые — пустые).
      const lists = (html: string) => text(html.slice(html.indexOf('>Счета<')))
      const payments = (html: string) => lists(html).slice(lists(html).indexOf('Платежи'))
      const usd = { id: 'usd', name: 'Доллары', note: '', amount: 479_260, amountSetAt: T0, kind: 'cash' as const, currency: 'USD' as const, foreignAmount: 1_000, rate: 479.26, rateAt: T0, updatedAt: T0 }
      const subs = (id: string, extra: Partial<Obligation>): Obligation => ({ id, name: id, note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: T0, ...extra })
      const withSubs = (): Partial<SyncDoc> => ({
        obligations: [
          ...planFamilyDoc().obligations,
          subs('Кино', { group: true, versions: [] }),
          subs('Netflix', { parentId: 'Кино' }),
          subs('Яндекс', { parentId: 'Кино', day: 7, versions: [{ from: '2000-01', amount: 2_990 }] }),
          subs('iCloud', { day: 15, versions: [{ from: '2000-01', amount: 1_490 }] }),
          subs('Страховка', { every: 'year', month: 3, day: 1, category: 'd1', versions: [{ from: '2000-01', amount: 60_000 }] }),
          subs('Коммуналка', { day: 8, category: 'd1', estimate: true, payer: 'b', versions: [{ from: '2000-01', amount: 30_000 }] }),
        ],
      })

      it('«Счета»: итог в тенге с валютным по курсу, мета «вид · сумма в валюте · чей», вклад — ставкой; «Добавить счёт» — участнику', async () => {
        const store = await family('member', {
          accounts: [
            planFamilyDoc().accounts[0],
            usd,
            { id: 'dep', name: 'Депозит Kaspi', note: '', amount: 1_200_000, amountSetAt: T0, kind: 'deposit', updatedAt: T0, deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true } },
          ],
        })
        store.addAccount({ name: 'Заначка', kind: 'cash', amount: 300_000 }, true)
        const html = lists(await renderScreen(Money, '/money'))
        // 2 000 000 + 479 260 + 1 200 000 + 300 000 (личный тоже в капитале) + цели вне счетов 650 000 (Р-109, Блок 16) —
        // итог не у заголовка, а в подсказке у капитала («Счета и цели — …», Р-116): та же сумма из finance.ts.
        expect(amountTotal(liveAccounts(store.accounts)) + capitalGoals(store.goals, store.accounts).total).toBe(4_629_260)
        expect(html).not.toContain(money(4_629_260))
        expect(html).toContain(`Kaspi Gold карта · общий ${money(2_000_000)}`)
        expect(html).toContain(`Доллары наличные · ${moneyIn(1_000, 'USD')} · общий ${money(479_260)}`)
        expect(html).toContain(`Депозит Kaspi 14 % · общий ${money(1_200_000)}`)
        expect(html).toContain(`Заначка наличные · личный ${money(300_000)}`)
        expect(html).toContain('Добавить счёт')
      })

      it('«Платежи» — справочник: по дню, без «Оплатил», ✓ и сумм месяца — и у оплаченного; годовое — «раз в год · в марте»; подписки — одной строкой', async () => {
        const store = await family('member', withSubs())
        store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
        const html = await renderScreen(Money, '/money')
        const list = payments(html)
        const order = ['Страховка', 'Аренда', 'Коммуналка', 'Кредит ', 'Кредитка', 'Рассрочка', 'Подписки · 3']
        expect(order.map((n) => list.indexOf(n)).every((i) => i >= 0)).toBe(true)
        expect(order.map((n) => list.indexOf(n))).toEqual([...order.map((n) => list.indexOf(n))].sort((a, b) => a - b))
        // Строка: название, день, кружок плательщика, сумма — и больше ничего.
        expect(list).toContain(`Аренда 5-го И ${money(220_000)}`)
        expect(list).toContain(`Коммуналка 8-го · ≈ оценка А ${money(30_000)}`)
        expect(list).toContain(`Страховка раз в год · в марте И ${money(60_000)}`)
        // Оплаченный кредит — та же строка справочника: отметка живёт в «Месяце».
        expect(list).toContain(`Кредит 15-го И ${money(58_000)}`)
        for (const gone of ['Оплатил', 'оплачено', 'Осталось в', '✓']) expect(list).not.toContain(gone)
        expect(html).not.toContain('aria-label="Оплачено — подробнее"')
        // Подписки (Р-93): свёрнуты — «Подписки · 3» и сумма в месяц (4 990 + 2 990 + 1 490); по отдельности их в списке нет.
        expect(list).toContain(`Подписки · 3 ${money(9_470)}`)
        for (const name of ['Netflix', 'Яндекс', 'iCloud']) expect(list).not.toContain(name)
        // Ручная группа «Кино» целиком из подписок — своей строкой не стоит (она подзаголовком внутри).
        expect(list).not.toContain('Кино')
        // Ставка и доли кредита — только в листе кредита.
        expect(list).not.toContain('ГЭСВ')
        expect(list).not.toContain('в долг')
        expect(list).toContain('Добавить')
      })

      it('подписки раскрыты: сначала без группы, затем ручная группа подзаголовком; лист группы — те же строки без «Оплатил»', async () => {
        await family('member', withSubs())
        const open = text(await renderScreen(Money, '/money', undefined, [screenMixin({ subsOpen: true })]))
        const list = open.slice(open.indexOf('Подписки · 3'))
        const order = ['iCloud', 'Кино ›', 'Netflix', 'Яндекс']
        expect(order.map((n) => list.indexOf(n)).every((i) => i >= 0)).toBe(true)
        expect(order.map((n) => list.indexOf(n))).toEqual([...order.map((n) => list.indexOf(n))].sort((a, b) => a - b))
        expect(list).toContain(`Netflix 3-го И ${money(4_990)}`)
        const group = text(await renderScreen(Money, '/money', undefined, [screenMixin({ selectedGroupId: 'Кино' })]))
        expect(group).toContain(`Netflix 3-го И ${money(4_990)}`)
        expect(group).toContain(`Итого ${money(7_980)} в месяц`)
        expect(group).not.toContain('Оплатил')
      })

      it('одна подписка — обычной строкой, без группы; ручная группа с не-подпиской — своей строкой', async () => {
        await family('member', {
          obligations: [
            ...planFamilyDoc().obligations,
            subs('iCloud', { day: 15, versions: [{ from: '2000-01', amount: 1_490 }] }),
            subs('Дом', { group: true, versions: [] }),
            subs('Коммуналка', { parentId: 'Дом', day: 8, category: 'd1', estimate: true, versions: [{ from: '2000-01', amount: 30_000 }] }),
          ],
        })
        const list = payments(await renderScreen(Money, '/money'))
        expect(list).toContain(`iCloud 15-го И ${money(1_490)}`)
        expect(list).not.toContain('Подписки ·')
        expect(list).toContain(`Дом 1 ${money(30_000)}`)
      })

      it('листы платежа и кредита — без «Оплатил»: отметка месяца — только в «Месяце» (Р-94)', async () => {
        await family()
        const credit = dialog2(await renderScreen(Money, '/money?credit=loan'))
        // Срок — строкой у полей; «Платежей осталось» — в свёрнутом «Графике платежей» (Б17).
        expect(credit).toContain('закроется в')
        expect(credit).toContain('График платежей')
        expect(dialog2(await renderScreen(Money, '/money?credit=loan', undefined, [screenMixin({ scheduleOpen: true })]))).toContain('Платежей осталось')
        expect(credit).not.toContain('Оплатил')
        const rent = dialog2(await renderScreen(Money, '/money?obligation=rent'))
        expect(rent).toContain('Аренда')
        expect(rent).not.toContain('Оплатил')
      })

      it('viewer: ни «Добавить», ни «Добавить счёт»; закладка ?add= формы не открывает', async () => {
        await family('viewer')
        for (const path of ['/money', '/money?add=debt', '/money?add=payment']) {
          const html = await renderScreen(Money, path)
          expect(text(html)).toContain('Платежи')
          expect(html).not.toMatch(/<button[^>]*>\s*Оплатил/)
          expect(html).not.toMatch(/<button[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?\s*Добавить/)
          for (const t of ['Долг или рассрочка', 'Регулярный платёж']) expect(html).not.toContain(t)
        }
      })

      it('адрес открывает лист: ?account= — счёт (вклад — с «Расчётом вклада»), ?credit=, ?obligation=; участнику ?add=debt — форма; «Внеплановый доход» — в «Месяце»', async () => {
        await family('member', {
          accounts: [{ id: 'dep', name: 'Депозит Kaspi', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'deposit', updatedAt: T0, deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true } }],
        })
        const dep = dialog2(await renderScreen(Money, '/money?account=dep'))
        expect(dep).toContain('Депозит Kaspi')
        expect(dep).toContain('Расчёт вклада')
        expect(dep).toContain('Удалить вклад')
        expect(dialog2(await renderScreen(Money, '/money?credit=loan'))).toContain('закроется в')
        expect(dialog2(await renderScreen(Money, '/money?obligation=rent'))).toContain('Аренда')
        expect(dialog2(await renderScreen(Money, '/money?add=debt'))).toContain('Долг или рассрочка')
        // `?income=1` на «Деньгах» больше ничего не открывает — лист живёт в «Месяце».
        expect(await renderScreen(Money, '/money?income=1')).not.toContain('role="dialog"')
        expect(dialog2(await renderScreen(Month, '/month?income=1'))).toContain('Внеплановый доход')
      })
    })
  })

  describe('B2C-43: долговой план — самая дорогая ставка и «Сначала долги»; с Б17 — экран «Закрыть быстрее» (перенос DebtPlan.test и «Что гасить первым»)', () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    /** Экран «Закрыть быстрее» (`/money/debts/faster`, Б17): весь долговой план — здесь, на «Долгах» — только ссылка. */
    const faster = () => renderScreen(DebtFaster, '/money/debts/faster')
    const stepButton = />\s*Шаг сделан\s*</
    const prepay = (p: Partial<Payment>): Payment => ({
      id: 'p1', kind: 'prepay', targetId: 'cc', period: '2026-09', amount: 100_000, principal: 100_000, accountId: 'card',
      by: 'a', at: '2026-09-20T05:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', saved: 9_000, mode: 'term', planId: 'plan', ...p,
    })
    const plan = async (extra: Partial<SyncDoc> = {}, role: 'member' | 'viewer' = 'member', now = '2026-09-24T07:00:00Z') => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(now))
      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs(role, 'a'))
      useFinanceStore().setHouseholdDoc(planFamilyDoc({ plans: [planOf()], ...extra }), 1)
      return useFinanceStore()
    }
    afterEach(() => vi.useRealTimers())

    it('«Самая дорогая ставка»: на виду — одной строкой имя и ставка; долг, проценты в месяц, переплата = debtAdvice — в свёрнутом «Подробнее»', async () => {
      const store = await plan({ plans: [] })
      const { worstDebt, worstHalfExtra, worstGain } = debtAdvice(store.credits)
      const html = await faster()
      // Главная карточка (Б17): «Сначала долги» и одна строка — самая дорогая; цифр долга здесь нет.
      const main = text(html.slice(html.indexOf('data-plan-main'), html.indexOf('data-plan-more')))
      expect(main).toContain('Сначала долги')
      expect(main).toContain('Самая дорогая — Кредитка · 40 %')
      expect(main).not.toContain(money(300_000))
      expect(main).not.toContain(money(worstDebt!.cost.monthlyInterest))
      // «Подробнее» — свёрнуто; всё, что было в карточке ставки, — тут.
      const more = html.slice(html.indexOf('data-plan-more') - 200)
      expect(more).toMatch(/<details[^>]*data-plan-more[^>]*>\s*<summary/)
      expect(html).not.toMatch(/<details[^>]* open/)
      const detailRaw = html.slice(html.indexOf('data-plan-worst-detail'), html.indexOf('Копить или гасить?'))
      const detail = text(detailRaw)
      expect(detail).toContain(`Самая дорогая ставка Кредитка · 40 % ${money(300_000)}`)
      expect(worstDebt!.cost.monthlyInterest).toBe(10_000)
      expect(detail).toContain(`Процентов в месяц ${money(10_000)}`)
      expect(detail).toContain(`Переплата до конца ${money(worstDebt!.cost.overpay)}`)
      expect(detail).toContain('Доля платежа в проценты 40%')
      expect(detail).toContain(`Проценты банку по всем долгам ${money(budgetInterest(store.credits))} в месяц`)
      // Розового блока нет — половина переплаты одной строкой `data-plan-half`.
      expect(detailRaw).toContain('data-plan-half')
      expect(detailRaw).not.toContain('border-brand bg-brand-soft')
      expect(detail).toContain(`Половину переплаты снимет добавка ${money(worstHalfExtra!)} в месяц`)
      expect(detail).toContain(`это минус ${worstGain!.monthsSaved} мес. и экономия ${money(worstGain!.saved)}`)
      expect(detail).toContain('Посчитать на свою сумму')
    })

    it('без ставки — «уточните»; долгов нет — «Долгов нет» вместо обеих карточек', async () => {
      const store = await plan({ plans: [] })
      store.addCredit({ name: 'Оплата Kaspi Кредита', note: 'из выписки', principal: 1_200_000, annualRate: 0, rateUnknown: true, payment: 151_790, day: 24 })
      expect(text(await faster())).toContain('Ставку «Оплата Kaspi Кредита» уточните — тогда сравним.')
      await plan({ plans: [], credits: [] })
      // «Долгов нет» — на «Долгах»; ссылки «Как закрыть быстрее» нет, и сам экран пуст.
      const debts = await renderScreen(Money, '/money/debts')
      expect(text(debts)).toContain('Долгов нет')
      expect(debts).not.toContain('data-debts-calc')
      const none = text(await faster())
      expect(none).not.toContain('Самая дорогая')
      expect(none).not.toContain('Сначала долги')
    })

    it('без плана — переключатель выключен, «Копить или гасить?» свёрнуто с выбором плана внутри', async () => {
      await plan({ plans: [] })
      const html = await faster()
      expect(html).toMatch(/role="switch" aria-checked="false"/)
      expect(html).not.toMatch(/role="switch"[^>]*\sdisabled(=""|\s|>)/)
      expect(text(html)).toContain('Копить или гасить?')
      expect(html).toMatch(/>\s*Выбрать этот план\s*</)
      expect(html).not.toMatch(stepButton)
    })

    it('план: переключатель включён, шаг месяца, прогноз одной строкой от planOutlook, «Уже сэкономили» = planFact, цели на паузе, подушка; «Шаг сделан» и «Изменить режим» убраны (Блок 16, Р-110)', async () => {
      const store = await plan()
      const html = await faster()
      const t = text(html)
      expect(html).toMatch(/role="switch" aria-checked="true"/)
      expect(t).toContain(`Шаг сентября ${money(100_000)} досрочно`)
      expect(t).toContain('в «Кредитка»')
      const o = planOutlook(store.activePlan!, store.planState(), '2026-09')
      expect(o.monthsSooner).toBeGreaterThan(0)
      // Одна крупная цифра (Б17): на сколько раньше; шаг — строкой под ней.
      expect(html).toMatch(new RegExp(`data-plan-sooner[^>]*>на ${o.monthsSooner} мес\\. раньше<`))
      expect(html).toMatch(new RegExp(`data-plan-step[^>]*>${money(100_000)} → Кредитка · 40 %<`))
      // Полный прогноз — в «Подробнее».
      expect(t).toContain(
        `Закроется в ${monthIn(o.debtFreeMonth!)}, на ${o.monthsSooner} мес. раньше. Переплата ${plain(o.overpayWithout!)} → ${money(o.overpayWith!)}.`,
      )
      // До первой досрочки — без «Уже сэкономили 0 ₸» (ревью frontend Б9, Н-9; правило 12).
      expect(t).not.toContain('Уже сэкономили')
      expect(t).toContain('Цели на паузе Отпуск, Машина')
      expect(t).not.toContain('взнос идёт в долг')
      expect(t).toContain('Подушка плана Подушка')
      // Шаг месяца записывает «Отложил» у строки долга в «Месяце» — здесь кнопок шага нет.
      expect(html).not.toMatch(stepButton)
      expect(t).not.toContain('Изменить режим')
      // Шаг внесён — «внесено по плану», досрочка строкой, кнопок нет; «Уже сэкономили» — живой planFact.
      await plan({ payments: [prepay({})] })
      const st = useFinanceStore()
      const done = text(await faster())
      expect(done).toContain(`внесено по плану · ${money(100_000)}`)
      expect(done).toContain(`${money(100_000)} в «Кредитка»`)
      expect(done).not.toContain('Шаг сделан')
      expect(done).not.toContain('Изменить режим')
      expect(done).toContain(`Уже сэкономили ${money(planFact(st.activePlan!, st.payments, st.credits).savedInterest)}.`)
      expect(planFact(st.activePlan!, st.payments, st.credits).savedInterest).toBe(9_000)
      // Критик (Р-38): при плане сэкономленное — одно число строкой прогноза; «Досрочками уже сэкономили» в «Подробнее» — без плана.
      expect(done).not.toContain('Досрочками уже сэкономили')
    })

    it('шаг закрыл кредитку, сумма месяца не вся — второй шаг в «Кредит» с «уже внесено»', async () => {
      const credits = planFamilyDoc().credits.map((c) => (c.id === 'cc' ? { ...c, principal: 20_000 } : c))
      await plan({ credits, payments: [prepay({ amount: 20_000, principal: 20_000 })] })
      const t = text(await faster())
      expect(t).toContain(`${money(100_667)} досрочно`)
      expect(t).toContain(`в «Кредит»; уже внесено ${money(20_000)} — «Кредитка» закрыт`)
    })

    it('шаг — подушка: «сначала подушка: не хватает N» и «Пополнить подушку»; без взносов на паузе — шага нет', async () => {
      const goals = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 100_000, seed: 100_000 } : g))
      await plan({ goals })
      const html = await faster()
      expect(text(html)).toContain(`сначала подушка: не хватает ${money(223_000)}`)
      expect(html).toMatch(/>\s*Пополнить подушку\s*</)
      expect(html).not.toMatch(stepButton)
      await plan({ plans: [planOf({ keptGoalIds: ['trip', 'car'] })] })
      const none = await faster()
      expect(text(none)).not.toContain('Шаг сентября')
      expect(none).not.toMatch(stepButton)
    })

    it('пропущенный месяц — одна строка без упрёка; «Шаги по месяцам» — план и факт, пауза целей, ожидание при выборе, история планов', async () => {
      const store = await plan({}, 'member', '2026-10-15T07:00:00Z')
      const t = text(await faster())
      expect(t).toContain('В сентябре досрочки не было — план пересчитан от факта.')
      expect(t).not.toMatch(/пропустил|просроч|не внесли|забыли/i)
      const months = t.slice(t.indexOf('Шаги по месяцам'))
      expect(months).toContain(`сен 2026 ${money(100_000)} — —`)
      expect(months).toContain(`окт 2026 ${money(100_000)} — Кредитка`)
      expect(months).toContain(`«Отпуск»: ${money(80_000)} не внесено, дата сдвинулась на 2 мес.`)
      expect(months).toContain(`При выборе ожидали: не отдадим банку ${money(180_000)}`)
      expect(store.activePlan?.forecast.savedInterest).toBe(180_000)
      // История — живой итог (досрочка партнёра после отмены), новые сверху; план закрыт в этом месяце — Callout.
      const done = planOf({ status: 'done', endedAt: '2026-10-19T05:00:00.000Z', result: { savedInterest: 0 } })
      const old = planOf({ id: 'old', status: 'cancelled', startedAt: '2026-08-05T05:00:00.000Z', endedAt: '2026-08-20T05:00:00.000Z', result: { savedInterest: 0 } })
      await plan({ plans: [old, done], payments: [prepay({})] }, 'member', '2026-10-20T07:00:00Z')
      const h = text(await faster())
      expect(h).toContain('Долги с процентами закрыты — цели возобновились')
      expect(h).toContain(`Сентябрь 2026 — Октябрь 2026: сэкономили ${money(9_000)} процентов`)
      expect(h).toContain(`Август 2026: отменён, сэкономили ${money(0)}`)
      expect(h.indexOf('Сентябрь 2026 — Октябрь 2026')).toBeLessThan(h.indexOf('Август 2026: отменён'))
    })

    it('критик: план закрыл последний долг — «Долгов нет», но поздравление и прошлые планы на месте (как в прежнем экране плана)', async () => {
      const done = planOf({ status: 'done', endedAt: '2026-10-19T05:00:00.000Z', result: { savedInterest: 0 } })
      const closed = planFamilyDoc().credits.map((c) => ({ ...c, principal: 0 }))
      await plan({ plans: [done], credits: closed, payments: [prepay({})] }, 'member', '2026-10-20T07:00:00Z')
      const t = text(await renderScreen(Money, '/money/debts'))
      expect(t).toContain('Долгов нет')
      expect(t).toContain('Долги с процентами закрыты — цели возобновились')
      expect(t).toContain('Прошлые планы')
      expect(t).toContain(`Сентябрь 2026 — Октябрь 2026: сэкономили ${money(9_000)} процентов`)
      expect(t).not.toContain('Самая дорогая ставка')
    })

    it('Р-11: долг не закрывается — прогноз «экономию не считаем», без «Переплата A → B»', async () => {
      const store = await plan()
      store.updateCredit('cc', { payment: 5_000 })
      store.updateCredit('loan', { payment: 20_000 })
      const t = text(await faster())
      expect(t).toContain('Прогноз: при текущем платеже долг не закрывается — экономию не считаем.')
      expect(t).not.toContain('Переплата')
    })

    it('viewer: переключатель неактивен, шаг и прогноз видны, ни «Шаг сделан», ни «Изменить режим», ни «Выбрать этот план»', async () => {
      await plan({}, 'viewer')
      const html = await faster()
      expect(html).toMatch(/role="switch" aria-checked="true"[^>]*\sdisabled(=""|\s|>)/)
      expect(text(html)).toContain(`Шаг сентября ${money(100_000)} досрочно`)
      expect(html).not.toMatch(stepButton)
      expect(html).not.toContain('Изменить режим')
      expect(html).not.toMatch(/>\s*Выбрать этот план\s*</)
    })

  })

  describe('B2C-44: квадрат «История» — свои операции, отметки, итог и моменты по дням', () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    /** Лента: от чипов фильтра до конца экрана. */
    const squares = squaresOf
    const feed = (html: string) => text(html.slice(html.indexOf('>', html.indexOf('aria-label="Фильтр"')) + 1))
    const op = (id: string, date: string, amount: number, merchant: string, p: Partial<Operation> = {}): Operation => ({
      id, bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId: null, internal: false, ...p,
    })
    const ops = [
      op('o1', '2026-09-24', -6_800, 'ИП Сериков', { categoryId: 'sc_food' }),
      op('o2', '2026-09-24', -4_990, 'Яндекс Плюс', { categoryId: 'sc_subscriptions' }),
      op('o3', '2026-09-20', -12_400, 'Magnum', { categoryId: 'sc_food' }),
      op('o4', '2026-09-12', -200_000, 'На депозит', { kind: 'transfer-out', internal: true }),
      op('o5', '2026-09-11', -3_000, 'Непонятно ТОО'),
      op('o6', '2026-08-30', -9_000, 'Magnum', { categoryId: 'sc_food' }),
    ]
    const history = async (role: 'member' | 'viewer' = 'member', now = '2026-09-25T07:00:00Z', list = ops) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(now))
      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs(role, 'a'))
      const store = useFinanceStore()
      // Аруна отметила аренду 20 сентября (с выписки).
      const rent: Payment = { id: 'pr', kind: 'obligation', targetId: 'rent', period: '2026-09', amount: 220_000, accountId: 'card', by: 'b', at: '2026-09-20T05:00:00.000Z', updatedAt: '2026-09-20T05:00:00.000Z', source: 'statement' }
      store.setHouseholdDoc(planFamilyDoc({ payments: [rent] }), 1)
      // Стор операций у viewer пуст: сервер отдаёт только свои (Р-5).
      if (role === 'member') for (const o of list) useOperationsStore().ops[o.id] = o
      return store
    }
    afterEach(() => vi.useRealTimers())

    it('лента по дням, новые сверху: операции с разделом и знаком, «между своими» без знака; прошлый месяц — только после «Раньше»', async () => {
      await history()
      const t = feed(await renderScreen(Money, '/money/history'))
      const days = ['24 сентября', '20 сентября', '12 сентября', '11 сентября']
      expect(days.map((d) => t.indexOf(d)).every((i, k, a) => i >= 0 && (k === 0 || i > a[k - 1]))).toBe(true)
      expect(t).toContain(`ИП ИП Сериков Продукты −${money(6_800)}`)
      expect(t).toContain(`На депозит между своими · не трата ${money(200_000)}`)
      expect(t).not.toContain(`−${money(200_000)}`)
      expect(t).toContain(`Н Непонятно ТОО Не разобрано −${money(3_000)}`)
      expect(t).not.toContain('30 августа')
      expect(t).toContain('Раньше')
      const more = feed(await renderScreen(Money, '/money/history', undefined, [screenMixin({ months: ['2026-09', '2026-08'] })]))
      expect(more).toContain(`30 августа M Magnum Продукты −${money(9_000)}`)
      expect(more).not.toContain('Раньше')
    })

    it('отметка — «оплачено · кто · из выписки» со знаком; чипы: Всё, Операции, Отметки, разделы по сумме трат, «Не разобрано»; фильтр «Отметки» — только отметки', async () => {
      await history()
      const html = await renderScreen(Money, '/money/history')
      const t = feed(html)
      expect(t).toContain(`Аренда оплачено · Аруна · из выписки −${money(220_000)}`)
      // Продукты 19 200 > Подписки 4 990 > Не разобрано 3 000; между своими — не трата.
      expect(t).toMatch(/^ ?Всё Операции Отметки Продукты Подписки Не разобрано /)
      const marks = feed(await renderScreen(Money, '/money/history', undefined, [screenMixin({ filter: 'marks' })]))
      expect(marks).toContain('Аренда оплачено')
      expect(marks).not.toContain('Magnum')
      const food = feed(await renderScreen(Money, '/money/history', undefined, [screenMixin({ filter: 'sc_food' })]))
      expect(food).toContain('Magnum')
      expect(food).not.toContain('Яндекс Плюс')
      expect(food).not.toContain('Аренда оплачено')
    })

    it('итог месяца строкой: в середине месяца — прошлый, в последние дни — этот; лист — карточка «Наш <месяц>»', async () => {
      await history('member', '2026-09-29T07:00:00Z')
      const end = await renderScreen(Money, '/money/history')
      expect(text(end)).toContain('Наш сентябрь итог месяца · поделиться')
      const sheet = text(await renderScreen(Money, '/money/history', undefined, [screenMixin({ summaryOpen: true })]))
      expect(sheet).toContain(`Оплатили 1 платёж ${money(220_000)}`)
      // 15 октября: итог сентября строкой, хотя «сейчас» не конец месяца.
      await history('member', '2026-10-15T07:00:00Z')
      expect(text(await renderScreen(Money, '/money/history'))).toContain('Наш сентябрь итог месяца · поделиться')
    })

    it('viewer: операций нет (они у владельца), отметки и итог видны; ни «Загрузить выписку», ни нажатий на операции', async () => {
      await history('viewer')
      const html = await renderScreen(Money, '/money/history')
      const t = feed(html)
      expect(t).toContain('Аренда оплачено · Аруна')
      expect(t).not.toContain('Magnum')
      expect(html).not.toContain('Загрузить выписку')
      // Пусто у viewer — без кнопки загрузки.
      vi.setSystemTime(new Date('2026-11-25T07:00:00Z'))
      const empty = await renderScreen(Money, '/money/history')
      expect(text(empty)).toContain('Пока пусто')
      expect(empty).not.toContain('Загрузить выписку')
    })

    it('пусто у участника — «Пока пусто» и тихая «Загрузить выписку»; у чипа подписи нет — последний прошлый месяц первой строкой', async () => {
      await history('member', '2026-11-25T07:00:00Z')
      const html = await renderScreen(Money, '/money/history')
      expect(text(html)).toContain('Пока пусто')
      expect(html).toMatch(/>\s*Загрузить выписку\s*</)
      // Блок 16 (Р-111): последний прошлый месяц «Истории» (данные с августа) — первой строкой; чип без подписи (Р-116).
      await history()
      const filled = await renderScreen(Money, '/money/history')
      expect(text(squares(filled))).toMatch(/> Капитал Долги История\s*$/)
      expect(filled.match(/data-history-month="([^"]+)"/)?.[1]).toBe('2026-08')
    })
  })

  it('«Освободится» (Р-86, Блок 15): подсказка у платежа в «Месяце» — +N в месяц из freedChange (годовое — доля в месяц) первой цели очереди, одна брендовая; на «Деньгах» её нет', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z')) // 17 сентября, Алматы
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 25, updatedAt: '' }]
      store.householdDoc.goals = [{ id: 'trip', name: 'Отпуск', need: 2_000_000, seed: 0, have: 0, monthly: 50_000, hue: 'teal', planPct: 0, movements: [], updatedAt: '' }]
      // Страховка раз в год 60 000, с октября — 48 000: в месяц освобождается 1 000, за год — 12 000 (а не 12 000 и 144 000).
      store.householdDoc.obligations = [
        {
          id: 'ins', name: 'Страховка', note: '', day: 5, month: 3, every: 'year', category: 'd1',
          versions: [{ from: '2026-01', amount: 60_000 }, { from: '2026-10', amount: 48_000 }], updatedAt: '',
        },
        { id: 'net', name: 'Интернет', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 10_000 }], updatedAt: '' },
      ]
      const dues = [screenMixin({ opened: 'dues' })]
      let plan = await renderScreen(Month, '/month', undefined, dues)
      expect(plan).toContain(`С октября свободно +${plain(1_000)} в месяц`)
      expect(plan).toMatch(/>\s*К «Отпуск»\s*</)
      expect(plan).not.toContain(plain(12_000))
      // Зарплата не ждёт «Отложил» — кнопка подсказки брендовая, и она на экране одна (правило 12).
      const brand = (html: string) =>
        [...html.matchAll(/<button[^>]*class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim())
      expect(brand(await renderScreen(Month, '/month'))).toEqual([])
      expect(brand(plan)).toEqual(['К «Отпуск»'])
      const html = await renderScreen(Money, '/money')
      expect(html).not.toContain('свободно')
      expect(html).not.toContain(money(12_000))

      // Ежемесячное 300 000 → 220 000: 80 000 в месяц, 960 000 за год. На карте меньше списаний — одна фраза.
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi Gold', note: '', kind: 'card', amount: 100_000, updatedAt: '' }]
      plan = await renderScreen(Month, '/month', undefined, dues)
      expect(plan).toContain(`С октября свободно +${plain(80_000)} в месяц`)
      expect(await renderScreen(Money, '/money')).not.toContain('не хватает')
    } finally {
      vi.useRealTimers()
    }
  })
})
