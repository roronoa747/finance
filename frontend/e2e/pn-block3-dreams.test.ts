import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, type Pinia } from 'pinia'
import { useAuthStore } from '../src/stores/auth'
import { apiClient } from '../src/api/client'
import { closerDays, closerThisMonth, goalPace } from '../src/lib/finance'
import { GOAL_TYPES, templateById, templateCredit, themePhotos, type GoalTemplateType } from '../src/lib/goalTemplates'
import { attachTemplate } from '../src/lib/photos/goalPhoto'
import { plural } from '../src/lib/utils'
import { layoutStory, storyText } from '../src/lib/storyCard'
import type { LinkFound } from '../src/lib/photos/useLinkPreview'
import { authAs, planFamilyDoc, T0 } from '../src/test/planFamily'
import { screenMixin } from '../src/test/screenState'
import Dreams from '../src/views/Dreams.vue'
import GoalDetail from '../src/views/GoalDetail.vue'
import GoalNew from '../src/views/GoalNew.vue'
import MonthPlan from '../src/components/money/MonthPlan.vue'
import { at, fakeServer, phone, screen, type FakeServer } from './support/family'

// Сжатие в Node не декодирует картинку (нет canvas) — как в DOM-тестах фото: байты идут как есть.
vi.mock('../src/lib/photos/compress', async (orig) => ({
  ...(await orig<typeof import('../src/lib/photos/compress')>()),
  compressImage: vi.fn(async (b: Blob) => ({ blob: b, width: 800, height: 800 })),
}))

/**
 * Блок 3 «понятность» (PN-07…PN-10, Р-4, Р-15): мечты наряднее — на двух телефонах с фейковым сервером
 * (`support/family`), 12 октября 2026. (а) 19 тем, у восьми новых — по 5 фото; выбор новой темы → `attachTemplate` →
 * `photoId` и автор; (б) фото по ссылке — заглушка превью → у новой цели и у существующей `photoId`, `template` null,
 * автора нет; (в) взнос → тост «ближе на N дней» на экране цели, под героем «Мечт» — та же строка; (г) второй телефон
 * после синка видит фото и строку; (д) обои — тексты без сумм (Node); (е) приёмка — взнос с экрана цели и «Отложил всё». Экраны — SSR (`screen`), действия — методами
 * экрана (`screenMixin`); браузер — на стенде §6.
 */
const KEY = '2026-10'
const NEW_THEMES: GoalTemplateType[] = ['business', 'moving', 'furniture', 'sport', 'celebration', 'gift', 'dacha', 'pet']

type Phone = Awaited<ReturnType<typeof phone>>

describe('e2e / понятность Блок 3 — мечты наряднее', () => {
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
    // Герой «Мечт» — «Отпуск» (40 000 в месяц); «Машина» заведена из шаблона «Машина».
    const base = planFamilyDoc()
    server = fakeServer(planFamilyDoc({
      goals: base.goals.map((g) => (g.id === 'car' ? { ...g, template: 'car', photoId: 'ph-car-old', photoCredit: templateCredit(templateById('car')!) } : g)),
      goalOrder: { ids: ['trip', 'car', 'cushion'], updatedAt: T0 },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function as(role: 'member' | 'viewer', slot: 'a' | 'b') {
    const p = await phone(server)
    setActivePinia(p.pinia)
    useAuthStore().setAuthData(authAs(role, slot))
    return p
  }
  const on = <P extends { pinia: Pinia }>(p: P) => (setActivePinia(p.pinia), p)
  const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
  const sync = async (from: Phone, to: Phone) => {
    await on(from).store.syncHousehold(from.client)
    await on(to).store.syncHousehold(to.client)
  }
  /** Заглушки сервера фото: сжатие в Node не декодирует — загружается как есть, id — заданный. */
  const uploads = (id: string) => {
    const sent: Blob[] = []
    vi.spyOn(apiClient, 'uploadPhoto').mockImplementation(async (b: Blob) => {
      sent.push(b)
      return { id }
    })
    return sent
  }
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' })

  it('(а) 19 тем в порядке Р-4, у восьми новых — по 5 фото с автором; «Новая мечта» показывает все плитки и «По ссылке»; выбор «Той» → фото и автор у цели', async () => {
    expect(GOAL_TYPES.map((k) => k.type).slice(11)).toEqual(NEW_THEMES)
    expect(GOAL_TYPES.map((k) => k.name).slice(11)).toEqual(['Бизнес', 'Переезд', 'Мебель', 'Спорт', 'Той / юбилей', 'Подарок', 'Дача / земля', 'Животное'])
    for (const type of NEW_THEMES) {
      const list = themePhotos(type)
      expect(list, type).toHaveLength(5)
      for (const t of list) expect(t.photo.author.trim().length, t.id).toBeGreaterThan(0)
    }
    const A = await as('member', 'a')
    const html = await screen(A.pinia, GoalNew, '/goals/new')
    for (const k of GOAL_TYPES) expect(html, k.type).toContain(`>${k.name}<`)
    for (const type of NEW_THEMES) expect(html, type).toContain(templateById(type)!.photo.unsplashId)
    expect(html).toContain('Своё фото')
    expect(html).toContain('По ссылке')
    expect(html).toContain('data-link-tile')
    // Поле ссылки свёрнуто, пока не нажали плитку.
    expect(html).not.toContain('data-link-photo')

    // Новая цель из темы «Той / юбилей»: шаблон и цвет сразу, картинка — `attachTemplate` (скачать → сжать → загрузить).
    const toi = templateById('celebration')!
    const id = A.store.addGoal({ name: 'Той', need: 1_500_000, monthly: 100_000, hue: toi.hue, template: toi.id })
    const result = await attachTemplate(A.store, id, toi, {
      fetch: async (url) => {
        expect(url).toContain(toi.photo.unsplashId)
        return { ok: true, blob: async () => jpeg() }
      },
      compress: async (blob) => ({ blob }),
      upload: async () => 'ph-toi',
      online: () => true,
    })
    expect(result).toBe('uploaded')
    const goal = A.store.goals.find((g) => g.id === id)!
    expect(goal).toMatchObject({ template: 'celebration', hue: 'plum', photoId: 'ph-toi' })
    expect(goal.photoCredit).toEqual({ author: toi.photo.author, url: `https://unsplash.com/photos/${toi.photo.pageId}` })
    expect(goal.photoCredit!.author).toBe('Jacques Dillies')
  })

  it('(б) фото по ссылке: «Новая мечта» — название со страницы, цель без шаблона, картинка своим фото; у существующей — шаблон и автор снимаются', async () => {
    const A = await as('member', 'a')
    const sent = uploads('ph-link')
    // Поле ссылки нашло картинку (`LinkPhotoField` → `found`): экран берёт её как своё фото и название со страницы.
    const found: LinkFound = { url: 'https://kaspi.kz/shop/p/sofa-askona/', title: 'Угловой диван Askona', file: new File([jpeg()], 'link-photo', { type: 'image/jpeg' }) }
    let box: { onLink: (f: LinkFound) => void; create: () => Promise<void>; set: (k: string, v: unknown) => void; get: (k: string) => unknown } | null = null
    await screen(A.pinia, GoalNew, '/goals/new', undefined, [
      screenMixin({}, (s) => {
        box = { onLink: s.onLink as (f: LinkFound) => void, create: s.create as () => Promise<void>, set: (k, v) => Reflect.set(s, k, v), get: (k) => Reflect.get(s, k) }
      }),
    ])
    box!.onLink(found)
    expect(box!.get('step')).toBe('form')
    expect(box!.get('name')).toBe('Угловой диван Askona')
    expect(box!.get('template')).toBeNull()
    box!.set('needText', '450 000')
    await box!.create()
    const goal = A.store.goals.find((g) => g.name === 'Угловой диван Askona')!
    expect(goal).toMatchObject({ need: 450_000, photoId: 'ph-link', template: null })
    expect(goal.photoCredit).toBeNull()
    expect(sent).toHaveLength(1)

    // Существующая «Машина» (шаблон «Машина» с автором): `PhotoPicker` → «По ссылке» → `onFile` экрана цели.
    const sent2 = uploads('ph-link-car')
    let onFile: ((f: Blob) => Promise<void>) | null = null
    await screen(A.pinia, GoalDetail, '/goals/car', undefined, [screenMixin({}, (s) => { onFile = s.onFile as (f: Blob) => Promise<void> })])
    expect(A.store.goals.find((g) => g.id === 'car')).toMatchObject({ template: 'car', photoId: 'ph-car-old' })
    await onFile!(found.file!)
    expect(A.store.goals.find((g) => g.id === 'car')).toMatchObject({ photoId: 'ph-link-car', template: null, photoCredit: null })
    expect(sent2).toHaveLength(1)
  })

  it('(в) взнос 100 000 в «Отпуск» (40 000 в месяц) → тост «Отпуск ближе на 76 дней»; под героем «Мечт» — «ближе на 76 дней»; снятие — без тоста', async () => {
    const A = await as('member', 'a')
    expect(await screen(A.pinia, Dreams, '/')).not.toContain('data-hero-closer')
    const trip = () => A.store.goals.find((g) => g.id === 'trip')!
    expect(goalPace(trip(), KEY)).toBe(40_000)
    expect(closerDays(100_000, 40_000)).toBe(76)

    let box: { apply: () => void; get: (k: string) => unknown } | null = null
    await screen(A.pinia, GoalDetail, '/goals/trip', undefined, [
      screenMixin({ depositOperation: 'deposit', depositAmount: '100 000' }, (s) => {
        box = { apply: s.applyDeposit as () => void, get: (k) => Reflect.get(s, k) }
      }),
    ])
    box!.apply()
    expect(box!.get('closerNote')).toBe('Отпуск ближе на 76 дней')
    expect(trip().have).toBe(50_000 + 100_000)
    expect(closerThisMonth(trip(), KEY)).toBe(76)

    const dreams = await screen(A.pinia, Dreams, '/')
    expect(dreams).toContain('data-hero-closer')
    expect(text(dreams)).toContain('Отпуск · ближе на 76 дней')

    // Снятие — тоста нет.
    let box2: { apply: () => void; get: (k: string) => unknown } | null = null
    await screen(A.pinia, GoalDetail, '/goals/trip', undefined, [
      screenMixin({ depositOperation: 'withdraw', depositAmount: '10 000' }, (s) => {
        box2 = { apply: s.applyDeposit as () => void, get: (k) => Reflect.get(s, k) }
      }),
    ])
    box2!.apply()
    expect(box2!.get('closerNote')).toBeNull()
    expect(trip().have).toBe(140_000)
  })

  it('(г) второй телефон после синка видит фото по ссылке и «ближе на N дней» под героем; viewer — ту же строку', async () => {
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    on(A)
    uploads('ph-link-car')
    let onFile: ((f: Blob) => Promise<void>) | null = null
    await screen(A.pinia, GoalDetail, '/goals/car', undefined, [screenMixin({}, (s) => { onFile = s.onFile as (f: Blob) => Promise<void> })])
    await onFile!(jpeg())
    at('2026-10-12T07:01:00Z')
    A.store.contribute('trip', 100_000, 'a')
    await sync(A, B)

    expect(B.store.goals.find((g) => g.id === 'car')).toMatchObject({ photoId: 'ph-link-car', template: null, photoCredit: null })
    expect(B.store.goals.find((g) => g.id === 'trip')!.movements.map((m) => m.amount)).toEqual([100_000])
    const dreams = await screen(B.pinia, Dreams, '/')
    expect(dreams).toContain('data-hero-closer')
    expect(text(dreams)).toContain('Отпуск · ближе на 76 дней')

    const V = await as('viewer', 'b')
    const viewer = await screen(V.pinia, Dreams, '/')
    expect(text(viewer)).toContain('Отпуск · ближе на 76 дней')
    expect(viewer).not.toContain('Добавить фото')
  })

  it('(е) приёмка: взнос с экрана цели закрыл план месяца «Отпуска» → «Отложил всё» в «Месяце» говорит о «Машине», не об «Отпуске»; фонд не считается; партнёр видит взносы', async () => {
    // «Подушка» — фонд (Р-82): у фонда «дней» нет. Найдено в браузере приёмки на демо: после взноса на экране цели
    // «Отложил всё» не упоминает закрытую цель.
    const base = planFamilyDoc()
    server = fakeServer(planFamilyDoc({ goals: base.goals.map((g) => (g.id === 'cushion' ? { ...g, fund: 'cushion' as const } : g)) }))
    const A = await as('member', 'a')
    const B = await as('member', 'b')
    on(A)
    // Зарплата Ильяса пришла — «Отложил всё» откладывает его часть плана.
    A.store.markSalary('a', { period: KEY })
    let deposit: { apply: () => void; get: (k: string) => unknown } | null = null
    await screen(A.pinia, GoalDetail, '/goals/trip', undefined, [
      screenMixin({ depositOperation: 'deposit', depositAmount: '40 000' }, (s) => {
        deposit = { apply: s.applyDeposit as () => void, get: (k) => Reflect.get(s, k) }
      }),
    ])
    deposit!.apply()
    expect(deposit!.get('closerNote')).toBe('Отпуск ближе на 30 дней')

    type Put = { kind: string; goalId: string | null; name: string; left: number }
    let month: { pending: () => Put[]; save: (l: Put[]) => void; note: () => unknown } | null = null
    await screen(A.pinia, MonthPlan, '/month', { monthKey: KEY }, [
      screenMixin({}, (s) => {
        month = { pending: () => Reflect.get(s, 'pending') as Put[], save: s.savePuts as (l: Put[]) => void, note: () => Reflect.get(s, 'closerNote') }
      }),
    ])
    const pending = month!.pending()
    const goals = pending.filter((p) => p.kind === 'goal' && p.left > 0)
    expect(goals.map((p) => p.name)).toEqual(['Машина'])
    expect(pending.some((p) => p.kind === 'fund')).toBe(true)
    const car = A.store.goals.find((g) => g.id === 'car')!
    const days = closerDays(goals[0].left, goalPace(car, KEY))!
    month!.save(pending)
    expect(month!.note()).toBe(`Машина ближе на ${days} ${plural(days, 'день', 'дня', 'дней')}`)

    await sync(A, B)
    expect(B.store.goals.find((g) => g.id === 'trip')!.movements.map((m) => m.amount)).toEqual([40_000])
    expect(B.store.goals.find((g) => g.id === 'car')!.have).toBe(A.store.goals.find((g) => g.id === 'car')!.have)
  })

  it('(д) обои: тексты без сумм и без подписей сверху, 1170 × 2532, процент и имя в нижней трети', () => {
    const t = storyText('wallpaper', { percent: 33, goalName: 'Отпуск 1 200 000 ₸', doneMonth: 'мае 2027' })
    expect(t).toMatchObject({ kind: 'wallpaper', app: '', label: '', line: 'Отпуск · будет нашей в мае 2027', percent: 33 })
    expect(t.big).toBe('33 %')
    for (const s of [t.app, t.label, t.big, t.line]) expect(s).not.toMatch(/₸|\d{1,3}(?:[\s ]\d{3})+/)
    const l = layoutStory('wallpaper')
    expect(l).toMatchObject({ width: 1170, height: 2532, app: null, label: null })
    expect(l.big.y - l.big.size * 0.9).toBeGreaterThan(0.6 * l.height)
  })
})
