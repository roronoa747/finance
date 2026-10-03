import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { addDaysIso, todayIso } from '@/lib/dates'
import { docCurrencies } from '@/lib/finance'
import { bookWindow, demoRateBook } from '@/lib/fx'
import { FX_BOOK_KEY, readStorage, writeStorage } from '@/lib/storage'
import type { Currency, RateBook } from '@/types/finance'

// Книга курсов Нацбанка (B2C-77, Р-72): код → день → курс из `GET /api/fx-rates`, кэш на
// устройстве (`FX_BOOK_KEY`, выход стирает). Расчёты получают `book` параметром. Демо — своя
// синтетическая книга без запросов. Офлайн и ошибки — остаётся то, что есть.

/** Сколько раз переспросить период, если сервер догрузил у банка не всё (`partial`). */
export const FX_RETRIES = 3
/** Пауза перед повтором `partial`, мс. */
export const FX_RETRY_MS = 2_000

/** Загруженный без пропусков отрезок дней валюты: следующий запрос берёт только края. */
type Covered = { from: string; to: string }
type Saved = { book: RateBook; covered: Partial<Record<Currency, Covered>> }

/** Отрезки `from..to`, которых нет в `cov`. */
function gaps(cov: Covered | undefined, from: string, to: string): [string, string][] {
  if (!cov) return [[from, to]]
  const out: [string, string][] = []
  if (from < cov.from) out.push([from, to < cov.from ? to : addDaysIso(cov.from, -1)])
  if (to > cov.to) out.push([from > cov.to ? from : addDaysIso(cov.to, 1), to])
  return out
}

/** Отрезок после загрузки `from..to`: смежный или пересекающийся — объединение, иначе новый. */
function cover(cov: Covered | undefined, from: string, to: string): Covered {
  if (!cov || from > addDaysIso(cov.to, 1) || to < addDaysIso(cov.from, -1)) return { from, to }
  return { from: from < cov.from ? from : cov.from, to: to > cov.to ? to : cov.to }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const useFxStore = defineStore('fx', () => {
  const auth = useAuthStore()
  const finance = useFinanceStore()
  // Демо — токен демо или документ демо-семьи (`finance.isDemo`): запросов нет.
  const demo = () => auth.isDemo || finance.isDemo
  const saved = readStorage<Saved>(FX_BOOK_KEY, { book: {}, covered: {} })
  const loaded = ref<RateBook>(saved.book ?? {})
  const covered = ref<Partial<Record<Currency, Covered>>>(saved.covered ?? {})

  /** Книга для расчётов: демо — синтетическая (Р-72), иначе загруженная. */
  const book = computed<RateBook>(() => (demo() ? demoRateBook(todayIso()) : loaded.value))

  const persist = () => writeStorage(FX_BOOK_KEY, { book: loaded.value, covered: covered.value } satisfies Saved)

  // Выход: память тоже пустеет (ключ стирает `clearLocal`), следующий вход грузит свою.
  watch(
    () => auth.token,
    (token) => {
      if (token) return
      loaded.value = {}
      covered.value = {}
    },
  )

  const inFlight = new Map<Currency, Promise<void>>()

  async function loadRange(client: ApiClient, code: Currency, from: string, to: string, pause: number) {
    for (let attempt = 0; ; attempt++) {
      let res
      try {
        res = await client.fxRates(code, from, to)
      } catch {
        return // офлайн, 409 без семьи, сбой — остаётся то, что есть
      }
      loaded.value = { ...loaded.value, [code]: { ...(loaded.value[code] ?? {}), ...res.rates } }
      if (!res.partial) covered.value = { ...covered.value, [code]: cover(covered.value[code], from, to) }
      persist()
      if (!res.partial || attempt >= FX_RETRIES) return
      await wait(pause)
    }
  }

  /**
   * Догрузить курсы валют `codes` за `from..to`: только дни вне загруженного отрезка; `partial` —
   * переспросить до `FX_RETRIES` раз с паузой. Демо и без входа — ничего не запрашивает.
   */
  async function ensureRates(codes: Currency[], from: string, to: string, client: ApiClient = apiClient, pause = FX_RETRY_MS) {
    if (demo() || !auth.token) return
    await Promise.all(
      codes
        .filter((code) => code !== 'KZT')
        .map((code) => {
          const prev = inFlight.get(code) ?? Promise.resolve()
          const next = prev.then(async () => {
            for (const [f, t] of gaps(covered.value[code], from, to)) await loadRange(client, code, f, t, pause)
          })
          inFlight.set(code, next)
          return next.finally(() => {
            if (inFlight.get(code) === next) inFlight.delete(code)
          })
        }),
    )
  }

  /** Курсы валют документа за период книги (13 месяцев до сегодня) — зовёт движок синка. */
  function ensureDocRates(client: ApiClient = apiClient) {
    const { from, to } = bookWindow(todayIso())
    return ensureRates(docCurrencies({ accounts: finance.accounts, people: finance.people, obligations: finance.obligations }), from, to, client)
  }

  return { book, ensureRates, ensureDocRates }
})
