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
