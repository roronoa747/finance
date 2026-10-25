import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defaultSyncDoc, useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { renderScreen } from '@/test/screenState'
import { authAs } from '@/test/planFamily'
import { plain } from '@/lib/money'
import type { Account, AccountSpent, Person } from '@/types/finance'
import Money from '@/views/Money.vue'

/** F2-08 (Р-7): «Счета» — у счёта для трат подпись «траты · оба / <имя>» вместо «общий», число — тающий остаток. */

const T0 = '2026-10-01T00:00:00.000Z'
const two: Person[] = [
  { id: 'a', name: 'Ильяс', salary: 0, payday: 10, updatedAt: T0 },
  { id: 'b', name: 'Аруна', salary: 0, payday: 20, updatedAt: T0 },
]
const acc = (id: string, name: string, p: Partial<Account> = {}): Account => ({ id, name, note: '', amount: 250_000, amountSetAt: T0, kind: 'card', updatedAt: T0, ...p })
const spent = (by: 'a' | 'b', amount: number, accountId = 'k1'): AccountSpent => ({ id: `${accountId}:${by}`, accountId, by, since: T0, amount, updatedAt: T0 })
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/\s+/g, ' ')

async function render(accounts: Account[], accountSpent: AccountSpent[], role: 'member' | 'viewer' = 'member') {
  useAuthStore().setAuthData(authAs(role))
  useFinanceStore().setHouseholdDoc({ ...defaultSyncDoc(), setupDoneAt: T0, people: two, accounts, accountSpent }, 1)
  return text(await renderScreen(Money, '/money'))
}

describe('F2-08: счёт для трат на «Счетах»', () => {
  const storage = new Map<string, string>()
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('«оба» — подпись «траты · оба», остаток минус траты обоих', async () => {
    const html = await render([acc('k1', 'Kaspi Gold')], [spent('a', 5_000), spent('b', 7_000)])
    expect(html).toContain(`Kaspi Gold карта · траты · оба ${plain(238_000).replace(/\s/g, ' ')}`)
  })

  it('свой счёт партнёра — «траты · <имя>»; второй счёт — «общий»', async () => {
    const html = await render([acc('k1', 'Kaspi Gold', { spendBy: 'b' }), acc('k2', 'Halyk', { spendBy: 'a' })], [spent('b', 7_000)])
    expect(html).toContain(`Kaspi Gold карта · траты · Аруна ${plain(243_000).replace(/\s/g, ' ')}`)
    expect(html).toContain('Halyk карта · траты · Ильяс')
  })

  it('не счёт для трат — «общий», остаток без трат; viewer видит ту же подпись и число', async () => {
    const html = await render([acc('k1', 'Kaspi Gold'), acc('k2', 'Halyk')], [spent('a', 5_000)])
    expect(html).toContain(`Kaspi Gold карта · общий ${plain(250_000).replace(/\s/g, ' ')}`)
    setActivePinia(createPinia())
    const viewer = await render([acc('k1', 'Kaspi Gold')], [spent('a', 5_000)], 'viewer')
    expect(viewer).toContain(`Kaspi Gold карта · траты · оба ${plain(245_000).replace(/\s/g, ' ')}`)
  })
})
