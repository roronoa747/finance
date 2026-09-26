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
}

/**
 * Память семьи (Р-22): «продавец → раздел», «кому → что», «это внутренний перевод».
 * Живёт в личном документе — переводы людям не утекают партнёру.
 */
export type MerchantRule = Tracked & {
  id: string
  /** Нормализованные: `normalizeMerchant` / `normalizeCounterparty`. */
  match: { merchant?: string; counterparty?: string }
  to: { categoryId: string } | { internal: true } | { person: string }
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
