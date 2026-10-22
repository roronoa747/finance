import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { apiClient, ApiError, type ApiClient } from '@/api/client'
import { buildReviewFactsV4 } from '@/lib/aiFacts'
import { demoReview } from '@/lib/demo'
import { MONTHS_GEN, addMonths, monthKey, parseMonthKey } from '@/lib/dates'
import { countedPayments, liveSpendCategories, periodMonth, reviewCardOrder, reviewCards, reviewWork } from '@/lib/finance'
import { AI_SELLERS_KEY, readAiAuto, readAiReviewSeen, readStorage, writeAiAuto, writeAiReviewSeen, writeStorage, type AiAutoTry } from '@/lib/storage'
import { UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { aiSellerNames, type UnknownGroup } from '@/lib/statements/model'
import type { MerchantRule } from '@/lib/statements/types'
import { useAuthStore } from './auth'
import { useFinanceStore } from './finance'
import { useOperationsStore } from './operations'
import type { AiConsent, AiReview, OpenTarget, Payment, ReviewReason } from '@/types/finance'

/** Состояние запроса разбора (AI-09) и предложений продавцам (AI-12): идёт, лимит месяца кончился, не вышло. */
export type ReviewState = 'idle' | 'thinking' | 'limit' | 'failed'

/** Предложение раздела продавцу на этом телефоне: `to` — id раздела или null (ИИ не уверен), `at` — когда спросили. */
export interface SellerHint {
  to: string | null
  at: string
}
/** Сколько помнить предложение: старше — продавец спрашивается заново, кэш не растёт (AI-12). */
const SELLER_HINT_MS = 60 * 24 * 60 * 60 * 1000
/** Повтор неудавшегося разбора сам — не чаще (Р-4). */
const DAY_MS = 24 * 60 * 60 * 1000
/**
 * Окно ответа ручки разбора: 55 с на сервере (`reviewDeadline`) плюс сеть. Попытка без исхода моложе окна — запрос,
 * возможно, ещё идёт (вторая вкладка того же телефона); старше — страница не дожила до ответа (RZ-HF2).
 */
const REVIEW_INFLIGHT_MS = 90 * 1000
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

  /**
   * «Да» старого списка (v1 — без разбора сам, чека и фразы) — снова «не спрошено»: лист покажется ещё раз один раз
   * (Р-12, Р-22). «Не надо» любой версии — «нет»: не переспрашиваем, включить — в настройках.
   */
  const consent = computed<'unknown' | 'on' | 'off'>(() => {
    const c = finance.privateDoc.aiConsent as AiConsent | undefined
    if (!c) return 'unknown'
    if (!c.on) return 'off'
    return (c.v ?? 1) >= AI_CONSENT_V ? 'on' : 'unknown'
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
      d.aiConsent = { on, at: new Date().toISOString(), v: AI_CONSENT_V } satisfies AiConsent
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

  /** Запрос разбора в полёте — один на телефон: «Разобрать» во время разбора сам ждёт тот же ответ. */
  let inflight: Promise<AiReview | string> | null = null

  /** Ключ повода (Р-20; v4 — свой у каждого, бэклог «Фидбек», Р-27): `month:<key>`, `salary:<key>`; у «Обновить» нет. */
  const reasonKeyOf = (reason: ReviewReason, key: string): string | undefined =>
    reason === 'month' ? `month:${key}` : reason === 'salary' ? `salary:${key}` : undefined

  /** Свои операции, правила «В платежи» — для карточек кода (FB-15); стор операций — лениво (он тяжёлый). */
  const cardsInput = () => {
    const ops = useOperationsStore()
    return { ops: ops.all, opts: { recurringFor: ops.recurringFor } }
  }

  /**
   * Разбор v4 месяца `key` (бэклог «Фидбек», Р-23, Р-26, Р-27): карточки кода по своим операциям и факты
   * (`buildReviewFactsV4`, без имён людей и участников) → ручка → одна главная мысль и id следующей карточки → разбор в
   * **личный** документ (партнёр его не видит). Карточек нет — не спрашиваем (`ai_failed` без запроса); `next` не из
   * присланных — `ai_failed`. Счётчик работы — свои операции и карточки (`reviewWork(…, by)`). Ошибка — код ручки строкой
   * (`ai_limit`, `ai_failed`, …; сеть — `network`); `ai_off` — флаг сняли: `/auth/me` уберёт ИИ. Не сохранён — отчёт
   * показывает карточки кода без мысли (FB-17).
   */
  function requestReview(key: string, reason: ReviewReason, client: ApiClient): Promise<AiReview | string> {
    if (inflight) return inflight
    inflight = (async () => {
      const input = finance.planInput(key)
      const by = auth.slot ?? 'a'
      const { ops, opts } = cardsInput()
      const { payload, cards, cardById, labels } = buildReviewFactsV4(finance.householdDoc, input, ops, by, reason, opts)
      if (!payload.facts.length || !payload.cards.length) return 'ai_failed'
      try {
        const res = await client.aiReview({ reason, ...payload })
        const next = cardById.get(res.next)
        if (!next) return 'ai_failed'
        const f = res.figure ? payload.facts.find((x) => x.id === res.figure) : undefined
        const label = f ? labels.get(f.id) : undefined
        const reasonKey = reasonKeyOf(reason, key)
        return finance.saveAiReview({
          month: key,
          at: new Date().toISOString(),
          by,
          good: '',
          risk: '',
          steps: [],
          v: 4,
          reason,
          ...(reasonKey ? { reasonKey } : {}),
          lead: { title: res.title, text: res.text, figure: f ? { about: f.about, value: f.value, ...(label ? { label } : {}) } : null },
          next: next.id,
          work: reviewWork(input.state, input.ctx, cards, cards, by),
          sent: payload,
        })
      } catch (err) {
        const code = err instanceof ApiError ? err.message : 'network'
        if (code === 'ai_off') void auth.fetchMe().catch(() => {})
        return code
      }
    })().finally(() => (inflight = null))
    return inflight
  }

  /**
   * Разбор по нажатию (✦ «Разобрать» — повод `month`, «Обновить» — `refresh`): согласие спрашивает вызывающий
   * (`ensureConsent`). `ai_limit` — «ИИ вернётся 1 <следующего месяца>»; прочее и сеть — «не вышло».
   */
  async function runReview(key: string, reason: ReviewReason = 'month', client: ApiClient = apiClient): Promise<AiReview | null> {
    if (reviewState.value === 'thinking' || !available.value) return null
    reviewState.value = 'thinking'
    const r = await requestReview(key, reason, client)
    if (typeof r === 'string') {
      reviewState.value = r === 'ai_limit' ? 'limit' : 'failed'
      return null
    }
    reviewState.value = 'idle'
    return r
  }

  /**
   * Свои отметки зарплаты месяца `key` (аванс и недели — тоже), ранняя запись первой; дубли офлайн-отметок с двух
   * телефонов схлопнуты (`countedPayments`). Одно правило повода `salary` для `autoReason` и оболочки.
   */
  function salaryMarks(key: string): Payment[] {
    return countedPayments(finance.householdDoc.payments ?? [])
      .filter((p) => p.kind === 'salary' && p.targetId === auth.slot && periodMonth(p.period) === key)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  }

  /**
   * Повод разбора сам в месяце `key` (Р-20) по **своим** разборам v4 (личный документ, бэклог «Фидбек», Р-27): разбор
   * партнёра и общий v1–v3 месяца повод не закрывают — каждый участник получает свой первый v4 сам. Нет своего
   * `month:<key>` — `month`; иначе своя первая отметка зарплаты месяца (аванс и недели — та же отметка, не новые поводы)
   * без своего `salary:<key>` и без своего разбора позже неё (тот уже видел зарплату) — `salary`; иначе ничего. Надгробия
   * обрезки «живых ≤ 12» (`saveAiReview`) тоже считаются: повод их уже был — иначе частое «Обновить» вернёт повод.
   */
  function autoReason(key: string): 'month' | 'salary' | null {
    const reviews = finance.myAiReviews.filter((r) => r.month === key)
    if (!reviews.some((r) => r.reasonKey === `month:${key}`)) return 'month'
    const mark = salaryMarks(key)[0]
    // Когда отметку записали (`updatedAt`), а не день прихода (`at` аванса — его день): разбор позже записи её видел.
    if (!mark || reviews.some((r) => r.reasonKey === `salary:${key}` || r.at > mark.updatedAt)) return null
    return 'salary'
  }

  /**
   * Разбор сам (Р-4, Р-20, AU-13) — зовут движок синка после подтянутого общего документа и оболочка после своей
   * «Пришла». Участник с ИИ (`available`: не viewer, не демо), в сети, есть повод текущего месяца. «Да» текущей версии
   * согласия (`AI_CONSENT_V`) — запрос в фоне, без «Думаю…»; «да» прежней версии — лист согласия один раз на повод
   * (закрыл — до следующего повода); не спрошено никогда или «Не надо» — молча ничего. 429 / 502 / сеть, тело старой
   * версии (400) и семья без кнопок (`ai_failed` без запроса) — молча, тот же повод на этом телефоне — не чаще раза в
   * сутки (`ff_ai_auto`, попытка пишется до запроса, исход — после). Страница не дожила до ответа (перезагрузка,
   * закрытый PWA: ответ идёт 5–55 с; владелец 2026-10-18 — 33 открытия за 2 минуты, ответ 200 пришёл на мёртвую
   * страницу, RZ-HF2) — попытка без исхода: повод повторяется один раз, как только окно ответа вышло; второй обрыв
   * подряд — сутки. Один запрос за раз.
   */
  async function autoReview(client: ApiClient = apiClient): Promise<AiReview | null> {
    if (!available.value || consent.value === 'off' || inflight) return null
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
    const key = monthKey()
    const reason = autoReason(key)
    if (!reason) return null
    // Своих карточек нет (выписка ещё не загружена или не подтянулась) — спрашивать не о чем, и попытку не пишем: иначе
    // выписка того же дня ждала бы разбора сутки.
    const { ops, opts } = cardsInput()
    const { state, ctx } = finance.planInput(key)
    if (!reviewCards({ ...finance.householdDoc, ...state }, ctx, ops, auth.slot ?? 'a', opts).length) return null
    // Попытка v4 — своя (`v4:month:<key>`): попытка v3 того же утра (прошлая сборка) не держит её сутки.
    const rk = `v4:${reasonKeyOf(reason, key)!}`
    // Попытки — только этого месяца: прошлые поводы не копятся.
    const mine = () => Object.fromEntries(Object.entries(readAiAuto()).filter(([k]) => k.endsWith(`:${key}`)))
    // Запись после ожидания — в свежую карту целиком: пока ждали, месяц мог смениться, и попытка нового месяца (вторая
    // вкладка) стёрлась бы фильтром `mine()` — повод октября заплатил бы третий раз (критик RZ-HF2).
    const patch = (p: AiAutoTry) => {
      const all = readAiAuto()
      writeAiAuto({ ...all, [rk]: { ...all[rk], ...p } })
    }
    const tried = mine()[rk]
    const age = tried?.at ? Date.now() - Date.parse(tried.at) : Infinity
    // Попытка за сутки: с исходом или уже повторная — молчим; без исхода и моложе окна ответа — запрос, возможно, ещё
    // идёт (вторая вкладка) — ждём; без исхода и старше окна — оборвана, идём повторять один раз (`lost`).
    if (age < DAY_MS && (tried!.done || tried!.retry || age < REVIEW_INFLIGHT_MS)) return null
    const lost = age < DAY_MS
    if (consent.value === 'unknown') {
      // Не спрошено никогда — ИИ ещё не включали: сам не зовём. «Да» прежней версии — спросить заново один раз на повод.
      const c = finance.privateDoc.aiConsent as AiConsent | undefined
      // Листа нет (экран без оболочки) — спросить нечем: повод не тратим.
      if (!c?.on || tried?.asked || !sheetMounted.value) return null
      writeAiAuto({ ...mine(), [rk]: { ...tried, asked: true } })
      const ok = await ensureConsent(client)
      // Личный документ не подтянулся — лист не показан: повод не «спрошен», спросим на следующем круге.
      if (consentFailed.value) patch({ asked: undefined })
      if (!ok || autoReason(key) !== reason) return null
    }
    // Попытка — до запроса, исход — после: закрыли PWA посреди запроса — повтор один раз после окна ответа, не каждый
    // pull (RZ-HF2; до него — сутки, приёмка). Удачный разбор закрывает повод сам (`autoReason`).
    writeAiAuto({ ...mine(), [rk]: { ...mine()[rk], at: new Date().toISOString(), done: undefined, retry: lost || undefined } })
    const r = await requestReview(key, reason, client)
    // Исход — только ответ сервера (разбор или код ручки). Сбой сети неотличим от потерянного ответа: перезагрузка
    // обрывает fetch, и этот код ещё успевает выполниться (Chrome) — такая попытка остаётся «без исхода».
    if (r !== 'network') patch({ done: true })
    return typeof r === 'string' ? null : r
  }

  /** Открытый на этом телефоне разбор (`ff_ai_review_seen`): другой — точка у ✦, на «Месяце» и на «Плане». */
  const seenReview = ref(readAiReviewSeen())
  function markReviewSeen(id: string) {
    writeAiReviewSeen(id)
    seenReview.value = id
  }
  /** Разбор текущего месяца есть и на этом телефоне не открыт (Р-4) — и у viewer: он видит сохранённый. */
  const reviewUnseen = computed(() => {
    if (!auth.ai || auth.isDemo) return false
    const r = finance.aiReviewOf(monthKey())
    return !!r && r.id !== seenReview.value
  })

  /**
   * ✦ у предметов (бэклог «Разбор», Р-9, Р-23, RZ-10): предмет совета разбора v3 **текущего месяца** → номер совета
   * (1…3, карточка отчёта `/month?review=1&card=<n>`). «Открыть» — `kind:id` цели, у продавца — ещё его раздел
   * (`cat:<categoryId>`); «Сделать» — раздел, откуда (`cat:`), и мечта / подушка, куда (`goal:`), досрочка — кредит
   * карточки долга очереди (`credit:`, как берёт `stepCandidates`). Первый совет на предмет побеждает. Отчёт открывается
   * только с ИИ семьи (или в демо — по заготовке), иначе ✦ вёл бы в пустоту — меток нет; у v1/v2 советов нет.
   */
  const adviceMarks = computed(() => {
    const out = new Map<string, number>()
    if (!auth.ai && !auth.isDemo) return out
    const key = monthKey()
    const review = auth.isDemo ? demoReview(finance.householdDoc, finance.planInput(key), useOperationsStore().all) : finance.aiReviewOf(key)
    const put = (k: string, n: number) => {
      if (!out.has(k)) out.set(k, n)
    }
    const debtCredit = () => finance.monthPlanOf(key).queue.find((q) => q.kind === 'debt' && q.creditId)?.creditId
    if (review?.v === 4) {
      // v4 (бэклог «Фидбек», Р-27): предметы карточек кода на «Месяце» — раздел и платёж; номер — место карточки в
      // отчёте (`reviewCardOrder`: следующая за мыслью — первой). Карточки — свежие, по своим операциям.
      const { ops, opts } = cardsInput()
      const { state, ctx } = finance.planInput(key)
      const cards = reviewCardOrder(reviewCards({ ...finance.householdDoc, ...state }, ctx, ops, auth.slot ?? 'a', opts), review.next)
      cards.forEach((c, i) => {
        const t = c.target
        if (t.kind === 'cat' || t.kind === 'plan') put(`cat:${t.categoryId}`, i + 1)
        else if (t.kind === 'obligation') put(`obligation:${t.obligationId}`, i + 1)
        else if (t.kind === 'image') put(`cat:${t.image.categoryId}`, i + 1)
      })
      return out
    }
    if (review?.v !== 3) return out
    ;(review.advices ?? []).forEach((a, i) => {
      const n = i + 1
      if (a.action.kind === 'open') {
        const t = a.action.target
        put(`${t.kind}:${t.id}`, n)
        if (t.kind === 'seller' && t.categoryId) put(`cat:${t.categoryId}`, n)
        return
      }
      const { from, to } = a.action.candidate.shift
      if (from !== 'rest') put(`cat:${from.categoryId}`, n)
      if (to !== 'debt') put(`goal:${to.goalId}`, n)
      else {
        const id = debtCredit()
        if (id) put(`credit:${id}`, n)
      }
    })
    return out
  })
  /** Номер совета про предмет или null — проп `n` у `AdviceMark`. */
  const markFor = (kind: OpenTarget['kind'], id: string | null | undefined): number | null =>
    (id ? adviceMarks.value.get(`${kind}:${id}`) : undefined) ?? null

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
    autoReview,
    salaryMarks,
    seenReview,
    markReviewSeen,
    reviewUnseen,
    adviceMarks,
    markFor,
    sellersState,
    sellerHint,
    suggestSellers,
  }
})

/** Лимит месяца кончился: «ИИ вернётся 1 ноября» — с месяцем, «1-го» заставляло думать, какого (владелец, `/ux` Блока 2). */
export const aiLimitText = () => `ИИ вернётся 1 ${MONTHS_GEN[parseMonthKey(addMonths(monthKey(), 1)).month]}`

/**
 * Версия согласия (бэклог «ИИ-польза», Р-12; v3 — «Разбор», Р-21): список ниже изменился — «да» прежней версии
 * спрашивается ещё раз один раз.
 */
export const AI_CONSENT_V = 3

/**
 * Кто получает и что уходит (Р-9; v2 — бэклог «ИИ-польза», Р-12; v3 — «Разбор», Р-7, Р-21: продавцы и суммы находок —
 * частые траты, списания и 1–2 крупнейшие покупки раздела, «что раздуло») — одни слова для листа согласия и подсказки в
 * настройках. `AI_AUTO` — не «что», а «когда» (разбор без нажатия): в листе — строкой под списком (Х-16), в подсказке
 * настроек — отдельной фразой. Слова v3 — черновик, финал `/ux` Блока 2.
 */
export const AI_TO = 'Claude от Anthropic'
export const AI_AUTO = 'Разбор приходит сам — 1-го и после зарплаты'
export const AI_SENDS = [
  'Цифры месяца и названия статей без ваших имён',
  'Продавцы и суммы частых трат, списаний и крупных покупок',
  'Скриншот товара',
  'Фото чека',
  'Фраза о мечте',
] as const
export const AI_NO_TRAINING = 'На ваших данных не обучается'
