import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { parseStatement } from '@/lib/statements/parsers'
import { renderScreen } from '@/test/screenState'
import type { StatementUploadResponse } from '@/types/api'
import kaspi01 from '@/lib/statements/fixtures/kaspi-01.rows.json'
import Statements from './Statements.vue'

const storage = new Map<string, string>()
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ')

function signIn(role: 'member' | 'viewer' = 'member') {
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [
    { id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' },
    { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: '' },
  ]
}

function uploadsClient(uploads: Partial<StatementUploadResponse>[]) {
  return { listStatementUploads: vi.fn(async () => ({ uploads })) } as unknown as ApiClient
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
  setActivePinia(createPinia())
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('views/Statements.vue', () => {
  it('пусто: кнопка загрузки и приглашение, без таблицы', async () => {
    signIn()
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).toContain('Загрузить выписку')
    expect(html).toContain('Файл остаётся на телефоне')
    expect(html).toContain('Загрузите выписку — здесь появятся траты')
    expect(html).not.toContain('Загрузки')
  })

  it('картина недели и месяца по разделам обоих, загрузки семьи и «без выписки <имя>»', async () => {
    signIn()
    const finance = useFinanceStore()
    const t = (by: 'a' | 'b', kind: 'week' | 'month', period: string, categoryId: string, amount: number) => ({
      id: `${by}:${kind}:${period}:${categoryId}`, by, kind, period, categoryId, amount, ops: 1, updatedAt: '',
    })
    finance.householdDoc.spendTotals = [
      t('a', 'week', '2026-W39', 'sc_food', 12_000), t('b', 'week', '2026-W39', 'sc_food', 8_000),
      t('a', 'month', '2026-09', 'sc_food', 50_000), t('b', 'month', '2026-09', 'sc_food', 30_000),
      t('a', 'month', '2026-09', '_unknown', 4_000),
    ]
    await useOperationsStore().loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'kaspi', period_from: '2026-08-26', period_to: '2026-09-26', ops_count: 120, created_at: '' },
    ]))
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).toContain('Продукты 20 000 ₸ 80 000 ₸')
    expect(html).toContain('Не разобрано — 4 000 ₸')
    expect(html).toContain('Всего 20 000 ₸ 84 000 ₸')
    expect(html).toContain('Алихан · Kaspi')
    expect(html).toContain('26.08–26.09 · 120')
    expect(html).toContain('За эту неделю без выписки Дана.')
  })

  it('предпросмотр: сводка, незнакомые с выбором раздела, подсказка о переводе партнёру', async () => {
    signIn()
    const parsed = parseStatement(kaspi01)
    useOperationsStore().setDraft([{ name: 'выписка.pdf', parsed }], [{ name: 'чек.pdf', message: 'Пока понимаю выписки Kaspi и Freedom' }])
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).toContain('Kaspi · 26.06–26.07 · 60 операций')
    expect(html).toContain('чек.pdf: Пока понимаю выписки Kaspi и Freedom')
    expect(html).toContain('Операций 60')
    expect(html).toContain('Незнакомое — куда отнести')
    expect(html).toContain('IP ASANOVA')
    expect(html).toContain('«Дана К.» — это Дана? Переводы между вами не считаются тратами.')
    expect(html).toContain('Отправить')
    expect(html).not.toContain('Загрузить выписку')
  })

  it('повтор того же файла — «все N уже были»', async () => {
    signIn()
    const store = useOperationsStore()
    const parsed = parseStatement(kaspi01)
    for (const op of parsed.operations) store.ops[op.id] = op
    store.setDraft([{ name: 'выписка.pdf', parsed }])
    expect(text(await renderScreen(Statements, '/statements'))).toContain('Все 60 уже были — ничего не удвоится')
  })

  it('viewer видит картину и загрузки, но не кнопку загрузки', async () => {
    signIn('viewer')
    await useOperationsStore().loadUploads(uploadsClient([
      { id: 'u1', slot: 'a', bank: 'freedom', period_from: '2026-09-01', period_to: '2026-09-26', ops_count: 40, created_at: '' },
    ]))
    const html = text(await renderScreen(Statements, '/statements'))
    expect(html).not.toContain('Загрузить выписку')
    expect(html).toContain('Алихан · Freedom')
  })

  it('демо: отправка без запросов, загрузка — локально', async () => {
    useAuthStore().setAuthData({
      token: DEMO_TOKEN, user: { id: 'demo', email: 'demo', created_at: '' },
      household: { id: 'demo-household-1', name: 'Демо', created_by: 'demo', created_at: '' },
      member: { household_id: 'demo-household-1', user_id: 'demo', slot: 'a', display_name: 'Я', role: 'member', joined_at: '' },
    })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const store = useOperationsStore()
    store.setDraft([{ name: 'выписка.pdf', parsed: parseStatement(kaspi01) }])
    await store.send()
    const html = text(await renderScreen(Statements, '/statements'))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(html).toContain('демо: только на этом телефоне')
    expect(html).toContain('26.06–26.07 · 60')
  })
})
