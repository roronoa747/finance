// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import { useOperationsStore } from '@/stores/operations'
import { applyRules } from '@/lib/statements/model'
import { plain } from '@/lib/money'
import type { Operation } from '@/lib/statements/types'
import type { SyncDoc } from '@/types/finance'
import Start from './Start.vue'

/**
 * Возврат приёмки 2 п. 1: первый запуск не стирает введённое, когда приходит синк. Вопросы
 * пересобираются при каждой подмене документа (синк после ответа, `focus`, фоновый круг), а поля
 * карточки сбрасывались на каждый новый объект вопроса: исправленный оклад откатывался к выписке,
 * введённый остаток кредита стирался («Записать» давал обязательство вместо кредита), выбранный чип
 * возвращался. Подмена здесь — как у `pull`: новый объект документа с новой ревизией.
 */

let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  // Синк документа по таймеру (таймеры поддельные) — сети в тесте нет, запрос не отвечает.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'upsertOperations').mockResolvedValue({ upserted: 0 })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({
    household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '',
  }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const op = (id: string, date: string, amount: number, merchant: string, kind: Operation['kind'] = 'purchase'): Operation => ({
  id, bank: 'kaspi', date, amount, kind, merchant, categoryId: null, internal: false,
})

/** Новая семья после разбора выписки: зарплата, кредит Kaspi, аренда переводом. */
async function openQuestions() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'Алихан', role: 'member', joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.setHouseholdDoc(defaultSyncDoc(), 1)
  const store = useOperationsStore()
  const list = applyRules(
    [
      op('s8', '2026-08-12', 300_000, 'Зарплата ТОО Ромашка', 'income'),
      op('s9', '2026-09-12', 300_000, 'Зарплата ТОО Ромашка', 'income'),
      op('c8', '2026-08-05', -151_790, 'Оплата Kaspi Кредита'),
      op('c9', '2026-09-05', -151_790, 'Оплата Kaspi Кредита'),
      op('r8', '2026-08-03', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
      op('r9', '2026-09-03', -220_000, 'PEREVOD ARENDA', 'transfer-out'),
      op('k8', '2026-08-20', -45_000, 'Оплата Kaspi Red'),
      op('k9', '2026-09-20', -45_000, 'Оплата Kaspi Red'),
    ],
    [],
  )
  for (const o of list) store.ops[o.id] = o

  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/start/questions')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Start)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await nextTick()
  /** Синк, возврат в приложение, фоновый круг: документ с сервера — новый объект, та же суть. */
  const pull = async () => {
    finance.setHouseholdDoc(JSON.parse(JSON.stringify(finance.householdDoc)) as SyncDoc, 2)
    await nextTick()
    await nextTick()
  }
  return { finance, store, pull }
}

const page = () => document.body.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
const field = (label: string) =>
  [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent?.trim() === label)!.querySelector('input')!
async function type(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await nextTick()
}
async function click(el: HTMLElement) {
  el.click()
  await nextTick()
  await nextTick()
}

describe('views/Start.vue — синк посреди вопроса не стирает введённое (возврат приёмки 2 п. 1, DOM)', () => {
  it('исправленный оклад, остаток кредита и выбранный чип переживают подмену документа; «Записать» пишет введённое', async () => {
    const { finance, pull } = await openQuestions()

    // Доход: оклад исправлен 300 000 → 350 000, пришёл синк — поле то же, «Да» пишет 350 000.
    expect(page()).toContain('Это ваш доход?')
    await type(field('Оклад, ₸'), '350000')
    await pull()
    expect(field('Оклад, ₸').value).toBe(plain(350_000))
    await click(button('Да, это зарплата'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 350_000, payday: 12 })
    await pull()

    // Аренда: выбран чип «Аренда», синк — чип тот же, «Записать» — обязательство «Аренда» в жилье.
    expect(page()).toContain('PEREVOD ARENDA — это что?')
    await click(button('Аренда'))
    await pull()
    expect(button('Аренда').getAttribute('aria-pressed')).toBe('true')
    await click(button('Записать'))
    expect(finance.obligations).toEqual([expect.objectContaining({ name: 'Аренда', category: 'd1', note: 'PEREVOD ARENDA' })])
    await pull()

    // Кредит: остаток «если знаете» введён, синк — остаток на месте, «Записать» — кредит с остатком и без ставки.
    expect(page()).toContain('Оплата Kaspi Кредита — это что?')
    await type(field('Остаток долга, ₸ — если знаете'), '1200000')
    await pull()
    expect(field('Остаток долга, ₸ — если знаете').value).toBe(plain(1_200_000))
    await click(button('Записать'))
    expect(finance.householdDoc.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, rateUnknown: true, payment: 151_790 })])
    expect(finance.obligations.map((o) => o.name)).toEqual(['Аренда'])

    // Следующий вопрос-кредит: поля сброшены — остаток 1 200 000 не переезжает в Kaspi Red, «Записать» без остатка — обязательство.
    expect(page()).toContain('Оплата Kaspi Red — это что?')
    expect(field('Остаток долга, ₸ — если знаете').value).toBe('')
    await click(button('Записать'))
    expect(finance.householdDoc.credits).toHaveLength(1)
    expect(finance.obligations.map((o) => o.name)).toEqual(['Аренда', 'Оплата Kaspi Red'])
  })

  it('критик возврата 2: вторая выписка меняет кандидата дохода — поля обновляются (ключ дохода — с отправителем), «Да» пишет нового', async () => {
    const { finance, store } = await openQuestions()
    expect(page()).toContain('ТОО Ромашка')
    expect(field('Оклад, ₸').value).toBe(plain(300_000))
    // Загружена Freedom с большим регулярным приходом — кандидат дохода теперь ТОО Лютик 500 000 · 25-го.
    for (const o of applyRules([op('l8', '2026-08-25', 500_000, 'Зарплата ТОО Лютик', 'income'), op('l9', '2026-09-25', 500_000, 'Зарплата ТОО Лютик', 'income')], [])) store.ops[o.id] = o
    await nextTick()
    await nextTick()
    expect(page()).toContain('ТОО Лютик')
    expect(field('Оклад, ₸').value).toBe(plain(500_000))
    expect(field('День').value).toBe('25')
    await click(button('Да, это зарплата'))
    expect(finance.people.find((p) => p.id === 'a')).toMatchObject({ salary: 500_000, payday: 25 })
  })
})
