export type FxRates = {
  rates: Record<string, number>
  /** Дата, на которую опубликован курс. */
  date: string
  source: string
}

/**
 * Курс валют от Национального банка Казахстана (заглушка или обращение к API).
 */
export async function fetchRates(): Promise<FxRates | null> {
  return null
}
