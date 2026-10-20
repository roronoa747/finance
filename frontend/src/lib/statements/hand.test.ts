import { describe, expect, it } from 'vitest'
import { applyRules, categorize, handId, handOperation, isHand, spendTotals } from './model'
import { matchCandidates } from './matching'
import { replacedByStatement } from './phone'
import type { MerchantRule, Operation } from './types'
import type { Obligation } from '@/types/finance'

/**
 * Бэклог «Ручная трата» (MAN-01, Р-1, Р-2): трата, вписанная руками, — обычная личная операция банка `hand`. Раздел
 * выбрал человек — правила и словарь его не меняют; вопросом «это платёж?» не становится; выписка её не заменяет.
 */
const hand = (extra: Partial<Parameters<typeof handOperation>[0]> = {}, name = 'Продукты') =>
  handOperation({ id: 'aaaabbbbccccdddd', amount: 2_500, categoryId: 'sc_food', date: '2026-10-20', note: '', ...extra }, name)

describe('handOperation', () => {
  it('списание в целых тенге, вид «покупка», банк hand; подпись — заметка, пусто — имя раздела', () => {
    expect(hand()).toEqual({
      id: 'aaaabbbbccccdddd', bank: 'hand', date: '2026-10-20', amount: -2_500, kind: 'purchase', merchant: 'Продукты', categoryId: 'sc_food', internal: false,
    })
    const named = hand({ note: '  Магнум  у дома ' })
    expect(named).toMatchObject({ merchant: 'Магнум у дома', note: 'Магнум у дома' })
    expect(isHand(named)).toBe(true)
    // Минус и дробь не проходят: 2 500,4 → 2 500 списания.
    expect(hand({ amount: 2_500.4 }).amount).toBe(-2_500)
    expect(hand({ amount: -700 }).amount).toBe(-700)
  })

  it('длинные цифры из заметки уходят (сервер отверг бы строку — очередь встала бы), пустое — имя раздела', () => {
    expect(hand({ note: 'карта 4400430212345678' }).merchant).toBe('карта')
    const onlyDigits = hand({ note: '1234567' })
    expect(onlyDigits.merchant).toBe('Продукты')
    expect(onlyDigits.note).toBeUndefined()
  })

  it('id — 16 hex-знаков, каждый раз новый (сервер: ^[0-9a-f]{8,32}$)', () => {
    const a = handId()
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(handId()).not.toBe(a)
  })
})

describe('ручная трата среди операций', () => {
  const magnum = hand({ note: 'Magnum', categoryId: 'sc_cafe' }, 'Кафе и рестораны')

  it('раздел выбрал человек: словарь (Magnum → продукты) и правило семьи его не меняют', () => {
    const rules: MerchantRule[] = [{ id: 'r1', match: { merchant: 'magnum' }, to: { categoryId: 'sc_gifts' }, updatedAt: '', by: 'a' }]
    expect(categorize(magnum, [])).toEqual({ categoryId: 'sc_cafe', internal: false })
    expect(categorize(magnum, rules)).toEqual({ categoryId: 'sc_cafe', internal: false })
    // Та же строка из выписки — по словарю и правилу.
    const statement: Operation = { ...magnum, bank: 'kaspi', categoryId: null }
    expect(categorize(statement, rules).categoryId).toBe('sc_gifts')
    expect(applyRules([magnum], rules)[0]).toBe(magnum)
  })

  it('вопросом «это платёж по …?» не становится, даже сумма и день как у обязательства', () => {
    const rent: Obligation = { id: 'rent', name: 'Аренда', note: '', day: 20, category: 'd1', versions: [{ from: '2000-01', amount: 2_500 }], updatedAt: '' }
    const rentRule: MerchantRule[] = [{ id: 'r2', match: { merchant: 'magnum' }, to: { payment: { kind: 'obligation', targetId: 'rent' } }, updatedAt: '', by: 'a' }]
    const statement: Operation = { ...magnum, id: 'bbbbccccddddeeee', bank: 'kaspi' }
    expect(matchCandidates([statement], { obligations: [rent] }, [])).toHaveLength(1)
    expect(matchCandidates([magnum], { obligations: [rent] }, [])).toEqual([])
    expect(matchCandidates([magnum], { obligations: [rent] }, rentRule)).toEqual([])
  })

  it('выписка её не заменяет: та же сумма, день и продавец — ручная остаётся', () => {
    const line: Operation = { ...magnum, id: 'cccc000011112222', bank: 'kaspi' }
    expect(replacedByStatement([line], [magnum], [{ bank: 'kaspi', from: '2026-10-01', to: '2026-10-31' }]).size).toBe(0)
  })

  it('в итогах раздела — как трата', () => {
    const totals = spendTotals([magnum, hand()], 'a', 'week', '2026-W43', '')
    expect(totals.map((t) => [t.categoryId, t.amount, t.ops])).toEqual([
      ['sc_cafe', 2_500, 1],
      ['sc_food', 2_500, 1],
    ])
  })
})
