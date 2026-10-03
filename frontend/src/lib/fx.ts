import type { Currency, RateBook } from '@/types/finance'
import { shiftIsoMonths } from '@/lib/dates'

/** Валюты приложения в порядке чипов форм (KZT — первый, по умолчанию). */
export const CURRENCIES: Currency[] = ['KZT', 'USD', 'EUR', 'RUB', 'CNY']

/** Знаки валют — одна таблица для форм и подписей (B2C-77). */
export const CURRENCY_SIGN: Record<Currency, string> = { KZT: '₸', USD: '$', EUR: '€', RUB: '₽', CNY: '¥' }

/** Сколько месяцев истории держит книга курсов: год и запас на «тот же день год назад» (Р-72, Р-76). */
export const BOOK_MONTHS = 13

/** Период книги курсов: `BOOK_MONTHS` месяцев назад до сегодня, `YYYY-MM-DD`. */
export function bookWindow(today: string): { from: string; to: string } {
  return { from: shiftIsoMonths(today, -BOOK_MONTHS), to: today }
}

/**
 * Синтетическая книга демо-режима (Р-72): евро и доллар на каждый день периода книги без
 * запросов — евро плавно дешевеет с 640 до 506 ₸, доллар — с 545 до 452 ₸, с мелкой рябью
 * по дням. Курс — не деньги: дробный, до сотых, как публикует Нацбанк.
 */
export function demoRateBook(today: string): RateBook {
  const { from } = bookWindow(today)
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${today}T00:00:00Z`)
  const span = Math.max(1, end - start)
  const eur: Record<string, number> = {}
  const usd: Record<string, number> = {}
  for (let t = start, i = 0; t <= end; t += 86_400_000, i++) {
    const day = new Date(t).toISOString().slice(0, 10)
    const k = (t - start) / span
    const ripple = Math.sin(i / 3) * 2.5
    eur[day] = Math.round((640 - 134 * k + ripple) * 100) / 100
    usd[day] = Math.round((545 - 93 * k + ripple * 0.8) * 100) / 100
  }
  return { EUR: eur, USD: usd }
}

export type FxRates = {
  rates: Record<string, number>
  /** Дата, на которую опубликован курс. */
  date: string
  source: string
}

/**
 * Курс валют Национального банка Казахстана через `GET /api/fx-rate`
 * (браузер к банку напрямую не пускают — ходит бэкенд). Ручка публичная,
 * работает и в демо-режиме. Любая ошибка → `null`: форма даёт ввести курс руками.
 */
export async function fetchRates(fetchImpl: typeof fetch = fetch): Promise<FxRates | null> {
  try {
    const res = await fetchImpl('/api/fx-rate')
    if (!res.ok) return null
    const body = (await res.json()) as Partial<FxRates>
    if (!body.rates || typeof body.date !== 'string') return null
    return { rates: body.rates, date: body.date, source: body.source ?? '' }
  } catch {
    return null
  }
}

/**
 * Курс в поле формы счёта: вписанный руками курс не трогаем; иначе — курс
 * выбранной валюты (при смене валюты авто-курс меняется вместе с ней).
 * Стёртое поле снова заполняется автоматически.
 */
export function formRate(
  info: FxRates | null,
  currency: string,
  current: string,
  touched: boolean,
): string {
  if (touched && current) return current
  const auto = info?.rates?.[currency]
  return auto ? String(auto) : ''
}
