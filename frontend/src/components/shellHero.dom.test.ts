// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setPhotoThemeColor } from './shellHero'

// Цвет верха iPhone под обложкой «Мечт» (владелец 2026-10-27: белая полоса под часами на тёмном фото).
describe('setPhotoThemeColor', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f2f2f0">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121214">'
  })
  afterEach(() => {
    document.head.innerHTML = ''
  })
  const colors = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)

  it('шапка на фото — обе метки тёмные; уход — прежние значения', () => {
    setPhotoThemeColor(true)
    expect(colors()).toEqual(['#121214', '#121214'])
    setPhotoThemeColor(false)
    expect(colors()).toEqual(['#f2f2f0', '#121214'])
  })

  it('повторное включение не теряет исходный светлый цвет', () => {
    setPhotoThemeColor(true)
    setPhotoThemeColor(true)
    setPhotoThemeColor(false)
    expect(colors()).toEqual(['#f2f2f0', '#121214'])
  })
})
