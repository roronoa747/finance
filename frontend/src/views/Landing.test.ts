import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { renderScreen } from '@/test/screenState'
import { createAppRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore, DEMO_HOUSEHOLD } from '@/stores/finance'
import { writeDemoPending } from '@/lib/storage'
import { startDemo } from '@/lib/demo'
import Landing from './Landing.vue'

const visible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

describe('B2C-27: лэндинг «/» для анонима', () => {
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

  it('секции и тексты DESIGN.md §6: фраза-идея, три образа, для кого, приватность, подвал; ссылки на /access и /privacy', async () => {
    const html = await renderScreen(Landing, '/')
    const text = visible(html)
    for (const t of [
      'Реально.',
      'Фото цели и одна цифра — сколько до неё. Для пар и одиночек в Казахстане.',
      'Начать с Google',
      'Попробовать',
      'Бесплатно. Без карты. Выписка остаётся на телефоне.',
      'Мечта',
      'Свобода',
      'Утечки',
      'Для двоих. Или для одного.',
      'Файл не покидает телефон.',
      '© Family Finance, 2026 · Казахстан',
      'Политика конфиденциальности',
    ]) expect(text, t).toContain(t)
    expect(html).toContain('href="/access"')
    // Шапка без своего «Начать»: главное действие — одно, «Начать с Google» в герое (смоук владельца Б4).
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0]
    expect(nav).toBeTruthy()
    expect(nav).not.toContain('href="/access"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('mailto:')
    // Десктоп — та же страница шире: две колонки героя и три образа в ряд.
    expect(html).toContain('md:grid-cols-2')
    expect(html).toContain('md:grid-cols-3')
    // Картинки — снимки в теме экрана; ниже героя — лениво.
    expect(html).toContain('/landing/hero-light.webp')
    expect(html.match(/loading="lazy"/g)?.length).toBe(3)
  })

  it('черновик демо на телефоне — «Вернуться в демо»', async () => {
    useFinanceStore().claimFor(DEMO_HOUSEHOLD)
    expect(visible(await renderScreen(Landing, '/'))).toContain('Вернуться в демо')
  })

  it('вход истёк, правки семьи не отправлены — «Попробовать» нет, демо их не стирает (критик Блока 4)', async () => {
    localStorage.setItem('ff_unsent', JSON.stringify({ household: true }))
    const finance = useFinanceStore()
    finance.claimFor('h-own')
    finance.mutateHouseholdDoc((doc) => {
      doc.people = [{ id: 'a', name: 'Дана', salary: 1, updatedAt: '2026-10-01T00:00:00Z' } as never]
    })
    const before = JSON.stringify(finance.householdDoc)

    const text = visible(await renderScreen(Landing, '/'))
    expect(text).not.toContain('Попробовать')
    expect(text).toContain('Неотправленные правки ждут — войдите в свою семью.')

    expect(startDemo()).toBe(false)
    expect(useAuthStore().isDemo).toBe(false)
    expect(finance.docHousehold).toBe('h-own')
    expect(JSON.stringify(finance.householdDoc)).toBe(before)
    expect(finance.hasUnsent).toBe(true)
  })

  it('гард: аноним «/» — лэндинг; вошедший — приложение; вопрос «взять демо?» не отвечен — «с кем»', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')

    // Черновик демо, вход Google, семья уже создана, приложение перезапущено до ответа.
    useFinanceStore().claimFor(DEMO_HOUSEHOLD)
    writeDemoPending(true)
    useAuthStore().setAuthData({
      token: 'g',
      user: { id: 'u', email: 'a@b.kz', created_at: '' },
      household: { id: 'h-new', name: 'Наша казна', created_by: 'u', created_at: '' },
      member: { household_id: 'h-new', user_id: 'u', slot: 'a', display_name: 'Дана', role: 'member', joined_at: '' },
    })
    for (const path of ['/week', '/', '/start']) {
      await router.push(path)
      expect(router.currentRoute.value.path, path).toBe('/who')
    }
    // Ответили — гард отпускает.
    writeDemoPending(false)
    await router.push('/week')
    expect(router.currentRoute.value.path).toBe('/start')
  })
})
