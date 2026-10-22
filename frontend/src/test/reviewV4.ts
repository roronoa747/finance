import type { ApiClient } from '@/api/client'
import { spendTotals } from '@/lib/statements/model'
import type { Operation } from '@/lib/statements/types'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import type { AiReviewLead } from '@/types/api'
import type { PersonId, ReviewPayloadV4 } from '@/types/finance'
import { T0 } from './planFamily'

/**
 * Разбор v4 в тестах (бэклог «Фидбек», FB-16): ответ ручки — одна мысль и первая присланная карточка; свой месяц
 * участника — операции на телефоне, выписка месяца (до 10-го — месяц находок текущий) и итоги в общем документе:
 * «Не разобрано» 30 000 из 100 000 — карточка `unknown` есть, разбор v4 спрашивается.
 */
export const leadFor = (body: unknown): AiReviewLead => ({
  title: 'Главное',
  text: 'Разберём траты без раздела.',
  figure: null,
  next: (body as ReviewPayloadV4).cards[0].id,
})

export function ownMonthOps(key: string, by: PersonId = 'a'): Operation[] {
  const op = (n: number, amount: number, categoryId: string | null, merchant: string): Operation => ({
    id: `${by === 'a' ? 'aa' : 'bb'}00000${n}`, bank: 'kaspi', date: `${key}-0${n + 2}`, amount, kind: 'purchase', merchant, categoryId, internal: false,
  })
  return [op(1, -30_000, null, 'SHOP X'), op(2, -70_000, 'sc_food', 'MAGNUM')]
}

/** Свой месяц `key` участника `by` на этом телефоне: операции, выписка (`loadUploads`) и итоги в документе. */
export async function seedOwnMonth(key: string, by: PersonId = 'a'): Promise<Operation[]> {
  const ops = useOperationsStore()
  const finance = useFinanceStore()
  const list = ownMonthOps(key, by)
  ops.ops = { ...ops.ops, ...Object.fromEntries(list.map((o) => [o.id, o])) }
  const upload = { id: `u-${by}-${key}`, slot: by, bank: 'kaspi', period_from: `${key}-01`, period_to: `${key}-10`, ops_count: list.length, created_at: T0 }
  await ops.loadUploads({ listStatementUploads: async () => ({ uploads: [...ops.uploads.filter((u) => u.id !== upload.id), upload] }) } as unknown as ApiClient)
  const totals = spendTotals(list, by, 'month', key, T0, { marked: new Set(), categories: [] })
  finance.mutateHouseholdDoc((d) => {
    d.spendTotals = [...(d.spendTotals ?? []).filter((t) => !totals.some((x) => x.id === t.id)), ...totals]
  })
  return list
}
