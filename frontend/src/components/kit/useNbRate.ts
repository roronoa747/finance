import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useFxStore } from '@/stores/fx'
import { fxToTenge, rateOn } from '@/lib/finance'
import { todayIso } from '@/lib/dates'
import { fetchRates, type FxRates } from '@/lib/fx'
import type { Currency } from '@/types/finance'

/**
 * Курс версии суммы в валюте (Р-70, Р-75) для формы: Нацбанк сегодня из книги, иначе публичная
 * `/api/fx-rate` (спрашивается, когда форма открыта); нет и её — `manual`, курс руками. Тенге — 1.
 */
export function useNbRate(currency: MaybeRefOrGetter<Currency>, active: MaybeRefOrGetter<boolean>) {
  const fx = useFxStore()
  const info = ref<FxRates | null>(null)
  const manual = ref('')
  const foreign = computed(() => toValue(currency) !== 'KZT')
  const auto = computed(() => {
    const c = toValue(currency)
    return c === 'KZT' ? 1 : rateOn(fx.book, c, todayIso(), info.value?.rates[c] ?? null)
  })
  const rate = computed(() => auto.value ?? parseFloat(manual.value.replace(',', '.')))
  const ok = computed(() => Number.isFinite(rate.value) && rate.value > 0)
  /** Тенге суммы в валюте формы по этому курсу; курса нет — 0. */
  const tenge = (amount: number) => (ok.value ? fxToTenge(amount, rate.value) : 0)

  watch(
    [() => toValue(active), () => toValue(currency)],
    async ([on]) => {
      if (!on || !foreign.value || auto.value || info.value) return
      info.value = await fetchRates()
    },
    { immediate: true },
  )

  return { foreign, auto, manual, rate, ok, tenge }
}

export type NbRate = ReturnType<typeof useNbRate>
