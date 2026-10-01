import { hasBudgetData } from '@/lib/finance'

/**
 * Куда после входа (B2C-19): семья без данных — первый запуск; участник по коду, которого ещё
 * нет в `people` (партнёр без своего дохода), — тоже `/start`, но короткий; иначе главный.
 * Отдельным модулем: роутер импортирует экраны, экран входа — этот выбор.
 */
export function landingPath(
  auth: { slot?: string | null; isViewer: boolean },
  finance: { setupDone: boolean; householdDoc: Parameters<typeof hasBudgetData>[0] & { people?: { id: string; onboardedAt?: string | null }[] } },
): string {
  // Viewer смотрит, что есть, — первый запуск не его.
  if (auth.isViewer) return '/'
  const me = auth.slot ? (finance.householdDoc.people ?? []).find((p) => p.id === auth.slot) : undefined
  // Семья ещё не настроена: первый запуск — в том числе продолжение после перезагрузки
  // (ответы уже в документе, участник ещё не отмечен `onboardedAt`).
  if (!finance.setupDone) return hasBudgetData(finance.householdDoc) && me?.onboardedAt ? '/' : '/start'
  // Настроенная семья: участник без своей записи (партнёр по коду) — короткий первый запуск.
  return me ? '/' : '/start'
}
