import { describe, expect, it } from 'vitest'
import {
  expectedSalaryTenge,
  monthPlan,
  monthPlanPast,
  monthSalaries,
  monthSummary,
  payEvents,
  payRhythmOf,
  planSave,
  salaryAsk,
  salaryAt,
  salaryMarkPeriod,
  salaryMonthly,
  salaryOpen,
  salaryTenge,
  untilPayday,
  type MonthPlanCtx,
} from './finance'
import type { Payment, Person } from '@/types/finance'
import { planFamilyDoc } from '@/test/planFamily'

/**
 * Ритм зарплаты (понятность Б7, PN-22; Р-5, Р-6). Числа — руками в комментариях (правило 6).
 * Календарь: 2026-10 — пятницы 2, 9, 16, 23, 30 (пять); 2026-11 — 6, 13, 20, 27 (четыре).
 */
const T0 = '2026-09-01T00:00:00.000Z'
const week: Person = { id: 'a', name: 'Ильяс', salary: 150_000, payday: 10, payRhythm: 'week', weekday: 5, updatedAt: T0 }
const advance: Person = { id: 'b', name: 'Аруна', salary: 500_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 200_000, updatedAt: T0 }
const month: Person = { id: 'b', name: 'Аруна', salary: 450_000, payday: 25, updatedAt: T0 }

const paid = (targetId: 'a' | 'b', period: string, amount: number, at = `${period.length > 7 ? period : `${period}-10`}T05:00:00.000Z`): Payment => ({
  id: `s-${targetId}-${period}`, kind: 'salary', targetId, period, amount, accountId: null, by: targetId, at, updatedAt: at,
})
const ctxOf = (key: string): MonthPlanCtx => ({ key, totals: [], spendCategories: [], uploads: [] })

describe('payEvents — приходы месяца по ритму', () => {
  it('месяц — один приход, period = месяц (старые отметки действуют); 31-е в сентябре — 30-е', () => {
    expect(payEvents(month, '2026-10')).toEqual([{ period: '2026-10', day: '2026-10-25', amount: 450_000, currency: 'KZT', kind: 'salary' }])
    expect(payEvents({ ...month, payday: 31 }, '2026-09')).toEqual([{ period: '2026-09', day: '2026-09-30', amount: 450_000, currency: 'KZT', kind: 'salary' }])
  })

  it('аванс — два прихода по дням: аванс 15-го 200 000, остаток 30-го 300 000; в феврале 30-е — 28-е', () => {
    expect(payEvents(advance, '2026-10')).toEqual([
      { period: '2026-10-15', day: '2026-10-15', amount: 200_000, currency: 'KZT', kind: 'advance' },
      { period: '2026-10-30', day: '2026-10-30', amount: 300_000, currency: 'KZT', kind: 'salary' },
    ])
    expect(payEvents(advance, '2027-02').map((e) => e.day)).toEqual(['2027-02-15', '2027-02-28'])
    // Аванс 28-го и зарплата 31-го в феврале совпали — один приход всей суммой (иначе две отметки на один ключ).
    expect(payEvents({ ...advance, payday: 31, payday2: 28 }, '2027-02')).toEqual([
      { period: '2027-02-28', day: '2027-02-28', amount: 500_000, currency: 'KZT', kind: 'salary' },
    ])
    // Аванс больше оклада — не больше оклада; остаток 0 — не приход (критик Б7): один аванс всей суммой.
    expect(payEvents({ ...advance, salary2: 900_000 }, '2026-10')).toEqual([
      { period: '2026-10-15', day: '2026-10-15', amount: 500_000, currency: 'KZT', kind: 'advance' },
    ])
    // Аванс не вписан (0 или нет поля) — один приход зарплаты 30-го всей суммой.
    for (const salary2 of [0, undefined]) {
      expect(payEvents({ ...advance, salary2 }, '2026-10')).toEqual([
        { period: '2026-10-30', day: '2026-10-30', amount: 500_000, currency: 'KZT', kind: 'salary' },
      ])
    }
  })

  it('критик Б7: аванс 0 — пришла зарплата, значит пришёл месяц: «✓», «Отложить по плану» есть', () => {
    // «Дважды» выбрали в первом запуске до оклада — `rhythmDefaults` дал salary2 0; раньше пустой аванс 15-го
    // нельзя было отметить, месяц навсегда «1 из 2», плана после зарплаты не было.
    // Семья плана: очередь целей платит Ильяс (оклад 700 000, 10-го) — у него аванс 25-го без суммы.
    const doc = planFamilyDoc({ payments: [paid('a', '2026-10-10', 700_000)] })
    doc.people[0] = { ...doc.people[0], payRhythm: 'advance', payday2: 25, salary2: 0 }
    const plan = monthPlan(doc, ctxOf('2026-10'))
    expect(plan.income.byPerson[0]).toMatchObject({ person: 'a', amount: 700_000, came: true, cameCount: 1, eventCount: 1 })
    expect(planSave(plan, 'a')).toMatchObject({ put: 130_000 })
  })

  it('неделя — каждая пятница: октябрь 5, ноябрь 4; оклад за неделю', () => {
    expect(payEvents(week, '2026-10').map((e) => e.period)).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'])
    expect(payEvents(week, '2026-11').map((e) => e.period)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'])
    expect(payEvents(week, '2026-10').every((e) => e.amount === 150_000 && e.kind === 'week')).toBe(true)
    // Понедельник (1) октября 2026: 5, 12, 19, 26.
    expect(payEvents({ ...week, weekday: 1 }, '2026-10').map((e) => e.day)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'])
  })

  it('неполный ритм — месячный: аванс без дня или в день зарплаты, неделя без дня недели', () => {
    expect(payRhythmOf({ payday: 10 })).toBe('month')
    expect(payRhythmOf({ payday: 10, payRhythm: 'advance' })).toBe('month')
    expect(payRhythmOf({ payday: 10, payRhythm: 'advance', payday2: 10 })).toBe('month')
    expect(payRhythmOf({ payday: 10, payRhythm: 'week' })).toBe('month')
    expect(payRhythmOf({ payday: 10, payRhythm: 'week', weekday: 5 })).toBe('week')
  })

  it('salaryMonthly и salaryAt: неделя — n × оклад (750 000 / 600 000), аванс — оклад', () => {
    expect(salaryMonthly(week, '2026-10')).toBe(750_000)
    expect(salaryMonthly(week, '2026-11')).toBe(600_000)
    expect(salaryAt(week, '2026-10')).toBe(750_000)
    expect(salaryMonthly(advance, '2026-10')).toBe(500_000)
    expect(salaryTenge(week, '2026-11').tenge).toBe(600_000)
  })

  it('salaryTenge валютной недели — каждый приход по курсу своего дня: 300 € × (510 + 520 + 530 × 3) = 786 000', () => {
    const eur: Person = { ...week, salaryVersions: [{ from: '2026-01', amount: 300, currency: 'EUR', rate: 500 }] }
    // Курс 23-го и 30-го — последний в книге не позже дня (16-е, 530).
    const book = { EUR: { '2026-10-02': 510, '2026-10-09': 520, '2026-10-16': 530 } }
    const t = salaryTenge(eur, '2026-10', { book })
    expect(t).toMatchObject({ tenge: 786_000, currency: 'EUR', left: 1_500, rate: 510, rateDay: '2026-10-02' })
    expect(salaryAt(eur, '2026-10', book)).toBe(786_000)
    // Пришедшая в тенге неделя (выписка тенгового счёта) — суммой отметки: 155 000 + 300 × (520 + 530 × 3) = 788 000.
    const t2 = salaryTenge(eur, '2026-10', { book, payments: [paid('a', '2026-10-02', 155_000)] })
    expect(t2.tenge).toBe(788_000)
  })
})

describe('monthPlan и строки зарплат по ритму', () => {
  it('ноябрь, две недели из четырёх пришли: доход = 150 000 + 170 000 факт + 150 000 × 2 ожидание = 620 000', () => {
    const payments = [paid('a', '2026-11-06', 150_000), paid('a', '2026-11-13', 170_000)]
    const inc = monthPlan({ people: [week], payments }, ctxOf('2026-11')).income
    expect(inc.total).toBe(620_000)
    expect(inc.byPerson[0]).toMatchObject({ amount: 620_000, came: false, cameCount: 2, eventCount: 4 })
    expect(inc.byPerson[0].events.map((e) => [e.period, e.amount, e.came])).toEqual([
      ['2026-11-06', 150_000, true],
      ['2026-11-13', 170_000, true],
      ['2026-11-20', 150_000, false],
      ['2026-11-27', 150_000, false],
    ])
    // came — только когда пришли все.
    const all = [...payments, paid('a', '2026-11-20', 150_000), paid('a', '2026-11-27', 150_000)]
    expect(monthPlan({ people: [week], payments: all }, ctxOf('2026-11')).income.byPerson[0]).toMatchObject({ amount: 620_000, came: true, cameCount: 4 })
  })

  it('отметка с месячным period у недельного участника не считается приходом недели', () => {
    const inc = monthPlan({ people: [week], payments: [paid('a', '2026-11', 999_000)] }, ctxOf('2026-11')).income
    expect(inc.byPerson[0]).toMatchObject({ amount: 600_000, cameCount: 0 })
  })

  it('SalaryLine: open — у открытого прихода, payday — ближайший непришедший, openPeriod — первый открытый', () => {
    const payments = [paid('a', '2026-11-06', 150_000)]
    const plan = monthPlan({ people: [week], payments }, ctxOf('2026-11'))
    // 10 ноября: до 13-го три дня — окно «Пришла» (SALARY_EARLY_DAYS 3).
    const [line] = monthSalaries(plan, { people: [week], payments }, { key: '2026-11', day: 10 })
    expect(line).toMatchObject({ open: true, openPeriod: '2026-11-13', payday: 13, rhythm: 'week', cameCount: 1, eventCount: 4 })
    expect(line.events.map((e) => e.open)).toEqual([false, true, false, false])
    // 9 ноября: до 13-го четыре дня — ещё рано.
    const [early] = monthSalaries(plan, { people: [week], payments }, { key: '2026-11', day: 9 })
    expect(early).toMatchObject({ open: false, openPeriod: null, payday: 13 })
  })

  it('прошлый месяц и итог месяца — приходы недели складываются, одна строка на участника', () => {
    const payments = [paid('a', '2026-10-02', 150_000), paid('a', '2026-10-09', 160_000), paid('b', '2026-10', 450_000)]
    const past = monthPlanPast({ people: [week, month], payments }, '2026-10')
    expect(past.cameBy).toEqual([{ person: 'a', amount: 310_000 }, { person: 'b', amount: 450_000 }])
    expect(past.came).toBe(760_000)
    expect(monthSummary({ people: [week, month], payments }, '2026-10').income).toBe(760_000)
  })
})

describe('«до зарплаты», «Пришла?» по событиям', () => {
  it('неделя: 3 октября ближайшая — пятница 9-го (6 дней); 9-е пришла — 16-е (13 дней)', () => {
    expect(untilPayday({ people: [week] }, { key: '2026-10', day: 3 })).toMatchObject({ key: '2026-10', period: '2026-10-09', day: 9, inDays: 6, income: 150_000, kind: 'week' })
    const payments = [paid('a', '2026-10-09', 150_000)]
    expect(untilPayday({ people: [week], payments }, { key: '2026-10', day: 3 })).toMatchObject({ period: '2026-10-16', inDays: 13 })
  })

  it('аванс: до 15-го ждём аванс 200 000; после 15-го — остаток 300 000 30-го', () => {
    expect(untilPayday({ people: [advance] }, { key: '2026-10', day: 10 })).toMatchObject({ period: '2026-10-15', inDays: 5, income: 200_000, kind: 'advance' })
    expect(untilPayday({ people: [advance] }, { key: '2026-10', day: 16 })).toMatchObject({ period: '2026-10-30', inDays: 14, income: 300_000, kind: 'salary' })
    // 30 октября всё пришло — следующий аванс 15 ноября (16 дней).
    const payments = [paid('b', '2026-10-15', 200_000), paid('b', '2026-10-30', 300_000)]
    expect(untilPayday({ people: [advance], payments }, { key: '2026-10', day: 30 })).toMatchObject({ key: '2026-11', period: '2026-11-15', inDays: 16 })
  })

  it('salaryOpen по событию: окно 3 дня до дня прихода, прошедший в этом месяце ждёт, месяц у недели — не приход', () => {
    const now = { key: '2026-10', day: 7 }
    expect(salaryOpen(week, [], '2026-10-09', now)).toBe(true)
    expect(salaryOpen(week, [], '2026-10-16', now)).toBe(false)
    expect(salaryOpen(week, [], '2026-10-02', now)).toBe(true)
    expect(salaryOpen(week, [paid('a', '2026-10-02', 150_000)], '2026-10-02', now)).toBe(false)
    expect(salaryOpen(week, [], '2026-10', now)).toBe(false)
    // Следующий месяц — только в окне: 31 октября до 2 ноября (понедельник) два дня.
    expect(salaryOpen({ ...week, weekday: 1 }, [], '2026-11-02', { key: '2026-10', day: 31 })).toBe(true)
    expect(salaryOpen({ ...week, weekday: 1 }, [], '2026-11-09', { key: '2026-10', day: 31 })).toBe(false)
  })

  it('salaryAsk — по ближайшему приходу своего участника', () => {
    expect(salaryAsk({ people: [week] }, 'a', { key: '2026-10', day: 7 })).toMatchObject({ period: '2026-10-09' })
    expect(salaryAsk({ people: [week] }, 'a', { key: '2026-10', day: 3 })).toBeNull()
  })

  it('salaryMarkPeriod: месяц экрана у недели — первый открытый приход; ISO-день и месячный ритм — как есть', () => {
    const now = { key: '2026-10', day: 10 }
    expect(salaryMarkPeriod(week, [], '2026-10', now)).toBe('2026-10-02')
    expect(salaryMarkPeriod(week, [paid('a', '2026-10-02', 150_000)], '2026-10', now)).toBe('2026-10-09')
    expect(salaryMarkPeriod(week, [], '2026-10-16', now)).toBe('2026-10-16')
    expect(salaryMarkPeriod(month, [], '2026-10', now)).toBe('2026-10')
  })
})

describe('плавающая сумма (Р-6) — среднее трёх последних приходов', () => {
  const floating: Person = { ...month, floating: true, salary: 400_000 }
  const history = [
    paid('b', '2026-06', 999_999),
    paid('b', '2026-07', 300_000),
    paid('b', '2026-08', 320_000),
    paid('b', '2026-09', 340_000),
  ]

  it('три — (300 000 + 320 000 + 340 000) / 3 = 320 000; две — 330 000; ни одной — оклад 400 000', () => {
    expect(expectedSalaryTenge(floating, '2026-10', { payments: history })).toBe(320_000)
    expect(expectedSalaryTenge(floating, '2026-10', { payments: history.slice(2) })).toBe(330_000)
    expect(expectedSalaryTenge(floating, '2026-10', { payments: [] })).toBe(400_000)
    // Без «сумма меняется» — оклад.
    expect(expectedSalaryTenge(month, '2026-10', { payments: history })).toBe(450_000)
  })

  it('доход плана и «до зарплаты» — среднее; пришедшая — факт', () => {
    expect(monthPlan({ people: [floating], payments: history }, ctxOf('2026-10')).income.total).toBe(320_000)
    expect(untilPayday({ people: [floating], payments: history }, { key: '2026-10', day: 20 })).toMatchObject({ income: 320_000 })
    const came = [...history, paid('b', '2026-10', 355_000)]
    expect(monthPlan({ people: [floating], payments: came }, ctxOf('2026-10')).income.total).toBe(355_000)
  })

  it('неделя — среднее недель, не месячных отметок; пятница 9-го ждёт (150 + 170 + 160) / 3 = 160 000', () => {
    const w: Person = { ...week, floating: true }
    const payments = [paid('a', '2026-09', 900_000), paid('a', '2026-09-25', 150_000), paid('a', '2026-10-02', 170_000), paid('a', '2026-09-18', 160_000)]
    const plan = monthPlan({ people: [w], payments }, ctxOf('2026-10'))
    // 170 000 факт 2-го + 4 × 160 000 ожидания = 810 000.
    expect(plan.income.total).toBe(810_000)
  })
})
