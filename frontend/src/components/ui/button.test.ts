import { describe, expect, it } from 'vitest'
import { buttonVariants } from './button'

/** Кит пачки 2 «Figma» (FG-19): главная 44 с окантовкой `--brand-edge`, компактная вторая 40. */
describe('buttonVariants — размеры пачки 2', () => {
  it('главная (`default`, `lg`) — 44 px, текст 15, не 52', () => {
    for (const size of ['default', 'lg'] as const) {
      const cls = buttonVariants({ size })
      expect(cls).toContain('h-11')
      expect(cls).toContain('text-[15px]')
      expect(cls).not.toContain('h-13')
    }
  })

  it('компактная вторая `md` — 40 px; `sm` 32 и `xs` 26 — как были', () => {
    expect(buttonVariants({ size: 'md' })).toContain('h-10')
    expect(buttonVariants({ size: 'sm' })).toContain('h-8')
    expect(buttonVariants({ size: 'xs' })).toContain('h-[26px]')
  })

  it('окантовка `--brand-edge` — только у брендовой', () => {
    expect(buttonVariants({ variant: 'default' })).toContain('var(--brand-edge)')
    for (const variant of ['secondary', 'outline', 'ghost', 'soft', 'destructive'] as const) {
      expect(buttonVariants({ variant })).not.toContain('--brand-edge')
    }
  })
})
