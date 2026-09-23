import { describe, it, expect } from 'vitest'
import { mergeDocs, isEmptyDoc } from './merge'
import type { SyncDoc, Goal, Obligation, Person, Category, Account, Credit } from '@/types/finance'

function createEmptyDoc(): SyncDoc {
  return {
    people: [],
    categories: [],
    goals: [],
    wishlist: [],
    obligations: [],
    accounts: [],
    credits: [],
    setupDoneAt: null,
  }
}

describe('merge.ts — слияние версий документа казны (3-way merge)', () => {
  it('isEmptyDoc корректно определяет пустой документ', () => {
    expect(isEmptyDoc(null)).toBe(true)
    expect(isEmptyDoc(undefined)).toBe(true)
    expect(isEmptyDoc(createEmptyDoc())).toBe(true)

    const docWithPerson: SyncDoc = {
      ...createEmptyDoc(),
      people: [
        {
          id: 'a',
          name: 'Ильяс',
          salary: 500_000,
          payday: 10,
          updatedAt: '2026-09-20T10:00:00Z',
        },
      ],
    }
    expect(isEmptyDoc(docWithPerson)).toBe(false)
  })

  it('слияние целей объединяет взносы (movements) и пересчитывает накопления (have)', () => {
    const goalLocal: Goal = {
      id: 'g-1',
      name: 'Отпуск',
      need: 1_000_000,
      seed: 100_000,
      have: 150_000,
      monthly: 50_000,
      hue: 'teal',
      planPct: 0.15,
      updatedAt: '2026-09-21T10:00:00Z',
      movements: [
        {
          id: 'm-1',
          date: '2026-09-20',
          amount: 50_000,
          by: 'a',
          note: 'Взнос от Ильяса',
        },
      ],
    }

    const goalRemote: Goal = {
      id: 'g-1',
      name: 'Отпуск в Турции', // переименовано позже
      need: 1_000_000,
      seed: 100_000,
      have: 170_000,
      monthly: 50_000,
      hue: 'teal',
      planPct: 0.17,
      updatedAt: '2026-09-22T10:00:00Z',
      movements: [
        {
          id: 'm-2',
          date: '2026-09-21',
          amount: 70_000,
          by: 'b',
          note: 'Взнос от Аруны',
        },
      ],
    }

    const docA: SyncDoc = { ...createEmptyDoc(), goals: [goalLocal] }
    const docB: SyncDoc = { ...createEmptyDoc(), goals: [goalRemote] }

    const merged = mergeDocs(docA, docB)

    expect(merged.goals).toHaveLength(1)
    const g = merged.goals[0]
    // Название берётся более позднее (из docB)
    expect(g.name).toBe('Отпуск в Турции')
    // Взносы объединяются: m-1 и m-2 присутствуют оба
    expect(g.movements).toHaveLength(2)
    expect(g.movements.map((m) => m.id)).toContain('m-1')
    expect(g.movements.map((m) => m.id)).toContain('m-2')
    // have пересчитывается: seed (100k) + 50k + 70k = 220k
    expect(g.have).toBe(220_000)
  })

  it('слияние обязательств объединяет версии сумм (versions) по месяцам', () => {
    const obA: Obligation = {
      id: 'ob-1',
      name: 'Аренда квартиры',
      note: '',
      day: 5,
      category: 'd1',
      updatedAt: '2026-09-20T10:00:00Z',
      versions: [{ from: '2026-01', amount: 300_000 }],
    }

    const obB: Obligation = {
      id: 'ob-1',
      name: 'Аренда квартиры',
      note: 'Повышение с октября',
      day: 5,
      category: 'd1',
      updatedAt: '2026-09-22T12:00:00Z',
      versions: [
        { from: '2026-01', amount: 300_000 },
        { from: '2026-10', amount: 350_000, reason: 'Индексация' },
      ],
    }

    const merged = mergeDocs(
      { ...createEmptyDoc(), obligations: [obA] },
      { ...createEmptyDoc(), obligations: [obB] },
    )

    expect(merged.obligations).toHaveLength(1)
    const ob = merged.obligations[0]
    expect(ob.note).toBe('Повышение с октября')
    expect(ob.versions).toHaveLength(2)
    expect(ob.versions[0].from).toBe('2026-01')
    expect(ob.versions[1].from).toBe('2026-10')
    expect(ob.versions[1].amount).toBe(350_000)
  })

  it('удаление побеждает (надгробие deletedAt сохраняется)', () => {
    const accA: Account = {
      id: 'acc-1',
      name: 'Kaspi Gold',
      note: '',
      amount: 50_000,
      kind: 'card',
      updatedAt: '2026-09-23T10:00:00Z',
      deletedAt: '2026-09-23T10:00:00Z', // удалено
    }

    const accB: Account = {
      id: 'acc-1',
      name: 'Kaspi Gold Ильяс', // отредактировано на другом устройстве
      note: '',
      amount: 55_000,
      kind: 'card',
      updatedAt: '2026-09-23T11:00:00Z',
      deletedAt: null,
    }

    const merged = mergeDocs(
      { ...createEmptyDoc(), accounts: [accA] },
      { ...createEmptyDoc(), accounts: [accB] },
    )

    expect(merged.accounts).toHaveLength(1)
    expect(merged.accounts[0].deletedAt).toBe('2026-09-23T10:00:00Z')
  })

  it('слияние коммутативно: mergeDocs(A, B) эквивалентно mergeDocs(B, A)', () => {
    const personA: Person = {
      id: 'a',
      name: 'Ильяс',
      salary: 600_000,
      payday: 10,
      updatedAt: '2026-09-20T10:00:00Z',
    }
    const catA: Category = {
      key: 'd1',
      name: 'Жильё',
      note: '',
      amount: 300_000,
      updatedAt: '2026-09-20T10:00:00Z',
    }
    const credA: Credit = {
      id: 'c-1',
      name: 'Автокредит',
      note: '',
      principal: 2_000_000,
      annualRate: 0.18,
      payment: 70_000,
      day: 15,
      updatedAt: '2026-09-20T10:00:00Z',
    }

    const doc1: SyncDoc = {
      ...createEmptyDoc(),
      setupDoneAt: '2026-09-20T10:00:00Z',
      people: [personA],
      categories: [catA],
      credits: [credA],
    }

    const personB: Person = {
      id: 'b',
      name: 'Аруна',
      salary: 500_000,
      payday: 15,
      updatedAt: '2026-09-21T10:00:00Z',
    }
    const catB: Category = {
      key: 'd2',
      name: 'Авто',
      note: '',
      amount: 100_000,
      updatedAt: '2026-09-21T10:00:00Z',
    }

    const doc2: SyncDoc = {
      ...createEmptyDoc(),
      people: [personB],
      categories: [catB],
    }

    const res1 = mergeDocs(doc1, doc2)
    const res2 = mergeDocs(doc2, doc1)

    expect(res1.setupDoneAt).toBe(res2.setupDoneAt)
    expect(res1.people.length).toBe(res2.people.length)
    expect(res1.categories.length).toBe(res2.categories.length)
    expect(res1.credits.length).toBe(res2.credits.length)
  })

  it('слияние идемпотентно: mergeDocs(A, A) сохраняет исходный A', () => {
    const doc: SyncDoc = {
      ...createEmptyDoc(),
      setupDoneAt: '2026-09-20T10:00:00Z',
      people: [
        {
          id: 'a',
          name: 'Ильяс',
          salary: 600_000,
          payday: 10,
          updatedAt: '2026-09-20T10:00:00Z',
        },
      ],
      categories: [
        {
          key: 'd1',
          name: 'Жильё',
          note: '',
          amount: 300_000,
          updatedAt: '2026-09-20T10:00:00Z',
        },
      ],
    }

    const merged1 = mergeDocs(doc, doc)
    const merged2 = mergeDocs(merged1, merged1)
    expect(merged2).toEqual(merged1)
    expect(merged1.people[0].name).toBe('Ильяс')
    expect(merged1.categories[0].amount).toBe(300_000)
    expect(merged1.setupDoneAt).toBe(doc.setupDoneAt)
  })

  it('слияние категорий и вишлиста сохраняет элементы и выбирает актуальные правки', () => {
    const docA: SyncDoc = {
      ...createEmptyDoc(),
      categories: [
        { key: 'd1', name: 'Жильё', note: '', amount: 300_000, updatedAt: '2026-09-20T10:00:00Z' },
      ],
      wishlist: [
        { id: 'w-1', name: 'Кофемашина', price: 250_000, by: 'a', addedOn: '2026-09-20', bought: false, updatedAt: '2026-09-20T10:00:00Z' },
      ],
    }

    const docB: SyncDoc = {
      ...createEmptyDoc(),
      categories: [
        { key: 'd1', name: 'Аренда жилья', note: 'уточнено', amount: 320_000, updatedAt: '2026-09-22T10:00:00Z' },
        { key: 'd2', name: 'Еда и кафе', note: '', amount: 150_000, updatedAt: '2026-09-21T10:00:00Z' },
      ],
      wishlist: [
        { id: 'w-1', name: 'Кофемашина DeLonghi', price: 260_000, by: 'a', addedOn: '2026-09-20', bought: true, updatedAt: '2026-09-23T10:00:00Z' },
        { id: 'w-2', name: 'Наушники', price: 80_000, by: 'b', addedOn: '2026-09-21', bought: false, updatedAt: '2026-09-21T10:00:00Z' },
      ],
    }

    const merged = mergeDocs(docA, docB)

    // Категории: d1 обновлена до 320k, d2 добавлена
    expect(merged.categories).toHaveLength(2)
    const cat1 = merged.categories.find((c) => c.key === 'd1')
    expect(cat1?.name).toBe('Аренда жилья')
    expect(cat1?.amount).toBe(320_000)

    // Вишлист: w-1 стал купленным, w-2 добавлен
    expect(merged.wishlist).toHaveLength(2)
    const w1 = merged.wishlist.find((w) => w.id === 'w-1')
    expect(w1?.name).toBe('Кофемашина DeLonghi')
    expect(w1?.bought).toBe(true)
  })
})
