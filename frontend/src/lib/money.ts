/**
 * Деньги хранятся ЦЕЛЫМИ ТЕНГЕ. Никаких дробей и никаких float в состоянии.
 *
 * Почему не тиыны: тиын не ходит в обороте, а лишний множитель ×100 в каждом
 * расчёте — это источник ошибок округления. Когда появятся валютные счета,
 * добавляем поле currency + minorExponent и переводим хранение в минорные
 * единицы одной миграцией: все суммы ×100 для KZT/USD/EUR.
 */

const NBSP = ' '

/** 1050000 → «1 050 000» */
export function plain(v: number): string {
  return Math.round(v).toLocaleString('ru-RU').replace(/[\s  ]/g, NBSP)
}

/** 1050000 → «1 050 000 ₸» */
export function money(v: number): string {
  return plain(v) + NBSP + '₸'
}

/** Компактно для тесных мест: 1234567 → «1,2 млн ₸» */
export function moneyShort(v: number): string {
  const a = Math.abs(v)
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(1).replace('.', ',') + NBSP + 'млн' + NBSP + '₸'
  if (a >= 100_000) return Math.round(v / 1000) + NBSP + 'тыс.' + NBSP + '₸'
  return money(v)
}

/** «1 050 000 ₸», «1050000», «1 050 000» → 1050000 */
export function parseMoney(s: string): number {
  const n = parseInt(String(s).replace(/[^\d-]/g, ''), 10)
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
