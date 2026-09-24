import { describe, it, expect, vi } from 'vitest'
import { fetchRates, formRate, type FxRates } from './fx'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchRates', () => {
  it('200 → разобранный курс с API', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      json({ rates: { USD: 447.85, EUR: 513.46 }, date: '2026-09-23', source: 'Национальный банк РК' }),
    )
    const res = await fetchRates(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('/api/fx-rate')
    expect(res).toEqual({
      rates: { USD: 447.85, EUR: 513.46 },
      date: '2026-09-23',
      source: 'Национальный банк РК',
    })
  })

  it('502 от API → null', async () => {
    const res = await fetchRates(vi.fn().mockResolvedValue(json({ error: 'курс Нацбанка недоступен' }, 502)))
    expect(res).toBeNull()
  })

  it('сетевая ошибка (офлайн) → null', async () => {
    const res = await fetchRates(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(res).toBeNull()
  })

  it('неожиданный ответ → null', async () => {
    expect(await fetchRates(vi.fn().mockResolvedValue(json({ foo: 1 })))).toBeNull()
    expect(await fetchRates(vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })))).toBeNull()
  })
})

describe('formRate — курс в форме нового счёта', () => {
  const info: FxRates = { rates: { USD: 447.85, EUR: 508.71 }, date: '2026-09-23', source: '' }

  it('смена валюты меняет авто-курс: EUR → USD', () => {
    const eur = formRate(info, 'EUR', '', false)
    expect(eur).toBe('508.71')
    expect(formRate(info, 'USD', eur, false)).toBe('447.85')
  })

  it('курс, вписанный руками, смена валюты не трогает', () => {
    expect(formRate(info, 'USD', '510', true)).toBe('510')
  })

  it('стёртое руками поле снова заполняется авто-курсом', () => {
    expect(formRate(info, 'USD', '', true)).toBe('447.85')
  })

  it('нет курса для валюты или курс не пришёл → пустое поле, а не курс чужой валюты', () => {
    expect(formRate(info, 'RUB', '508.71', false)).toBe('')
    expect(formRate(null, 'USD', '', false)).toBe('')
  })
})
