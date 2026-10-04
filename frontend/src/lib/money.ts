/**
 * Деньги хранятся ЦЕЛЫМИ ТЕНГЕ. Никаких дробей и никаких float в состоянии.
 *
 * Почему не тиыны: тиын не ходит в обороте, а лишний множитель ×100 в каждом
 * расчёте — это источник ошибок округления. Суммы в валюте — тоже целые единицы
 * валюты, без центов (Р-70); тенге из валюты — только `fxToTenge` (`lib/finance`).
 */

import type { Currency } from '@/types/finance'
import { CURRENCY_SIGN } from '@/lib/fx'

const NBSP = ' '
/** Типографский минус (U+2212): у локали и `toFixed` — дефис, в макетах и рядом (`−` + `plain(abs)`) — «−». */
const MINUS = '−'

/** 1050000 → «1 050 000», −5000 → «−5 000» */
export function plain(v: number): string {
  return Math.round(v).toLocaleString('ru-RU').replace(/[\s  ]/g, NBSP).replace('-', MINUS)
}

/** 1050000 → «1 050 000 ₸» */
export function money(v: number): string {
  return plain(v) + NBSP + '₸'
}

/** Со знаком: 15750 → «+15 750 ₸», −201000 → «−201 000 ₸», 0 → «0 ₸» (курс за год, B2C-82). */
export function moneySigned(v: number): string {
  return v > 0 ? `+${money(v)}` : money(v)
}

/** Цвет суммы со знаком (токены): минус — `text-destructive`, плюс — `text-ok`, ноль — `zero`. */
export function signTone(v: number, zero = 'text-ink'): string {
  return v < 0 ? 'text-destructive' : v > 0 ? 'text-ok' : zero
}

/** Компактно для тесных мест: 1234567 → «1,2 млн ₸» */
export function moneyShort(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',').replace('-', MINUS) + NBSP + 'млн' + NBSP + '₸'
  if (a >= 100_000) return String(Math.round(v / 1000)).replace('-', MINUS) + NBSP + 'тыс.' + NBSP + '₸'
  return money(v)
}

/** «1 050 000 ₸», «1050000», «1 050 000» → 1050000; «−5 000» и «-5 000» → −5000 */
export function parseMoney(s: string): number {
  const n = parseInt(String(s).replace(MINUS, '-').replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

/** Доля в процентах, округлённая до целого. */
export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

/** 0.1781 → «17,81%» */
export function ratePct(r: number, digits = 2): string {
  return (r * 100).toFixed(digits).replace('.', ',') + '%'
}

/**
 * Ставка в поле ввода — проценты до сотых без хвоста двоичной дроби и лишних нулей: 0.14 → «14»
 * (0,14 × 100 в JS — 14,000000000000002), 0.1425 → «14,25». Вклад и кредит (хвост §4, приёмка Блока 3).
 */
export const rateField = (r: number) => String(Math.round(r * 10_000) / 100).replace('.', ',')

/** Сумма в своей валюте: 2500, EUR → «2 500 €»; тенге — как `money` (B2C-78). */
export function moneyIn(v: number, currency: Currency = 'KZT'): string {
  return currency === 'KZT' ? money(v) : plain(v) + NBSP + CURRENCY_SIGN[currency]
}
