import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { apiClient, type ApiClient } from '../src/api/client'
import { DEMO_TOKEN, useAuthStore } from '../src/stores/auth'
import { useApplePayStore } from '../src/stores/applepay'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Payment } from '../src/types/finance'
import type { WalletStatus } from '../src/types/api'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, screen, serverPush, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 2 «Пуши банков» бэклога «Apple Pay» (написан 2026-10-16, взят в набор приёмкой 2026-10-18 — мутанты
 * `useSalaryTap` красные): сценарии, которых не было в `ap-block2-push`, —
 * «Пришла» по пушу настоящей кнопкой строки «Месяца» (`useSalaryTap.tap`, не `acceptMatch` напрямую): приход ложится
 * на счёт прошлой зарплаты с операцией пуша, остаток счёта растёт, точка и вопрос «Недели» уходят, партнёр после синка
 * видит отметку без точки; первая зарплата — лист отметки с суммой прихода, отметка на выбранный счёт; viewer и демо —
 * ни точки, ни запросов статуса Apple Pay (viewer — и без «Пришла»). Четверг 15 октября 2026, зарплата Ильяса — 10-го.
 * Суммы и имена — синтетические.
 */
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1'
const STATUS: WalletStatus = {
  connected: true, phones: 1,
  shortcut_url: 'https://www.icloud.com/shortcuts/stub-ios27', shortcut_url_legacy: 'https://www.icloud.com/shortcuts/stub-legacy',
  push_shortcut_url: 'https://www.icloud.com/shortcuts/stub-push',
}
const SEPT_SALARY: Payment = {
  id: 'sal-a-2026-09', kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, accountId: 'card', by: 'a',
  at: '2026-09-10T05:00:00.000Z', updatedAt: '2026-09-10T05:00:00.000Z', source: 'manual',
}
const SALARY_PUSH = { id: 'f000000000000001', date: '2026-10-14', amount: 690_000, merchant: 'Зарплата', kind: 'income', bank: 'freedom' }

type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore>; wallet: ReturnType<typeof vi.fn> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', o: { role?: 'member' | 'viewer'; demo?: boolean } = {}): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const role = o.role ?? 'member'
  const user = role === 'viewer' ? 'u-v' : `u-${slot}`
  useAuthStore().setAuthData({
    token: o.demo ? DEMO_TOKEN : `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot: role === 'viewer' ? 'c' : slot, display_name: slot, role, joined_at: '' },
  })
  const wallet = vi.fn(async () => ({ ...STATUS }))
  const client = {
    ...backend(server), ...statementsFor(st, user, slot),
    walletStatus: wallet,
    fxRates: vi.fn(async (code: string) => ({ code, rates: {}, partial: false })),
  } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  useApplePayStore().userAgent = IPHONE
  await useApplePayStore().load(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store, wallet }
}

const on = (p: Phone) => (setActivePinia(p.pinia), p)
async function pull(p: Phone) {
  on(p)
  await useOperationsStore().pull(p.client)
  await p.store.syncHousehold(p.client)
}
/** «Пришла» в строке зарплаты Ильяса на «Месяце» — первая строка с `tap` (`useSalaryTap`). */
const tap = () => [screenMixin({}, (s) => (s.tap as () => void)())]
/** Лист отметки (`MarkSheet`, режим «отметить»): сумму не трогаем — что подставлено, то и отмечается; счёт — карта. */
const confirmMark = (seen: { amount?: unknown }) =>
  screenMixin({}, (s) => {
    void (s.salary && s.mode === 'mark' ? s.confirmMark : s.notThisSheet)
    seen.amount = s.amountText
    s.chosen = 'card'
    ;(s.confirmMark as () => void)()
  })
const salaryOct = (p: Phone) => p.store.payments.filter((x) => !x.deletedAt && x.kind === 'salary' && x.targetId === 'a' && x.period === '2026-10')
const card = (p: Phone) => p.store.accounts.find((a) => a.id === 'card')!.amount

describe('e2e / приёмка Apple Pay Блок 2 — «Пришла» по пушу кнопкой, первая зарплата, viewer и демо', () => {
  const storage = new Map<string, string>()
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-15T07:00:00Z')
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('«Пришла» кнопкой строки: приход на счёт сентябрьской зарплаты с операцией пуша; точка и вопрос «Недели» ушли; Аруна видит отметку без точки', async () => {
    server = fakeServer(planFamilyDoc({ payments: [SEPT_SALARY] }))
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')
    expect(serverPush(st, 'u-a', SALARY_PUSH)).toBe('saved')
    await pull(A)
    on(A)
    const ops = useOperationsStore()
    expect(ops.salaryArrival('a', '2026-10')?.op.id).toBe(SALARY_PUSH.id)
    expect(ops.pendingMatches.some((c) => c.opId === SALARY_PUSH.id && c.kind === 'salary')).toBe(true)
    expect(await screen(A.pinia, Month, '/month')).toContain('data-arrival-dot')
    const before = card(A)

    // Правило «это зарплата» уходит на сервер тем же клиентом, что у телефона (`tap` зовёт `acceptMatch` без клиента).
    vi.spyOn(apiClient, 'upsertOperations').mockImplementation(A.client.upsertOperations)
    await screen(A.pinia, Month, '/month', undefined, tap())
    await vi.advanceTimersByTimeAsync(0)
    expect(salaryOct(A).map((p) => [p.amount, p.accountId, p.opId])).toEqual([[690_000, 'card', SALARY_PUSH.id]])
    // Зачислено, как обычной «Пришла»: остаток карты вырос на сумму прихода (не оклада 700 000).
    expect(card(A) - before).toBe(690_000)
    const html = await screen(A.pinia, Month, '/month')
    expect(html).not.toContain('data-arrival-dot')
    on(A)
    expect(useOperationsStore().pendingMatches.some((c) => c.opId === SALARY_PUSH.id)).toBe(false)

    await A.store.syncHousehold(A.client)
    await pull(B)
    expect(salaryOct(B).map((p) => [p.amount, p.accountId, p.opId])).toEqual([[690_000, 'card', SALARY_PUSH.id]])
    expect(await screen(B.pinia, Month, '/month')).not.toContain('data-arrival-dot')
    // Операции Ильяса Аруне не видны (Р-2): у неё нет ни прихода, ни вопроса.
    on(B)
    expect(useOperationsStore().all.some((o) => o.id === SALARY_PUSH.id)).toBe(false)
  })

  it('первая зарплата из пуша: «Пришла» открывает лист с суммой прихода; отметка на выбранный счёт, точка и вопрос уходят', async () => {
    server = fakeServer(planFamilyDoc())
    const A = await phone(server, st, 'a')
    serverPush(st, 'u-a', SALARY_PUSH)
    await pull(A)
    expect(await screen(A.pinia, Month, '/month')).toContain('data-arrival-dot')

    const sheet = await screen(A.pinia, Month, '/month', undefined, tap())
    expect(sheet).toContain('Отметить зарплату')
    expect(sheet.replace(/&nbsp;|[  ]/g, ' ')).toContain('690 000')
    expect(salaryOct(A)).toEqual([])

    const seen: { amount?: unknown } = {}
    await screen(A.pinia, Month, '/month', undefined, [...tap(), confirmMark(seen)])
    expect(String(seen.amount).replace(/\D/g, '')).toBe('690000')
    expect(salaryOct(A).map((p) => [p.amount, p.accountId])).toEqual([[690_000, 'card']])
    expect(await screen(A.pinia, Month, '/month')).not.toContain('data-arrival-dot')
    on(A)
    expect(useOperationsStore().pendingMatches.some((c) => c.opId === SALARY_PUSH.id)).toBe(false)
  })

  it('viewer и демо: ни точки, ни запросов статуса Apple Pay (viewer — и без «Пришла») — даже когда у Ильяса есть приход из пуша', async () => {
    server = fakeServer(planFamilyDoc({ payments: [SEPT_SALARY] }))
    serverPush(st, 'u-a', SALARY_PUSH)
    const A = await phone(server, st, 'a')
    expect(A.wallet).toHaveBeenCalled()
    expect(await screen(A.pinia, Month, '/month')).toContain('data-arrival-dot')

    for (const o of [{ role: 'viewer' as const }, { demo: true }]) {
      storage.clear() // другой телефон: копии операций Ильяса на нём нет
      const p = await phone(server, st, 'a', o)
      on(p)
      await useApplePayStore().load(p.client, true)
      expect(p.wallet, JSON.stringify(o)).not.toHaveBeenCalled()
      expect(useApplePayStore().pushLink, JSON.stringify(o)).toBe('')
      const html = await screen(p.pinia, Month, '/month')
      expect(html, JSON.stringify(o)).not.toContain('data-arrival-dot')
      // viewer не отмечает вовсе; демо отмечает по-своему (локально) — «Пришла» есть, но без точки.
      if (o.role === 'viewer') expect(html).not.toContain('data-salary-came-btn')
      on(p)
      expect(useOperationsStore().salaryArrivals, JSON.stringify(o)).toEqual([])
    }
  })
})
