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
  duesTotal,
  freeByFact,
  monthDues,
  netWorth,
  planFact,
  planOutlook,
  cushionMonths,
  liquidCash,
  nextChange,
  untilPayday,
} from '@/lib/finance'
import { money, pct, plain } from '@/lib/money'
import { monthIn } from '@/lib/dates'
import type { Obligation, Payment, SyncDoc } from '@/types/finance'
import type { Operation } from '@/lib/statements/types'
import type { SpendTotal } from '@/lib/statements/types'
import { authAs, planFamilyDoc, planOf, T0 } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Money from './Money.vue'

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


  describe('пивот 3 (B2C-41): «Деньги» — сводка «До зарплаты», три квадрата, виджеты Доход · Траты · Долги', () => {
    const total = (by: 'a' | 'b', period: string, categoryId: string, amount: number): SpendTotal => ({
      id: `${by}:month:${period}:${categoryId}`, by, kind: 'month', period, categoryId, amount, ops: 1, updatedAt: T0,
    })
    const upload = { id: 'u1', slot: 'a' as const, bank: 'kaspi', period_from: '2026-09-01', period_to: '2026-09-11', ops_count: 10, created_at: T0 }
    // Текст как его видит человек: теги — пробел, переводы строк и пробелы шаблона схлопнуты (NBSP сумм остаются).
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
    // Лист в SSR рендерится на месте (без Teleport) — его текст отдельно от экрана.
    const dialog = (html: string) => {
      expect(html).toContain('role="dialog"')
      // Лист — внутри сводки, сразу за ним — квадраты «Денег».
      const at = html.indexOf('role="dialog"')
      return html.slice(at, html.indexOf('aria-label="Деньги"', at))
    }
    /** Текст открытого листа где угодно на экране (до конца разметки). */
    const dialog2 = (html: string) => {
      expect(html).toContain('role="dialog"')
      return text(html.slice(html.indexOf('role="dialog"')))
    }
    const squares = squaresOf

    // Семья `planFamilyDoc`: Ильяс 700 000 (10-го), Аруна 500 000 (20-го), аренда 220 000 (5-го), три долга
    // (15-го, 22-го, 25-го), еда и быт 150 000. «Сейчас» — 12 сентября: до зарплаты Аруны 8 дней.
    async function family(role: 'member' | 'viewer' = 'member', extra: Partial<SyncDoc> = {}, uploads: (typeof upload)[] = []) {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-12T07:00:00Z'))
      setActivePinia(createPinia())
      useAuthStore().setAuthData(authAs(role, 'a'))
      useFinanceStore().setHouseholdDoc(planFamilyDoc(extra), 1)
      vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads })
      await useOperationsStore().loadUploads()
      return useFinanceStore()
    }
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()
    })

    it('сводка: дни до зарплаты, K списаний и сумма — из untilPayday, «хватает» и остаток; «Оплатил» уменьшает K и сумму', async () => {
      const store = await family()
      const p = untilPayday({ people: store.people, obligations: store.obligations, credits: store.credits, accounts: store.householdAccounts, payments: store.payments })!
      expect(p.inDays).toBe(8)
      expect(p.due.map((d) => d.name)).toEqual(['Кредит'])
      expect(p.dueTotal).toBe(58_000)
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('До зарплаты 8 дней')
      expect(html).toContain(`1 списание · ${plain(58_000)} ₸ · остаётся ${plain(p.shortfall)} ₸`)
      expect(html).toContain('хватает')
      // «Впереди», меню входов и «Свободно до конца месяца» ушли (Р-31, Р-32).
      for (const gone of ['Впереди', 'Календарь', 'История и итоги', 'Свободно до конца месяца']) expect(html).not.toContain(gone)
      // Лист «До зарплаты» — те же строки с «Оплатил» и строка зарплаты.
      const sheet = text(dialog(await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])))
      for (const t of ['До зарплаты', 'Кредит', 'Оплатил', 'Аруна']) expect(sheet).toContain(t)
      // Критик: имя — в названии строки зарплаты, в подписи только дата (было «Зарплата · Аруна … · Аруна»).
      expect(sheet.match(/Аруна/g)).toHaveLength(1)
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Списаний нет')
      expect(html).not.toContain('1 списание')
    })

    it('сводка: на счетах меньше — «не хватает N ₸»; счетов нет — «Добавьте счёт»; оклада нет ни у кого — карточки нет', async () => {
      await family('member', { accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 20_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }] })
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`не хватает ${plain(38_000)} ₸`)
      expect(html).not.toContain('остаётся')
      await family('member', { accounts: [] })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Добавьте счёт — покажем, хватит ли')
      expect(html).not.toContain('хватает')
      await family('member', { people: planFamilyDoc().people.map((x) => ({ ...x, salary: 0 })) })
      html = text(await renderScreen(Money, '/money'))
      expect(html).not.toContain('До зарплаты')
    })

    it('квадраты: Капитал — чистых коротко, План — три состояния, История — «отметки» без операций; активный — по адресу', async () => {
      const store = await family()
      const worth = netWorth(store.accounts, store.credits, store.goals)
      let html = await renderScreen(Money, '/money')
      expect(text(squares(html))).toContain(`Капитал ${plain(worth)}`)
      expect(text(squares(html))).toContain('План гасить первым')
      expect(text(squares(html))).toContain('История отметки')
      expect(squares(html).match(/aria-current="page"/g)).toHaveLength(1)
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>Капитал/)
      // Подсказка «чистых» — у квадрата «Капитал», рядом с кнопкой, а не внутри (кнопка в кнопке недопустима).
      const capital = squares(html).slice(0, squares(html).indexOf('>План</b>'))
      expect(capital).toMatch(/<\/button>\s*<span class="absolute right-2 top-2">\s*<span[^>]*>\s*<button[^>]*aria-label="Что такое капитал"/)
      expect(squares(html).match(/aria-label="Что такое капитал"/g)).toHaveLength(1)
      store.householdDoc.plans = [planOf()]
      html = await renderScreen(Money, '/money/plan')
      expect(text(squares(html))).toContain('План сначала долги')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>План/)
      // Сводка и виджеты — только у Капитала.
      expect(html).not.toContain('До зарплаты')
      expect(html).not.toContain('обязательное')
      store.householdDoc.plans = []
      store.householdDoc.credits = []
      html = await renderScreen(Money, '/money/history')
      expect(text(squares(html))).toContain('План долгов нет')
      expect(squares(html)).toMatch(/aria-current="page"[^>]*>\s*<b[^>]*>История/)
    })

    it('«Доход»: оклады, нагрузка = доля жилья и кредитов (формула Бюджета), доли в легенде, строки участников с днём', async () => {
      const store = await family()
      const a = budgetAmounts({ ...store.householdDoc, credits: store.credits })
      expect(a).toMatchObject({ d1: 220_000, d2: 103_000, d3: 130_000, d4: 150_000, d5: 597_000, income: 1_200_000 })
      const html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(money(1_200_000))
      expect(html).toContain(`нагрузка ${pct(a.d1 + a.d2, a.income)} %`)
      expect(html).toContain('нагрузка 27 %')
      for (const t of ['обязательное 27 %', 'мечты 11 %', 'траты 13 %', 'свободно 50 %']) expect(html).toContain(t)
      expect(html).toContain(`Ильяс 10-го ${money(700_000)}`)
      expect(html).toContain(`Аруна 20-го ${money(500_000)}`)
      expect(html).not.toContain('План не сходится')
    })

    it('«Траты» (бывший «Еда и быт», владелец 2026-10-02): факт — траты по выпискам без разделов плана (= вычитаемое «Свободно»), план — база d4; без загрузок — «—» без тега', async () => {
      const totals = [total('a', '2026-09', 'sc_food', 90_000), total('b', '2026-09', 'sc_cafe', 30_000), total('a', '2026-09', 'sc_credit', 58_000)]
      const store = await family('member', { spendTotals: totals }, [upload])
      const fact = freeByFact({ ...store.householdDoc, credits: store.credits }, totals, store.householdDoc.spendCategories ?? [], '2026-09', [upload]).spent
      expect(fact).toBe(120_000)
      const html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`${money(fact)} план ${plain(150_000)}`)
      expect(html).toContain('по выпискам 80 %')
      // Название виджета и доли — «Траты» / «траты»; прежнего «Еда и быт» на Капитале нет.
      expect(html).toMatch(/Траты \? по выпискам 80 %/)
      expect(html).not.toMatch(/еда и быт/i)
      await family('member', { spendTotals: totals }, [])
      const none = text(await renderScreen(Money, '/money'))
      expect(none).toContain(`— план ${plain(150_000)}`)
      expect(none).not.toContain('по выпискам')
    })

    it('«Долги»: остаток красным, «в сентябре оплачено N из M» растёт после «Оплатил», «чистых» нет (оно в квадрате); без долгов — «Долгов нет»', async () => {
      const store = await family()
      let html = text(await renderScreen(Money, '/money'))
      expect(html).toContain(`−${money(1_540_000)}`)
      expect(html).toContain('в сентябре оплачено 0 из 3')
      // «Чистых» — только в квадрате «Капитал» (решение владельца 2026-10-02): в «Долгах» его нет.
      expect(html).not.toContain('чистых')
      store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('в сентябре оплачено 1 из 3')
      // «Чистый капитал» карточкой больше нет — он строкой в «Долгах» (Р-33).
      expect(html).not.toContain('Чистый капитал')
      store.householdDoc.credits = []
      html = text(await renderScreen(Money, '/money'))
      expect(html).toContain('Долгов нет')
      expect(html).not.toContain('оплачено')
    })

    describe('B2C-42: «Счета» и «Платежи» одним списком, листы', () => {
      // Списки — после виджетов: от «Счета» до конца экрана (листы в SSR на месте, закрытые — пустые).
      const lists = (html: string) => text(html.slice(html.indexOf('>Счета<')))
      const payments = (html: string) => lists(html).slice(lists(html).indexOf('Платежи'))
      const usd = { id: 'usd', name: 'Доллары', note: '', amount: 479_260, amountSetAt: T0, kind: 'cash' as const, currency: 'USD' as const, foreignAmount: 1_000, rate: 479.26, rateAt: T0, updatedAt: T0 }

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
        // 2 000 000 + 479 260 + 1 200 000 + 300 000 (личный тоже в капитале).
        expect(html).toContain(`Счета ${money(3_979_260)}`)
        expect(html).toContain(`Kaspi Gold карта · общий ${money(2_000_000)}`)
        expect(html).toContain(`Доллары наличные · ${plain(1_000)} USD · общий ${money(479_260)}`)
        expect(html).toContain(`Депозит Kaspi 14 % · общий ${money(1_200_000)}`)
        expect(html).toContain(`Заначка наличные · личный ${money(300_000)}`)
        expect(html).toContain('Добавить счёт')
      })

      it('«Платежи»: по дню, итог = duesTotal(monthDues), оплаченное на месте с ✓ без «Оплатил», годовое не в свой месяц — без кнопки, группа — «Подписки · N»', async () => {
        const subs = (id: string, extra: Partial<Obligation>): Obligation => ({ id, name: id, note: '', day: 3, category: 'd4', versions: [{ from: '2000-01', amount: 4_990 }], updatedAt: T0, ...extra })
        const store = await family('member', {
          obligations: [
            ...planFamilyDoc().obligations,
            subs('Подписки', { group: true, versions: [] }),
            subs('Netflix', { parentId: 'Подписки' }),
            subs('Яндекс', { parentId: 'Подписки', day: 7, versions: [{ from: '2000-01', amount: 2_990 }] }),
            subs('Страховка', { every: 'year', month: 3, day: 1, category: 'd1', versions: [{ from: '2000-01', amount: 60_000 }] }),
            subs('Коммуналка', { day: 8, category: 'd1', estimate: true, who: 'b', versions: [{ from: '2000-01', amount: 30_000 }] }),
          ],
        })
        store.markPaid('credit', 'loan', 'a', { period: '2026-09', accountId: 'card' })
        const dues = monthDues({ obligations: store.obligations, credits: store.credits, payments: store.payments }, '2026-09')
        // Аренда 220 000 + подписки 7 980 + коммуналка 30 000 + кредиты 58 000 + 25 000 + 20 000; годовая — не в сентябре.
        expect(duesTotal(dues)).toBe(360_980)
        const html = await renderScreen(Money, '/money')
        const list = payments(html)
        expect(list).toContain(`Платежи ${plain(360_980)} в месяц`)
        const order = ['Страховка', 'Аренда', 'Коммуналка', 'Кредит ', 'Кредитка', 'Рассрочка', 'Подписки 2']
        expect(order.map((n) => list.indexOf(n))).toEqual([...order.map((n) => list.indexOf(n))].sort((a, b) => a - b))
        expect(list).toContain(`Аренда 5-го ${money(220_000)} Оплатил`)
        expect(list).toContain(`Коммуналка 8-го · Аруна · ≈ оценка ${money(30_000)} Оплатил`)
        expect(list).toContain(`Страховка раз в год · в марте ${money(60_000)}`)
        expect(list).not.toMatch(/Страховка[^₸]*₸ Оплатил/)
        expect(list).toContain(`Кредит 15-го · оплачено ${money(58_000)}`)
        expect(list).not.toMatch(/Кредит 15-го · оплачено[^₸]*₸ Оплатил/)
        expect(html).toContain('aria-label="Оплачено — подробнее"')
        expect(list).toContain(`Подписки 2 ${money(7_980)}`)
        // Подписки группы — в её листе, не в списке; ставка и доли кредита — только в листе кредита.
        expect(list).not.toContain('Netflix')
        expect(list).not.toContain('ГЭСВ')
        expect(list).not.toContain('в долг')
        expect(list).toContain('Добавить')
        const group = text(await renderScreen(Money, '/money', undefined, [screenMixin({ selectedGroupId: 'Подписки' })]))
        expect(group).toContain(`Netflix 3-го ${money(4_990)} Оплатил`)
        expect(group).toContain(`Итого ${money(7_980)} в месяц`)
      })

      it('«Чистый капитал» карточкой, «На счетах», «Накоплено по мечтам», «Досрочками уже сэкономили» — не на экране (Р-33, Р-34)', async () => {
        await family()
        const html = text(await renderScreen(Money, '/money'))
        for (const gone of ['Чистый капитал', 'На счетах', 'Накоплено по мечтам', 'Досрочками', 'Где лежат деньги', 'Обязательства']) expect(html).not.toContain(gone)
      })

      it('viewer: ни «Оплатил», ни «Добавить», ни «Добавить счёт»; закладки ?add= и ?income=1 форм не открывают', async () => {
        await family('viewer')
        for (const path of ['/money', '/money?add=debt', '/money?add=payment', '/money?income=1']) {
          const html = await renderScreen(Money, path)
          expect(text(html)).toContain('Платежи')
          expect(html).not.toMatch(/<button[^>]*>\s*Оплатил/)
          expect(html).not.toMatch(/<button[^>]*>[^<]*(<svg[\s\S]*?<\/svg>)?\s*Добавить/)
          for (const t of ['Долг или рассрочка', 'Регулярный платёж', 'Внеплановый доход']) expect(html).not.toContain(t)
        }
      })

      it('адрес открывает лист: ?account= — счёт (вклад — с «Расчётом вклада»), ?credit=, ?obligation=; участнику ?add=debt — форма', async () => {
        await family('member', {
          accounts: [{ id: 'dep', name: 'Депозит Kaspi', note: '', amount: 1_000_000, amountSetAt: T0, kind: 'deposit', updatedAt: T0, deposit: { annualRate: 0.14, months: 12, monthlyTopUp: 0, capitalize: true } }],
        })
        const dep = dialog2(await renderScreen(Money, '/money?account=dep'))
        expect(dep).toContain('Депозит Kaspi')
        expect(dep).toContain('Расчёт вклада')
        expect(dep).toContain('Удалить вклад')
        expect(dialog2(await renderScreen(Money, '/money?credit=loan'))).toContain('Платежей осталось')
        expect(dialog2(await renderScreen(Money, '/money?obligation=rent'))).toContain('Аренда')
        expect(dialog2(await renderScreen(Money, '/money?add=debt'))).toContain('Долг или рассрочка')
      })
    })

    it('viewer: оклады и план «Трат» — текстом, без кнопок; в листе «До зарплаты» нет «Оплатил»', async () => {
      await family('viewer')
      const html = await renderScreen(Money, '/money')
      expect(text(html)).toContain(`план ${plain(150_000)}`)
      expect(html).not.toMatch(/<button[^>]*>\s*план/)
      expect(html).not.toMatch(/<button[^>]*>\s*<span[^>]*title="Ильяс"/)
      expect(html).toMatch(/<div[^>]*>\s*<span[^>]*title="Ильяс"/)
      const sheet = text(dialog(await renderScreen(Money, '/money', undefined, [screenMixin({ open: true })])))
      expect(sheet).toContain('Кредит')
      expect(sheet).not.toContain('Оплатил')
      expect(sheet).not.toContain('Пришла зарплата')
    })
  })

  describe('B2C-43: квадрат «План» — самая дорогая ставка и «Сначала долги» (перенос DebtPlan.test и «Что гасить первым»)', () => {
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ \t\r\n]+/g, ' ')
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

    it('«Самая дорогая ставка»: тег ставки, долг и остаток, проценты в месяц и переплата = debtAdvice; цифры и абзац — в свёрнутом «Подробнее»', async () => {
      const store = await plan({ plans: [] })
      const { worstDebt, worstHalfExtra, worstGain } = debtAdvice(store.credits)
      const html = await renderScreen(Money, '/money/plan')
      const card = text(html.slice(html.indexOf('Самая дорогая ставка'), html.indexOf('Подробнее')))
      expect(card).toContain('Самая дорогая ставка 40 %')
      expect(card).toContain(`Кредитка ${money(300_000)}`)
      expect(card).toContain(`процентов в месяц ${plain(10_000)} · переплата до конца ${plain(worstDebt!.cost.overpay)}`)
      const more = html.slice(html.indexOf('Подробнее'))
      expect(more).toMatch(/<details[^>]*>\s*<summary/)
      expect(html).not.toMatch(/<details[^>]* open/)
      const t = text(more)
      expect(t).toContain('Доля платежа в проценты 40%')
      expect(t).toContain(`Проценты банку по всем долгам ${money(budgetInterest(store.credits))} в месяц`)
      expect(t).toContain(`Половину переплаты снимает добавка ${money(worstHalfExtra!)} в месяц`)
      expect(t).toContain(`это минус ${worstGain!.monthsSaved} мес. и экономия ${money(worstGain!.saved)}`)
      expect(t).toContain('Посчитать на свою сумму')
    })

    it('без ставки — «уточните»; долгов нет — «Долгов нет» вместо обеих карточек', async () => {
      const store = await plan({ plans: [] })
      store.addCredit({ name: 'Оплата Kaspi Кредита', note: 'из выписки', principal: 1_200_000, annualRate: 0, rateUnknown: true, payment: 151_790, day: 24 })
      expect(text(await renderScreen(Money, '/money/plan'))).toContain('Ставку «Оплата Kaspi Кредита» уточните — тогда сравним.')
      await plan({ plans: [], credits: [] })
      const none = text(await renderScreen(Money, '/money/plan'))
      expect(none).toContain('Долгов нет')
      expect(none).not.toContain('Самая дорогая ставка')
      expect(none).not.toContain('Сначала долги')
    })

    it('без плана — переключатель выключен, «Копить или гасить?» свёрнуто с выбором плана внутри', async () => {
      await plan({ plans: [] })
      const html = await renderScreen(Money, '/money/plan')
      expect(html).toMatch(/role="switch" aria-checked="false"/)
      expect(html).not.toMatch(/role="switch"[^>]*\sdisabled(=""|\s|>)/)
      expect(text(html)).toContain('Копить или гасить?')
      expect(html).toMatch(/>\s*Выбрать этот план\s*</)
      expect(html).not.toMatch(stepButton)
    })

    it('план: переключатель включён, шаг месяца, прогноз одной строкой от planOutlook, «Уже сэкономили» = planFact, цели на паузе, подушка; «Шаг сделан» и «Изменить режим»', async () => {
      const store = await plan()
      const html = await renderScreen(Money, '/money/plan')
      const t = text(html)
      expect(html).toMatch(/role="switch" aria-checked="true"/)
      expect(t).toContain(`Шаг сентября ${money(100_000)} досрочно`)
      expect(t).toContain('в «Кредитка»')
      const o = planOutlook(store.activePlan!, store.planState(), '2026-09')
      expect(o.monthsSooner).toBeGreaterThan(0)
      expect(t).toContain(
        `Закроется в ${monthIn(o.debtFreeMonth!)}, на ${o.monthsSooner} мес. раньше. Переплата ${plain(o.overpayWithout!)} → ${money(o.overpayWith!)}.`,
      )
      // До первой досрочки — без «Уже сэкономили 0 ₸» (ревью frontend Б9, Н-9; правило 12).
      expect(t).not.toContain('Уже сэкономили')
      expect(t).toContain('Цели на паузе Отпуск, Машина · взнос идёт в долг')
      expect(t).toContain('Подушка плана Подушка')
      expect(html).toMatch(stepButton)
      expect(html).toMatch(/class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>\s*Шаг сделан/)
      expect(t).toContain('Изменить режим')
      // Шаг внесён — «внесено по плану», досрочка строкой, кнопок нет; «Уже сэкономили» — живой planFact.
      await plan({ payments: [prepay({})] })
      const st = useFinanceStore()
      const done = text(await renderScreen(Money, '/money/plan'))
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
      const t = text(await renderScreen(Money, '/money/plan'))
      expect(t).toContain(`${money(100_667)} досрочно`)
      expect(t).toContain(`в «Кредит»; уже внесено ${money(20_000)} — «Кредитка» закрыт`)
    })

    it('шаг — подушка: «сначала подушка: не хватает N» и «Пополнить подушку»; без взносов на паузе — шага нет', async () => {
      const goals = planFamilyDoc().goals.map((g) => (g.id === 'cushion' ? { ...g, have: 100_000, seed: 100_000 } : g))
      await plan({ goals })
      const html = await renderScreen(Money, '/money/plan')
      expect(text(html)).toContain(`сначала подушка: не хватает ${money(223_000)}`)
      expect(html).toMatch(/>\s*Пополнить подушку\s*</)
      expect(html).not.toMatch(stepButton)
      await plan({ plans: [planOf({ keptGoalIds: ['trip', 'car'] })] })
      const none = await renderScreen(Money, '/money/plan')
      expect(text(none)).not.toContain('Шаг сентября')
      expect(none).not.toMatch(stepButton)
    })

    it('пропущенный месяц — одна строка без упрёка; «Шаги по месяцам» — план и факт, пауза целей, ожидание при выборе, история планов', async () => {
      const store = await plan({}, 'member', '2026-10-15T07:00:00Z')
      const t = text(await renderScreen(Money, '/money/plan'))
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
      const h = text(await renderScreen(Money, '/money/plan'))
      expect(h).toContain('Долги с процентами закрыты — цели возобновились')
      expect(h).toContain(`Сентябрь 2026 — Октябрь 2026: сэкономили ${money(9_000)} процентов`)
      expect(h).toContain(`Август 2026: отменён, сэкономили ${money(0)}`)
      expect(h.indexOf('Сентябрь 2026 — Октябрь 2026')).toBeLessThan(h.indexOf('Август 2026: отменён'))
    })

    it('критик: план закрыл последний долг — «Долгов нет», но поздравление и прошлые планы на месте (как в прежнем экране плана)', async () => {
      const done = planOf({ status: 'done', endedAt: '2026-10-19T05:00:00.000Z', result: { savedInterest: 0 } })
      const closed = planFamilyDoc().credits.map((c) => ({ ...c, principal: 0 }))
      await plan({ plans: [done], credits: closed, payments: [prepay({})] }, 'member', '2026-10-20T07:00:00Z')
      const t = text(await renderScreen(Money, '/money/plan'))
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
      const t = text(await renderScreen(Money, '/money/plan'))
      expect(t).toContain('Прогноз: при текущем платеже долг не закрывается — экономию не считаем.')
      expect(t).not.toContain('Переплата')
    })

    it('viewer: переключатель неактивен, шаг и прогноз видны, ни «Шаг сделан», ни «Изменить режим», ни «Выбрать этот план»', async () => {
      await plan({}, 'viewer')
      const html = await renderScreen(Money, '/money/plan')
      expect(html).toMatch(/role="switch" aria-checked="true"[^>]*\sdisabled(=""|\s|>)/)
      expect(text(html)).toContain(`Шаг сентября ${money(100_000)} досрочно`)
      expect(html).not.toMatch(stepButton)
      expect(html).not.toContain('Изменить режим')
      expect(html).not.toMatch(/>\s*Выбрать этот план\s*</)
    })

    it('«Шаг сделан» одним нажатием: досрочка шага со счёта прошлой оплаты (PlanStepAction)', async () => {
      const store = await plan()
      store.markPaid('credit', 'cc', 'a', { accountId: 'card' })
      const card = store.accounts[0].amount
      await renderScreen(Money, '/money/plan', undefined, [screenMixin({}, (st) => (st.tap as () => void)())])
      expect(store.payments.filter((p) => p.kind === 'prepay')).toEqual([
        expect.objectContaining({ targetId: 'cc', amount: 100_000, planId: 'plan', accountId: 'card', mode: 'term' }),
      ])
      expect(store.accounts[0].amount).toBe(card - 100_000)
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

    it('пусто у участника — «Пока пусто» и тихая «Загрузить выписку»; подпись квадрата — число своих операций месяца', async () => {
      await history('member', '2026-11-25T07:00:00Z')
      const html = await renderScreen(Money, '/money/history')
      expect(text(html)).toContain('Пока пусто')
      expect(html).toMatch(/>\s*Загрузить выписку\s*</)
      await history()
      expect(text(squares(await renderScreen(Money, '/money/history')))).toContain('История 5 операций')
    })
  })

  it('критик возврата 2: «Пришла зарплата» в «Деньгах» — по тому же условию, что главный и «Неделя» (salaryAsk): в день зарплаты своя есть, чужая и отмеченная — нет', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T07:00:00Z')) // 25 сентября, Алматы
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [
        { id: 'a', name: 'Ильяс', salary: 700_000, payday: 25, updatedAt: '' },
        { id: 'b', name: 'Аруна', salary: 500_000, payday: 28, updatedAt: '' },
      ]
      expect(await renderScreen(Money, '/money')).toContain('Пришла зарплата')
      // Своя отмечена — ближайшая теперь чужая (28-го): кнопки нет.
      store.markSalary('a', { period: '2026-09', amount: 700_000, accountId: null })
      expect(await renderScreen(Money, '/money')).not.toContain('Пришла зарплата')
    } finally {
      vi.useRealTimers()
    }
  })

  it('критик возврата 3 (правило 12): «Освободится» и «Пришла зарплата» на одном экране — брендовая одна («Распределить»), без события — брендовая «Пришла зарплата»', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T07:00:00Z')) // 17 сентября, Алматы — день зарплаты
    try {
      useAuthStore().setAuthData({
        token: 't',
        user: { id: 'u-a', email: 'a@example.com', created_at: '' },
        household: { id: 'h-1', name: 'Family', created_by: 'u-a', created_at: '' },
        member: { household_id: 'h-1', user_id: 'u-a', slot: 'a', display_name: 'Ильяс', role: 'member', joined_at: '' },
      })
      const store = useFinanceStore()
      store.householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 17, updatedAt: '' }]
      const brand = (html: string) =>
        [...html.matchAll(/<button[^>]*class="[^"]*bg-brand text-brand-ink[^"]*"[^>]*>([\s\S]*?)<\/button>/g)].map((x) => x[1].replace(/<[^>]+>/g, '').trim())
      expect(brand(await renderScreen(Money, '/money'))).toEqual(['Пришла зарплата'])
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      const html = await renderScreen(Money, '/money')
      expect(html).toContain('Пришла зарплата')
      expect(brand(html)).toEqual(['Распределить'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('«Освободится»: сумма из freedChange (годовое — доля в месяц и разница за год), пояснение — одной строкой, без Callout о переезде; «До зарплаты» — без абзацев (критик Блока 3)', async () => {
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
      // Страховка раз в год 60 000, с октября — 48 000: в месяц освобождается 1 000, за год — 12 000 (а не 12 000 и 144 000).
      store.householdDoc.obligations = [
        {
          id: 'ins', name: 'Страховка', note: '', day: 5, month: 3, every: 'year', category: 'd1',
          versions: [{ from: '2026-01', amount: 60_000 }, { from: '2026-10', amount: 48_000 }], updatedAt: '',
        },
        { id: 'net', name: 'Интернет', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 10_000 }], updatedAt: '' },
      ]
      let html = await renderScreen(Money, '/money')
      expect(html).toContain('С октября')
      expect(html).toContain(`Освободится ${money(1_000)} в месяц`)
      expect(html).toContain(`Страховка: ${plain(60_000)} → ${plain(48_000)} ₸ · ${money(12_000)} за год`)
      expect(html).not.toContain(money(144_000))
      expect(html).not.toContain('Перед экономией')
      expect(html).not.toContain('переезд')
      // Счёта нет — одна строка вместо абзаца.
      expect(html).toContain('Добавьте счёт — покажем, хватит ли')
      expect(html).not.toContain('приложение не знает')

      // Ежемесячное 300 000 → 220 000: 80 000 в месяц, 960 000 за год. На карте меньше списаний — одна фраза.
      store.householdDoc.obligations = [
        { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2026-01', amount: 300_000 }, { from: '2026-10', amount: 220_000 }], updatedAt: '' },
      ]
      store.householdDoc.accounts = [{ id: 'card', name: 'Kaspi Gold', note: '', kind: 'card', amount: 100_000, updatedAt: '' }]
      html = await renderScreen(Money, '/money')
      expect(html).toContain(`Освободится ${money(80_000)} в месяц`)
      expect(html).toContain(`Аренда: ${plain(300_000)} → ${plain(220_000)} ₸ · ${money(960_000)} за год`)
      // Сводка «До зарплаты» (пивот 3): аренда 300 000 до 25-го, на счетах 100 000 — тег «не хватает».
      expect(html).toContain(`не хватает ${plain(200_000)} ₸`)
      expect(html).not.toContain('Перенесите платёж')
    } finally {
      vi.useRealTimers()
    }
  })
})
