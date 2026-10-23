import { buildReviewFacts } from '../../src/lib/aiFacts'
import { reviewWork, type ReviewFinding } from '../../src/lib/finance'
import type { useFinanceStore } from '../../src/stores/finance'
import type { AiAdvice, AiReview, PersonId, ReviewPayloadV3, ReviewReason } from '../../src/types/finance'

/** Ответ ручки v3 на присланное тело (как в старых e2e): строка «Куда ушло» и советы по id фактов и действий. */
export type AnswerV3 = { where: string; advices: { title: string; text: string; figure: string | null; action: string }[] }

/**
 * Разбор v3 «старой сборки» (до v4, бэклог «Фидбек», Р-26): новая сборка v3 больше не запрашивает, а сохранённые v3 в
 * общем документе показываются как были. Помощник пишет v3 в общий документ так, как это делал `requestReview` v3:
 * факты и действия `buildReviewFacts`, совет — по id ответа (кандидат «Сделать» / экран «Открыть»), крупная цифра — факт
 * с подписью, счётчик — `reviewWork` по находкам советов.
 */
export function saveV3(
  store: ReturnType<typeof useFinanceStore>,
  key: string,
  answer: (body: ReviewPayloadV3) => AnswerV3,
  opts: { by?: PersonId; reason?: ReviewReason } = {},
): AiReview {
  const input = store.planInput(key)
  const reason = opts.reason ?? 'month'
  const { payload, doById, openById, findings, byFact, byAction, labels } = buildReviewFacts(store.householdDoc, input, reason)
  const res = answer(payload)
  const facts = new Map(payload.facts.map((f) => [f.id, f]))
  const advices: AiAdvice[] = []
  const used: ReviewFinding[] = []
  for (const a of res.advices) {
    const candidate = doById.get(a.action)
    const target = openById.get(a.action)
    if (!candidate && !target) continue
    const f = a.figure ? facts.get(a.figure) : undefined
    const label = f ? labels.get(f.id) : undefined
    advices.push({
      title: a.title,
      text: a.text,
      figure: f ? { about: f.about, value: f.value, ...(label ? { label } : {}) } : null,
      action: candidate ? { kind: 'do', candidate } : { kind: 'open', target: target! },
    })
    const finding = (a.figure ? byFact.get(a.figure) : undefined) ?? byAction.get(a.action)
    if (finding) used.push(finding)
  }
  return store.saveAiReview({
    month: key,
    at: new Date().toISOString(),
    by: opts.by ?? 'a',
    good: '',
    risk: '',
    steps: [],
    v: 3,
    reason,
    ...(reason === 'month' ? { reasonKey: `month:${key}` } : {}),
    where: res.where,
    advices,
    work: reviewWork(input.state, input.ctx, findings, used),
    sent: payload,
  })
}
