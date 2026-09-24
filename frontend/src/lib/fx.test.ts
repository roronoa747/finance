import { describe, it, expect, vi } from 'vitest'
import { fetchRates } from './fx'

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
