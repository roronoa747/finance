import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { PhHeart } from '@phosphor-icons/vue'
import DreamHero from './DreamHero.vue'
import DreamTile from './DreamTile.vue'
import WeekCard from './WeekCard.vue'
import FreeCard from './FreeCard.vue'
import DecisionCard from './DecisionCard.vue'
import Chip from './Chip.vue'
import TemplateTile from './TemplateTile.vue'
import OpRow from './OpRow.vue'
import Stepper from './Stepper.vue'
import Tabs from './Tabs.vue'
import Toggle from './Toggle.vue'
import EmptyState from './EmptyState.vue'
import ScreenHeader from './ScreenHeader.vue'
import Avatar from './Avatar.vue'
import Callout from './Callout.vue'
import Tag from './Tag.vue'
import Card from './Card.vue'

/** SSR новых компонентов кита (B2C-12, DESIGN.md §5): пропсы — в разметку, пустые состояния, цвет только токенами. */
async function render(comp: Component, props: Record<string, unknown> = {}, slots: Record<string, () => unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { render: () => null } }] })
  const app = createSSRApp({ render: () => h(comp, props, slots) })
  app.use(router)
  return (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
}

// `&nbsp;` шаблона SSR отдаёт символом U+00A0, деньги — `money()` с тем же пробелом.
const NBSP = ' '
const pctText = (n: number) => `${n}${NBSP}%`
const noLiterals = (html: string) => {
  // Литералов цвета в разметке нет — только var(--…) и классы токенов.
  expect(html).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i)
}

describe('DreamHero', () => {
  it('фото: «До мечты», процент, строка «Цель · накоплено из нужно · будет вашей в», полоса и автор', async () => {
    const html = await render(DreamHero, {
      title: 'Япония',
      percent: 62,
      src: 'blob:photo',
      author: 'Matthew Skinner',
      haveAmount: 1_116_000,
      needAmount: 1_800_000,
      doneMonth: 'мае 2027',
    })
    expect(html).toContain('До мечты')
    expect(html).toContain(pctText(62))
    // «·» держится за предыдущее слово, месяц с годом — одним куском: строка не начинается с точки (смоук владельца, п. 4).
    expect(html).toContain(`Япония${NBSP}· 1${NBSP}116${NBSP}000 из 1${NBSP}800${NBSP}000${NBSP}₸${NBSP}· будет вашей в мае${NBSP}2027`)
    expect(html).not.toContain(' · ')
    expect(html).toContain('src="blob:photo"')
    expect(html).toContain('photo-scrim')
    expect(html).toContain('text-on-photo')
    expect(html).toContain('Фото: Matthew Skinner')
    expect(html).toContain('aria-valuenow="62"')
    expect(html).toContain('min-h-[440px]')
    noLiterals(html)
  })

  it('без фото — surface-3 и ink-текст, слот действий («Добавить фото»); экран цели — 380, превью — без процента', async () => {
    const html = await render(DreamHero, { title: 'Машина', percent: 18, size: 'goal' }, { actions: () => h('button', 'Добавить фото') })
    expect(html).toContain('bg-surface-3')
    expect(html).not.toContain('<img')
    expect(html).toContain('Добавить фото')
    expect(html).toContain('min-h-[380px]')
    const preview = await render(DreamHero, { title: 'Путешествие · Япония', size: 'preview', src: 'x' })
    expect(preview).not.toContain('До мечты')
    expect(preview).toContain('Путешествие · Япония')
  })

  it('empty — «На что копим?» с пояснением и кнопкой «Выбрать мечту»; процент обрезается 0…100', async () => {
    const html = await render(DreamHero, { empty: true })
    expect(html).toContain('На что копим?')
    expect(html).toContain('Одна мечта с фото — и этот экран покажет, сколько до неё осталось.')
    expect(html).toContain('Выбрать мечту')
    expect(await render(DreamHero, { title: 'Х', percent: 140 })).toContain(pctText(100))
    expect(await render(DreamHero, { title: 'Х', percent: -5 })).toContain(pctText(0))
  })
})

describe('DreamTile / TemplateTile', () => {
  it('плитка: процент и имя с обрезкой; plain без фото; add — «Новая мечта»', async () => {
    const tile = await render(DreamTile, { name: 'Путешествие в Юго-Восточную Азию', percent: 40, src: 'p' })
    expect(tile).toContain(pctText(40))
    expect(tile).toContain('truncate')
    expect(tile).toContain('h-[150px]')
    expect(await render(DreamTile, { name: 'Машина', percent: 18 })).toContain('bg-surface-3')
    expect(await render(DreamTile, { add: true })).toContain('Новая мечта')
  })

  it('link — переход в том же ряду (возврат смоука: «Желания» вместо отдельной ссылки): подпись, строка, иконка слотом', async () => {
    const html = await render(DreamTile, { link: true, name: 'Желания', meta: '3 в списке' }, { icon: () => h(PhHeart) })
    expect(html).toContain('Желания')
    expect(html).toContain('3 в списке')
    expect(html).toContain('<svg')
    expect(html).toContain('border-card-border')
    expect(html).not.toContain('border-dashed')
    expect(html).not.toContain('%')
  })

  it('шаблон: выбранный — обводка бренда и aria-pressed; камера — «Своё фото»', async () => {
    const on = await render(TemplateTile, { name: 'Путешествие', src: 'p', selected: true })
    expect(on).toContain('aria-pressed="true"')
    expect(on).toContain('outline-brand')
    const cam = await render(TemplateTile, { name: 'Своё фото', camera: true })
    expect(cam).toContain('Своё фото')
    expect(cam).toContain('border-dashed')
  })
})

describe('WeekCard / FreeCard', () => {
  const segments = [
    { id: 'sc_food', name: 'Продукты', amount: 62_000, share: 0.34, color: 'var(--s1)' },
    { id: 'sc_cafe', name: 'Кафе и рестораны', amount: 28_000, share: 0.15, color: 'var(--s2)' },
    { id: 'sc_home', name: 'Дом и быт', amount: 18_000, share: 0.1, color: 'var(--s8)' },
    { id: 'sc_transport', name: 'Транспорт', amount: 14_000, share: 0.08, color: 'var(--s3)' },
    { id: 'sc_health', name: 'Здоровье', amount: 12_000, share: 0.07, color: 'var(--s5)' },
    { id: 'sc_subs', name: 'Подписки', amount: 9_990, share: 0.05, color: 'var(--s4)' },
  ]

  it('сумма, тег, стопка (разделы + не разобрано), четыре строки, «ещё 2 раздела · не разобрано 40 000 ₸», ссылка', async () => {
    const html = await render(WeekCard, {
      total: 184_000,
      tag: { text: 'по выпискам обоих', tone: 'ok' },
      segments,
      unknown: 40_000,
      unknownShare: 0.21,
      link: { text: 'Неделя →', to: '/week' },
    })
    expect(html).toContain(`184${NBSP}000${NBSP}₸`)
    expect(html).toContain('по выпискам обоих')
    expect(html).toContain('bg-ok-soft')
    expect(html).toContain('Транспорт')
    expect(html).not.toContain('Здоровье')
    expect(html).toContain(`ещё 2 раздела · не разобрано 40${NBSP}000${NBSP}₸`)
    expect(html).toContain('var(--s-unknown)')
    expect(html).toContain('href="/week"')
    expect(html).toContain('Неделя →')
    noLiterals(html)
  })

  it('без «не разобрано» и с ≤ 4 разделами подвала нет; тег «без выписки Даны» — warn; слот заметки', async () => {
    const html = await render(
      WeekCard,
      { total: 121_000, tag: { text: 'без выписки Даны', tone: 'warn' }, segments: segments.slice(0, 3) },
      { default: () => h(Callout, { tone: 'neutral', icon: 'bell' }, () => 'Напомним Дане в воскресенье в 21:00.') },
    )
    expect(html).toContain('без выписки Даны')
    expect(html).toContain('bg-warn-soft')
    expect(html).not.toContain('ещё ')
    expect(html).not.toContain('var(--s-unknown)')
    expect(html).toContain('Напомним Дане в воскресенье в 21:00.')
  })

  it('unknownRow — «Не разобрано» строкой списка с подписью и шевроном (g2 «Неделя — итог»), в подвале его нет; без action — не кнопка', async () => {
    const html = await render(WeekCard, {
      total: 184_000,
      segments,
      rows: segments.length,
      unknown: 40_000,
      unknownShare: 0.21,
      unknownRow: { meta: '2 продавца · разобрать', action: true },
    })
    expect(html).toContain('Здоровье')
    expect(html).toContain('Подписки')
    expect(html).toContain('Не разобрано')
    expect(html).toContain('2 продавца · разобрать')
    expect(html).toContain(`40${NBSP}000${NBSP}₸`)
    expect(html).not.toContain('не разобрано 40')
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>\s*<i[^>]*bg-s-unknown/)
    const still = await render(WeekCard, { total: 184_000, segments, rows: segments.length, unknown: 40_000, unknownShare: 0.21, unknownRow: {} })
    expect(still).toContain('Не разобрано')
    expect(still).not.toContain('<button')
  })

  it('FreeCard: сумма и подпись, полоса --ok; null — «—» без полосы; md — 32', async () => {
    const html = await render(FreeCard, { amount: 236_000, note: 'по факту выписок обоих · 9 дней до зарплаты Ильяса', share: 0.38 })
    expect(html).toContain('Свободно до конца месяца')
    expect(html).toContain(`236${NBSP}000${NBSP}₸`)
    expect(html).toContain('9 дней до зарплаты Ильяса')
    expect(html).toContain('bg-ok')
    expect(html).toContain('type-big')
    const none = await render(FreeCard, { amount: null, note: 'появится после первой выписки' })
    expect(none).toContain('—')
    expect(none).not.toContain('role="progressbar"')
    expect(await render(FreeCard, { amount: 1, size: 'md' })).toContain('type-big-md')
    // Справа — «до зарплаты / 9 дней» в «Деньгах» (g6).
    const aside = await render(FreeCard, { amount: 236_000, size: 'md' }, { aside: () => 'до зарплаты 9 дней' })
    expect(aside).toContain('до зарплаты 9 дней')
    expect(aside).toContain('text-right')
  })
})

describe('DecisionCard / Chip / Stepper', () => {
  it('вопрос Piazzolla, детали, прогресс «2 из 6», внутренняя карточка, три кнопки', async () => {
    const html = await render(
      DecisionCard,
      {
        question: 'Похоже, это платёж по Автокредиту — отметить?',
        meta: '95 000 ₸ · 12 сентября · «Оплата Kaspi Кредита»',
        progress: { n: 2, k: 6 },
        actions: { primary: 'Да, отметить', secondary: 'Нет, это другое', ghost: 'Потом' },
      },
      { inner: () => h('span', '23-й платёж из 60') },
    )
    expect(html).toContain('type-h2')
    expect(html).toContain('Похоже, это платёж по Автокредиту — отметить?')
    expect(html).toContain('2 из 6')
    expect(html).toContain('aria-valuenow="33"')
    expect(html).toContain('23-й платёж из 60')
    for (const t of ['Да, отметить', 'Нет, это другое', 'Потом']) expect(html).toContain(t)
    expect(html.match(/<button/g)).toHaveLength(3)
  })

  it('чипы в слоте: выбранный — aria-pressed и brand-soft, точка раздела — токеном; без actions кнопок нет', async () => {
    const html = await render(
      DecisionCard,
      { question: 'ИП Сериков — куда отнести?' },
      {
        chips: () => [
          h(Chip, { on: true, sw: 'var(--s1)' }, () => 'Продукты'),
          h(Chip, { quiet: true }, () => 'Ещё 11 ▾'),
        ],
      },
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('bg-brand-soft')
    expect(html).toContain('background:var(--s1)')
    expect(html).toContain('Ещё 11 ▾')
    expect(html).toContain('border-line-strong')
    noLiterals(html)
  })

  it('Stepper — «3 из 5» и полоса 60 %', async () => {
    const html = await render(Stepper, { n: 3, k: 5 })
    expect(html).toContain('3 из 5')
    expect(html).toContain('aria-valuenow="60"')
  })
})

describe('OpRow / Tabs / Toggle / EmptyState / ScreenHeader / Avatar / Tag / Card', () => {
  it('строка операции: буква на цвете раздела, раздел, списание без знака, поступление «+» зелёным, не разобрано — s-unknown', async () => {
    const neg = await render(OpRow, { merchant: 'ИП Сериков', category: { name: 'Продукты', color: 'var(--s1)' }, amount: -6_800, date: '19 сент' })
    expect(neg).toContain('>И<')
    expect(neg).toContain('background:var(--s1)')
    expect(neg).toContain('Продукты · 19 сент')
    expect(neg).toContain(`6${NBSP}800${NBSP}₸`)
    expect(neg).not.toContain('text-ok')
    const pos = await render(OpRow, { merchant: 'Зарплата', amount: 750_000, clickable: true })
    expect(pos).toContain(`+750${NBSP}000${NBSP}₸`)
    expect(pos).toContain('text-ok')
    expect(pos).toContain('Не разобрано')
    expect(pos).toContain('var(--s-unknown)')
    expect(pos).toMatch(/^<button/)
  })

  it('вкладки: три ссылки, активная — aria-current="page", «+» с именем; без plus кнопки нет', async () => {
    const items = [
      { to: '/', label: 'Мечты', icon: PhHeart, active: true },
      { to: '/week', label: 'Неделя', icon: PhHeart, active: false },
      { to: '/money', label: 'Деньги', icon: PhHeart, active: false },
    ]
    const html = await render(Tabs, { items })
    expect(html.match(/<a /g)).toHaveLength(3)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/<a aria-current="page" href="\/"/)
    expect(html).toContain('aria-label="Добавить"')
    expect(html).toContain('bg-brand')
    expect(await render(Tabs, { items, plus: false })).not.toContain('aria-label="Добавить"')
  })

  it('Toggle — switch с aria-checked; EmptyState — заголовок, текст и действия; ScreenHeader — h1, подпись, «Назад» и слот', async () => {
    expect(await render(Toggle, { modelValue: true, label: 'Push на этом телефоне' })).toContain('role="switch" aria-checked="true"')
    const empty = await render(EmptyState, { title: 'Картины недели пока нет', text: 'Загрузите первую выписку.' }, { default: () => h('button', 'Загрузить') })
    expect(empty).toContain('Картины недели пока нет')
    expect(empty).toContain('Загрузите первую выписку.')
    expect(empty).toContain('Загрузить')
    const head = await render(ScreenHeader, { title: 'Разбор', sub: 'Kaspi Gold · 1–21 сентября', back: '/week' }, { right: () => h('b', 'Пропустить все') })
    expect(head).toContain('<h1 class="type-h1 truncate text-ink">Разбор</h1>')
    expect(head).toContain('Kaspi Gold · 1–21 сентября')
    expect(head).toContain('aria-label="Назад"')
    expect(head).toContain('Пропустить все')
    expect(await render(ScreenHeader, { title: 'Мечты' })).not.toContain('aria-label="Назад"')
  })

  it('Avatar — буква на var(--pa)/var(--pb), третий слот — ink-3; Tag — варианты; Card — tight и рамка card-border', async () => {
    expect(await render(Avatar, { id: 'a', name: 'Ильяс' })).toContain('background:var(--pa)')
    expect(await render(Avatar, { id: 'b', name: 'Дана', size: 34 })).toMatch(/size-\[34px\][^>]*background:var\(--pb\)[^>]*>\s*Д/)
    expect(await render(Avatar, { id: 'c', name: 'Гость' })).toContain('var(--ink-3)')
    expect(await render(Tag, { tone: 'ok' }, { default: () => 'готово' })).toContain('bg-ok-soft text-ok')
    expect(await render(Tag, { tone: 'warn' }, { default: () => 'x' })).toContain('bg-warn-soft')
    const card = await render(Card, { tight: true }, { default: () => 'x' })
    expect(card).toContain('rounded-card border border-card-border bg-surface p-4')
    expect(await render(Card, {}, { default: () => 'x' })).toContain('p-5')
  })

  it('Callout — тона neutral/brand/ok/warn (у «готово» одно имя — ok), иконка по тону или своя', async () => {
    expect(await render(Callout, { tone: 'neutral' }, { default: () => 'x' })).toContain('bg-surface-2')
    expect(await render(Callout, { tone: 'brand' }, { default: () => 'x' })).toContain('bg-brand-soft text-brand')
    const ok = await render(Callout, { tone: 'ok' }, { default: () => 'x' })
    expect(ok).toContain('bg-ok-soft text-ok')
    // Иконка «готово» — галочка по тону, как если бы её задали явно.
    expect(ok).toBe(await render(Callout, { tone: 'ok', icon: 'check' }, { default: () => 'x' }))
    expect(ok).not.toBe(await render(Callout, { tone: 'ok', icon: 'info' }, { default: () => 'x' }))
    const warn = await render(Callout, { title: 'Не всё ушло' }, { default: () => 'x' })
    expect(warn).toContain('bg-warn-soft')
    expect(warn).toContain('Не всё ушло')
    expect(await render(Callout, { tone: 'neutral', icon: 'none' }, { default: () => 'x' })).not.toContain('<svg')
  })
})
