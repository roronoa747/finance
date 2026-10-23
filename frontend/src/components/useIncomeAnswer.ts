import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { ruleMatchOf } from '@/lib/statements/model'
import { salaryOpOfMonth, type IncomeCandidate } from '@/lib/statements/firstRun'
import { nearestEvent, operationAt, SALARY_TOLERANCE } from '@/lib/statements/matching'
import type { Operation } from '@/lib/statements/types'
import { addMonths, monthKey } from '@/lib/dates'
import { parseMoney, plain } from '@/lib/money'
import type { PersonId } from '@/types/finance'

/**
 * «Да, это зарплата» (Блок 5 «Фидбек», Р-35; раньше — вопрос первого запуска `Start.answerIncome`): оклад и день — в
 * участника (имя — как знает семья или регистрация); правило зарплаты — когда отправитель назван или приход регулярный;
 * отметка этого и прошлого месяца — приходом в допуске оклада (`salaryOpOfMonth`; премия в пределах допуска ложится
 * на свободное), недельный ритм (PN-24) — каждая пятница своим днём (`nearestEvent`). Поля карточки — сумма и день из
 * кандидата, правятся. Ничего не считает: `firstRun.ts`, `matching.ts`, стор.
 */
export function useIncomeAnswer() {
  const auth = useAuthStore()
  const finance = useFinanceStore()
  const ops = useOperationsStore()

  const slot = computed<PersonId>(() => auth.slot ?? 'a')
  const knownName = computed(() => {
    const existing = finance.people.find((p) => p.id === slot.value)
    return existing?.name || auth.member?.display_name || auth.user?.email?.split('@')[0] || 'Участник'
  })

  const salary = ref('')
  const payday = ref('')
  /** Поля — от кандидата (при смене вопроса, не при каждом пересборе). */
  function setCandidate(c: IncomeCandidate | null | undefined) {
    if (!c) return
    salary.value = plain(c.amount)
    payday.value = String(c.day)
  }

  const clampDay = (v: string, fallback: number) => Math.min(28, Math.max(1, parseMoney(v) || fallback))
  const groupOps = (ids: string[]) => ids.map((id) => ops.all.find((o) => o.id === id)).filter((o): o is Operation => !!o)

  /** Недельный доход (PN-24): каждый приход этого и прошлого месяца в допуске недельной суммы — отметка своей пятницы. */
  function markWeeks(list: Operation[], amount: number) {
    const p = finance.people.find((x) => x.id === slot.value)
    if (!p) return
    const from = `${addMonths(monthKey(), -1)}-01`
    for (const op of list) {
      if (op.date < from || op.amount <= 0 || Math.abs(op.amount - amount) > amount * SALARY_TOLERANCE) continue
      const near = nearestEvent(op.date, p)
      if (near && near.gap <= 3) finance.markSalary(slot.value, { period: near.event.period, amount: op.amount, source: 'statement', opId: op.id, at: operationAt(op.date) })
    }
  }

  /** «Да»: пишет оклад, правило и отметки; false — сумма не введена. */
  function answer(c: IncomeCandidate): boolean {
    const amount = parseMoney(salary.value)
    if (amount <= 0) return false
    const weekly = c.rhythm === 'week' && c.weekday ? { payRhythm: 'week' as const, weekday: c.weekday } : {}
    finance.setPerson(slot.value, { name: knownName.value, salary: amount, payday: clampDay(payday.value, c.day), ...weekly })
    const op = ops.all.find((o) => o.id === c.opIds[0])
    if (op && (op.counterparty || c.regular)) {
      // Правило зарплаты без раздела — пересчитывать операции нечего.
      ops.answer(ruleMatchOf(op), { payment: { kind: 'salary', targetId: slot.value } })
      if (c.rhythm === 'week') markWeeks(groupOps(c.opIds), amount)
      else
        for (const period of [addMonths(monthKey(), -1), monthKey()]) {
          const cur = salaryOpOfMonth(groupOps(c.opIds), amount, period)
          if (cur) finance.markSalary(slot.value, { period, amount: Math.abs(cur.amount), source: 'statement', opId: cur.id, at: operationAt(cur.date) })
        }
    }
    return true
  }

  return { salary, payday, setCandidate, answer }
}
