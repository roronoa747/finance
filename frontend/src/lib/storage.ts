// localStorage без исключений: хранилища может не быть (SSR-тесты), оно бывает закрыто или
// переполнено — тогда чтение отдаёт запасное значение, запись пишет ошибку в консоль.

/**
 * Ключи личной копии операций выписок (`stores/operations.ts`, B2C-07). Выход стирает и их
 * (`LOCAL_KEYS` в `stores/finance.ts`), даже если стор операций ещё не создан.
 */
export const OPERATIONS_STORAGE_KEYS = {
  ops: 'ff_operations',
  cursor: 'ff_operations_cursor',
  pending: 'ff_operations_pending',
  demoUploads: 'ff_statement_uploads_demo',
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
