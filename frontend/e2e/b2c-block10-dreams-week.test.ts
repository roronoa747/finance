import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick, type ComponentOptions } from 'vue'
import type { ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { assignIds, spendTotals } from '../src/lib/statements/model'
import { plannedElsewhere } from '../src/lib/statements/dictionary'
import type { Operation, ParsedStatement, SpendTotal } from '../src/lib/statements/types'
import { money } from '../src/lib/money'
import { weekKey, weekRange, weekRangeLabel } from '../src/lib/dates'
import { freeByFact, spendRows, type Decision } from '../src/lib/finance'
import { planFamilyDoc } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Access from '../src/views/Access.vue'
import Dreams from '../src/views/Dreams.vue'
import Money from '../src/views/Money.vue'
import Month from '../src/views/Month.vue'
import Week from '../src/views/Week.vue'
import { at, backend, fakeServer, fakeStatements, screen, statementsFor, type FakeServer, type FakeStatements } from './support/family'

/**
 * Приёмка Блока 10 (пивот 3, «Мечты и Неделя»): два телефона на фейковом сервере. Часть 1 — «Свободно» =
 * `freeByFact` (B2C-108, Р-116: переехало с «Мечт» в подсказку у «Остаётся» в «План · Месяц»), недельного на «Мечтах»
 * нет; часть 2 — одна очередь «Недели»: ответ на продавца у A → итоги и «Свободно» у B пересчитались, «N из M»
 * растёт; часть 3 — «Свободно» одно (на «Деньгах» слова нет); часть 4 — viewer без решений и загрузки; часть 5 —
 * демо: итоги недели из демо-операций той же функцией, что разбор. Нажатия — обработчиками компонентов (`screenMixin`).
 */
type Phone = { pinia: Pinia; client: ApiClient; store: ReturnType<typeof useFinanceStore> }

async function phone(server: FakeServer, st: FakeStatements, slot: 'a' | 'b', role: 'member' | 'viewer' = 'member'): Promise<Phone> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const user = role === 'viewer' ? `u-v` : `u-${slot}`
  useAuthStore().setAuthData({
    token: `t-${user}`, user: { id: user, email: `${user}@family.kz`, created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: user, slot, display_name: slot, role, joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(st, user, slot) } as unknown as ApiClient
  const store = useFinanceStore()
  store.claimFor('h-family')
  await store.pullHousehold(client)
  const ops = useOperationsStore()
  await ops.loadUploads(client)
  await ops.pull(client)
  return { pinia, client, store }
}

async function sync(from: Phone, to: Phone) {
  setActivePinia(from.pinia)
  await from.store.syncHousehold(from.client)
  setActivePinia(to.pinia)
  await to.store.pullHousehold(to.client)
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
const op = (date: string, amount: number, merchant: string, categoryId: string | null = null): Omit<Operation, 'id'> => ({
  bank: 'kaspi', date, amount, kind: 'purchase', merchant, categoryId, internal: false,
})

/** Выписка A за сентябрь: продукты, кафе и два незнакомых продавца на этой неделе (21–27 сентября). */
async function uploadA(A: Phone) {
  const parsed: ParsedStatement = {
    bank: 'kaspi', from: '2026-09-01', to: '2026-09-24', skipped: 0,
    operations: assignIds([
      op('2026-09-15', -30_000, 'Magnum', 'sc_food'),
      op('2026-09-22', -18_000, 'Magnum', 'sc_food'),
      op('2026-09-23', -6_000, 'Coffee Boom', 'sc_cafe'),
      op('2026-09-23', -12_000, 'ТОО Непонятное'),
      op('2026-09-24', -4_000, 'ИП Жансая'),
    ]),
  }
  setActivePinia(A.pinia)
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'выписка.pdf', parsed }])
  await ops.send(A.client)
  await A.store.syncHousehold(A.client)
  return ops
}

const fact = (p: Phone) => {
  setActivePinia(p.pinia)
  const ops = useOperationsStore()
  return freeByFact({ ...p.store.householdDoc, credits: p.store.credits }, p.store.householdDoc.spendTotals ?? [], p.store.householdDoc.spendCategories ?? [], '2026-09', ops.uploads)
}

/** «Неделя» с открытым листом вопросов (Блок 15, Р-97). */
const sheetOpen = () => [screenMixin({ questionsOpen: true })]

/** Нажатый «?» подсказки `kit/Hint` с этой подписью: текст подсказки в SSR — только у открытой. */
const openHint = (label: string): ComponentOptions => ({
  created() {
    const s = this.$.setupState as Record<string, unknown>
    if ('at' in s && this.$.props.label === label) s.at = { left: 0, top: 0, width: 280 }
  },
})
/** «План · Месяц» с открытой подсказкой у «Остаётся» — там «Свободно» по выпискам и дни до зарплаты (B2C-108). */
const restHint = async (p: Phone) => text(await screen(p.pinia, Month, '/month', undefined, [openHint('Остаётся')]))

describe('e2e / B2C Блок 10 — «Мечты и Неделя» на двух телефонах', () => {
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
    at('2026-09-24T07:00:00Z') // четверг 24 сентября: неделя 21–27, до зарплаты Ильяса (10-го) — 16 дней
    server = fakeServer(planFamilyDoc())
    st = fakeStatements()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('часть 1 — «Свободно» = freeByFact у обоих (подсказка «Остаётся» в «Месяце»); на «Мечтах» ни его, ни недельного', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    for (const p of [A, B]) {
      const html = text(await screen(p.pinia, Dreams, '/'))
      const free = fact(p)
      expect(free.byFact).toBe(true)
      expect(await restHint(p)).toContain(`Свободно по выпискам — ${text(money(free.amount))}`)
      for (const w of ['Свободно', weekRangeLabel(weekRange(weekKey())), 'Без раздела', 'Загрузить выписку', 'Пришла зарплата', 'Не разобрано']) expect(html).not.toContain(w)
    }
  })

  it('часть 2 — очередь: одно решение за раз, ответ из пачки продавцов у A, итоги и «Свободно» у B пересчитались', async () => {
    const A = await phone(server, st, 'a')
    const ops = await uploadA(A)
    const B = await phone(server, st, 'b')
    const before = fact(B).amount

    const html = await screen(A.pinia, Week, '/week', undefined, sheetOpen())
    // Блок 12 (Р-58): оба продавца — одной пачкой, одно решение.
    expect(text(html)).toContain('Без раздела · 2')
    expect(html.match(/<h2 class="type-h2 text-ink">/g)).toHaveLength(1)
    expect(text(html)).toContain('ТОО Непонятное')

    // Ответ чипом «Подписки»: в пачке остался второй продавец. Подписки такой в плане нет, строка не отмечена —
    // «Свободно» её по-прежнему вычитает (мелочи ML-03, хвост 952).
    let after = ''
    const answered = await screen(A.pinia, Week, '/week', undefined, [
      screenMixin({ questionsOpen: true }, (s) => {
        const d = s.decision as Decision
        const g = d.groups!.find((x) => x.label === 'ТОО Непонятное')!
        ;(s.answerBatch as (m: unknown[], to: unknown) => void)([g.match], { categoryId: 'sc_subscriptions' })
      }),
    ])
    after = text(answered)
    expect(after).toContain('Без раздела · 1')
    expect(after).toContain('ИП Жансая')
    expect(after).not.toContain('ТОО Непонятное')
    await vi.runOnlyPendingTimersAsync()
    await ops.flush(A.client)

    await sync(A, B)
    const week = (B.store.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === '2026-W39' && t.amount > 0)
    expect(week.find((t) => t.categoryId === 'sc_subscriptions')?.amount).toBe(12_000)
    expect(week.find((t) => t.categoryId === '_unknown')?.amount).toBe(4_000)
    expect(fact(B).amount).toBe(before)
    expect(await restHint(B)).toContain(`Свободно по выпискам — ${text(money(before))}`)
    // Блок 15 (Р-95): «Неделя» — только свои траты: на телефоне B цифр Ильяса нет — ни 4 000, ни 12 000; у него только ✓.
    const weekB = await screen(B.pinia, Week, '/week', undefined, sheetOpen())
    expect(text(weekB)).not.toContain(text(money(4_000)))
    expect(text(weekB)).not.toContain('12 000')
    expect(weekB).toMatch(/data-uploaded="true" data-partner="a"/)
  })

  it('часть 3 — «Свободно» одно: на «Деньгах» и «Мечтах» слова нет, с числом — только в подсказке «Месяца»', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    setActivePinia(A.pinia)
    // Блок 15 (Р-91): сводки «До зарплаты» и виджета «Доход» на «Деньгах» нет — слова «свободно» там по-прежнему нет.
    const money_ = text(await screen(A.pinia, Money, '/money'))
    expect(money_.toLowerCase()).not.toContain('свободно')
    // Слово с числом — только в подсказке у «Остаётся» в «Месяце» (B2C-108); на «Мечтах» строки нет.
    expect(text(await screen(A.pinia, Dreams, '/'))).not.toContain('Свободно')
    expect(await restHint(A)).toContain(`Свободно по выпискам — ${text(money(fact(A).amount))}`)
  })

  it('часть 4 — viewer: «Мечты» и «Неделя» без решений, загрузки и брендовых кнопок; картина недели видна', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const V = await phone(server, st, 'b', 'viewer')
    const week = await screen(V.pinia, Week, '/week', undefined, sheetOpen())
    expect(text(week)).toContain(weekRangeLabel(weekRange(weekKey())))
    for (const w of ['Без раздела', 'Загрузить выписку', 'из 2']) expect(text(week)).not.toContain(w)
    expect(week).not.toContain('type-h2')
    expect(week).not.toContain('bg-brand text-brand-ink')
    const dreams = text(await screen(V.pinia, Dreams, '/'))
    for (const w of ['Без раздела', 'Загрузить выписку', '+ Новая', 'Добавить фото']) expect(dreams).not.toContain(w)
  })

  it('часть 5 — демо: итоги недели участника a = spendTotals демо-операций; сумма недели = операции + итоги партнёра; три вопроса за «!»; «Мечты» — 2 цели и 3 желания', async () => {
    const pinia = createPinia()
    await screen(pinia, Access, '/access', undefined, [screenMixin({}, (s) => (s.startDemoMode as () => void)())])
    await nextTick()
    setActivePinia(pinia)
    const finance = useFinanceStore()
    const ops = useOperationsStore()
    const week = weekKey()
    const mine = (finance.householdDoc.spendTotals ?? []).filter((t) => t.by === 'a' && t.kind === 'week' && t.period === week && t.amount > 0)
    const strip = (list: SpendTotal[]) => list.map(({ categoryId, amount }) => ({ categoryId, amount }))
    expect(strip(mine)).toEqual(strip(spendTotals(ops.all, 'a', 'week', week)))
    const pic = { ...spendRows(finance.householdDoc.spendTotals ?? [], finance.householdDoc.spendCategories ?? [], { kind: 'week', period: week }), range: weekRange(week) }
    const opsWeek = ops.all.filter((o) => !o.internal && o.amount < 0 && weekKey(o.date) === week).reduce((a, o) => a - o.amount, 0)
    const aruna = (finance.householdDoc.spendTotals ?? []).filter((t) => t.by === 'b' && t.kind === 'week' && t.period === week).reduce((a, t) => a + t.amount, 0)
    expect(pic.total).toBe(opsWeek + aruna)
    let kinds: string[] = []
    const html = text(
      await screen(pinia, Week, '/week', undefined, [screenMixin({ questionsOpen: true }, (s) => (kinds = (s.queue as Decision[]).map((d) => d.kind)))]),
    )
    // Блок 15 (Р-95): на «Неделе» — сумма только своих трат недели, без итогов Аруны и без платежей (подписки, связь — Р-94).
    const own = mine.filter((t) => !plannedElsewhere(t.categoryId, finance.householdDoc.spendCategories ?? [])).reduce((a, t) => a + t.amount, 0)
    expect(html).toContain(`${weekRangeLabel(pic.range)} ${text(money(own))}`)
    expect(html).not.toContain(text(money(pic.total)))
    // Пришедшая зарплата Ильяса — дело «Месяца» (Блок 15, Р-97). За «!» — три вопроса по одному (B2C-98):
    // платёж «Яндекс Плюс» из выписки, пачка незнакомых продавцов, «Оставить Spotify?».
    expect(html).not.toContain('Пришла зарплата')
    expect(kinds.slice(0, 3)).toEqual(['match', 'unknownBatch', 'keep'])
    expect(html).toContain('Похоже, это платёж по Яндекс Плюс')
    // «История» демо — те же операции недели.
    expect(text(await screen(pinia, Money, '/money/history'))).toContain('ИП Абенова')
    // «Мечты» демо «как в макете» (приёмка Б10): главная, 2 цели, желания обоих и общее.
    const dreams = text(await screen(pinia, Dreams, '/'))
    for (const w of ['Поездка в Японию', 'Машина', 'Новый диван', 'Все 3', 'общие', 'Вы', 'Партнёр']) expect(dreams).toContain(w)
    expect(dreams).not.toContain('+ Желание')
  })

  // Приёмка Блока 10: правило 12 на каждом шаге очереди и «Свободно» на стыке месяцев — на двух телефонах.
  const brands = (html: string) => (html.match(/bg-brand text-brand-ink/g) ?? []).length

  it('приёмка — «Неделя»: не больше одной брендовой кнопки на каждом шаге; B без своей выписки — одна «Загрузить»', async () => {
    const A = await phone(server, st, 'a')
    const ops = await uploadA(A)
    const B = await phone(server, st, 'b')
    const b = await screen(B.pinia, Week, '/week', undefined, sheetOpen())
    expect(brands(b)).toBe(1)
    expect(b).toContain('data-upload="lead"')

    // A: пачка продавцов — чипы без брендовой; после ответа обоим решений нет, своя выписка есть — загрузки нет.
    const answer = screenMixin({}, (s) => {
      const d = s.decision as Decision
      ;(s.answerBatch as (m: unknown[], to: unknown) => void)([d.groups![0].match], { categoryId: 'sc_food' })
    })
    expect(brands(await screen(A.pinia, Week, '/week', undefined, sheetOpen()))).toBeLessThanOrEqual(1)
    const one = await screen(A.pinia, Week, '/week', undefined, [screenMixin({ questionsOpen: true }), answer])
    expect(text(one)).toContain('Без раздела · 1')
    expect(brands(one)).toBeLessThanOrEqual(1)
    // Ответ первого рендера отправлен; второго продавца — тем же ответом стора, с ожиданием записи.
    await vi.runOnlyPendingTimersAsync()
    await ops.flush(A.client)
    let last: Parameters<typeof ops.recategorize>[0] | undefined
    await screen(A.pinia, Week, '/week', undefined, [screenMixin({ questionsOpen: true }, (s) => (last = (s.decision as Decision).groups![0].match))])
    setActivePinia(A.pinia)
    await ops.recategorize(last!, { categoryId: 'sc_food' }, A.client)
    const done = await screen(A.pinia, Week, '/week', undefined, sheetOpen())
    expect(text(done)).not.toContain('Без раздела')
    expect(text(done)).not.toContain('Загрузить выписку')
    expect(brands(done)).toBe(0)
  })

  it('приёмка — 1 октября с выписками только за сентябрь: в подсказке «Месяца» «Свободно» нет у обоих, «до зарплаты» есть', async () => {
    const A = await phone(server, st, 'a')
    await uploadA(A)
    const B = await phone(server, st, 'b')
    at('2026-10-01T07:00:00Z')
    for (const p of [A, B]) {
      const html = await restHint(p)
      expect(html).not.toContain('Свободно')
      expect(html).toMatch(/До зарплаты \d+ (день|дня|дней)/)
    }
  })
})
