import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { lastAccountFor, liveAccounts, paidFor, salaryAt, salaryOf, salaryOpen } from '@/lib/finance'
import type { PersonId } from '@/types/finance'

/**
 * Отметка «Пришла» своей зарплаты (RP-10, Р-18; PN-02 — вынесено из `SalaryRow`, чтобы кнопка в строке «Месяца»
 * и «Капитала» и кнопка в листе зарплаты были одной отметкой, а не копией). Отмечает только сам участник, viewer —
 * никогда (Р-13). Одно нажатие (`tap`) — оклад месяца на счёт, куда зарплата пришла в прошлый раз (Р-5); лист
 * отметки `MarkSheet` — только для исключений: первая отметка (счёт спросить один раз), валютная без счёта той же
 * валюты, «другая сумма или счёт» (`openMore`). Тенговая после отметки ведёт в план месяца (Р-78), валютная — нет
 * (сначала «Обменял»). Кто зовёт — рендерит `MarkSheet` сам, подавая ему `sheet`, `markAmount`, `markAccount`,
 * `firstTime`, `title` и слушая `marked` → `onMarked`, `allocate` → `toAllocation`.
 */
export function useSalaryTap(personId: MaybeRefOrGetter<PersonId>, period: MaybeRefOrGetter<string>) {
  const router = useRouter()
  const finance = useFinanceStore()
  const auth = useAuthStore()

  const person = computed(() => finance.people.find((p) => p.id === toValue(personId) && !p.deletedAt))
  const record = computed(() => paidFor(finance.payments, 'salary', toValue(personId), toValue(period)))
  /** Оклад в валюте (B2C-79, Р-73): приходит на валютный счёт суммой в валюте, после — «Обменял». */
  const own = computed(() => (person.value ? salaryOf(person.value, toValue(period)) : null))
  const fxSalary = computed(() => !!own.value && own.value.currency !== 'KZT')
  /** Оклад месяца — сумма по умолчанию (валютный — в валюте). */
  const due = computed(() => (!person.value ? 0 : fxSalary.value ? own.value!.amount : salaryAt(person.value, toValue(period))))

  const mine = computed(() => !auth.isViewer && auth.slot === toValue(personId))
  const canMark = computed(() => mine.value && !!person.value && salaryOpen(person.value, finance.payments, toValue(period)))
  const title = computed(() => `Зарплата · ${person.value?.name ?? ''}`)

  const sheet = ref<'mark' | 'paid' | null>(null)
  const markAmount = ref(0)
  // undefined — счёт ещё не выбран; null — «не зачислять».
  const markAccount = ref<string | null | undefined>(undefined)
  const firstTime = ref(false)

  function openMark(amount: number, account: string | null | undefined) {
    markAmount.value = amount
    markAccount.value = account
    sheet.value = 'mark'
  }

  /** После отметки — план месяца: «Отложить по плану» этой зарплаты (Р-78). */
  function toAllocation() {
    void router.push('/month')
  }

  function mark(amount: number, accountId: string | null | undefined) {
    if (fxSalary.value) {
      finance.markSalary(toValue(personId), { period: toValue(period), foreign: amount, accountId })
      sheet.value = null
      return
    }
    finance.markSalary(toValue(personId), { period: toValue(period), amount, accountId: accountId ?? null })
    sheet.value = null
    toAllocation()
  }

  /** Отмечено в листе: тенговая — в план месяца; валютная — остаёмся, дальше «Обменял». */
  function onMarked() {
    if (!fxSalary.value) toAllocation()
  }

  /** Главный путь — одно нажатие. Лист — если счёт спросить не у кого. */
  function tap() {
    // Валютная: одним нажатием, когда есть валютный счёт той же валюты (стор выберет); иначе лист с «Евро-счётом».
    if (fxSalary.value) {
      const has = liveAccounts(finance.accounts).some((a) => a.currency === own.value!.currency)
      firstTime.value = !has
      if (has) mark(due.value, undefined)
      else openMark(due.value, undefined)
      return
    }
    const last = lastAccountFor(finance.payments, toValue(personId), finance.accounts)
    firstTime.value = last === undefined
    if (last === undefined) openMark(due.value, last)
    else mark(due.value, last)
  }

  function openMore() {
    if (fxSalary.value) return openMark(due.value, undefined)
    const last = lastAccountFor(finance.payments, toValue(personId), finance.accounts)
    firstTime.value = last === undefined
    openMark(due.value, last)
  }

  return { person, record, own, fxSalary, due, mine, canMark, title, sheet, markAmount, markAccount, firstTime, tap, openMore, onMarked, toAllocation }
}
