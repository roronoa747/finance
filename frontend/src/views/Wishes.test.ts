import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import type { SyncDoc, WishItem } from '@/types/finance'
import { budgetAmounts } from '@/lib/finance'
import { money, plain } from '@/lib/money'
import { addMonths, monthIn } from '@/lib/dates'
import { GOAL_TYPES, TRAVEL_DIRECTIONS, templateById } from '@/lib/goalTemplates'
import { T0, authAs, planFamilyDoc } from '@/test/planFamily'
import { renderScreen, screenMixin } from '@/test/screenState'
import Wishes from './Wishes.vue'
import GoalNew from './GoalNew.vue'

/**
 * B2C-18: желания по людям и сюрпризы (`Wishes.vue`), «Новая мечта» (`GoalNew.vue`) — SSR на
 * семье плана (`planFamily`). Сюрприз живёт в личном документе автора: у адресата его нет.
 */
const wish = (w: Partial<WishItem> & Pick<WishItem, 'id' | 'name' | 'price'>): WishItem => ({
  by: 'a', addedOn: '2026-09-10T06:00:00.000Z', bought: false, updatedAt: T0, ...w,
})

function family(role: 'member' | 'viewer' = 'member', slot: 'a' | 'b' = 'a', extra: Partial<SyncDoc> = {}) {
  useAuthStore().setAuthData(authAs(role, slot))
  const store = useFinanceStore()
  store.setHouseholdDoc(planFamilyDoc(extra), 1)
  return store
}

/** Нажатая кнопка `Segmented` / `Chip` с подписью. */
const pressed = (html: string, label: string) => new RegExp(`<button[^>]*aria-pressed="true"[^>]*>(?:\\s|<!---->)*${label}(?:\\s|<!---->)*<`).test(html)
/** Выключенная кнопка с подписью (в кнопке может быть иконка). */
const disabled = (html: string, label: string) => new RegExp(`<button[^>]*\\sdisabled(?=[\\s>])[^>]*>(?:(?!</button>)[\\s\\S])*?${label}`).test(html)

const storage = new Map<string, string>()
function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, String(v)),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  })
  storage.clear()
}

describe('views/Wishes.vue — желания по людям и сюрпризы (B2C-18, SSR)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const list = () => [
    wish({ id: 'pan', name: 'Сковорода', price: 18_000 }), // запись до Блока 3 — список по добавившему
    wish({ id: 'kettle', name: 'Чайник', price: 12_000, by: 'b' }),
    wish({ id: 'lamp', name: 'Лампа', price: 9_000, by: 'a', list: 'b' }), // Ильяс добавил в список Аруны
    wish({ id: 'sofa', name: 'Диван', price: 250_000, by: 'b', list: 'all' }),
    wish({ id: 'vac', name: 'Пылесос', price: 180_000, by: 'b', bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
  ]

  it('/wishes — «Общие»: весь список семьи, вкладки участников и «Общие», итог «Уже купили», сюрпризов нет', async () => {
    family('member', 'a', { wishlist: list() })
    const html = await renderScreen(Wishes, '/wishes')
    for (const n of ['Сковорода', 'Чайник', 'Лампа', 'Диван', 'Пылесос']) expect(html).toContain(n)
    expect(pressed(html, 'Общие')).toBe(true)
    expect(pressed(html, 'Ильяс')).toBe(false)
    expect(html).toContain(money(180_000))
    expect(html).not.toContain('Сюрпризы для')
  })

  it('/people/b — список Аруны: её записи и добавленные в её список, чужих нет; «Сюрпризы для Аруна» видит автор, себе — нет', async () => {
    const store = family('member', 'a', { wishlist: list() })
    store.addGift({ forSlot: 'b', name: 'Наушники', price: 90_000 })
    const html = await renderScreen(Wishes, '/people/b')
    expect(pressed(html, 'Аруна')).toBe(true)
    expect(html).toContain('Чайник')
    expect(html).toContain('Лампа')
    expect(html).toContain('Пылесос')
    expect(html).not.toContain('Сковорода')
    expect(html).not.toContain('Диван')
    expect(html).toContain('Сюрпризы для Аруна')
    expect(html).toContain('Видно только вам')
    expect(html).toContain('Наушники')
    expect(html).toContain(plain(90_000))
    expect(html).toContain('aria-label="Сюрприз куплен"')
    expect(html).toContain('Сюрприз')

    const own = await renderScreen(Wishes, '/people/a')
    expect(pressed(own, 'Ильяс')).toBe(true)
    expect(own).toContain('Сковорода')
    expect(own).not.toContain('Лампа')
    expect(own).not.toContain('Сюрпризы для')
    expect(own).not.toContain('Наушники')
  })

  it('адресат: в его личном документе сюрприза нет — на своей вкладке ничего, на вкладке автора — пустой раздел', async () => {
    const author = family('member', 'a', { wishlist: list() })
    author.addGift({ forSlot: 'b', name: 'Наушники', price: 90_000 })
    expect(author.gifts).toHaveLength(1)
    // Сюрприз — только в личном документе: в общем его имени нет (критик Блока 3).
    expect(JSON.stringify(author.householdDoc)).not.toContain('Наушники')
    expect(JSON.stringify(author.privateDoc)).toContain('Наушники')
    // Телефон Аруны — другое устройство: общий документ тот же, личный — свой.
    stubStorage()
    setActivePinia(createPinia())
    family('member', 'b', { wishlist: list() })
    expect(useFinanceStore().gifts).toEqual([])
    const mine = await renderScreen(Wishes, '/people/b')
    expect(mine).not.toContain('Наушники')
    expect(mine).not.toContain('Сюрпризы для')
    const his = await renderScreen(Wishes, '/people/a')
    expect(his).toContain('Сюрпризы для Ильяс')
    expect(his).toContain('Пока ни одного сюрприза')
    expect(his).not.toContain('Наушники')
  })

  it('viewer: списки видны, ни форм, ни сюрпризов, ни «Добавить покупку»', async () => {
    family('viewer', 'a', { wishlist: list() })
    const html = await renderScreen(Wishes, '/people/b', undefined, [screenMixin({ editWishId: 'kettle', openWishModal: true })])
    expect(html).toContain('Чайник')
    expect(html).not.toContain('Сюрпризы для')
    expect(html).not.toContain('Добавить покупку')
    expect(html).not.toContain('role="dialog"')
    expect(html).not.toContain('<input')
  })

  it('добавить на вкладке участника — в его список от своего имени, без «Кто добавил»; на «Общие» — с выбором', async () => {
    const store = family('member', 'a', { wishlist: [] })
    const sheet = await renderScreen(Wishes, '/people/b', undefined, [screenMixin({ openWishModal: true })])
    expect(sheet).toContain('Покупка в дом')
    expect(sheet).not.toContain('aria-label="Кто добавил"')
    await renderScreen(Wishes, '/people/b', undefined, [
      screenMixin({ wishName: 'Плед', wishPrice: '9 000', wishBy: 'b' }, (s) => (s.createWish as () => void)()),
    ])
    expect(store.wishlist[0]).toMatchObject({ name: 'Плед', price: 9_000, by: 'a', list: 'b' })
    expect(await renderScreen(Wishes, '/people/b')).toContain('Плед')
    expect(await renderScreen(Wishes, '/people/a')).not.toContain('Плед')
    expect(await renderScreen(Wishes, '/wishes')).toContain('Плед')

    const shared = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ openWishModal: true })])
    expect(shared).toContain('aria-label="Кто добавил"')
    await renderScreen(Wishes, '/wishes', undefined, [
      screenMixin({ wishName: 'Полка', wishPrice: '4 000', wishBy: 'b' }, (s) => (s.createWish as () => void)()),
    ])
    expect(store.wishlist[0]).toMatchObject({ name: 'Полка', by: 'b', list: 'all' })
  })
})

describe('views/GoalNew.vue — «Новая мечта» (B2C-18, SSR)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
    // Картинка шаблона грузится после создания — здесь сети нет.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('шаг «На что копим?»: пять типов с картинками Unsplash, «Своё фото», «Дальше» выключена до выбора, «Пока без мечты»', async () => {
    family()
    const html = await renderScreen(GoalNew, '/goals/new')
    expect(html).toContain('На что копим?')
    for (const k of GOAL_TYPES) expect(html).toContain(k.name)
    expect(html).toContain('Своё фото')
    expect((html.match(/images\.unsplash\.com\//g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(disabled(html, 'Дальше')).toBe(true)
    expect(html).toContain('Пока без мечты')
    expect(html).not.toContain('Куда')
  })

  it('«Путешествие» — направления чипами; выбранная Япония отмечена, «Дальше» доступна', async () => {
    family()
    const html = await renderScreen(GoalNew, '/goals/new', undefined, [screenMixin({ pickedType: 'travel', template: templateById('japan') })])
    expect(html).toContain('Куда')
    for (const d of TRAVEL_DIRECTIONS) expect(html).toContain(d.name)
    expect(pressed(html, 'Япония')).toBe(true)
    expect(pressed(html, 'Турция')).toBe(false)
    expect(disabled(html, 'Дальше')).toBe(false)
  })

  it('шаг «Сумма и срок»: взнос считается, «реально» при свободных плана, «будет вашей в …»; свой срок — числом', async () => {
    const store = family()
    const free = budgetAmounts({ ...store.householdDoc, credits: store.credits }).d5
    expect(free).toBeGreaterThanOrEqual(150_000)
    const html = await renderScreen(GoalNew, '/goals/new', undefined, [
      screenMixin({ step: 'form', template: templateById('japan'), name: 'Япония', needText: '1 800 000', term: '12' }),
    ])
    expect(html).toContain('value="Япония"')
    expect(html).toContain(`По ${money(150_000)} в месяц`)
    expect(html).toContain('реально')
    expect(html).toContain(`при свободных ≈ ${money(free)}`)
    expect(html).toContain(`будет вашей в ${monthIn(addMonths('2026-09', 11))}`)
    expect(html).toContain('Путешествие · Япония')
    expect(html).toContain('Matthew Skinner')
    expect(html).toContain('Готово — к мечте')

    const custom = await renderScreen(GoalNew, '/goals/new', undefined, [
      screenMixin({ step: 'form', template: templateById('japan'), name: 'Япония', needText: '1 800 000', term: 'custom', customMonths: '24' }),
    ])
    expect(custom).toContain(`По ${money(75_000)} в месяц`)
    expect(custom).toContain(`будет вашей в ${monthIn(addMonths('2026-09', 23))}`)
  })

  it('«Готово — к мечте»: цель со взносом, шаблоном и цветом шаблона; у семьи с целями — не главная, первая цель семьи — главная', async () => {
    const store = family()
    await renderScreen(GoalNew, '/goals/new', undefined, [
      screenMixin({ step: 'form', template: templateById('japan'), name: 'Япония', needText: '1 800 000', term: '12' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    const goal = store.goals.find((g) => g.name === 'Япония')!
    expect(goal).toMatchObject({ need: 1_800_000, have: 0, monthly: 150_000, hue: 'plum', template: 'japan' })
    expect(goal.main).toBeUndefined()

    stubStorage()
    setActivePinia(createPinia())
    const fresh = family('member', 'a', { goals: [] })
    await renderScreen(GoalNew, '/goals/new', undefined, [
      screenMixin({ step: 'form', template: templateById('car'), name: 'Машина', needText: '3 000 000', term: '18' }, (s) => void (s.create as () => Promise<void>)()),
    ])
    expect(fresh.goals[0]).toMatchObject({ name: 'Машина', main: true, template: 'car', hue: 'steel', monthly: 166_667 })
  })

  it('viewer: «Готово — к мечте» выключена', async () => {
    family('viewer')
    const html = await renderScreen(GoalNew, '/goals/new', undefined, [
      screenMixin({ step: 'form', template: templateById('japan'), name: 'Япония', needText: '1 800 000' }),
    ])
    expect(disabled(html, 'Готово — к мечте')).toBe(true)
  })
})

describe('views/Wishes.vue — фото желаний (Р-9, B2C-18, SSR)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('строка с фото — место под картинку; окно покупки — чип «Фото» и выбор файла; viewer — без них; в демо чипа нет', async () => {
    const store = family('member', 'a', { wishlist: [wish({ id: 'lamp', name: 'Лампа', price: 9_000, photoId: 'ph-1' }), wish({ id: 'pan', name: 'Сковорода', price: 18_000 })] })
    const html = await renderScreen(Wishes, '/wishes')
    expect((html.match(/data-photo/g) ?? []).length).toBe(1)
    const sheet = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ openWishModal: true })])
    expect(sheet).toContain('>Фото</span>')
    expect(sheet).toContain('accept="image/*"')
    // Правка (владелец 2026-09-28: кнопки не больше фото): фото крупно, «Сменить» и «Убрать» —
    // маленькие иконки в углах, без чипов-надписей; без фото — пунктирная плитка «Фото».
    const edit = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'lamp' })])
    expect(edit).toContain('aria-label="Сменить фото"')
    expect(edit).toContain('aria-label="Убрать фото"')
    expect(edit).not.toContain('Другое фото')
    const bare = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ editWishId: 'pan' })])
    expect(bare).not.toContain('Убрать фото')
    expect(bare).toContain('>Фото</span>')
    // Запись фото — у обоих через документ.
    store.setWishPhoto('pan', 'ph-2')
    expect(store.wishlist.find((w) => w.id === 'pan')!.photoId).toBe('ph-2')
    expect((await renderScreen(Wishes, '/wishes')).match(/data-photo/g)).toHaveLength(2)

    setActivePinia(createPinia())
    stubStorage()
    family('viewer', 'a', { wishlist: [wish({ id: 'lamp', name: 'Лампа', price: 9_000, photoId: 'ph-1' })] })
    const viewer = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ openWishModal: true, editWishId: 'lamp' })])
    expect(viewer).toContain('data-photo')
    expect(viewer).not.toContain('accept="image/*"')
  })
})

describe('views/Wishes.vue — галерея и список с переключателем (владелец 2026-09-27)', () => {
  beforeEach(() => {
    stubStorage()
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const list = () => [
    wish({ id: 'pan', name: 'Сковорода', price: 18_000, url: 'https://kaspi.kz/p', photoId: 'ph-1' }),
    wish({ id: 'vac', name: 'Пылесос', price: 180_000, by: 'b', bought: true, boughtOn: '2026-09-20T15:00:00.000Z' }),
  ]

  it('по умолчанию галерея: плитки без автора и даты, одна кнопка «Списком» в строке вкладок; в списке — строки с автором и датой, ссылкой и картинкой, кнопка «Галереей»; выбор — на устройстве', async () => {
    family('member', 'a', { wishlist: list() })
    const grid = await renderScreen(Wishes, '/wishes')
    expect(grid).toContain('aria-label="Списком"')
    expect(grid).not.toContain('aria-label="Галереей"')
    expect(grid).toMatch(/<button type="button"[^>]*data-wish="pan"/)
    expect(grid).not.toContain('Ильяс · 10 сентября')
    expect(grid).toContain('Аруна · куплено 20 сентября')

    const rows = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ view: 'list' })])
    expect(rows).toContain('aria-label="Галереей"')
    expect(rows).not.toContain('aria-label="Списком"')
    expect(rows).toContain('Ильяс · 10 сентября')
    expect(rows).toContain('Аруна · куплено 20 сентября')
    expect(rows).toContain('line-through">Пылесос<')
    expect(rows).toContain('aria-label="Открыть ссылку"')
    expect(rows).toContain('data-photo')
    expect(rows).toMatch(/<button type="button"[^>]*data-wish="pan"/)
    expect(rows).toContain('aria-label="Отметить купленным"')
    expect(rows).toContain('aria-label="Вернуть в список"')

    // Выбор запоминается: setView пишет ключ, новый рендер читает его.
    await renderScreen(Wishes, '/wishes', undefined, [screenMixin({}, (s) => (s.setView as (v: string) => void)('list'))])
    expect(storage.get('ff_wishes_view')).toBe('"list"')
    expect(await renderScreen(Wishes, '/wishes')).toContain('aria-label="Галереей"')

    // Viewer: и в списке строка — не кнопка.
    setActivePinia(createPinia())
    family('viewer', 'a', { wishlist: list() })
    const viewer = await renderScreen(Wishes, '/wishes', undefined, [screenMixin({ view: 'list' })])
    expect(viewer).toMatch(/<div[^>]*data-wish="pan"/)
    expect(viewer).not.toContain('aria-label="Отметить купленным"')
  })
})
