import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { applyRules } from '@/lib/statements/model'
import { detectIncome } from '@/lib/statements/firstRun'
import type { Operation } from '@/lib/statements/types'
import { OPERATIONS_STORAGE_KEYS, writeStorage } from '@/lib/storage'
import { paidFor } from '@/lib/finance'
import { plain } from '@/lib/money'
import { T0, authAs } from '@/test/planFamily'
import type { SyncDoc } from '@/types/finance'
import { useIncomeAnswer } from './useIncomeAnswer'

/**
 * «Да, это зарплата» (Блок 5 «Фидбек», Р-35, FB-21) — то же, что делал первый запуск (`Start.answerIncome`, тесты
 * перенесены сюда): оклад и день участнику, правило зарплаты, отметки месяцев приходом в допуске оклада (возврат приёмки
 * п. 7), недельный ритм (PN-24), перевод другого отправителя перед зарплатой (ML-06, хвост 959).
 */
const storage = new Map<string, string>()
const op = (id: string, date: string, amount: number, merchant: string, kind: Operation['kind'] = 'purchase'): Operation => ({
  id, bank: 'kaspi', date, amount, kind, merchant, categoryId: null, internal: false,
})
const parsed = (list: Operation[]) => applyRules(list, [])

function family(doc: SyncDoc = defaultSyncDoc(), slot: 'a' | 'b' = 'a') {
  useAuthStore().setAuthData(authAs('member', slot))
  const store = useFinanceStore()
  store.claimFor('h-family')
  store.setHouseholdDoc(doc, 1)
  return store
}
function seedOps(ops: Operation[], user = 'u-a') {
  writeStorage(OPERATIONS_STORAGE_KEYS.ops, { owner: `h-family:${user}`, ops: Object.fromEntries(ops.map((o) => [o.id, o])) })
}
/** Кандидат дохода из своих операций и ответ «Да» с полями от кандидата (сумму можно поправить). */
function yes(salary?: string) {
  const ops = useOperationsStore()
  const c = detectIncome(ops.all)[0]
  expect(c, 'кандидат дохода').toBeTruthy()
  const a = useIncomeAnswer()
  a.setCandidate(c)
  if (salary) a.salary.value = salary
  return { ok: a.answer(c), c, a }
}

describe('useIncomeAnswer — «Да, это зарплата»', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 0, json: async () => ({}), text: async () => '' })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('поля — от кандидата; «Да» с правкой суммы пишет оклад и день участнику с именем регистрации; безымянный отправитель без регулярности — правила нет; пустая сумма — false', () => {
    const store = family()
    seedOps(parsed([op('s9', '2026-09-24', 120_000, 'С карты другого банка', 'transfer-in')]))
    const { a, c } = yes()
    expect(a.salary.value).toBe(plain(120_000))
    expect(a.payday.value).toBe('24')
    a.salary.value = '125 000'
    expect(a.answer(c)).toBe(true)
    expect(store.people).toEqual([expect.objectContaining({ id: 'a', name: 'a', salary: 125_000, payday: 24 })])
    expect(store.people[0].payRhythm).toBeUndefined()
    expect(store.merchantRules).toEqual([])
    a.salary.value = ''
    expect(a.answer(c)).toBe(false)
  })

  it('отметки месяца — суммой, id и днём операции: премия в допуске оклада (±10 %) — запись суммой прихода; правило зарплаты', () => {
    const store = family()
    seedOps(parsed([op('s8', '2026-08-10', 450_000, 'Зарплата ТОО Ромашка', 'income'), op('s9', '2026-09-10', 490_000, 'Зарплата ТОО Ромашка', 'income')]))
    yes('450 000')
    expect(store.people[0]).toMatchObject({ salary: 450_000, payday: 10 })
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')).toMatchObject({ amount: 490_000, opId: 's9', source: 'statement', at: '2026-09-10T07:00:00.000Z' })
    expect(paidFor(store.payments, 'salary', 'a', '2026-08')).toMatchObject({ amount: 450_000, opId: 's8' })
    expect(store.merchantRules.map((r) => r.to)).toEqual([{ payment: { kind: 'salary', targetId: 'a' } }])
  })

  it('PN-24: доход каждую пятницу — ритм недели и отметка каждой пятницы своим днём', () => {
    const store = family()
    seedOps(
      parsed([
        op('w1', '2026-08-28', 150_000, 'ТОО Смена', 'income'),
        op('w2', '2026-09-04', 150_000, 'ТОО Смена', 'income'),
        op('w3', '2026-09-11', 152_000, 'ТОО Смена', 'income'),
        op('w4', '2026-09-18', 150_000, 'ТОО Смена', 'income'),
      ]),
    )
    const { c } = yes()
    expect(c.rhythm).toBe('week')
    expect(store.people[0]).toMatchObject({ salary: 150_000, payRhythm: 'week', weekday: 5 })
    expect(store.payments.filter((p) => p.kind === 'salary').map((p) => [p.period, p.amount, p.opId])).toEqual([
      ['2026-08-28', 150_000, 'w1'],
      ['2026-09-04', 150_000, 'w2'],
      ['2026-09-11', 152_000, 'w3'],
      ['2026-09-18', 150_000, 'w4'],
    ])
  })

  it('ML-06 (хвост 959): перевод другого отправителя перед зарплатой — «Да» отмечает август и сентябрь строками правила; вопроса «Это зарплата?» и второго правила нет', () => {
    const store = family()
    seedOps(
      parsed([
        op('d8', '2026-08-09', 590_000, 'Перевод от Дана К.', 'transfer-in'),
        op('s8', '2026-08-10', 600_000, 'Зарплата ТОО Ромашка', 'income'),
        op('s9', '2026-09-10', 600_000, 'Зарплата ТОО Ромашка', 'income'),
      ]),
    )
    yes('600 000')
    expect(paidFor(store.payments, 'salary', 'a', '2026-08')).toMatchObject({ amount: 600_000, opId: 's8', source: 'statement' })
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')).toMatchObject({ opId: 's9' })
    expect(useOperationsStore().pendingMatches.filter((x) => x.kind === 'salary')).toEqual([])
    expect(store.merchantRules.filter((r) => 'payment' in r.to && r.to.payment.kind === 'salary')).toHaveLength(1)
  })

  it('возврат приёмки п. 7: зарплату месяца отмечает только приход в допуске оклада — мелкий перевод того же отправителя месяц не отмечает', () => {
    const store = family()
    seedOps(parsed([op('j', '2026-07-12', 30_000, 'Зарплата ТОО Ромашка', 'income'), op('a', '2026-08-12', 30_000, 'Зарплата ТОО Ромашка', 'income'), op('s', '2026-09-03', 4_700, 'Зарплата ТОО Ромашка', 'income')]))
    yes('30 000')
    expect(store.people[0]).toMatchObject({ salary: 30_000, payday: 12 })
    expect(store.merchantRules.map((r) => r.to)).toEqual([{ payment: { kind: 'salary', targetId: 'a' } }])
    expect(paidFor(store.payments, 'salary', 'a', '2026-09')).toBeNull()
  })

  it('партнёр по коду: оклад — себе (people[b]), семья и первый участник не трогаются', () => {
    const store = family({ ...defaultSyncDoc(), people: [{ id: 'a', name: 'Ильяс', salary: 600_000, payday: 10, updatedAt: T0 }], setupDoneAt: T0 }, 'b')
    seedOps(parsed([op('s8', '2026-08-12', 160_000, 'ТОО Лютик', 'income'), op('s9', '2026-09-12', 160_000, 'ТОО Лютик', 'income')]), 'u-b')
    yes()
    expect(store.people.find((p) => p.id === 'b')).toMatchObject({ name: 'b', salary: 160_000, payday: 12 })
    expect(store.people.find((p) => p.id === 'a')).toMatchObject({ salary: 600_000, payday: 10 })
  })
})
