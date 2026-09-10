/** Пример семьи для прогонов по экранам: две зарплаты, кредит, три счёта, цель. */
export const seed = {
  version: 3,
  state: {
    people: [
      { id: 'a', name: 'Ильяс', salary: 700000, payday: 10, onboardedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'Аруна', salary: 500000, payday: 25, onboardedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    categories: [
      { key: 'd1', name: 'Жильё', note: 'аренда и коммуналка', amount: 0 },
      { key: 'd2', name: 'Кредиты', note: 'платежи', amount: 0 },
      { key: 'd3', name: 'Цели', note: 'накопления', amount: 0 },
      { key: 'd4', name: 'Еда и быт', note: 'оценка', amount: 200000 },
      { key: 'd5', name: 'Свободно', note: 'остаток', amount: 0 },
    ],
    goals: [{
      id: 'flat', name: 'Первая квартира', need: 6000000, seed: 2000000, have: 2000000,
      monthly: 200000, hue: 'green', planPct: 0.3, movements: [], updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    wishlist: [],
    obligations: [{
      id: 'rent', name: 'Аренда', note: 'квартира', day: 5, category: 'd1',
      versions: [{ from: '2025-01', amount: 280000 }], updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    accounts: [
      { id: 'card', name: 'Карта Kaspi', note: 'основная', amount: 240000, kind: 'card', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'usd', name: 'Доллары', note: 'наличные', amount: 456890, kind: 'cash', currency: 'USD', foreignAmount: 1000, rate: 456.89, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'dep', name: 'Отбасы', note: 'жилищный', amount: 1500000, kind: 'deposit', updatedAt: '2026-01-01T00:00:00.000Z', deposit: { annualRate: 0.02, months: 24, monthlyTopUp: 50000, capitalize: true } },
    ],
    credits: [{
      id: 'c1', name: 'Кредит Халык', note: 'ежемесячный платёж', principal: 1640000,
      annualRate: 0.234, payment: 117000, day: 12, updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    settings: { theme: 'auto', accent: 'copper', categories: { d1: 'blue', d2: 'brick', d3: 'green', d4: 'ochre', d5: 'steel' }, inflation: 0.102 },
    membership: [{ userId: 'u1', slot: 'a', name: 'Ильяс' }, { userId: 'u2', slot: 'b', name: 'Аруна' }],
    userId: 'u1',
    setupDoneAt: '2026-01-01T00:00:00.000Z',
  },
}
