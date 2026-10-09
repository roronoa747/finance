import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore, DEMO_TOKEN } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { renderScreen } from '@/test/screenState'
import type { Person, PersonId } from '@/types/finance'
import Settings from './Settings.vue'
import Money from './Money.vue'
import MyCircle from './MyCircle.vue'
import { routes } from '@/router'
import { screenMixin } from '@/test/screenState'

const T0 = '2026-09-01T00:00:00.000Z'

function signIn(role: 'member' | 'viewer' = 'member', slot: PersonId = 'a') {
  useAuthStore().setAuthData({
    token: 't',
    user: { id: `u-${slot}`, email: `${slot}@example.com`, created_at: T0 },
    household: { id: 'h-1', name: 'Наш бюджет', created_by: 'u-a', created_at: T0 },
    member: { household_id: 'h-1', user_id: `u-${slot}`, slot, display_name: 'Ильяс', role, joined_at: T0 },
  })
}

describe('B2C-13: /settings и /money (SSR)', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
    signIn()
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0 },
    ]
  })

  it('Настройки: «Оформление» с темой и именем прямо на экране, «С кем» — участники, свой помечен, состояние обмена', async () => {
    const html = await renderScreen(Settings, '/settings')
    expect(html).toContain('Оформление')
    expect(html).toContain('Авто')
    expect(html).toContain('Светлая')
    expect(html).toContain('Тёмная')
    expect(html).toMatch(/<input[^>]*value="Ильяс"/)
    expect(html).toContain('С кем')
    expect(html).toContain('вы · участник')
    expect(html).toContain('Дана')
    expect(html).toContain('Обмен между телефонами')
    expect(html).toContain('синхронизировано')
    expect(html).toContain('Выйти из аккаунта')
    // Напоминание — Блок 5: секции нет. Удаление аккаунта (B2C-25) — после выхода.
    expect(html).not.toContain('Напоминание')
    expect(html.indexOf('Выйти из аккаунта')).toBeLessThan(html.indexOf('Удалить аккаунт и данные'))
    // Возврат смоука (g7, правило 12): порядок «Оформление» → «С кем» → выход; разбор выписок — свёрнут
    // (<details> без open), выход — своей карточкой после «С кем». «Цвета разделов» сняты (клинап Б9, Р-33).
    expect(html.indexOf('Оформление')).toBeLessThan(html.indexOf('С кем'))
    expect(html.indexOf('С кем')).toBeLessThan(html.indexOf('Выйти из аккаунта'))
    expect(html).not.toContain('<details open')
    expect(html).not.toContain('Цвета разделов')
    const parse = html.slice(html.lastIndexOf('<details', html.indexOf('Разбор трат')), html.indexOf('Разбор трат'))
    expect(parse).toContain('<summary')
  })

  it('viewer: «вы · только просмотр»', async () => {
    setActivePinia(createPinia())
    signIn('viewer', 'b')
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0 },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0 },
    ]
    const html = await renderScreen(Settings, '/settings')
    expect(html).toContain('вы · только просмотр')
  })

  it('возврат приёмки п. 8: одиночке «Пригласить партнёра» прямо в «С кем»; семье из двух и viewer — нет', async () => {
    const solo = () => {
      useFinanceStore().householdDoc.people = [{ id: 'a', name: 'Асель', salary: 400_000, payday: 5, updatedAt: T0 }]
    }
    // Семья из двух (beforeEach) — приглашать некого.
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')

    solo()
    const html = await renderScreen(Settings, '/settings')
    const withWhom = html.slice(html.indexOf('С кем'))
    expect(withWhom).toContain('Пригласить партнёра')
    expect(withWhom).toContain('Создать код')

    setActivePinia(createPinia())
    signIn('viewer', 'a')
    solo()
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')

    // Демо: сервера нет — код не создаётся (иначе запрос к /api; критик возврата).
    setActivePinia(createPinia())
    useAuthStore().setAuthData({
      token: DEMO_TOKEN,
      user: { id: 'demo-user-1', email: 'demo@family.local', created_at: T0 },
      household: { id: 'demo-household-1', name: 'Демо Семья', created_by: 'demo-user-1', created_at: T0 },
      member: { household_id: 'demo-household-1', user_id: 'demo-user-1', slot: 'a', display_name: 'Вы', role: 'member', joined_at: T0 },
    })
    solo()
    expect(await renderScreen(Settings, '/settings')).not.toContain('Пригласить партнёра')
  })

  it('«Деньги» (пивот 3): три чипа Капитал · Долги · История вместо входов второго уровня', async () => {
    const html = await renderScreen(Money, '/money')
    // Чипы — кнопки с одним словом, без чисел и подписей (Р-116).
    for (const t of ['Капитал', 'Долги', 'История']) expect(html).toMatch(new RegExp(`>\\s*${t}\\s*</button>`))
    expect(html).not.toContain('План «Сначала долги»')
  })
})

describe('B2C-63: свой кружок — смайлик и цвет', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
  })
  const family = (a: Partial<Person> = {}, b: Partial<Person> = {}) => {
    useFinanceStore().householdDoc.people = [
      { id: 'a', name: 'Ильяс', salary: 700_000, payday: 10, updatedAt: T0, ...a },
      { id: 'b', name: 'Дана', salary: 500_000, payday: 20, updatedAt: T0, ...b },
    ]
  }
  /** Кружки участников в HTML: фон и содержимое. */
  const circles = (html: string) => [...html.matchAll(/<span class="grid shrink-0 place-items-center rounded-full[^"]*"[^>]*style="background:([^;"]+);?"[^>]*>\s*([^<]*?)\s*<\/span>/g)].map((m) => [m[1].trim(), m[2]])

  it('без выбора — буква на цвете слота, как было; смайлик и цвет — вместо буквы, у партнёра тоже', async () => {
    signIn()
    family()
    expect(circles(await renderScreen(Settings, '/settings'))).toEqual([['var(--pa)', 'И'], ['var(--pb)', 'Д']])
    family({ emoji: '🦊', color: 's8' }, { emoji: '🐻' })
    expect(circles(await renderScreen(Settings, '/settings'))).toEqual([['var(--s8)', '🦊'], ['var(--pb)', '🐻']])
  })

  it('своя строка ведёт в «Свой кружок», чужая — нет; viewer — без перехода, маршрут только member', async () => {
    signIn()
    family()
    let html = await renderScreen(Settings, '/settings')
    expect(html.match(/href="\/settings\/me"/g)).toHaveLength(1)
    expect(html.slice(html.indexOf('href="/settings/me"'), html.indexOf('</a>', html.indexOf('href="/settings/me"')))).toContain('Ильяс')
    setActivePinia(createPinia())
    signIn('viewer')
    family()
    html = await renderScreen(Settings, '/settings')
    expect(html).not.toContain('/settings/me')
    const shell = routes.find((r) => r.children?.some((c) => c.name === 'my-circle'))
    expect(shell?.children?.find((c) => c.name === 'my-circle')?.meta).toMatchObject({ memberOnly: true })
  })

  it('экран: большой кружок, буква + 11 смайликов, 6 цветов; выбранное — aria-pressed; выбор пишется сразу', async () => {
    signIn('member', 'b')
    family({}, { emoji: '🌙' })
    const html = await renderScreen(MyCircle, '/settings/me')
    expect(html).toContain('size-24')
    expect(html.match(/aria-label="Буква Д"/g)).toHaveLength(1)
    const emoji = [...html.matchAll(/<button[^>]*aria-pressed="(true|false)"[^>]*aria-label="([^"]+)"/g)].map((m) => [m[2], m[1]])
    expect(emoji.filter(([l]) => !l.startsWith('Цвет'))).toHaveLength(12)
    expect(emoji.filter(([, on]) => on === 'true').map(([l]) => l)).toEqual(['🌙', 'Цвет 2'])
    expect(emoji.filter(([l]) => l.startsWith('Цвет'))).toHaveLength(6)
    // Выбор — сразу в документ своего участника (как имя), чужой не трогается.
    await renderScreen(MyCircle, '/settings/me', undefined, [screenMixin({}, (s) => (s.set as (p: object) => void)({ color: 's3' }))])
    const [a, b] = useFinanceStore().householdDoc.people
    expect(b.color).toBe('s3')
    expect(b.emoji).toBe('🌙')
    expect(a.color).toBeUndefined()
  })
})
