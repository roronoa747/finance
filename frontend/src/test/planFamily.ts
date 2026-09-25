import { defaultSyncDoc } from '@/stores/finance'
import type { DebtPlan, Goal, SyncDoc } from '@/types/finance'

/**
 * Семья для SSR-тестов плана «Сначала долги» (PV-15…PV-17): три долга — кредит 33%,
 * кредитка 40%, рассрочка 0%; подушка полна (400 000 ≥ месяц списаний 323 000), отпуск
 * и машина встают на паузу — 100 000 в месяц. Доход 1 200 000.
 */
export const T0 = '2026-09-01T00:00:00.000Z'

const goal = (id: string, name: string, have: number, monthly: number): Goal => ({
  id, name, need: 3_000_000, seed: have, have, monthly, hue: 'teal', planPct: 0, movements: [], updatedAt: T0,
})

export function planFamilyDoc(extra: Partial<SyncDoc> = {}): SyncDoc {
  return {
    ...defaultSyncDoc(),
    setupDoneAt: T0,
    people: [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Аруна', salary: 500_000, payday: 20, updatedAt: T0 },
    ],
    categories: [
      { key: 'd1', name: 'Жильё', note: '', amount: 0, updatedAt: T0 },
      { key: 'd2', name: 'Кредиты', note: '', amount: 0, updatedAt: T0 },
      { key: 'd3', name: 'Цели', note: '', amount: 0, updatedAt: T0 },
      { key: 'd4', name: 'Еда и быт', note: '', amount: 150_000, updatedAt: T0 },
    ],
    accounts: [{ id: 'card', name: 'Kaspi Gold', note: '', amount: 2_000_000, amountSetAt: T0, kind: 'card', updatedAt: T0 }],
    obligations: [
      { id: 'rent', name: 'Аренда', note: '', day: 5, category: 'd1', versions: [{ from: '2000-01', amount: 220_000 }], updatedAt: T0 },
    ],
    credits: [
      { id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, principalSetAt: T0, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0 },
      { id: 'cc', name: 'Кредитка', note: '', principal: 300_000, principalSetAt: T0, annualRate: 0.4, payment: 25_000, day: 22, updatedAt: T0 },
      { id: 'inst', name: 'Рассрочка', note: '', principal: 240_000, principalSetAt: T0, annualRate: 0, payment: 20_000, day: 25, updatedAt: T0 },
    ],
    goals: [goal('cushion', 'Подушка', 400_000, 30_000), goal('trip', 'Отпуск', 50_000, 40_000), goal('car', 'Машина', 200_000, 60_000)],
    ...extra,
  }
}

/** Активный план семьи: подушка — «Подушка», выбран 10 сентября. */
export function planOf(p: Partial<DebtPlan> = {}): DebtPlan {
  return {
    id: 'plan', status: 'active', by: 'a', startedAt: '2026-09-10T05:00:00.000Z', endedAt: null,
    keptGoalIds: [], cushionGoalId: 'cushion', creditIds: ['cc', 'loan'], months: 24, lump: 0,
    forecast: { gain: 250_000, savedInterest: 180_000, debtFreeMonth: '2028-01' }, result: null, updatedAt: T0, ...p,
  }
}

/** Участник или viewer семьи — для экранов с правами (Р-12). */
export function authAs(role: 'member' | 'viewer', slot: 'a' | 'b' = 'a') {
  return {
    token: 't',
    user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: T0 },
    member: { household_id: 'h-family', user_id: `u-${slot}`, slot, display_name: slot, role, joined_at: T0 },
  }
}
