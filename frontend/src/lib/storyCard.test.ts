import { describe, expect, it } from 'vitest'
import { STORY_SIZE, drawStory, layoutStory, lineFont, storyText, withoutMoney, type StoryContext } from './storyCard'

// Светлые токены — из style.css (ревью Блока 3 Н-14): смена токена не разъедется с карточкой молча.
// CSS в Vitest приходит пустым — читается через node:fs, как в `style.tokens.test.ts`.
type NodeFs = { readFileSync(path: URL, encoding: string): string }
const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as unknown as NodeFs
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf-8')
const lightRoot = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
// Шрифты — системные стеки из `@theme inline` (пивот 3, Р-36): карточка не разъедется со style.css.
const themeFont = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css)![1].trim()
const DISPLAY = themeFont('--font-display')
const TEXT = themeFont('--font-sans')
const NUM = themeFont('--font-num')
const lightToken = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(lightRoot)![1].trim()
const rgbOfHex = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')

/**
 * Карточка для сторис (B2C-20, Р-10): тексты, гвард сумм, композиция по DESIGN.md §7 и
 * рисование записывающей заглушкой — ни одной суммы на карточке.
 */
describe('storyCard — тексты', () => {
  it('мечта: процент 0 / 62 / 100 с неразрывным пробелом, «До мечты», строка «<Цель> · будет нашей в <месяц год>»', () => {
    expect(storyText('goal', { percent: 0, goalName: 'Япония', doneMonth: 'мае 2027' })).toEqual({
      kind: 'goal', app: 'Family Finance', label: 'До мечты', big: '0 %', line: 'Япония · будет нашей в мае 2027', percent: 0,
    })
    expect(storyText('goal', { percent: 62.4, goalName: 'Япония', doneMonth: 'мае 2027' }).big).toBe('62 %')
    expect(storyText('goal', { percent: 100, goalName: 'Япония', doneMonth: null })).toMatchObject({ big: '100 %', line: 'Япония', percent: 100 })
    // За пределы не выходит; без имени — «Мечта».
    expect(storyText('goal', { percent: 150 }).percent).toBe(100)
    expect(storyText('goal', { percent: -5 }).big).toBe('0 %')
    expect(storyText('goal', {}).line).toBe('Мечта')
  })

  it('утечки: «За месяц», «−N», склонения 1 / 3 / 5', () => {
    expect(storyText('leaks', { count: 1 })).toEqual({ kind: 'leaks', app: 'Family Finance', label: 'За месяц', big: '−1', line: 'подписка, без которой можно', percent: null })
    expect(storyText('leaks', { count: 3 }).line).toBe('подписки, без которых можно')
    expect(storyText('leaks', { count: 5 })).toMatchObject({ big: '−5', line: 'подписок, без которых можно' })
  })

  it('гвард сумм: суммы с ₸, разряды и длинные числа из имени мечты не печатаются; год остаётся', () => {
    expect(withoutMoney('Машина 3 000 000 ₸')).toBe('Машина')
    expect(withoutMoney('Квартира за 6000000')).toBe('Квартира за')
    expect(withoutMoney('Накопить 1 800 000 на Японию')).toBe('Накопить на Японию')
    expect(withoutMoney('Япония 2027')).toBe('Япония 2027')
    // «млн» / «тыс» / «тг» — тоже деньги (критик Блока 3).
    expect(withoutMoney('Машина 1,8 млн')).toBe('Машина')
    expect(withoutMoney('Дом за 45 млн ₸')).toBe('Дом за')
    expect(withoutMoney('Телефон 800 тыс.')).toBe('Телефон')
    expect(withoutMoney('Ремонт 300000 тг')).toBe('Ремонт')
    expect(withoutMoney('₸ и ещё ₸')).toBe('и ещё')
    const t = storyText('goal', { percent: 62, goalName: 'Дом 25 000 000 ₸ · 2028', doneMonth: 'марте 2028' })
    expect(t.line).toBe('Дом · 2028 · будет нашей в марте 2028')
    for (const s of [t.app, t.label, t.big, t.line]) {
      expect(s).not.toContain('₸')
      expect(s).not.toMatch(/\d{1,3}(?:[\s ]\d{3})+/)
    }
  })
})

describe('storyCard — композиция', () => {
  it('layoutStory 1080 × 1920: поля 96, имя приложения 96/96, процент системный скруглённый 700 / 300, строка 56 (пивот 3), полоса 12 внизу с полями', () => {
    const l = layoutStory('goal')
    expect(l).toMatchObject({ width: 1080, height: 1920, margin: 96 })
    expect(l.app).toMatchObject({ x: 96, y: 140, font: `700 44px ${DISPLAY}`, alpha: 0.95 })
    expect(l.label.font).toBe(`500 40px ${TEXT}`)
    expect(l.big).toMatchObject({ font: `700 300px ${NUM}`, size: 300, lineHeight: 0.9 })
    expect(l.line).toMatchObject({ font: lineFont(56), maxWidth: 888 })
    for (const font of [l.app.font, l.label.font, l.big.font, l.line.font]) expect(font).not.toMatch(/Piazzolla|Golos/)
    expect(l.bar).toEqual({ x: 96, y: 1812, width: 888, height: 12, radius: 6 })
    expect(l.gradient).toMatchObject({ from: 576, to: 1920, color: 'rgba(24,18,14,0.82)' })
    // Снизу вверх: полоса → строка → процент → подпись, всё выше нижнего поля.
    expect(l.line.y).toBeLessThan(l.bar!.y)
    expect(l.big.y).toBeLessThan(l.line.y)
    expect(l.label.y).toBeLessThan(l.big.y)
    expect(l.label.y).toBeGreaterThan(l.app.y)
  })

  it('утечки: число 220 px и без полосы; половинный размер — всё в масштабе', () => {
    const leaks = layoutStory('leaks')
    expect(leaks.big.size).toBe(220)
    expect(leaks.bar).toBeNull()
    const half = layoutStory('goal', { width: 540, height: 960 })
    expect(half).toMatchObject({ margin: 48 })
    expect(half.app).toMatchObject({ x: 48, y: 70, font: `700 22px ${DISPLAY}` })
    expect(half.bar).toEqual({ x: 48, y: 906, width: 444, height: 6, radius: 3 })
    expect(STORY_SIZE).toEqual({ width: 1080, height: 1920 })
  })

  /** Записывающий контекст: что нарисовано и какими цветами. */
  function recorder() {
    const calls: { fn: string; args: unknown[]; fillStyle: unknown; font: string }[] = []
    const ctx = {
      fillStyle: '' as StoryContext['fillStyle'],
      font: '',
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      textAlign: 'left' as CanvasTextAlign,
    } as StoryContext
    for (const fn of ['fillRect', 'fillText', 'drawImage', 'beginPath', 'fill', 'roundRect', 'save', 'restore'] as const) {
      ;(ctx as unknown as Record<string, unknown>)[fn] = (...args: unknown[]) => calls.push({ fn, args, fillStyle: ctx.fillStyle, font: ctx.font })
    }
    // Ширина строки — половина кегля на символ: «Япония · будет нашей в мае 2027» при 56 px входит в 888.
    ctx.measureText = ((text: string) => ({ width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.5 })) as StoryContext['measureText']
    ctx.createLinearGradient = (() => ({ addColorStop: () => {} })) as unknown as StoryContext['createLinearGradient']
    return { ctx, calls }
  }

  it('с фото: cover по большей стороне, градиент, белый текст, полоса на процент; на карточке нет «₸» и сумм', () => {
    const { ctx, calls } = recorder()
    const texts = storyText('goal', { percent: 62, goalName: 'Япония 1 800 000 ₸', doneMonth: 'мае 2027' })
    drawStory(ctx, { width: 1200, height: 800, source: {} as CanvasImageSource }, texts)
    const draw = calls.find((c) => c.fn === 'drawImage')!
    // 1200 × 800 в 1080 × 1920: масштаб 2,4 — 2880 × 1920, по центру.
    expect(draw.args.slice(1)).toEqual([-900, 0, 2880, 1920])
    const printed = calls.filter((c) => c.fn === 'fillText').map((c) => [c.args[0], c.fillStyle, c.font])
    expect(printed.map((p) => p[0])).toEqual(['Family Finance', 'До мечты', '62 %', 'Япония · будет нашей в мае 2027'])
    expect(printed.every((p) => String(p[1]).startsWith('rgb') && String(p[1]).includes('255,255,255'))).toBe(true)
    expect(printed.map((p) => p[2])).toEqual([`700 44px ${DISPLAY}`, `500 40px ${TEXT}`, `700 300px ${NUM}`, lineFont(56)])
    for (const p of printed) expect(String(p[0])).not.toMatch(/₸|\d{1,3}(?:[\s ]\d{3})+/)
    // Полоса: подложка 30 % и заполнение на 62 % ширины.
    const bars = calls.filter((c) => c.fn === 'roundRect').map((c) => c.args)
    expect(bars).toEqual([
      [96, 1812, 888, 12, 6],
      [96, 1812, 888 * 0.62, 12, 6],
    ])
  })

  it('без фото: фон --surface-3 светлой темы и ink-текст; длинное имя ужимается до ширины поля; у утечек полосы нет', () => {
    const { ctx, calls } = recorder()
    drawStory(ctx, null, storyText('goal', { percent: 10, goalName: 'Очень длинное название мечты о доме у моря', doneMonth: 'мае 2027' }))
    // Значение `--surface-3` светлой темы из style.css (canvas переменных не читает).
    expect(calls.find((c) => c.fn === 'fillRect')).toMatchObject({ fillStyle: lightToken('--surface-3'), args: [0, 0, 1080, 1920] })
    expect(calls.some((c) => c.fn === 'drawImage')).toBe(false)
    const line = calls.filter((c) => c.fn === 'fillText').at(-1)!
    expect(String(line.fillStyle)).toBe(`rgb(${rgbOfHex(lightToken('--ink'))})`)
    expect(line.font).not.toBe(lineFont(56))
    expect(Number(/(\d+)px/.exec(line.font)![1])).toBeLessThan(56)

    const leaks = recorder()
    drawStory(leaks.ctx, null, storyText('leaks', { count: 3 }))
    expect(leaks.calls.filter((c) => c.fn === 'fillText').map((c) => c.args[0])).toEqual(['Family Finance', 'За месяц', '−3', 'подписки, без которых можно'])
    expect(leaks.calls.some((c) => c.fn === 'roundRect')).toBe(false)
  })
})
