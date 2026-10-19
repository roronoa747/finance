import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { renderScreen } from '@/test/screenState'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import Privacy from './Privacy.vue'

describe('B2C-26: /privacy — публичная политика конфиденциальности', () => {
  beforeEach(() => {
    const map = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => map.set(k, String(v)),
      removeItem: (k: string) => map.delete(k),
      clear: () => map.clear(),
    })
    setActivePinia(createPinia())
  })

  it('разделы: кто мы, что храним и что нет, где, кому передаём, удаление, контакт, дата; английская версия', async () => {
    const html = await renderScreen(Privacy, '/privacy')
    for (const text of ['Кто мы', 'Что храним', 'Что не храним', 'Где хранится', 'Кому передаём', 'Удаление', 'Обновлено']) {
      expect(html, text).toContain(text)
    }
    expect(html).toContain('Файл выписки не покидает телефон')
    expect(html).toContain('Сеул')
    expect(html).toContain('mailto:ilyas.muratbek.99@gmail.com')
    expect(html).toContain('Privacy policy (summary)')
  })

  it('AI-05: ИИ-помощник — Claude (Anthropic) при флаге семьи и согласии, без обучения; Gemini нет', async () => {
    const html = await renderScreen(Privacy, '/privacy')
    expect(html).not.toContain('Gemini')
    expect(html).toContain('Anthropic')
    // Хвост §4 ревью frontend Блока 1 (Н-1), AI-10: срок хранения у Anthropic, где обрабатывается, что храним сами.
    expect(html).toContain('запросы хранит до 30 дней')
    expect(html).toContain('вне Сеула')
    expect(html).toContain('число запросов и расход семьи за месяц')
    expect(html).toContain('keeps requests for up to 30 days')
    expect(html).toContain('не обучается')
    expect(html).toContain('вы дали согласие')
    expect(html).toContain('does not train on this data')
  })

  // AU-10 (бэклог «ИИ-польза», Р-12); RZ-03 (бэклог «Разбор», Р-21): те же пункты, что в листе согласия v3, RU и EN.
  // Критик Блока 1: «что раздуло» шлёт и крупнейшие покупки раздела (не повторы) — политика называет и их.
  it('RZ-03: согласие v3 — продавцы с суммами частых трат, списаний и крупнейших покупок без дат и людей, чек, фраза мечты, разбор сам; RU и EN', async () => {
    const html = await renderScreen(Privacy, '/privacy')
    expect(html).not.toContain('названия продавцов и подписок без сумм')
    for (const text of ['названия продавцов и суммы частых трат, повторяющихся списаний и крупнейших покупок, число повторов (без дат, без людей)', 'фото чека', 'фраза о мечте', 'Разбор месяца приходит сам', '1-го числа и после отметки зарплаты', 'Фото чека уходит ИИ-помощнику и нигде не сохраняется', '19 октября 2026']) {
      expect(html, text).toContain(text)
    }
    for (const text of ['amounts of frequent spending, repeated charges and the largest purchases, and repeat counts (no dates, no people)', 'receipt photos (never stored)', 'dream phrase', 'arrives by itself', 'after a salary is marked', 'October 19, 2026']) {
      expect(html, text).toContain(text)
    }
  })

  it('открывается без входа и пользователю без семьи; вошедший тоже видит', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/privacy')
    expect(router.currentRoute.value.path).toBe('/privacy')

    useAuthStore().setAuthData({ token: 't', user: { id: 'u', email: 'a@b.kz', created_at: '' }, household: null, member: null })
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/who')
    await router.push('/privacy')
    expect(router.currentRoute.value.path).toBe('/privacy')
  })

  it('AP-06: Apple Pay — и в русском списке, и в английской сводке (ревью frontend Н-7)', async () => {
    const html = await renderScreen(Privacy, '/privacy')
    expect(html).toContain('Apple Pay и пуши банков, если подключите')
    expect(html).toContain('без номера карты, остатка и текста пуша')
    const english = html.slice(html.indexOf('Privacy policy (summary)'))
    expect(english).toContain('Apple Pay')
    expect(english.replace(/\s+/g, ' ')).toContain('no card number, balance or notification text')
  })
})
