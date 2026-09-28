import { describe, it, expect } from 'vitest'
import { GOAL_TEMPLATES, GOAL_TYPES, TRAVEL_DIRECTIONS, templateById, templateCredit, templateImageUrl } from './goalTemplates'
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

  it('пять типов из брифа и 8–12 направлений путешествий', () => {
    expect(GOAL_TYPES.map((k) => k.type)).toEqual(['car', 'home', 'travel', 'tech', 'health'])
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
