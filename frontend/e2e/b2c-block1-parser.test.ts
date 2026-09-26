import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { parseStatement } from '../src/lib/statements/parsers'
import { picture } from '../src/lib/statements/model'
import type { Operation } from '../src/lib/statements/types'
import { backend, fakeServer, fakeStatements, setOnline, statementsFor, type FakeServer, type FakeStatements } from './support/family'
import kaspi01 from '../src/lib/statements/fixtures/kaspi-01.rows.json'
import kaspi02 from '../src/lib/statements/fixtures/kaspi-02.rows.json'
import freedom01 from '../src/lib/statements/fixtures/freedom-01.rows.json'

// Приёмка Блока 1 B2C (B2C-07): два телефона семьи, фейковые сервер документа и ручки
// выписок (как Go). Файл → строки — это pdf.js (браузерная проверка на стенде); здесь строки
// берутся из фикстур и идут тем же путём: разбор → черновик → отправка → итоги в документе.

const storage = new Map<string, string>()

type Phone = { pinia: Pinia; client: ApiClient; user: string }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${slot}`, user: { id: user, email: `${slot}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  return { pinia, client, user }
}

/** Выписка с телефона: разбор строк → черновик → «Отправить» → документ на сервер. */
async function upload(p: Phone, rows: typeof kaspi01) {
  setActivePinia(p.pinia)
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'выписка.pdf', parsed: parseStatement(rows) }])
  await ops.send(p.client)
  await useFinanceStore().syncHousehold(p.client)
}

const spent = (ops: Operation[], month: string) =>
  ops.filter((o) => o.amount < 0 && !o.internal && o.date.startsWith(month)).reduce((s, o) => s - o.amount, 0)

describe('e2e / B2C Блок 1 — выписка: разбор на телефоне, личные операции, итоги семье', () => {
  let server: FakeServer
  let st: FakeStatements

  beforeEach(() => {
    vi.useFakeTimers() // синк по таймеру не уходит в сеть — телефоны синкаются явно
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    server = fakeServer({
      ...defaultSyncDoc(),
      setupDoneAt: '2026-09-01T00:00:00Z',
      people: [
        { id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' },
        { id: 'b', name: 'Дана', salary: 0, payday: 20, updatedAt: '' },
      ],
    })
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('A загружает Kaspi, B видит итоги и загрузку без операций; повтор не удваивает; B — Freedom; A без сети досылает', async () => {
    const A = await phone(server, st, 'a')
    const B = await phone(server, st, 'b')

    // A загружает выписку Kaspi.
    await upload(A, kaspi01)
    expect(st.uploads.map((u) => [u.slot, u.bank, u.ops_count])).toEqual([['a', 'kaspi', 60]])
    expect(st.ops.get('u-a')?.size).toBe(60)
    const totalsA = server.data.spendTotals!.filter((t) => t.by === 'a')
    expect(totalsA.length).toBeGreaterThan(0)
    setActivePinia(A.pinia)
    const opsA = useOperationsStore().all
    const julyA = spent(opsA, '2025-07')
    expect(totalsA.filter((t) => t.kind === 'month' && t.period === '2025-07').reduce((s, t) => s + t.amount, 0)).toBe(julyA)
    // На сервере — только разобранное: ни строк PDF, ни 6+ цифр.
    for (const o of st.ops.get('u-a')!.values()) {
      expect([o.merchant, o.counterparty, o.note].join(' ')).not.toMatch(/\d{6,}/)
    }

    // B: итоги и запись загрузки видит, операций A — нет.
    setActivePinia(B.pinia)
    await useFinanceStore().pullHousehold(B.client)
    expect(useFinanceStore().householdDoc.spendTotals?.filter((t) => t.by === 'a').length).toBe(totalsA.length)
    const opsB = useOperationsStore()
    await opsB.loadUploads(B.client)
    await opsB.pull(B.client)
    expect(opsB.uploads.map((u) => u.slot)).toEqual(['a'])
    expect(opsB.all).toEqual([])

    // A загружает тот же файл снова: операций столько же, итоги те же.
    const before = JSON.stringify(server.data.spendTotals)
    await upload(A, kaspi01)
    expect(st.ops.get('u-a')?.size).toBe(60)
    const strip = (json: string) => JSON.parse(json).map((t: { id: string; amount: number; ops: number }) => [t.id, t.amount, t.ops])
    expect(strip(JSON.stringify(server.data.spendTotals))).toEqual(strip(before))

    // B загружает Freedom: картина семьи складывает обоих.
    await upload(B, freedom01)
    setActivePinia(B.pinia)
    const julyB = spent(useOperationsStore().all, '2025-07')
    setActivePinia(A.pinia)
    await useFinanceStore().pullHousehold(A.client)
    const rows = picture(useFinanceStore().householdDoc.spendTotals ?? [], '2025-W30', '2025-07')
    expect(rows.reduce((s, r) => s + r.month, 0)).toBe(julyA + julyB)
    expect(st.ops.get('u-b')?.size).toBe(42)

    // A без сети: итоги сразу, операции в очереди; сеть вернулась — на сервере.
    setOnline(false)
    setActivePinia(A.pinia)
    const opsA2 = useOperationsStore()
    opsA2.setDraft([{ name: 'август.pdf', parsed: parseStatement(kaspi02) }])
    await opsA2.send(A.client)
    expect(opsA2.pendingCount).toBe(21)
    expect(st.uploads).toHaveLength(3)
    expect(useFinanceStore().householdDoc.spendTotals?.some((t) => t.id.startsWith('a:month:2025-08'))).toBe(true)
    setOnline(true)
    await opsA2.flush(A.client)
    expect(opsA2.pendingCount).toBe(0)
    expect(st.uploads).toHaveLength(4)
    expect(st.ops.get('u-a')?.size).toBe(81)
  })
})
