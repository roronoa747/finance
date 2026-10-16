import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiClient, ApiError, type ApiClient } from '@/api/client'
import { buildMonthSummary } from '@/lib/aiSummary'
import { MONTHS_GEN, addMonths, monthKey, parseMonthKey } from '@/lib/dates'
import { liveSpendCategories } from '@/lib/finance'
import { AI_SELLERS_KEY, readStorage, writeStorage } from '@/lib/storage'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { aiSellerNames, type UnknownGroup } from '@/lib/statements/model'
import type { MerchantRule } from '@/lib/statements/types'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useFxStore } from './fx'
import { useOperationsStore } from './operations'
import type { AiConsent, AiReview } from '@/types/finance'

/** Состояние запроса разбора (AI-09) и предложений продавцам (AI-12): идёт, лимит месяца кончился, не вышло. */
export type ReviewState = 'idle' | 'thinking' | 'limit' | 'failed'

/** Предложение раздела продавцу на этом телефоне: `to` — id раздела или null (ИИ не уверен), `at` — когда спросили. */
export interface SellerHint {
  to: string | null
  at: string
}
/** Сколько помнить предложение: старше — продавец спрашивается заново, кэш не растёт (AI-12). */
const SELLER_HINT_MS = 60 * 24 * 60 * 60 * 1000
/** Разделов в запросе — не больше, чем берёт ручка (AI-11). */
const SELLERS_CATEGORIES_MAX = 40

const sellerKey = (match: MerchantRule['match']) => JSON.stringify(match)

/** Кэш предложений без просроченных; мусор — пусто. */
function freshSellerHints(now = Date.now()): Record<string, SellerHint> {
  const all = readStorage<Record<string, SellerHint> | null>(AI_SELLERS_KEY, null)
  const out: Record<string, SellerHint> = {}
  if (!all || typeof all !== 'object') return out
  for (const [k, h] of Object.entries(all)) {
    if (h && typeof h.at === 'string' && now - Date.parse(h.at) < SELLER_HINT_MS) out[k] = h
  }
  return out
}

/**
 * ИИ-помощник (бэклог «ИИ», Р-7, Р-9, Р-10): доступен ли человеку и его согласие. Согласие — один раз на человека,
 * в личном документе (`aiConsent`, общее для его устройств). Функции ИИ зовут `ensureConsent()` перед запросом:
 * «да» — идём, «нет» — функция не вызывается. Лист согласия один на приложение (`AiConsentSheet` в оболочке).
 */
export const useAiStore = defineStore('ai', () => {
  const auth = useAuthStore()
  const finance = useFinanceStore()

  /** Семье включён ИИ (ключ и флаг на сервере), человек — участник, не демо: viewer кнопок ИИ не видит (Р-7). */
  const available = computed(() => auth.ai && !auth.isViewer && !auth.isDemo)

  const consent = computed<'unknown' | 'on' | 'off'>(() => {
    const c = finance.privateDoc.aiConsent as AiConsent | undefined
    return !c ? 'unknown' : c.on ? 'on' : 'off'
  })

  /** Лист «что уходит» открыт — ждёт ответа на `ensureConsent`. */
  const sheetOpen = ref(false)
  /** Лист смонтирован (оболочка): без него спросить нечем — «нет», а не вечное ожидание (экран первого запуска). */
  const sheetMounted = ref(false)
  /** Последний `ensureConsent` не смог спросить: личный документ не подтянулся (нет сети) — экран скажет «не вышло». */
  const consentFailed = ref(false)
  let pending: Promise<boolean> | null = null
  let resolve: ((on: boolean) => void) | null = null

  function setConsent(on: boolean) {
    finance.mutatePrivateDoc((d) => {
      d.aiConsent = { on, at: new Date().toISOString() } satisfies AiConsent
    })
  }

  /** `on` → да без листа; `off` → нет без листа; не спрошено → лист и ответ человека. `client` — для тестов. */
  function ensureConsent(client: ApiClient = apiClient): Promise<boolean> {
    consentFailed.value = false
    if (!available.value || consent.value === 'off') return Promise.resolve(false)
    if (consent.value === 'on') return Promise.resolve(true)
    if (pending) return pending
    if (!sheetMounted.value) return Promise.resolve(false)
    pending = ask(client)
    return pending
  }

  /**
   * Не спрошено на этом телефоне — ответ мог прийти с другого телефона человека, а синк ещё не дошёл (хвост §4
   * ревью frontend Блока 1, Н-4): сначала личный документ с сервера, лист — только если и там не спрошено. Без
   * сети — «нет» без листа: поздний «Не надо» отсюда переписал бы «да» на всех телефонах.
   */
  async function ask(client: ApiClient): Promise<boolean> {
    const pulled = await finance.pullPrivateDoc(client)
    if (consent.value !== 'unknown' || !pulled || !sheetMounted.value) {
      consentFailed.value = consent.value === 'unknown'
      pending = null
      return consent.value === 'on'
    }
    sheetOpen.value = true
    return new Promise<boolean>((r) => (resolve = r))
  }

  /** Ответ листа: «Включить» / «Не надо» записываются; `null` — закрыли (свайп, крестик): на этот раз нет, вопрос остаётся. */
  function answer(on: boolean | null) {
    if (on !== null) setConsent(on)
    sheetOpen.value = false
    const r = resolve
    pending = null
    resolve = null
    r?.(on === true)
  }

  /** Разбор месяца: запрос идёт или чем кончился последний (лист разбора показывает). */
  const reviewState = ref<ReviewState>('idle')

  /**
   * Разбор месяца `key` (AI-09, Р-4): сводка без имён (`buildMonthSummary`, AI-07) → ручка → разбор в общий
   * документ (партнёр видит без запроса). Согласие спрашивает вызывающий (`ensureConsent`). `ai_limit` — «ИИ
   * вернётся 1 <следующего месяца>»; `ai_off` — флаг сняли: `/auth/me` уберёт кнопку; прочее и сеть — «не вышло».
   */
  async function runReview(key: string): Promise<AiReview | null> {
    if (reviewState.value === 'thinking' || !available.value) return null
    reviewState.value = 'thinking'
    const sent = buildMonthSummary(finance.householdDoc, key, new Date(), {
      book: useFxStore().book,
      uploads: useOperationsStore().uploads,
    })
    try {
      const res = await apiClient.aiReview(sent)
      const review = finance.saveAiReview({
        month: key,
        at: new Date().toISOString(),
        by: auth.slot ?? 'a',
        good: res.good,
        risk: res.risk,
        steps: res.steps.map((s) => ({ text: s.text, screen: s.screen ?? null })),
        sent,
      })
      reviewState.value = 'idle'
      return review
    } catch (err) {
      const code = err instanceof ApiError ? err.message : ''
      reviewState.value = code === 'ai_limit' ? 'limit' : 'failed'
      if (code === 'ai_off') void auth.fetchMe().catch(() => {})
      return null
    }
  }

  /** Предложения продавцам: запрос идёт или чем кончился последний (шапка пачки «Без раздела»). */
  const sellersState = ref<ReviewState>('idle')
  /** Предложения на этом телефоне по продавцу пачки (`match`); читаются заново при каждом открытии — выход их стирает. */
  const sellerHints = ref<Record<string, SellerHint>>({})

  /** Предложенный раздел продавцу или null: только с ИИ и согласием — «Не надо» и выключенный ИИ — как без него. */
  function sellerHint(match: MerchantRule['match']): string | null {
    if (!available.value || consent.value !== 'on') return null
    return sellerHints.value[sellerKey(match)]?.to ?? null
  }

  /**
   * Открыли пачку «Без раздела» (AI-12, Р-5): продавцам без предложения (`aiSellerNames` — без переводов людям,
   * «ИП + фамилия» и чисел 6+) — согласие и один запрос; ответ — в кэш телефона на 60 дней, и `null` тоже: повторное
   * открытие не спрашивает уже спрошенных. Ничего не применяется — человек принимает ✓ у продавца. Ошибки — тихо:
   * состояние для шапки; `ai_off` — `/auth/me` уберёт ИИ. Без сети не спрашиваем.
   */
  async function suggestSellers(groups: UnknownGroup[], client: ApiClient = apiClient): Promise<void> {
    sellerHints.value = freshSellerHints()
    if (!available.value || sellersState.value === 'thinking') return
    sellersState.value = 'idle'
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    // Спрошенные — до отбора 50: иначе продавцы сверх 50 не спросятся, пока верхние висят в пачке.
    const ask = aiSellerNames(groups.filter((g) => !(sellerKey(g.match) in sellerHints.value)))
    if (!ask.length || !(await ensureConsent(client))) return
    sellersState.value = 'thinking'
    const categories = liveSpendCategories(finance.householdDoc.spendCategories)
      .filter((c) => c.id !== UNKNOWN_CATEGORY && c.name.trim())
      .slice(0, SELLERS_CATEGORIES_MAX)
      .map((c) => ({ id: c.id, name: c.name }))
    try {
      const res = await client.aiSellers(
        ask.map((s) => s.name),
        categories,
      )
      const to = new Map(res.items.map((i) => [i.name, i.categoryId]))
      const at = new Date().toISOString()
      const next = freshSellerHints()
      for (const s of ask) next[sellerKey(s.match)] = { to: to.get(s.name) ?? null, at }
      writeStorage(AI_SELLERS_KEY, next)
      sellerHints.value = next
      sellersState.value = 'idle'
    } catch (err) {
      const code = err instanceof ApiError ? err.message : ''
      sellersState.value = code === 'ai_limit' ? 'limit' : 'failed'
      if (code === 'ai_off') void auth.fetchMe().catch(() => {})
    }
  }

  return {
    available,
    consent,
    sheetOpen,
    sheetMounted,
    consentFailed,
    setConsent,
    ensureConsent,
    answer,
    reviewState,
    runReview,
    sellersState,
    sellerHint,
    suggestSellers,
  }
})

/** Лимит месяца кончился: «ИИ вернётся 1 ноября» — с месяцем, «1-го» заставляло думать, какого (владелец, `/ux` Блока 2). */
export const aiLimitText = () => `ИИ вернётся 1 ${MONTHS_GEN[parseMonthKey(addMonths(monthKey(), 1)).month]}`

/** Кто получает и что уходит (Р-9) — одни слова для листа согласия и подсказки в настройках. */
export const AI_TO = 'Claude от Anthropic'
export const AI_SENDS = ['Цифры месяца и названия статей без ваших имён', 'Названия продавцов', 'Скриншот товара'] as const
export const AI_NO_TRAINING = 'На ваших данных не обучается'
