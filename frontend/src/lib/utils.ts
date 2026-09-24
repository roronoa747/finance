import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Слово при числе по-русски: plural(21, 'платёж', 'платежа', 'платежей') — «платёж»,
 * 24 — «платежа», 11 и 25 — «платежей». Число экран ставит сам.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const t = Math.abs(n) % 10
  const h = Math.abs(n) % 100
  if (h >= 11 && h <= 14) return many
  if (t === 1) return one
  if (t >= 2 && t <= 4) return few
  return many
}
