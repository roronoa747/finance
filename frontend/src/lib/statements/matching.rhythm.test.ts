import { describe, expect, it } from 'vitest'
import { matchCandidates, nearestEvent, nearestPeriod, ruleHit } from './matching'
import { assignIds } from './model'
import type { Operation } from './types'
import type { Payment, Person } from '@/types/finance'

/**
 * PN-24 (понятность Б7, Р-5, Р-6): поиск прихода в выписке по ритму. Октябрь 2026 — пятницы 2, 9, 16, 23, 30.
 * Кандидат зарплаты — ближайший приход (`nearestEvent`, окно 7 дней), `period` — его ключ (ISO-день у аванса и недели);
 * сумма — ±10 % прихода, плавающая — ±30 % среднего трёх последних.
 */
const T = '2026-09-01T00:00:00.000Z'
const weekly: Person = { id: 'a', name: 'Ильяс', salary: 150_000, payday: 10, payRhythm: 'week', weekday: 5, updatedAt: T }
const advance: Person = { id: 'b', name: 'Аруна', salary: 500_000, payday: 30, payRhythm: 'advance', payday2: 15, salary2: 200_000, updatedAt: T }
const op = (date: string, amount: number, merchant = 'ТОО Работа'): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'transfer-in', merchant, categoryId: null, internal: false,
})
const paid = (targetId: 'a' | 'b', period: string, amount: number): Payment => ({
  id: `s-${period}`, kind: 'salary', targetId, period, amount, accountId: null, by: targetId, at: `${period.length > 7 ? period : `${period}-25`}T05:00:00.000Z`, updatedAt: T,
})

describe('PN-24: nearestEvent', () => {
  it('неделя — ближайшая пятница (суббота 3-го → 2-е, gap 1); месяц — как nearestPeriod', () => {
    expect(nearestEvent('2026-10-03', weekly)).toMatchObject({ event: { period: '2026-10-02' }, gap: 1 })
    expect(nearestEvent('2026-10-31', weekly)).toMatchObject({ event: { period: '2026-10-30' }, gap: 1 })
    const month: Person = { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T }
    for (const d of ['2026-10-01', '2026-10-25', '2026-10-28', '2026-11-03']) {
      const n = nearestEvent(d, month)!
      expect({ period: n.event.period, gap: n.gap }).toEqual(nearestPeriod(d, 10))
    }
  })
})

describe('PN-24: кандидаты зарплаты по ритму', () => {
  it('неделя: четыре пятничных прихода — четыре вопроса «за неделю», у каждого своя пятница; не схлопываются', () => {
    const list = assignIds([op('2026-10-02', 150_000), op('2026-10-09', 152_000), op('2026-10-17', 149_000), op('2026-10-23', 150_000)])
    const out = matchCandidates(list, { people: [weekly], payments: [] }, [], 'a')
    expect(out.map((c) => [c.period, c.amount])).toEqual([
      ['2026-10-02', 150_000],
      ['2026-10-09', 152_000],
      ['2026-10-16', 149_000],
      ['2026-10-23', 150_000],
    ])
    expect(out.every((c) => c.kind === 'salary' && c.question === 'Это зарплата Ильяс за неделю?')).toBe(true)
  })

  it('уже отмеченная пятница — пропуск; две строки к одной пятнице — одна, ближе к сумме', () => {
    const list = assignIds([op('2026-10-02', 150_000), op('2026-10-09', 150_000), op('2026-10-10', 151_000)])
    const out = matchCandidates(list, { people: [weekly], payments: [paid('a', '2026-10-02', 150_000)] }, [], 'a')
    expect(out.map((c) => [c.period, c.opId === list[1].id])).toEqual([['2026-10-09', true]])
  })

  it('аванс 15-го — «Это аванс», сумма аванса; остаток 30-го — «Это зарплата»; сумма остатка у аванса — не аванс', () => {
    const list = assignIds([op('2026-10-15', 205_000), op('2026-10-30', 300_000), op('2026-11-14', 300_000)])
    const out = matchCandidates(list, { people: [advance], payments: [] }, [], 'b')
    expect(out.map((c) => [c.period, c.question])).toEqual([
      ['2026-10-15', 'Это аванс Аруна?'],
      ['2026-10-30', 'Это зарплата Аруна?'],
    ])
  })

  it('плавающая: ±30 % от среднего трёх последних (320 000): 400 000 — да, 450 000 — нет', () => {
    const floating: Person = { id: 'a', name: 'Ильяс', salary: 900_000, payday: 25, floating: true, updatedAt: T }
    const payments = [paid('a', '2026-07', 300_000), paid('a', '2026-08', 320_000), paid('a', '2026-09', 340_000)]
    expect(matchCandidates(assignIds([op('2026-10-25', 400_000)]), { people: [floating], payments }, [], 'a').map((c) => c.period)).toEqual(['2026-10'])
    expect(matchCandidates(assignIds([op('2026-10-25', 450_000)]), { people: [floating], payments }, [], 'a')).toEqual([])
  })

  it('правило семьи — ближайший приход без окна: понедельник 12-го → пятница 9-го; сумма вне допуска — нет', () => {
    const targets = { obligations: [], credits: [], people: [weekly] }
    const [row] = assignIds([op('2026-10-12', 150_000)])
    expect(ruleHit(row, { kind: 'salary', targetId: 'a' }, targets)).toMatchObject({ period: '2026-10-09' })
    const [small] = assignIds([op('2026-10-12', 50_000)])
    expect(ruleHit(small, { kind: 'salary', targetId: 'a' }, targets)).toBeNull()
  })
})
