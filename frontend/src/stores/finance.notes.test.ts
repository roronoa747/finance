import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFinanceStore } from './finance'
import { apiClient } from '@/api/client'
import type { Note } from '@/types/finance'

/** FB-20 (бэклог «Фидбек», Р-33): заметки себе с датой — личный документ, партнёр не видит; деньги заметки не считаются. */
describe('stores/finance — заметки себе (notes)', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('офлайн'))))
    setActivePinia(createPinia())
  })

  const list = (f: ReturnType<typeof useFinanceStore>) => (f.privateDoc.notes as Note[] | undefined) ?? []

  it('addNote — запись в личном документе: текст до 80 знаков, дата, сумма целым; в общем документе заметок нет', () => {
    const f = useFinanceStore()
    const push = vi.spyOn(apiClient, 'pushPrivateDoc').mockImplementation(async (rev, data) => ({ household_id: 'h1', user_id: 'u', rev: rev + 1, data, updated_at: '' }))
    const id = f.addNote({ text: '  Продлить страховку  ', date: '2026-11-12', amount: 60_000.4 })
    expect(id).toMatch(/^nt_[0-9a-f]{8}$/)
    expect(f.notes).toEqual([expect.objectContaining({ id, text: 'Продлить страховку', date: '2026-11-12', amount: 60_000, doneAt: null })])
    expect(list(f)).toHaveLength(1)
    // Общий документ (партнёр) заметок не знает.
    expect(JSON.stringify(f.householdDoc)).not.toContain('Продлить страховку')
    expect(push).toHaveBeenCalled()
    // Длинный текст — обрезается до 80; без суммы — null.
    const long = f.addNote({ text: 'а'.repeat(100), date: '2026-11-13' })
    expect(f.notes.find((n) => n.id === long)).toMatchObject({ text: 'а'.repeat(80), amount: null })
  })

  it('setNoteDone ставит и снимает doneAt; setNote правит текст, дату и сумму; то же состояние — ничего не пишется', () => {
    const f = useFinanceStore()
    const id = f.addNote({ text: 'Шины', date: '2026-10-20' })
    const before = list(f)[0]!.updatedAt
    f.setNoteDone(id, true)
    expect(f.notes[0]!.doneAt).toBeTruthy()
    f.setNoteDone(id, true) // уже сделано — без записи
    const stamp = f.notes[0]!.updatedAt
    f.setNoteDone(id, false)
    expect(f.notes[0]!.doneAt).toBeNull()
    expect(f.notes[0]!.updatedAt >= before && f.notes[0]!.updatedAt >= stamp).toBe(true)
    f.setNote(id, { text: 'Зимние шины', date: '2026-10-27', amount: 120_000 })
    expect(f.notes[0]).toMatchObject({ text: 'Зимние шины', date: '2026-10-27', amount: 120_000 })
    f.setNote('nt_nope', { text: 'x', date: '2026-10-27' })
    expect(f.notes).toHaveLength(1)
  })

  it('removeNote — надгробие: живых нет, запись в документе остаётся (переживает слияние)', () => {
    const f = useFinanceStore()
    const id = f.addNote({ text: 'Подарок', date: '2026-10-25' })
    f.removeNote(id)
    expect(f.notes).toEqual([])
    expect(list(f)).toHaveLength(1)
    expect(list(f)[0]!.deletedAt).toBeTruthy()
    f.removeNote(id) // второй раз — тихо
    expect(list(f)).toHaveLength(1)
  })
})
