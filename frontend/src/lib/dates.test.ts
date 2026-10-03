import { afterEach, describe, expect, it, vi } from 'vitest'
import { addedLabel, monthShort, weekKey, weekRange, weekRangeLabel } from './dates'

describe('weekKey — ISO-неделя по Алматы', () => {
  afterEach(() => vi.useRealTimers())

  it('дата выписки: понедельник и воскресенье — одна неделя', () => {
    expect(weekKey('2026-09-21')).toBe('2026-W39')
    expect(weekKey('2026-09-27')).toBe('2026-W39')
    expect(weekKey('2026-09-28')).toBe('2026-W40')
  })

  it('границы года: 1 января может быть прошлой неделей, 31 декабря — следующей', () => {
    expect(weekKey('2027-01-01')).toBe('2026-W53')
    expect(weekKey('2026-01-01')).toBe('2026-W01')
    expect(weekKey('2025-12-29')).toBe('2026-W01')
    expect(weekKey('2024-12-30')).toBe('2025-W01')
    expect(weekKey('2021-01-03')).toBe('2020-W53')
  })

  it('«сейчас» — по Алматы: вечер воскресенья по UTC — уже понедельник', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-27T18:59:00Z')) // 23:59 воскресенья в Алматы
    expect(weekKey()).toBe('2026-W39')
    vi.setSystemTime(new Date('2026-09-27T19:00:00Z')) // 00:00 понедельника в Алматы
    expect(weekKey()).toBe('2026-W40')
    vi.setSystemTime(new Date('2026-12-31T19:30:00Z')) // 1 января 2027, 00:30 в Алматы
    expect(weekKey()).toBe('2026-W53')
  })
})

describe('weekRange', () => {
  it('понедельник — воскресенье, в том числе через границу года', () => {
    expect(weekRange('2026-W39')).toEqual({ from: '2026-09-21', to: '2026-09-27' })
    expect(weekRange('2026-W01')).toEqual({ from: '2025-12-29', to: '2026-01-04' })
    expect(weekRange('2026-W53')).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })

  it('обратна weekKey для каждого дня недели', () => {
    for (const key of ['2025-W01', '2026-W10', '2026-W53']) {
      const { from } = weekRange(key)
      for (let i = 0; i < 7; i++) {
        const day = new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
        expect(weekKey(day)).toBe(key)
      }
    }
  })
})

describe('weekRangeLabel — заголовок недели на главном и «Неделе»', () => {
  it('один месяц — «21–27 сентября»; на стыке месяцев и лет — обе половины', () => {
    expect(weekRangeLabel(weekRange('2026-W39'))).toBe('21–27 сентября')
    expect(weekRangeLabel({ from: '2026-09-28', to: '2026-10-04' })).toBe('28 сентября – 4 октября')
    expect(weekRangeLabel(weekRange('2026-W01'))).toBe('29 декабря – 4 января')
  })
})

describe('addedLabel — когда добавили или купили желание', () => {
  it('ISO — день по Алматы; старая строка из прода — как есть; пусто — пустая строка', () => {
    expect(addedLabel('2026-09-24T10:00:00.000Z')).toBe('24 сентября')
    // 20:00 UTC 30 сентября — в Алматы уже 1 октября.
    expect(addedLabel('2026-09-30T20:00:00.000Z')).toBe('1 октября')
    expect(addedLabel('2026-09-05')).toBe('5 сентября')
    expect(addedLabel('24.09.2026')).toBe('24.09.2026')
    expect(addedLabel('')).toBe('')
    expect(addedLabel(null)).toBe('')
    expect(addedLabel(undefined)).toBe('')
  })
})

describe('monthShort — короткое имя месяца', () => {
  it('с годом по умолчанию, без года — для ленты месяцев листа курса', () => {
    expect(monthShort('2026-03')).toBe('мар 2026')
    expect(monthShort('2026-03', false)).toBe('мар')
  })
})
