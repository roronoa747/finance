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
import { plain } from '../src/lib/money'
import type { PdfRow } from '../src/lib/statements/pdf'
import { parseStatement } from '../src/lib/statements/parsers'
import Week from '../src/views/Week.vue'
import Month from '../src/views/Month.vue'
import { at, backend, fakeServer, fakeStatements, statementsFor, type FakeServer } from './support/family'

/**
 * Приёмка Блока 3 B2C, часть 4 (DOM; возврат приёмки 2 п. 1), после Блока 5 «Фидбек» (FB-21, Р-35): вопросы первого
 * запуска переехали — «Это ваш доход?» на «Неделю», повторы — в «нашли в выписке» «Месяца». Между вводом и ответом
 * приходит синк — документ с сервера подменяет свой, очередь пересобирается. Введённое остаётся: исправленный оклад
 * пишется окладом; имя платежа в форме «В платежи» — тем, что вписали. Экран смонтирован по-настоящему.
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
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
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

/** Новая семья после первого запуска «сначала траты»: телефон A загрузил выписку Kaspi, оклада нет. */
async function family() {
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
  finance.setPerson('a', { name: 'a', onboardedAt: '2025-07-27T07:00:00.000Z' })
  finance.finishSetup()
  const ops = useOperationsStore()
  ops.setDraft([{ name: 'выписка.pdf', parsed: parseStatement(fixtures['../src/lib/statements/fixtures/kaspi-01.rows.json']) }])
  await ops.send(client)
  await finance.syncHousehold(client)
  /** Пауза человека: синк движка (после ответа, `focus`, фоновый круг) — документ с сервера. */
  const pause = async () => {
    const before = finance.householdDoc
    await finance.syncHousehold(client)
    expect(finance.householdDoc).not.toBe(before)
    await nextTick()
    await nextTick()
  }
  return { pinia, finance, ops, pause }
}

async function mount(pinia: ReturnType<typeof createPinia>, view: typeof Week | typeof Month, path: string) {
  app?.unmount()
  document.body.innerHTML = ''
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(view)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  for (let i = 0; i < 6; i++) await nextTick()
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
  vi.setSystemTime(new Date(Date.now() + 1000))
  el.click()
  for (let i = 0; i < 4; i++) await nextTick()
}

describe('e2e / B2C Блок 3 — часть 4 (DOM, возврат приёмки 2 п. 1; после FB-21): синк посреди вопроса не стирает введённое', () => {
  it('«Неделя»: оклад исправлен 120 000 → 125 000, пауза, «Да» — оклад 125 000; «Месяц»: имя платежа вписано, пауза, «Добавить» — платёж с этим именем, июль отмечен; всё на сервере', async () => {
    const { pinia, finance, ops, pause } = await family()
    await mount(pinia, Week, '/week')
    await click(document.querySelector<HTMLElement>('[data-bang]')!)
    expect(page()).toContain('Это ваш доход?')
    expect(field('Оклад').value).toBe(plain(120_000))
    await type(field('Оклад'), '125000')
    await pause()
    expect(field('Оклад').value).toBe(plain(125_000))
    await click(button('Да, это зарплата'))
    expect(finance.people).toEqual([expect.objectContaining({ id: 'a', salary: 125_000, payday: 24 })])
    await pause()

    // «Месяц» → «Платежи»: «нашли N в выписке» → «В платежи» у кредита → лист кредита (TL-03): имя переписано, остаток
    // вписан → пауза → «Добавить».
    await mount(pinia, Month, '/month')
    expect(page()).toContain('нашли')
    await click(document.querySelector<HTMLElement>('[data-section="dues"]')!)
    const row = [...document.querySelectorAll<HTMLElement>('[data-found-row]')].find((r) => r.textContent?.includes('Оплата Kaspi Кредита'))!
    expect(row, 'строка кредита в «нашли»').toBeTruthy()
    await click(row.querySelector<HTMLElement>('[data-found-pay]')!)
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Новый долг')
    const name = [...document.querySelectorAll<HTMLInputElement>('[role="dialog"] input')].find((i) => i.value.includes('Kaspi Кредита'))!
    expect(name, 'имя из выписки в поле').toBeTruthy()
    await type(name, 'Автокредит Kaspi')
    await type(field('Остаток долга'), '2400000')
    await pause()
    expect(name.value).toBe('Автокредит Kaspi')
    expect(field('Остаток долга').value).toBe(plain(2_400_000))
    await click(button('Добавить'))
    // Строка кредита — кредит с остатком (TL-03, Р-3), не обязательство «быт».
    const credit = finance.credits.find((c) => c.name === 'Автокредит Kaspi')!
    expect(credit).toMatchObject({ day: 24, payment: 151_790, principal: 2_400_000 })
    expect(finance.obligations).toEqual([])
    // Платёж июля из той же выписки отмечен днём операции; правило платежа — по продавцу.
    expect(finance.payments.find((p) => p.targetId === credit.id)).toMatchObject({ kind: 'credit', period: '2025-07', amount: 151_790, source: 'statement' })
    expect(finance.merchantRules.some((r) => 'payment' in r.to && r.to.payment.targetId === credit.id)).toBe(true)
    void ops
    await pause()
    expect(server.data.credits).toEqual([expect.objectContaining({ name: 'Автокредит Kaspi', principal: 2_400_000 })])
    expect(server.data.people).toEqual([expect.objectContaining({ id: 'a', salary: 125_000 })])
  })
})
