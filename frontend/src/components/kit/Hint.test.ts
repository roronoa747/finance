import { describe, it, expect } from 'vitest'
import { hintPosition } from './hintPosition'

describe('PV-23 п. 6: hintPosition — пояснение прижато к краям экрана (React kit.tsx:370-379)', () => {
  it('места хватает (планшет 1024) — окно от левого края знака, под ним на 6 px, ширина 268', () => {
    expect(hintPosition({ left: 150, bottom: 200 }, 1024)).toEqual({ left: 150, top: 206, width: 268 })
  })

  it('знак у правого края — окно прижато вправо с отступом 12, не обрезается', () => {
    const p = hintPosition({ left: 360, bottom: 100 }, 390)
    expect(p.left).toBe(390 - 268 - 12)
    expect(p.left + p.width).toBe(390 - 12)
  })

  it('знак у левого края — не ближе 12 px', () => {
    expect(hintPosition({ left: 2, bottom: 100 }, 390).left).toBe(12)
  })

  it('узкий экран 280 — ширина экрана минус 24, окно по центру между отступами', () => {
    expect(hintPosition({ left: 200, bottom: 0 }, 280)).toEqual({ left: 12, top: 6, width: 256 })
  })
})
