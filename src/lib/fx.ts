import { supabase } from '@/lib/supabase'

export type FxRates = {
  rates: Record<string, number>
  /** Дата, на которую опубликован курс. Может быть вчерашней: в выходные курса нет. */
  date: string
  source: string
}

/**
 * Курс валют от Национального банка Казахстана.
 *
 * Ходит через функцию на сервере, а не напрямую: сайт банка не разрешает
 * запросы со сторонних страниц, и из браузера обращение просто не состоится.
 *
 * Возвращает null, если облако не подключено или банк недоступен — тогда
 * курс вводится руками, как раньше. Отсутствие курса не должно мешать
 * завести счёт.
 */
export async function fetchRates(): Promise<FxRates | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke<FxRates>('fx-rate')
    if (error || !data?.rates) return null
    return data
  } catch {
    return null
  }
}
