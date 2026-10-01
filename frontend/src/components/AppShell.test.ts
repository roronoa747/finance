import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { renderScreen, screenMixin } from '@/test/screenState'
import type { PersonId } from '@/types/finance'
import AppShell from './AppShell.vue'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(role: 'member' | 'viewer' = 'member', slot: PersonId = 'a') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'Ильяс', role, joined_at: T0 },
  })
}

describe('AppShell (B2C-13): шапка, вкладки, лист «+» — SSR', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T08:00:00Z'))
    signIn()
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0 },
    ]
  })

  const title = async (path: string) => {
    const html = await renderScreen(AppShell, path)
    return html.match(/<h1 class="type-h1 truncate text-ink">([^<]*)<\/h1>/)?.[1]
  }

  it.each([
    ['/', 'Мечты'],
    ['/week', 'Неделя'],
    ['/week/salary', 'Разложим'],
    ['/money', 'Деньги'],
    // «Деньги» — один экран с квадратами (пивот 3, Р-31): шапка одна на все три.
    ['/money/plan', 'Деньги'],
    ['/money/history', 'Деньги'],
    ['/goals/x', 'Цель'],
    ['/goals/new', 'Новая мечта'],
    ['/wishes', 'Желания'],
    ['/people/a', 'Желания'],
    ['/settings', 'Настройки'],
  ])('%s → «%s» (DESIGN.md §6)', async (path, expected) => {
    expect(await title(path)).toBe(expected)
  })

  it('главный: подпись «Сентябрь · Ильяс и Дана», аватары обоих, шестерёнка → /settings, «Советника» нет', async () => {
    const html = await renderScreen(AppShell, '/')
    expect(html).toContain('Сентябрь · Ильяс и Дана')
    expect(html).toContain('background:var(--pa)')
    expect(html).toContain('background:var(--pb)')
    // Аватары ведут на список желаний участника (B2C-18).
    expect(html).toContain('href="/people/a"')
    expect(html).toContain('href="/people/b"')
    expect(html).toMatch(/<a[^>]*aria-label="Настройки"[^>]*href="\/settings"|<a[^>]*href="\/settings"[^>]*aria-label="Настройки"/)
    expect(html).not.toContain('Советник')
    expect(html).not.toContain('aria-label="Оформление"')
    // Обмен в покое — шапка чистая (бейдж compact молчит).
    expect(html).not.toContain('Обмен:')
    expect(html).not.toContain('aria-label="Назад"')
  })

  it('шапка по макетам (возврат смоука): «Деньги» — аватары без шестерёнки; «Неделя» — даты в подписи, без аватаров; вложенные — «назад» без аватаров', async () => {
    // Квадраты «Денег» — корни, как сама вкладка (пивот 3): подпись месяца, аватары, без «назад».
    for (const path of ['/money', '/money/plan', '/money/history']) {
      const money = await renderScreen(AppShell, path)
      expect(money).toContain('Сентябрь · Ильяс и Дана')
      expect(money).toContain('href="/people/a"')
      expect(money).not.toContain('aria-label="Настройки"')
      expect(money).not.toContain('aria-label="Назад"')
    }
    const week = await renderScreen(AppShell, '/week')
    expect(week).toContain('14–20 сентября')
    expect(week).not.toContain('href="/people/a"')
    expect(week).not.toContain('aria-label="Настройки"')
    for (const path of ['/goals/new', '/goals/x', '/settings']) {
      const html = await renderScreen(AppShell, path)
      expect(html).toContain('aria-label="Назад"')
      expect(html).not.toContain('href="/people/a"')
      expect(html).not.toContain('aria-label="Настройки"')
    }
    expect(await renderScreen(AppShell, '/settings')).toContain('Ильяс · a@example.com')
    // «Новая мечта» в шапке — без второго заголовка «На что копим?» под ней (он — заголовок шага первого запуска).
    const fresh = await renderScreen(AppShell, '/goals/new')
    expect(fresh).toContain('>Новая мечта</h1>')
    expect(fresh).not.toContain('На что копим?')
  })

  it('вкладки «Мечты · Неделя · Деньги» + «+»: активная — aria-current; экраны-потоки (цель, желания, настройки, раскладка) — без вкладок, как в макетах', async () => {
    const active = async (path: string) => {
      const html = await renderScreen(AppShell, path)
      const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'))
      expect(nav.match(/aria-current="page"/g)).toHaveLength(1)
      return nav.match(/<a aria-current="page" href="([^"]+)"/)?.[1]
    }
    expect(await active('/')).toBe('/')
    expect(await active('/week')).toBe('/week')
    expect(await active('/money/plan')).toBe('/money')
    expect(await active('/money/history')).toBe('/money')
    // Возврат смоука: в макетах g2/g4/g7 у цели, желаний, настроек и раскладки нижней навигации нет — путь назад в шапке.
    for (const path of ['/goals/x', '/people/a', '/wishes', '/settings', '/week/salary']) {
      const html = await renderScreen(AppShell, path)
      expect(html).not.toContain('<nav')
      expect(html).toContain('aria-label="Назад"')
    }
    const html = await renderScreen(AppShell, '/')
    expect(html).toContain('>Мечты</span>')
    expect(html).toContain('>Неделя</span>')
    expect(html).toContain('>Деньги</span>')
    expect(html).toContain('aria-label="Добавить"')
    expect(html).not.toMatch(/Обзор|Бюджет<\/span>|Капитал<\/span>/)
  })

  it('лист «+» на Sheet: шесть действий в порядке §2, «Загрузить выписку» первым; закрытый лист не рендерится', async () => {
    const closed = await renderScreen(AppShell, '/')
    expect(closed).not.toContain('role="dialog"')
    const html = await renderScreen(AppShell, '/', undefined, [screenMixin({ addOpen: true })])
    expect(html).toContain('role="dialog"')
    expect(html).toContain('bg-scrim')
    const order = ['Загрузить выписку', 'Новая мечта', 'Покупка в список желаний', 'Внеплановый доход', 'Обязательство или подписка', 'Кредит или рассрочка']
    const at = order.map((t) => html.indexOf(t))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain('Kaspi или Freedom — траты недели по разделам')
  })

  // Критик Блока 3: у viewer нет ни «+», ни строки желаний — добавить покупку он всё равно не может.
  it('viewer: кнопки «+» нет, лист без действий', async () => {
    setActivePinia(createPinia())
    signIn('viewer', 'b')
    const html = await renderScreen(AppShell, '/', undefined, [screenMixin({ addOpen: true })])
    expect(html).not.toContain('aria-label="Добавить"')
    for (const t of ['Покупка в список желаний', 'Загрузить выписку', 'Новая мечта', 'Внеплановый доход', 'Обязательство или подписка', 'Кредит или рассрочка']) {
      expect(html).not.toContain(t)
    }
  })

  it('одиночка: подпись без «и», один аватар', async () => {
    useFinanceStore().householdDoc.people = [{ id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 }]
    const html = await renderScreen(AppShell, '/')
    expect(html).toContain('Сентябрь · Ильяс')
    expect(html).not.toContain('Сентябрь · Ильяс и')
    expect(html).not.toContain('background:var(--pb)')
  })
})
