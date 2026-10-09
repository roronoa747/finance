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
})
