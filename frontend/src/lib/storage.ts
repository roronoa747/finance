// localStorage без исключений: хранилища может не быть (SSR-тесты), оно бывает закрыто или
// переполнено — тогда чтение отдаёт запасное значение, запись пишет ошибку в консоль.

/** Ответ «остались деньги?» на месяц (Р-19) — на устройстве; читают «Мечты» и «Неделя». */
export const MONTH_END_KEY = 'ff_month_end'

/** Показанные вопросы первого запуска (B2C-19) — на устройстве; выход стирает (`LOCAL_KEYS`). */
export const START_ANSWERED_KEY = 'ff_start_answered'

/**
 * Ключи личной копии операций выписок (`stores/operations.ts`, B2C-07). Выход стирает и их
 * (`LOCAL_KEYS` в `stores/finance.ts`), даже если стор операций ещё не создан.
 */
export const OPERATIONS_STORAGE_KEYS = {
  ops: 'ff_operations',
  cursor: 'ff_operations_cursor',
  pending: 'ff_operations_pending',
  demoUploads: 'ff_statement_uploads_demo',
  /** «Нет, это другое» на предложение сопоставления — на этот месяц (B2C-15). */
  declined: 'ff_match_declined',
} as const

export function readStorage<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeStorage(key: string, value: unknown) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error(`Ошибка записи ${key}:`, e)
  }
}

/**
 * Месяц, на который ответили «остались деньги?» (`MONTH_END_KEY`), — «Мечты» и «Неделя»
 * читают и пишут одним форматом: сырой ключ месяца «2026-09», не JSON. Запись в JSON-виде
 * ('"2026-09"', так писала «Неделя» до критика Блока 3) читается тоже. Нет ответа — null.
 */
export function readMonthEnd(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(MONTH_END_KEY)
    return raw ? raw.replace(/^"(.*)"$/, '$1') : null
  } catch {
    return null
  }
}

/** Ответ «остались деньги?» на месяц `key` — сырой строкой (см. `readMonthEnd`). */
export function writeMonthEnd(key: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(MONTH_END_KEY, key)
  } catch (e) {
    // Хранилище недоступно — спросим ещё раз, это не страшно.
    console.error(`Ошибка записи ${MONTH_END_KEY}:`, e)
  }
}
