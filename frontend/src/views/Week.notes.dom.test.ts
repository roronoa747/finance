// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'
import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { Note } from '@/types/finance'
import Week from './Week.vue'

/**
 * FB-20 (бэклог «Фидбек», Р-33; Figma `18:36`, `19:127`): заметка себе с датой — карточка на «Неделе» своей даты между
 * полосой плана и разделами; ✓ — сделано (приглушённая, до конца недели); нажатие — лист правки; «+ → Заметка» —
 * `/week?note=1`. Личный документ: viewer карточек не видит. «Сейчас» — четверг 24 сентября 2026 (W39: 21–27).
 */
let app: App | null = null

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-24T07:00:00Z'))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.spyOn(apiClient, 'listOperations').mockResolvedValue({ operations: [], next: null })
  vi.spyOn(apiClient, 'listStatementUploads').mockResolvedValue({ uploads: [] })
  vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u-a', rev: rev + 1, data, updated_at: '' }))
})

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const note = (id: string, text: string, date: string, extra: Partial<Note> = {}): Note => ({ id, text, date, amount: null, doneAt: null, updatedAt: '2026-09-20T05:00:00.000Z', ...extra })

async function open(o: { role?: 'member' | 'viewer'; notes?: Note[]; path?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const role = o.role ?? 'member'
  useAuthStore().setAuthData({
    token: 't', user: { id: 'u-a', email: 'a@b.kz', created_at: '' },
    household: { id: 'h1', name: 'Семья', created_by: 'u-a', created_at: '' },
    member: { household_id: 'h1', user_id: 'u-a', slot: 'a', display_name: 'a', role, joined_at: '' },
  })
  const finance = useFinanceStore()
  finance.claimFor('h1')
  finance.householdDoc.people = [{ id: 'a', name: 'Алихан', salary: 0, payday: 10, updatedAt: '' }]
  finance.privateDoc.notes = o.notes ?? []
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(o.path ?? '/week')
  await router.isReady()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(Week)
  app.use(pinia)
  app.use(router)
  app.mount(root)
  await flush()
  return { finance, router }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const all = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)]
const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const flush = async () => {
  for (let i = 0; i < 6; i++) await nextTick()
  await Promise.resolve()
  for (let i = 0; i < 3; i++) await nextTick()
}
const press = async (el: HTMLElement | null | undefined) => {
  expect(el, 'элемент для нажатия').toBeTruthy()
  vi.setSystemTime(new Date(Date.now() + 1000))
  el!.click()
  await flush()
}
const type = async (el: HTMLInputElement | null, value: string) => {
  expect(el, 'поле').toBeTruthy()
  el!.value = value
  el!.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

describe('FB-20: заметка себе с датой на «Неделе»', () => {
  it('карточка — только у заметок с датой на этой неделе, по дате; подпись «день · сумма»; сделанная — приглушена, ✓ переключает doneAt', async () => {
    const { finance } = await open({
      notes: [
        note('n2', 'Шины', '2026-09-26', { amount: 120_000 }),
        note('n1', 'Продлить страховку', '2026-09-22'),
        note('n3', 'Подарок', '2026-10-02'),
        note('n4', 'Удалённая', '2026-09-23', { deletedAt: '2026-09-23T05:00:00.000Z' }),
      ],
    })
    expect(all('[data-note]').map((el) => el.dataset.note)).toEqual(['n1', 'n2'])
    expect(txt(q('[data-note="n1"] [data-note-open]'))).toContain('Продлить страховку')
    expect(txt(q('[data-note="n1"] [data-note-open]'))).toContain('22 сентября')
    expect(txt(q('[data-note="n2"] [data-note-open]'))).toContain('26 сентября · 120 000 ₸')
    // К-2: значок карточки — «записка» (PhNote), как пункт «Заметка» в листе «+».
    expect(q('[data-note="n1"] [data-note-icon="note"] svg')).not.toBeNull()
    expect(q('[data-note="n1"]')!.dataset.done).toBeUndefined()
    // ✓ — сделано: `doneAt`, карточка приглушена и остаётся до конца недели; ещё раз — снято.
    await press(q('[data-note="n1"] [data-note-done]'))
    expect(finance.notes.find((n) => n.id === 'n1')!.doneAt).toBeTruthy()
    expect(q('[data-note="n1"]')!.dataset.done).toBe('true')
    expect(q('[data-note="n1"] [data-note-done]')!.className).toContain('bg-ok')
    expect(q('[data-note="n1"] [data-note-open] span')!.className).toContain('text-ink-2')
    await press(q('[data-note="n1"] [data-note-done]'))
    expect(finance.notes.find((n) => n.id === 'n1')!.doneAt).toBeNull()
    // Деньги заметки нигде не считаются: сумма недели — 0.
    expect(txt(q('[data-week-total]'))).toContain('0')
    expect(txt(q('[data-week-total]'))).not.toContain('120')
  })

  it('нажатие строки — лист «Заметка» с заполненными полями; «Сохранить» правит; «Удалить» убирает карточку', async () => {
    const { finance } = await open({ notes: [note('n1', 'Шины', '2026-09-26', { amount: 120_000 })] })
    await press(q('[data-note="n1"] [data-note-open]'))
    const sheet = q('[role="dialog"]')!
    expect(txt(sheet)).toContain('Заметка')
    expect(q<HTMLInputElement>('[role="dialog"] [data-note-text]')!.value).toBe('Шины')
    expect(q<HTMLInputElement>('[role="dialog"] [data-note-date]')!.value).toBe('2026-09-26')
    expect(q<HTMLInputElement>('[role="dialog"] [data-note-amount] input, [role="dialog"] input[data-note-amount]')!.value).toContain('120')
    expect(txt(sheet)).toContain('Всплывёт на своей неделе. Видите только вы.')
    await type(q<HTMLInputElement>('[role="dialog"] [data-note-text]'), 'Зимние шины')
    await press(q('[role="dialog"] [data-note-save]'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(finance.notes[0]).toMatchObject({ id: 'n1', text: 'Зимние шины', date: '2026-09-26', amount: 120_000 })
    expect(txt(q('[data-note="n1"]'))).toContain('Зимние шины')
    // Удалить — тихо внизу, с подтверждением.
    await press(q('[data-note="n1"] [data-note-open]'))
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Удалить заметку'))
    await press(all('[role="dialog"] button').find((b) => txt(b) === 'Удалить'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(finance.notes).toEqual([])
    expect(q('[data-note]')).toBeNull()
  })

  it('«+ → Заметка» (`/week?note=1`) — пустой лист, дата сегодня; «Сохранить» без текста — ошибка формы; с текстом — карточка на неделе даты', async () => {
    const { finance, router } = await open({ path: '/week?note=1' })
    expect(q('[role="dialog"] [data-note-text]')).not.toBeNull()
    expect(q<HTMLInputElement>('[role="dialog"] [data-note-date]')!.value).toBe('2026-09-24')
    await press(q('[role="dialog"] [data-note-save]'))
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(txt(q('[role="dialog"]'))).toContain('Напишите, о чём заметка')
    expect(finance.notes).toEqual([])
    await type(q<HTMLInputElement>('[role="dialog"] [data-note-text]'), 'Продлить страховку')
    await type(q<HTMLInputElement>('[role="dialog"] [data-note-date]'), '2026-09-25')
    await press(q('[role="dialog"] [data-note-save]'))
    expect(q('[role="dialog"]')).toBeNull()
    expect(finance.notes).toEqual([expect.objectContaining({ text: 'Продлить страховку', date: '2026-09-25', amount: null, doneAt: null })])
    expect(all('[data-note]')).toHaveLength(1)
    // Параметр адреса снят — тот же «+» откроет лист снова.
    await vi.waitFor(() => expect(router.currentRoute.value.query.note).toBeUndefined())
    // Карточка стоит до разделов (под шапкой/полосой), а не среди них.
    expect(q('[data-note]')!.compareDocumentPosition(q('[data-week-head]')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('viewer — ни карточек, ни листа по адресу', async () => {
    await open({ role: 'viewer', notes: [note('n1', 'Шины', '2026-09-26')], path: '/week?note=1' })
    expect(q('[data-note]')).toBeNull()
    expect(q('[role="dialog"]')).toBeNull()
  })
})
