import { describe, it, expect } from 'vitest'
import { mergeDocs, isEmptyDoc } from './merge'
import { accountBalance, activePlan, creditBalance, goalHave, paidFor, shiftedBase } from './finance'
import type { SyncDoc, Goal, Obligation, Person, Category, Account, Credit, DebtPlan, Payment } from '@/types/finance'

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

  describe('RP-02: незнакомое не теряется', () => {
    type Loose = SyncDoc & Record<string, unknown>
    const pay = (id: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id,
      amount,
      updatedAt: '2026-09-20T10:00:00Z',
      ...extra,
    })
    const unk = (doc: SyncDoc, key: string) => (doc as Loose)[key]

    it('незнакомый список с id с одной стороны сохраняется', () => {
      const withReceipts = { ...createEmptyDoc(), receipts: [pay('p1', 100)] } as Loose
      const res1 = mergeDocs(createEmptyDoc(), withReceipts)
      const res2 = mergeDocs(withReceipts, createEmptyDoc())
      expect(unk(res1, 'receipts')).toEqual([pay('p1', 100)])
      expect(unk(res2, 'receipts')).toEqual([pay('p1', 100)])
    })

    it('разные записи с двух сторон объединяются, надгробие побеждает', () => {
      const local = { ...createEmptyDoc(), receipts: [pay('p1', 100), pay('p2', 200)] } as Loose
      const remote = {
        ...createEmptyDoc(),
        receipts: [pay('p3', 300), pay('p2', 200, { deletedAt: '2026-09-21T10:00:00Z', updatedAt: '2026-09-19T10:00:00Z' })],
      } as Loose
      const list = unk(mergeDocs(local, remote), 'receipts') as { id: string; deletedAt?: string | null }[]
      expect(list.map((p) => p.id).sort()).toEqual(['p1', 'p2', 'p3'])
      expect(list.find((p) => p.id === 'p2')?.deletedAt).toBe('2026-09-21T10:00:00Z')
      // Пустой список с одной стороны — тоже список: объединяется, а не затирает.
      const withEmpty = { ...createEmptyDoc(), receipts: [] } as Loose
      expect(unk(mergeDocs(withEmpty, remote), 'receipts')).toHaveLength(2)
    })

    it('незнакомый скаляр и объект верхнего уровня сохраняются; при обеих — берётся remote', () => {
      const local = { ...createEmptyDoc(), review: { text: 'старый' }, flag: 1 } as Loose
      const remote = { ...createEmptyDoc(), review: { text: 'новый' }, onlyRemote: 'x' } as Loose
      const res = mergeDocs(local, remote)
      expect(unk(res, 'review')).toEqual({ text: 'новый' })
      expect(unk(res, 'flag')).toBe(1)
      expect(unk(res, 'onlyRemote')).toBe('x')
      // Явный null с сервера — значение.
      expect(unk(mergeDocs(local, { ...createEmptyDoc(), review: null } as Loose), 'review')).toBeNull()
    })

    it('поле, которого нет у победителя, остаётся от проигравшего; явный null — значение', () => {
      const old: Account = {
        id: 'acc',
        name: 'Kaspi',
        note: '',
        amount: 100,
        kind: 'card',
        updatedAt: '2026-09-20T10:00:00Z',
      }
      const fromNewClient = { ...old, amountSetAt: '2026-09-20T10:00:00Z' } as Account
      // Старый клиент поправил имя позже, про amountSetAt он не знает.
      const fromOldClient: Account = { ...old, name: 'Kaspi Gold', updatedAt: '2026-09-22T10:00:00Z' }

      for (const [a, b] of [
        [fromOldClient, fromNewClient],
        [fromNewClient, fromOldClient],
      ]) {
        const acc = mergeDocs({ ...createEmptyDoc(), accounts: [a] }, { ...createEmptyDoc(), accounts: [b] })
          .accounts[0] as Account & { amountSetAt?: string | null }
        expect(acc.name).toBe('Kaspi Gold')
        expect(acc.amountSetAt).toBe('2026-09-20T10:00:00Z')
      }

      const cleared = { ...fromOldClient, amountSetAt: null } as unknown as Account
      const acc = mergeDocs({ ...createEmptyDoc(), accounts: [fromNewClient] }, { ...createEmptyDoc(), accounts: [cleared] })
        .accounts[0] as Account & { amountSetAt?: string | null }
      expect(acc.amountSetAt).toBeNull()
    })

    it('коммутативность и идемпотентность на незнакомых данных', () => {
      const a = {
        ...createEmptyDoc(),
        receipts: [pay('p1', 100), pay('p2', 200, { updatedAt: '2026-09-22T10:00:00Z' })],
        review: { text: 'тот же' },
      } as Loose
      const b = {
        ...createEmptyDoc(),
        receipts: [pay('p3', 300), pay('p2', 250, { note: 'только у b' })],
        review: { text: 'тот же' },
      } as Loose
      const byId = (doc: SyncDoc) =>
        [...(unk(doc, 'receipts') as { id: string }[])].sort((x, y) => x.id.localeCompare(y.id))

      const ab = mergeDocs(a, b)
      const ba = mergeDocs(b, a)
      expect(byId(ab)).toEqual(byId(ba))
      expect(unk(ab, 'review')).toEqual(unk(ba, 'review'))
      const p2 = byId(ab).find((p) => p.id === 'p2') as unknown as { amount: number; note?: string }
      expect(p2.amount).toBe(200)
      expect(p2.note).toBe('только у b')

      // Как в тесте выше: первый проход дописывает deletedAt: null, дальше — неподвижная точка.
      const once = mergeDocs(a, a)
      expect(mergeDocs(once, once)).toEqual(once)
      const abab = mergeDocs(ab, ab)
      expect(mergeDocs(abab, abab)).toEqual(abab)
      expect(mergeDocs(abab, b)).toEqual(mergeDocs(abab, abab))
    })
  })
})

describe('RP-06: отметки оплат при слиянии', () => {
  const T0 = '2026-09-01T00:00:00Z'
  const card: Account = { id: 'card', name: 'Kaspi', note: '', amount: 1_000_000, kind: 'card', updatedAt: T0 }
  const loan: Credit = {
    id: 'loan', name: 'Кредит', note: '', principal: 1_000_000, annualRate: 0.33, payment: 58_000, day: 15, updatedAt: T0,
  }
  const base: SyncDoc = { ...createEmptyDoc(), accounts: [card], credits: [loan], payments: [] }
  const mark = (id: string, p: Partial<Payment>): Payment => ({
    id,
    kind: 'obligation',
    targetId: 'rent',
    period: '2026-09',
    amount: 220_000,
    accountId: 'card',
    by: 'a',
    at: '2026-09-05T10:00:00Z',
    updatedAt: '2026-09-05T10:00:00Z',
    ...p,
  })
  const ids = (doc: SyncDoc) => (doc.payments ?? []).map((p) => p.id).sort()

  it('две офлайн-отметки разных платежей с двух клиентов — после слияния обе', () => {
    const a: SyncDoc = { ...base, payments: [mark('ra', { by: 'a' })] }
    const b: SyncDoc = {
      ...base,
      payments: [mark('lb', { kind: 'credit', targetId: 'loan', amount: 58_000, principal: 30_500, by: 'b' })],
    }
    const ab = mergeDocs(a, b)
    const ba = mergeDocs(b, a)
    expect(ids(ab)).toEqual(['lb', 'ra'])
    expect(ids(ba)).toEqual(['lb', 'ra'])
    expect(accountBalance(ab.accounts[0], ab.payments)).toBe(1_000_000 - 220_000 - 58_000)
    expect(creditBalance(ab.credits[0], ab.payments)).toBe(969_500)
  })

  it('одна пара с двух клиентов (разные id) — обе записи остаются, остаток уменьшен один раз', () => {
    const a: SyncDoc = { ...base, payments: [mark('x1', { at: '2026-09-05T10:00:00Z' })] }
    const b: SyncDoc = { ...base, payments: [mark('x2', { at: '2026-09-05T10:03:00Z', by: 'b' })] }
    const ab = mergeDocs(a, b)
    const ba = mergeDocs(b, a)
    expect(ids(ab)).toEqual(['x1', 'x2'])
    expect(accountBalance(ab.accounts[0], ab.payments)).toBe(780_000)
    expect(accountBalance(ba.accounts[0], ba.payments)).toBe(780_000)
    expect(paidFor(ab.payments, 'obligation', 'rent', '2026-09')?.id).toBe('x1')
  })

  it('снятие побеждает отметку и не воскресает; повторная отметка — новая запись', () => {
    const marked = mark('r1', {})
    const unmarked = { ...marked, deletedAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z' }
    const again = mark('r2', { at: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:00Z' })
    // Партнёр видел только отметку; у нас она снята и поставлена снова.
    const partner: SyncDoc = { ...base, payments: [marked] }
    const mine: SyncDoc = { ...base, payments: [unmarked, again] }
    for (const doc of [mergeDocs(partner, mine), mergeDocs(mine, partner)]) {
      expect(doc.payments?.find((p) => p.id === 'r1')?.deletedAt).toBe('2026-09-06T00:00:00Z')
      expect(accountBalance(doc.accounts[0], doc.payments)).toBe(780_000)
      expect(paidFor(doc.payments, 'obligation', 'rent', '2026-09')?.id).toBe('r2')
    }
  })

  it('документ без payments (до Блока 1) сливается с новым; слияние идемпотентно', () => {
    const old = { ...createEmptyDoc(), accounts: [card] }
    const fresh: SyncDoc = { ...base, payments: [mark('r1', {})] }
    const merged = mergeDocs(old, fresh)
    expect(ids(merged)).toEqual(['r1'])
    expect(mergeDocs(old, old).payments).toEqual([])
    const twice = mergeDocs(merged, merged)
    expect(mergeDocs(twice, twice)).toEqual(twice)
  })
  describe('сверка и сдвиг остатка на одном телефоне, отметка на другом', () => {
    // Карта со сверкой в начале месяца: база 1 000 000, якорь T0.
    const anchored: Account = { ...card, amountSetAt: T0 }
    const withCard = (a: Account, payments: Payment[] = []): SyncDoc => ({ ...base, accounts: [a], payments })
    const both = (a: SyncDoc, b: SyncDoc) => [mergeDocs(a, b), mergeDocs(b, a)]

    it('сверка на A, отметка на B после сверки — списывается из сверенной суммы', () => {
      const tA = '2026-09-05T08:00:00Z'
      // A сверил с банком: 800 000, база и якорь — момент сверки.
      const a = withCard({ ...anchored, amount: 800_000, amountSetAt: tA, updatedAt: tA })
      // B отметил аренду позже сверки: в сверенную сумму она ещё не вошла.
      const b = withCard(anchored, [mark('r1', { at: '2026-09-05T10:00:00Z', by: 'b' })])
      for (const doc of both(a, b)) {
        expect(doc.accounts[0].amount).toBe(800_000)
        expect(doc.accounts[0].amountSetAt).toBe(tA)
        expect(accountBalance(doc.accounts[0], doc.payments)).toBe(580_000)
      }
    })

    it('сверка на A, отметка на B до сверки — сверка её уже включает, не списывается', () => {
      const tA = '2026-09-05T12:00:00Z'
      const a = withCard({ ...anchored, amount: 800_000, amountSetAt: tA, updatedAt: tA })
      const b = withCard(anchored, [mark('r1', { at: '2026-09-05T10:00:00Z', by: 'b' })])
      for (const doc of both(a, b)) {
        expect(accountBalance(doc.accounts[0], doc.payments)).toBe(800_000)
        // Оплата при этом остаётся отмеченной: сверка гасит только списание.
        expect(paidFor(doc.payments, 'obligation', 'rent', '2026-09')?.id).toBe('r1')
      }
    })

    it('сдвиг остатка на A (якорь прежний), офлайн-отметка на B раньше — обе суммы уходят', () => {
      // Регрессия: сдвиг с якорем «сейчас» съедал офлайн-отметку партнёра.
      const tA = '2026-09-06T08:00:00Z'
      // Как shiftAccountAmount: A не видит отметку B, база −50 000, якорь не трогаем.
      const shifted: Account = { ...anchored, amount: shiftedBase(anchored, [], -50_000), updatedAt: tA }
      expect(shifted.amount).toBe(950_000)
      const a = withCard(shifted)
      const b = withCard(anchored, [mark('r1', { at: '2026-09-05T10:00:00Z', by: 'b' })])
      for (const doc of both(a, b)) {
        expect(doc.accounts[0].amountSetAt).toBe(T0)
        expect(accountBalance(doc.accounts[0], doc.payments)).toBe(1_000_000 - 50_000 - 220_000)
      }
    })
  })

  describe('коммутативность слияния отметок', () => {
    const tomb = (p: Payment, at: string): Payment => ({ ...p, deletedAt: at, updatedAt: at })
    const sorted = (doc: SyncDoc) => [...(doc.payments ?? [])].sort((x, y) => x.id.localeCompare(y.id))
    const balances = (doc: SyncDoc) => ({
      card: accountBalance(doc.accounts[0], doc.payments),
      loan: creditBalance(doc.credits[0], doc.payments),
    })

    // Общее у обоих до разрыва связи: отметка кредита за сентябрь.
    const loanMark = mark('l1', { kind: 'credit', targetId: 'loan', amount: 58_000, principal: 30_500 })

    it('разные записи, пара с обеих сторон, надгробие на одной — результат не зависит от порядка', () => {
      const a: SyncDoc = {
        ...base,
        payments: [
          mark('ra', { targetId: 'net', amount: 12_000, at: '2026-09-03T09:00:00Z' }),
          mark('x1', { at: '2026-09-05T10:00:00Z' }),
          tomb(loanMark, '2026-09-06T00:00:00Z'),
        ],
      }
      const b: SyncDoc = {
        ...base,
        payments: [
          mark('rb', { targetId: 'gym', amount: 15_000, by: 'b', at: '2026-09-04T09:00:00Z' }),
          mark('x2', { by: 'b', at: '2026-09-05T10:03:00Z' }),
          loanMark,
        ],
      }
      const ab = mergeDocs(a, b)
      const ba = mergeDocs(b, a)
      expect(sorted(ab)).toEqual(sorted(ba))
      expect(sorted(ab).map((p) => p.id)).toEqual(['l1', 'ra', 'rb', 'x1', 'x2'])
      expect(ab.payments?.find((p) => p.id === 'l1')?.deletedAt).toBe('2026-09-06T00:00:00Z')
      // Пара схлопывается в одну аренду; кредит снят — ни тело, ни списание не действуют.
      expect(balances(ab)).toEqual({ card: 1_000_000 - 12_000 - 15_000 - 220_000, loan: 1_000_000 })
      expect(balances(ba)).toEqual(balances(ab))
    })

    it('надгробие на обеих сторонах в разное время — запись мертва, остатки равны в обоих порядках', () => {
      // Время надгробия берётся у local (хвост §4), поэтому toEqual по записям тут не сверяем.
      const a: SyncDoc = { ...base, payments: [tomb(loanMark, '2026-09-06T00:00:00Z'), mark('x1', {})] }
      const b: SyncDoc = { ...base, payments: [tomb(loanMark, '2026-09-07T00:00:00Z'), mark('x1', {})] }
      const ab = mergeDocs(a, b)
      const ba = mergeDocs(b, a)
      for (const doc of [ab, ba]) {
        expect(doc.payments?.find((p) => p.id === 'l1')?.deletedAt).toBeTruthy()
        expect(paidFor(doc.payments, 'credit', 'loan', '2026-09')).toBeNull()
      }
      expect(balances(ab)).toEqual({ card: 780_000, loan: 1_000_000 })
      expect(balances(ba)).toEqual(balances(ab))
    })
  })
})

describe('PV-04: цель с движениями в минус — 0 с обеих сторон слияния', () => {
  const goal = (p: Partial<Goal>): Goal => ({
    id: 'g-1', name: 'Отпуск', need: 1_000_000, seed: 100_000, have: 0, monthly: 50_000, hue: 'teal', planPct: 0,
    updatedAt: '2026-09-21T10:00:00Z', movements: [], ...p,
  })

  it('локально сняли 150 000 из 100 000, у партнёра — взнос 20 000: итог 0 в любом порядке, оба движения на месте', () => {
    const local = goal({ have: 0, movements: [{ id: 'm-out', date: '2026-09-21', amount: -150_000, by: 'a' }] })
    const remote = goal({
      have: 120_000,
      updatedAt: '2026-09-22T10:00:00Z',
      movements: [{ id: 'm-in', date: '2026-09-22', amount: 20_000, by: 'b' }],
    })
    const docA: SyncDoc = { ...createEmptyDoc(), goals: [local] }
    const docB: SyncDoc = { ...createEmptyDoc(), goals: [remote] }
    for (const merged of [mergeDocs(docA, docB), mergeDocs(docB, docA)]) {
      expect(merged.goals[0].have).toBe(0)
      expect(merged.goals[0].movements.map((m) => m.id).sort()).toEqual(['m-in', 'm-out'])
      // Та же формула, что у стора.
      expect(merged.goals[0].have).toBe(goalHave(merged.goals[0].seed, merged.goals[0].movements))
    }
  })
})

describe('PV-14: планы «Сначала долги» при слиянии', () => {
  const T0 = '2026-09-10T05:00:00.000Z'
  const plan = (id: string, p: Partial<DebtPlan> = {}): DebtPlan => ({
    id, status: 'active', by: 'a', startedAt: T0, endedAt: null, keptGoalIds: [], cushionGoalId: null, creditIds: ['cc'],
    months: 24, lump: 0, forecast: { gain: 100_000, savedInterest: 80_000, debtFreeMonth: '2028-03' }, result: null,
    updatedAt: T0, ...p,
  })
  const doc = (plans?: DebtPlan[]): SyncDoc => ({ ...createEmptyDoc(), ...(plans ? { plans } : {}) })
  // Слияние проставляет явное «не удалён» (null) там, где запись была с обеих сторон.
  const byId = (d: SyncDoc) =>
    [...(d.plans ?? [])].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ ...p, deletedAt: p.deletedAt ?? null }))
  const alive = (p: DebtPlan) => ({ ...p, deletedAt: null })

  it('план с одной стороны — у обоих; статус — по последней правке (отмена позже выбора)', () => {
    const chosen = plan('p1')
    const cancelled = plan('p1', { status: 'cancelled', endedAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z' })
    expect(byId(mergeDocs(doc([chosen]), doc([])))).toEqual([alive(chosen)])
    for (const merged of [mergeDocs(doc([chosen]), doc([cancelled])), mergeDocs(doc([cancelled]), doc([chosen]))]) {
      expect(byId(merged)).toEqual([alive(cancelled)])
      expect(activePlan(merged.plans)).toBeNull()
    }
  })

  it('надгробие сильнее правки и не воскресает', () => {
    const tomb = plan('p1', { deletedAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' })
    const edited = plan('p1', { updatedAt: '2026-09-15T00:00:00.000Z' })
    for (const merged of [mergeDocs(doc([tomb]), doc([edited])), mergeDocs(doc([edited]), doc([tomb]))]) {
      expect(merged.plans).toHaveLength(1)
      expect(merged.plans![0].deletedAt).toBe('2026-09-12T00:00:00.000Z')
      expect(activePlan(merged.plans)).toBeNull()
    }
  })

  it('двое выбрали разные планы офлайн — после слияния оба в списке, активный — поздний, в любом порядке', () => {
    const a = doc([plan('pa', { startedAt: '2026-09-10T05:00:00.000Z' })])
    const b = doc([plan('pb', { by: 'b', startedAt: '2026-09-10T06:30:00.000Z' })])
    for (const merged of [mergeDocs(a, b), mergeDocs(b, a)]) {
      expect(byId(merged).map((p) => p.id)).toEqual(['pa', 'pb'])
      expect(activePlan(merged.plans)?.id).toBe('pb')
    }
    const ab = mergeDocs(a, b)
    expect(byId(mergeDocs(ab, b))).toEqual(byId(ab))
  })

  it('документ старого клиента (без ключа plans) не стирает планы — в обе стороны', () => {
    const fresh = doc([plan('p1')])
    const old = doc()
    expect('plans' in old).toBe(false)
    expect(byId(mergeDocs(old, fresh))).toEqual([alive(plan('p1'))])
    expect(byId(mergeDocs(fresh, old))).toEqual([alive(plan('p1'))])
    // Оба без ключа — пустой список, а не undefined: так его и отправит push.
    expect(mergeDocs(old, doc()).plans).toEqual([])
  })
})
