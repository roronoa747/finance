import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { useRouter } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import {
  lastAccountFor,
  liveAccounts,
  paidFor,
  payEventAt,
  payEventOf,
  payRhythmOf,
  periodMonth,
  salaryMarkPeriod,
  salaryOf,
  salaryOpen,
  salaryRecords,
} from '@/lib/finance'
import type { PersonId } from '@/types/finance'

/**
 * Отметка «Пришла» своей зарплаты (RP-10, Р-18; PN-02 — вынесено из `SalaryRow`, чтобы кнопка в строке «Месяца»
 * и «Капитала» и кнопка в листе зарплаты были одной отметкой, а не копией). Отмечает только сам участник, viewer —
 * никогда (Р-13). Одно нажатие (`tap`) — оклад месяца на счёт, куда зарплата пришла в прошлый раз (Р-5); лист
 * отметки `MarkSheet` — только для исключений: первая отметка (счёт спросить один раз), валютная без счёта той же
 * валюты, «другая сумма или счёт» (`openMore`). Тенговая после отметки ведёт в план месяца (Р-78), валютная — нет
 * (сначала «Обменял»). Кто зовёт — рендерит `MarkSheet` сам, подавая ему `sheet`, `markAmount`, `markAccount`,
 * `firstTime`, `title`, `target` и слушая `marked` → `onMarked`, `allocate` → `toAllocation`.
 *
 * Ритм (понятность Б7): `period` — месяц экрана или ключ прихода; у аванса и недели месяц экрана — ближайший открытый
 * приход (`target`, ISO-день), сумма — этого прихода. Плавающая сумма (Р-6) — всегда лист с пустой суммой: одной
 * отметки без суммы нет. В план месяца ведёт только последний приход месяца — после недели ещё нечего откладывать.
 */
export function useSalaryTap(personId: MaybeRefOrGetter<PersonId>, period: MaybeRefOrGetter<string>) {
  const router = useRouter()
  const finance = useFinanceStore()
  const auth = useAuthStore()

  const person = computed(() => finance.people.find((p) => p.id === toValue(personId) && !p.deletedAt))
  /** Ключ прихода, который отметит нажатие: месяц у месячного ритма, ISO-день у аванса и недели. */
  const target = computed(() => (person.value ? salaryMarkPeriod(person.value, finance.payments, toValue(period)) : toValue(period)))
  const record = computed(() => paidFor(finance.payments, 'salary', toValue(personId), target.value))
  /** Оклад в валюте (B2C-79, Р-73): приходит на валютный счёт суммой в валюте, после — «Обменял». */
  const own = computed(() => (person.value ? salaryOf(person.value, periodMonth(target.value)) : null))
  const fxSalary = computed(() => !!own.value && own.value.currency !== 'KZT')
  /** Сумма прихода по умолчанию (валютный — в валюте): месячный — оклад месяца, аванс и неделя — свой приход. */
  const due = computed(() =>
    !person.value ? 0 : fxSalary.value ? (payEventOf(person.value, target.value)?.amount ?? own.value!.amount) : payEventAt(person.value, target.value),
  )
  const floating = computed(() => !!person.value?.floating)

  const mine = computed(() => !auth.isViewer && auth.slot === toValue(personId))
  const canMark = computed(() => mine.value && !!person.value && salaryOpen(person.value, finance.payments, target.value))
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

  /** Аванс и неделя: в план — только когда пришёл весь месяц (раньше «Отложить по плану» ещё нет). */
  function monthCame() {
    const p = person.value
    if (!p || payRhythmOf(p) === 'month') return true
    return salaryRecords(finance.payments, p, periodMonth(target.value)).every(Boolean)
  }

  function mark(amount: number, accountId: string | null | undefined) {
    if (fxSalary.value) {
      finance.markSalary(toValue(personId), { period: target.value, foreign: amount, accountId })
      sheet.value = null
      return
    }
    finance.markSalary(toValue(personId), { period: target.value, amount, accountId: accountId ?? null })
    sheet.value = null
    if (monthCame()) toAllocation()
  }

  /** Отмечено в листе: тенговая — в план месяца; валютная — остаёмся, дальше «Обменял». */
  function onMarked() {
    if (!fxSalary.value && monthCame()) toAllocation()
  }

  /** Главный путь — одно нажатие. Лист — если счёт спросить не у кого или сумма меняется. */
  function tap() {
    // Валютная: одним нажатием, когда есть валютный счёт той же валюты (стор выберет); иначе лист с «Евро-счётом».
    if (fxSalary.value) {
      const has = liveAccounts(finance.accounts).some((a) => a.currency === own.value!.currency)
      firstTime.value = !has
      if (has && !floating.value) mark(due.value, undefined)
      else openMark(floating.value ? 0 : due.value, undefined)
      return
    }
    const last = lastAccountFor(finance.payments, toValue(personId), finance.accounts)
    firstTime.value = last === undefined
    if (floating.value) openMark(0, last)
    else if (last === undefined) openMark(due.value, last)
    else mark(due.value, last)
  }

  function openMore() {
    if (fxSalary.value) return openMark(floating.value ? 0 : due.value, undefined)
    const last = lastAccountFor(finance.payments, toValue(personId), finance.accounts)
    firstTime.value = last === undefined
    openMark(floating.value ? 0 : due.value, last)
  }

  return { person, target, record, own, fxSalary, due, floating, mine, canMark, title, sheet, markAmount, markAccount, firstTime, tap, openMore, onMarked, toAllocation }
}
