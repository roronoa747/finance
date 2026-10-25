import { afterEach, describe, expect, it, vi } from 'vitest'
import { MONTH_END_KEY, PLAN_VIEW_KEY, TIPS_SEEN_KEY, markTipSeen, readMonthEnd, readPlanView, readTipsSeen, writeMonthEnd, writePlanView } from './storage'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authAs } from '@/test/planFamily'

// Ответ «остались деньги?» (Р-19): «Мечты» и «Неделя» пишут и читают одним форматом (критик Блока 3).
describe('readMonthEnd / writeMonthEnd', () => {
  const stub = (init: Record<string, string> = {}) => {
    const map = new Map(Object.entries(init))
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    })
    return map
  }
  afterEach(() => vi.unstubAllGlobals())

  it('пишет сырой ключ месяца и читает его же', () => {
    const map = stub()
    expect(readMonthEnd()).toBeNull()
    writeMonthEnd('2026-09')
    expect(map.get(MONTH_END_KEY)).toBe('2026-09')
    expect(readMonthEnd()).toBe('2026-09')
  })

  it('старая запись в JSON-виде («Неделя» до правки) читается как тот же месяц', () => {
    stub({ [MONTH_END_KEY]: '"2026-09"' })
    expect(readMonthEnd()).toBe('2026-09')
  })

  it('хранилища нет или оно бросает — null и без исключений', () => {
    expect(readMonthEnd()).toBeNull()
    expect(() => writeMonthEnd('2026-09')).not.toThrow()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('closed')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(readMonthEnd()).toBeNull()
    expect(() => writeMonthEnd('2026-09')).not.toThrow()
    err.mockRestore()
  })
})

// Вид вкладки «План» (Р-99): последний выбранный — на устройстве; пусто, мусор или нет хранилища — «Неделя».
describe('readPlanView / writePlanView', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('пусто — «Неделя»; записанный вид читается; мусор — «Неделя»', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, String(v)) })
    expect(readPlanView()).toBe('week')
    writePlanView('month')
    expect(readPlanView()).toBe('month')
    writePlanView('week')
    expect(readPlanView()).toBe('week')
    map.set(PLAN_VIEW_KEY, '"tiles"')
    expect(readPlanView()).toBe('week')
    map.set(PLAN_VIEW_KEY, 'не json')
    expect(readPlanView()).toBe('week')
  })

  it('хранилище бросает — «Неделя», без исключений', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('закрыто')
      },
      setItem: () => {
        throw new Error('закрыто')
      },
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(readPlanView()).toBe('week')
    expect(() => writePlanView('month')).not.toThrow()
  })
})

// Подсказки у предмета (бэклог «первый» FR-05): «видел» — список id на устройстве; выход его стирает.
describe('readTipsSeen / markTipSeen', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = () => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
    })
    return map
  }

  it('пусто → отметка → «видел»; повтор не дублирует', () => {
    const map = stub()
    expect(readTipsSeen()).toEqual([])
    markTipSeen('tab-dreams')
    markTipSeen('tab-month')
    markTipSeen('tab-dreams')
    expect(readTipsSeen()).toEqual(['tab-dreams', 'tab-month'])
    expect(JSON.parse(map.get(TIPS_SEEN_KEY)!)).toEqual(['tab-dreams', 'tab-month'])
  })

  it('мусор в ключе — пустой список (не массив, не JSON, не строки в массиве — мимо)', () => {
    const map = stub()
    for (const raw of ['{"a":1}', '42', 'не json', '"tab-dreams"']) {
      map.set(TIPS_SEEN_KEY, raw)
      expect(readTipsSeen(), raw).toEqual([])
    }
    map.set(TIPS_SEEN_KEY, '["tab-week", 7, null]')
    expect(readTipsSeen()).toEqual(['tab-week'])
  })

  it('Р-13 «Figma» (FG-11): ключа нет в LOCAL_KEYS — выход и другая семья «видел» не стирают, остальное своё стирается', () => {
    const map = stub()
    setActivePinia(createPinia())
    useAuthStore().setAuthData(authAs('member', 'a'))
    markTipSeen('tab-dreams')
    map.set(MONTH_END_KEY, '"2026-09"') // ключ из LOCAL_KEYS — этого входа
    useAuthStore().logout('discard')
    expect(map.has(TIPS_SEEN_KEY)).toBe(true)
    expect(readTipsSeen()).toEqual(['tab-dreams'])
    expect(map.has(MONTH_END_KEY)).toBe(false)
    // Смена семьи на этом телефоне (`claimFor` другой — `clearLocal`).
    setActivePinia(createPinia())
    const finance = useFinanceStore()
    finance.claimFor('h-one')
    map.set(MONTH_END_KEY, '"2026-09"')
    finance.claimFor('h-two')
    expect(readTipsSeen()).toEqual(['tab-dreams'])
    expect(map.has(MONTH_END_KEY)).toBe(false)
  })
})
