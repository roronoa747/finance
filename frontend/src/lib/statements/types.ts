import type { HueKey } from '@/lib/palette'
import type { PersonId, Tracked } from '@/types/finance'

export type BankId = 'kaspi' | 'freedom'

/**
 * Вид операции. `income` — доход (зарплата — когда банк её напечатает, CORPUS.md);
 * `transfer-in` — приход от человека или со своего счёта; `cash` — снятие наличных;
 * `fee` — комиссия банка; `other` — всё, что не легло в остальные.
 */
export type OperationKind = 'purchase' | 'transfer-out' | 'transfer-in' | 'income' | 'cash' | 'fee' | 'other'

/** Личная операция выписки (Р-5). Без ФИО и номеров: Р-23. */
export interface Operation {
  /** Отпечаток (`fingerprint`): повторная загрузка того же периода даёт те же id. */
  id: string
  bank: BankId
  /** Дата операции, как её печатает банк (календарь Алматы). */
  date: string
  /** Целые тенге, минус — списание. Тиын отбрасываются при разборе. */
  amount: number
  kind: OperationKind
  /** Продавец или детали, как печатает банк, очищено (`sanitize`). */
  merchant: string
  /** Имя и инициал у переводов людям («Дана К.»). */
  counterparty?: string
  note?: string
  /** Раздел трат (`SpendCategory.id`); null — не узнано. */
  categoryId: string | null
  /** Перевод между своими счетами и банками или партнёру — в траты не входит. */
  internal: boolean
  uploadId?: string
}

/** Раздел трат — отдельно от разделов бюджета d1…d5 (Р-22). */
export type SpendCategory = Tracked & {
  id: string
  name: string
  hue: HueKey
  order: number
  /**
   * Траты раздела уже учтены планом месяца (кредиты, коммуналка, аренда, подписки —
   * `monthDues`): «Свободно по факту» (B2C-14) их из выписок не вычитает второй раз.
   * Документы, засеянные до Блока 3, приходят без поля — берётся дефолт словаря по id.
   */
  plannedElsewhere?: boolean
  /** Цвет раздела — слот палитры 1…12 (`--sN`), выбранный семьёй (B2C-21); пусто — по таблице §4 и порядку. */
  slot?: number | null
  /**
   * Статья разбора, куда идут траты раздела (B2C-54, Р-56): правится в «Ваш порядок». Нет поля —
   * умолчание словаря (`spendArticle`): `plannedElsewhere` → «Обязательное», кафе, покупки,
   * развлечения, путешествия → «Траты», остальное → «Жизнь».
   */
  article?: 'must' | 'life' | 'spend'
}

/**
 * Память семьи (Р-22): «продавец → раздел», «кому → что», «это внутренний перевод».
 * Живёт в личном документе — переводы людям не утекают партнёру.
 */
/**
 * Правило «это платёж по <цели>» (Р-6, B2C-15): строка выписки с таким продавцом или получателем
 * отмечает платёж обязательства, кредита или зарплату участника сама; `categoryId` — раздел трат
 * операции (кредиты, аренда, коммуналка — `plannedElsewhere`), null — раздел по словарю.
 */
export type PaymentRule = {
  kind: 'obligation' | 'credit' | 'salary'
  targetId: string
  categoryId?: string | null
  /**
   * Раздел «остальных» строк продавца — тех, что не «такие» для правила (знак и сумма вне допуска,
   * `paymentFits`): ответ «куда отнести?» о таком продавце ложится сюда, а не заменяет правило
   * платежа (критик возврата 2). Нет — по словарю или незнакомое.
   */
  restCategoryId?: string | null
}

export type MerchantRule = Tracked & {
  id: string
  /** Нормализованные: `normalizeMerchant` / `normalizeCounterparty`. */
  match: { merchant?: string; counterparty?: string }
  to: { categoryId: string } | { internal: true } | { person: string } | { payment: PaymentRule }
  by: PersonId
}

/** Итог раздела за неделю или месяц в общем документе (Р-21). */
export type SpendTotal = Tracked & {
  /** `${by}:${kind}:${period}:${categoryId}` — LWW по id. */
  id: string
  by: PersonId
  kind: 'week' | 'month'
  /** `YYYY-Www` или `YYYY-MM`. */
  period: string
  /** Раздел или `_unknown`. */
  categoryId: string
  /** > 0, сумма списаний в целых тенге. */
  amount: number
  ops: number
}

export interface ParsedStatement {
  bank: BankId
  /** Период выписки, `YYYY-MM-DD`. */
  from: string
  to: string
  operations: Operation[]
  /** Строки таблицы, которые не удалось разобрать (в разработке — в консоль). */
  skipped: number
  /** Из них — операции в валюте без суммы в тенге (валюты — не-скоуп, B2C-04). */
  skippedForeign?: number
}
