import { describe, it, expect } from 'vitest'
import { GOAL_TEMPLATES, GOAL_TYPES, TRAVEL_DIRECTIONS, templateById, templateCredit, templateImageUrl, themePhotos } from './goalTemplates'
import { HUE_KEYS } from './palette'

describe('lib/goalTemplates — шаблоны целей (Р-28, B2C-17)', () => {
  it('у каждого шаблона — автор и ссылка на него; id уникальны; цвет — из палитры', () => {
    const ids = new Set<string>()
    for (const t of GOAL_TEMPLATES) {
      expect(ids.has(t.id)).toBe(false)
      ids.add(t.id)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.photo.author.length).toBeGreaterThan(0)
      expect(t.photo.authorUrl).toMatch(/^https:\/\/unsplash\.com\/@/)
      expect(t.photo.pageId.length).toBeGreaterThan(5)
      expect(t.photo.unsplashId.length).toBeGreaterThan(5)
      expect(HUE_KEYS).toContain(t.hue)
    }
  })

  it('B2C-64: шесть новых тем — свой тип и плитка у каждой; ни одна картинка и страница фото не повторяется', () => {
    const themes = { wedding: 'Свадьба', baby: 'Ребёнок', study: 'Учёба', renovation: 'Ремонт', cushion: 'Подушка', hajj: 'Хадж, Умра' }
    for (const [type, name] of Object.entries(themes)) {
      expect(GOAL_TYPES.find((k) => k.type === type)?.name, type).toBe(name)
      expect(templateById(type)?.type, type).toBe(type)
      expect(templateImageUrl(templateById(type)!, 600)).toMatch(/^https:\/\/images\.unsplash\.com\/photo-\d+-[0-9a-f]+\?w=600&q=80&fm=jpg&fit=crop$/)
    }
    expect(new Set(GOAL_TEMPLATES.map((t) => t.photo.unsplashId)).size).toBe(GOAL_TEMPLATES.length)
    expect(new Set(GOAL_TEMPLATES.map((t) => t.photo.pageId)).size).toBe(GOAL_TEMPLATES.length)
  })

  it('B2C-64-а: у каждой темы, кроме «Путешествия», 3–5 фото — первым фото плитки, варианты `<тип>-N` того же типа и оттенка; формат автора и ссылки', () => {
    for (const { type } of GOAL_TYPES.filter((k) => k.type !== 'travel')) {
      const list = themePhotos(type)
      expect(list.length, type).toBeGreaterThanOrEqual(3)
      expect(list.length, type).toBeLessThanOrEqual(5)
      expect(list[0].id).toBe(type)
      for (const [i, t] of list.slice(1).entries()) {
        expect(t.id).toBe(`${type}-${i + 2}`)
        expect(t).toMatchObject({ type, name: list[0].name, hue: list[0].hue })
        expect(templateImageUrl(t, 600)).toMatch(/^https:\/\/images\.unsplash\.com\/photo-\d+-[0-9a-f]+\?w=600&q=80&fm=jpg&fit=crop$/)
        expect(t.photo.authorUrl).toMatch(/^https:\/\/unsplash\.com\/@[\w.-]+$/)
        expect(t.photo.pageId).toMatch(/^[\w-]{11}$/)
      }
    }
    expect(themePhotos('travel')).toEqual([])
    // Варианты не попадают в направления путешествий; уникальность картинок и страниц — в тесте B2C-64 выше, на всём пуле.
    expect(TRAVEL_DIRECTIONS.some((t) => /-\d$/.test(t.id))).toBe(false)
  })

  it('типы из брифа и пула B2C-64 (одиннадцать) и 8–12 направлений путешествий', () => {
    expect(GOAL_TYPES.map((k) => k.type)).toEqual(['car', 'home', 'travel', 'tech', 'health', 'wedding', 'baby', 'study', 'renovation', 'cushion', 'hajj'])
    for (const k of GOAL_TYPES) expect(templateById(k.type)?.type).toBe(k.type)
    expect(TRAVEL_DIRECTIONS.length).toBeGreaterThanOrEqual(8)
    expect(TRAVEL_DIRECTIONS.length).toBeLessThanOrEqual(12)
    expect(TRAVEL_DIRECTIONS.every((t) => t.type === 'travel' && t.id !== 'travel')).toBe(true)
    expect(TRAVEL_DIRECTIONS.map((t) => t.name)).toContain('Япония')
  })

  it('возврат приёмки п. 6: фото направления снято в том месте, которое оно называет — место со страницы Unsplash; Дубай и Париж из ТЗ есть', () => {
    // Название направления → чем обязано быть место на странице фото (страна или город, как печатает Unsplash).
    const PLACE: Record<string, RegExp> = {
      japan: /Japan|Japon/, turkey: /Turkey|Türkiye/, dubai: /Dubai/, georgia: /Tbilisi, Georgia/, norway: /Norway/,
      bali: /Bali/, paris: /Paris, France/, italy: /Italy/, amsterdam: /Amsterdam/, almaty: /Almaty, Kazakhstan/,
    }
    expect(TRAVEL_DIRECTIONS.map((t) => t.id).sort()).toEqual(Object.keys(PLACE).sort())
    for (const t of TRAVEL_DIRECTIONS) expect(t.photo.place, t.id).toMatch(PLACE[t.id])
    expect(TRAVEL_DIRECTIONS.map((t) => t.name)).toEqual(expect.arrayContaining(['Дубай', 'Париж']))
    // Одна картинка — одно место: «Япония» — не ночная улица типа «Путешествие» (Белфаст).
    expect(new Set(TRAVEL_DIRECTIONS.map((t) => t.photo.pageId)).size).toBe(TRAVEL_DIRECTIONS.length)
    expect(templateById('japan')!.photo.pageId).not.toBe(templateById('travel')!.photo.pageId)
  })

  it('templateImageUrl — CDN Unsplash без ключа, с шириной; templateCredit — автор и страница фото', () => {
    const japan = templateById('japan')!
    expect(templateImageUrl(japan, 400)).toBe('https://images.unsplash.com/photo-1624253321171-1be53e12f5f4?w=400&q=80&fm=jpg&fit=crop')
    expect(templateImageUrl(templateById('car')!)).toMatch(/^https:\/\/images\.unsplash\.com\/photo-[0-9a-f-]+\?w=1200&q=80/)
    expect(templateCredit(japan)).toEqual({ author: 'Roméo A.', url: 'https://unsplash.com/photos/SlIl9eZjWUc' })
    expect(templateById('nope')).toBeUndefined()
    expect(templateById(null)).toBeUndefined()
  })
})
