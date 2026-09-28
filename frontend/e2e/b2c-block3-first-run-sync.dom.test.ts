// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '../src/router'
import { apiClient, type ApiClient } from '../src/api/client'
import { useAuthStore } from '../src/stores/auth'
import { defaultSyncDoc, useFinanceStore } from '../src/stores/finance'
import { useOperationsStore } from '../src/stores/operations'
import { creditBalance } from '../src/lib/finance'
import { plain } from '../src/lib/money'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import Start from '../src/views/Start.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer } from './support/family'

/**
 * Приёмка Блока 3 B2C, часть 4 (DOM; возврат приёмки 2 п. 1): первый запуск темпом человека. Между
 * вводом и «Записать» приходит синк — после ответа, по возврату в приложение (`focus`), фоновым кругом:
 * документ с сервера подменяет свой, вопросы пересобираются. Введённое остаётся: исправленный оклад
 * пишется окладом, остаток кредита — кредитом с остатком (а не обязательством «остаток уточните»).
 * Экран смонтирован по-настоящему — SSR-части этого файла синк между вводом и нажатием не видят.
 */

let app: App | null = null
let server: FakeServer

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  // Выписка Kaspi за 26.06–26.07.2025 загружена 27 июля (как часть 4 SSR).
  at('2025-07-27T07:00:00Z')
  // Фоновый синк стора идёт в настоящий клиент — сети нет, запрос не отвечает; синк телефона ниже — явный.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'pushPrivateDoc').mockRejectedValue(new TypeError('fetch failed'))
  server = fakeServer(defaultSyncDoc())
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const fixtures = import.meta.glob<PdfRow[]>('../src/lib/statements/fixtures/*.rows.json', { eager: true, import: 'default' })

/** Новая семья: телефон A загрузил выписку Kaspi и открыл вопросы первого запуска. */
async function firstRun() {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().setAuthData({
    token: 't-a', user: { id: 'u-a', email: 'a@family.kz', created_at: '' },
    household: { id: 'h-family', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h-family', user_id: 'u-a', slot: 'a', display_name: 'a', role: 'member', joined_at: '' },
  })
  const client = { ...backend(server), ...statementsFor(fakeStatements(), 'u-a', 'a') } as unknown as ApiClient
  const finance = useFinanceStore()
  finance.claimFor('h-family')
  await finance.pullHousehold(client)
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'выписка.pdf', parsed: parseStatement(fixtures['../src/lib/statements/fixtures/kaspi-01.rows.json']) }])
  await ops.send(client)
  await finance.syncHousehold(client)

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
  /** Пауза человека: синк движка (после ответа, `focus`, фоновый круг) — документ с сервера. */
  const pause = async () => {
    const before = finance.householdDoc
    await finance.syncHousehold(client)
    expect(finance.householdDoc).not.toBe(before)
    await nextTick()
    await nextTick()
  }
  return { finance, pause }
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

describe('e2e / B2C Блок 3 — часть 4 (DOM, возврат приёмки 2 п. 1): синк посреди первого запуска не стирает введённое', () => {
  it('Kaspi: оклад исправлен 120 000 → 125 000, пауза, «Да» — оклад 125 000; остаток кредита 1 200 000, пауза, «Записать» — кредит с остатком, июльский платёж его не уменьшает; всё на сервере', async () => {
    const { finance, pause } = await firstRun()

    expect(page()).toContain('Это ваш доход?')
    expect(field('Оклад, ₸').value).toBe(plain(120_000))
    await type(field('Оклад, ₸'), '125000')
    await pause()
    expect(field('Оклад, ₸').value).toBe(plain(125_000))
    await click(button('Да, это зарплата'))
    expect(finance.people).toEqual([expect.objectContaining({ id: 'a', salary: 125_000, payday: 24 })])
    await pause()

    expect(page()).toContain('Оплата Kaspi Кредита — это что?')
    await type(field('Остаток долга, ₸ — если знаете'), '1200000')
    await pause()
    expect(field('Остаток долга, ₸ — если знаете').value).toBe(plain(1_200_000))
    expect(button('Кредит').getAttribute('aria-pressed')).toBe('true')
    await click(button('Записать'))
    const credit = finance.householdDoc.credits.find((c) => c.name === 'Оплата Kaspi Кредита')!
    expect(credit).toMatchObject({ principal: 1_200_000, payment: 151_790, rateUnknown: true })
    expect(finance.obligations.map((o) => o.name)).not.toContain('Оплата Kaspi Кредита')
    // Платёж июля из той же выписки отмечен днём операции — до введённого остатка: «Долги» не меньше на него.
    expect(creditBalance(credit, finance.payments)).toBe(1_200_000)
    await pause()
    expect(server.data.credits).toEqual([expect.objectContaining({ name: 'Оплата Kaspi Кредита', principal: 1_200_000, rateUnknown: true })])
    expect(server.data.people).toEqual([expect.objectContaining({ id: 'a', salary: 125_000 })])
  })
})
