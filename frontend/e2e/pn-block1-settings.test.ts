import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { useFxStore } from '../src/stores/fx'
import { fxYearDelta } from '../src/lib/finance'
import { moneySigned } from '../src/lib/money'
import { FX_BOOK_KEY } from '../src/lib/storage'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import type { Payment, RateBook } from '../src/types/finance'
import AppShell from '../src/components/AppShell.vue'
import Settings from '../src/views/Settings.vue'
import MyCircle from '../src/views/MyCircle.vue'
import Month from '../src/views/Month.vue'
import Money from '../src/views/Money.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

/**
 * Блок 1 «понятность» (PN-01, PN-02): два телефона и viewer на фейковом сервере (`support/family`), понедельник
 * 12 октября 2026 — зарплата Ильяса (10-го) открыта, Аруны (20-го) нет. (а) аватары шапки → Настройки, «С кем» первым,
 * имя — в «Своём кружке»; (б) «Пришла» — у своей открытой строки в «Месяце» и «Капитале», у партнёра и viewer нет,
 * нажатие пишет `Payment kind: 'salary'` за месяц, у партнёра после синка ✓; (в) у валютного оклада в листе зарплаты —
 * строка «евро за год». Нажатия — обработчиками экранов (`screenMixin`), экраны — SSR (`screen`); браузер — на стенде §6.
 */
const KEY = '2026-10'
// Нацбанк (как в `lib/fxDelta.fx.test.ts`): 10.10.2025 — 622,23; 09.10.2026 (пт; 10-е — суббота) — 488,23 → −134 ₸ за евро.
const NB: RateBook = { EUR: { '2025-10-10': 622.23, '2026-03-10': 590, '2026-09-10': 511.4, '2026-10-09': 488.23 } }
/** Сентябрьская зарплата Ильяса пришла на карту — счёт для одного нажатия в октябре (Р-5). */
const september: Payment = { id: 'sal-a-09', kind: 'salary', targetId: 'a', period: '2026-09', amount: 700_000, accountId: 'card', by: 'a', at: '2026-09-10T05:00:00.000Z', updatedAt: T0 }

type Phone = Awaited<ReturnType<typeof phone>>

describe('e2e / понятность Блок 1 — настройки везде, «Пришла» в строке и «за год» в листе', () => {
  const storage = new Map<string, string>()
  let server: FakeServer

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    })
    storage.clear()
    vi.useFakeTimers()
    at('2026-10-12T07:00:00Z')
    server = fakeServer(planFamilyDoc({ payments: [september] }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Телефон участника или viewer: стор семьи с сервера, вход — свой. */
  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs(role, slot))
    return p
  }
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|[  ]/g, ' ').replace(/[ \t\r\n]+/g, ' ')
  /** Разметка строки зарплаты участника — от её `data-salary` до следующей строки или конца карточки. */
  const rowOf = (html: string, slot: 'a' | 'b') => {
    const start = html.indexOf(`data-salary="${slot}"`)
    expect(start, `строка зарплаты ${slot}`).toBeGreaterThan(-1)
    const ends = ['data-salary="', 'data-extra-income', 'data-sections', '</main', 'data-capital-accounts', 'Счета']
      .map((m) => html.indexOf(m, start + 1))
      .filter((i) => i > start)
    return html.slice(start, ends.length ? Math.min(...ends) : undefined)
  }
  const salaries = (p: Phone) => p.store.payments.filter((x) => !x.deletedAt && x.kind === 'salary' && x.period === KEY)

  it('PN-01: аватары на «Мечтах», «Месяце» и «Деньгах» → /settings (свой и партнёра одинаково), на «Неделе» нет; «С кем» первым, имя — в «Своём кружке»; viewer — то же, без «Своего кружка»', async () => {
    const A = await as('member', 'a')
    for (const path of ['/', '/month', '/money']) {
      const html = await screen(A.pinia, AppShell, path)
      expect(html, path).toMatch(/<a[^>]*aria-label="Настройки · Ильяс"[^>]*href="\/settings"|<a[^>]*href="\/settings"[^>]*aria-label="Настройки · Ильяс"/)
      expect(html, path).toMatch(/<a[^>]*aria-label="Настройки · Аруна"[^>]*href="\/settings"|<a[^>]*href="\/settings"[^>]*aria-label="Настройки · Аруна"/)
      expect(html, path).not.toContain('href="/people/')
    }
    expect(await screen(A.pinia, AppShell, '/week')).not.toContain('aria-label="Настройки · ')
    // Шестерёнка — только на «Мечтах» (Р-1: два входа на одном экране).
    expect(await screen(A.pinia, AppShell, '/')).toContain('aria-label="Настройки"')
    expect(await screen(A.pinia, AppShell, '/money')).not.toContain('aria-label="Настройки"')

    const settings = await screen(A.pinia, Settings, '/settings')
    expect(settings.indexOf('С кем')).toBeGreaterThan(-1)
    expect(settings.indexOf('С кем')).toBeLessThan(settings.indexOf('Оформление'))
    expect(settings).not.toContain('Ваше имя')
    expect(settings).toContain('href="/settings/me"')
    const circle = await screen(A.pinia, MyCircle, '/settings/me')
    expect(circle).toContain('aria-label="Имя"')
    expect(circle).toMatch(/<input[^>]*value="Ильяс"/)

    const V = await as('viewer', 'b')
    const home = await screen(V.pinia, AppShell, '/')
    expect(home).toContain('aria-label="Настройки · Ильяс"')
    expect(home).toContain('aria-label="Настройки · Аруна"')
    const vSettings = await screen(V.pinia, Settings, '/settings')
    expect(vSettings.indexOf('С кем')).toBeLessThan(vSettings.indexOf('Оформление'))
    expect(vSettings).not.toContain('/settings/me')
  })

  it('PN-02 (б): «Пришла» у своей открытой строки в «Месяце» и «Капитале»; у партнёра и viewer нет; нажатие — Payment salary за октябрь на счёт прошлого раза, у партнёра после синка ✓', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    const V = await as('viewer', 'b')

    for (const [view, path] of [[Month, '/month'], [Money, '/money']] as const) {
      const a = await screen(on(A).pinia, view, path)
      expect(a, path).toMatch(/data-salary="a" data-can-mark="true"/)
      expect(rowOf(a, 'a'), path).toContain('data-salary-came-btn')
      expect(text(rowOf(a, 'a')), path).toContain('Пришла')
      expect(rowOf(a, 'b'), path).not.toContain('data-salary-came-btn')
      // Партнёр: зарплата Ильяса не его, своя (20-го) ещё не открыта. Viewer — никогда (Р-13).
      const b = await screen(on(B).pinia, view, path)
      expect(b, path).not.toContain('data-salary-came-btn')
      expect(b, path).not.toContain('data-can-mark')
      const v = await screen(on(V).pinia, view, path)
      expect(v, path).not.toContain('data-salary-came-btn')
      expect(v, path).toContain('data-salary="a"')
    }

    // Нажатие «Пришла» в строке «Месяца» — `tap()` composable `useSalaryTap` (та же отметка, что в листе).
    on(A)
    at('2026-10-12T07:01:00Z')
    await screen(A.pinia, Month, '/month', undefined, [screenMixin({}, (s) => (s.tap as () => void)())])
    expect(salaries(A)).toHaveLength(1)
    expect(salaries(A)[0]).toMatchObject({ kind: 'salary', targetId: 'a', period: KEY, amount: 700_000, accountId: 'card', by: 'a' })
    const after = await screen(A.pinia, Month, '/month')
    expect(rowOf(after, 'a')).toContain('data-came')
    expect(rowOf(after, 'a')).not.toContain('data-salary-came-btn')
    expect(rowOf(await screen(A.pinia, Money, '/money'), 'a')).toContain('data-came')
    // Второе нажатие (двойной тап, второй телефон) — той же записью.
    await screen(A.pinia, Month, '/month', undefined, [screenMixin({}, (s) => (s.tap as () => void)())]).catch(() => {})
    expect(salaries(A)).toHaveLength(1)

    await A.store.syncHousehold(A.client)
    await on(B).store.syncHousehold(B.client)
    expect(salaries(B)).toHaveLength(1)
    expect(rowOf(await screen(B.pinia, Month, '/month'), 'a')).toContain('data-came')
  })

  it('PN-02 (в): валютный оклад — в листе зарплаты строка «евро за год −134 ₸» из «Месяца» и «Капитала», нажатие — лист «Курс евро»; у тенгового — нет', async () => {
    // Книга курсов — на устройстве до первого расчёта (стор читает `FX_BOOK_KEY` при создании).
    storage.set(FX_BOOK_KEY, JSON.stringify({ book: NB, covered: {} }))
    const A = await as('member', 'a')
    A.store.amendSalary('a', '2025-10', 1_500, undefined, { currency: 'EUR', rate: 622.23 })
    const ilyas = A.store.people.find((p) => p.id === 'a')!
    expect(fxYearDelta(ilyas, KEY, useFxStore().book)).toMatchObject({ currency: 'EUR', perUnit: -134 })

    const sheet = await screen(A.pinia, Month, '/month', undefined, [screenMixin({ salaryFor: 'a' })])
    expect(sheet).toContain('data-fx-year')
    expect(text(sheet)).toContain(`Евро за год ${moneySigned(-134)}`.replace(/[  ]/g, ' '))
    // Из «Капитала» — тот же лист (`CapitalSalaries.open`).
    const capital = await screen(A.pinia, Money, '/money', undefined, [screenMixin({}, (s) => { void s.lines; s.open = 'a' })])
    expect(capital).toContain('data-fx-year')
    expect(text(capital)).toContain('Евро за год')
    // Нажатие строки — лист курса (`SalarySheet.next('rate')`), заголовок «Курс евро». `year` и `rate` — только у листа
    // зарплаты (у `MarkSheet` строки тоже есть `next`).
    const rate = await screen(A.pinia, Month, '/month', undefined, [
      screenMixin({ salaryFor: 'a' }, (s) => {
        void s.year
        void s.rate
        ;(s.next as (to: string) => void)('rate')
      }),
    ])
    expect(rate).toContain('Курс евро')
    // Тенговый оклад Аруны — строки нет.
    const tenge = await screen(A.pinia, Month, '/month', undefined, [screenMixin({ salaryFor: 'b' })])
    expect(tenge).toContain('data-salary-status')
    expect(tenge).not.toContain('data-fx-year')
    expect(text(tenge)).not.toContain('за год')
  })
})
