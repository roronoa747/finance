import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createMemoryHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore, defaultSyncDoc } from '@/stores/finance'
import type { SyncDoc } from '@/types/finance'
import { authAs, planFamilyDoc } from '@/test/planFamily'
import { createAppRouter } from '@/router'
import { landingPath } from './landing'

/** Куда после входа и гард первого запуска (B2C-19). */
describe('router/landing — первый запуск', () => {
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

  function family(role: 'member' | 'viewer', slot: 'a' | 'b', doc: SyncDoc) {
    useAuthStore().setAuthData(authAs(role, slot))
    const store = useFinanceStore()
    store.setHouseholdDoc(doc, 1)
    return store
  }
  const withoutB = () => ({ ...planFamilyDoc(), people: [planFamilyDoc().people[0]] })

  it('landingPath: семья без данных → /start; посреди потока (данные есть, участник не отмечен) → /start; участник с записью → /; партнёр по коду без записи → /start; viewer → /', () => {
    const auth = useAuthStore()
    const finance = family('member', 'a', defaultSyncDoc())
    expect(landingPath(auth, finance)).toBe('/start')
    // Ответил про доход и перезагрузил: семья не настроена, участник без onboardedAt — продолжение.
    finance.setHouseholdDoc({ ...planFamilyDoc(), setupDoneAt: null }, 2)
    expect(landingPath(auth, finance)).toBe('/start')
    finance.setPerson('a', { onboardedAt: '2026-09-24T07:00:00.000Z' })
    expect(landingPath(auth, finance)).toBe('/')
    finance.setHouseholdDoc(planFamilyDoc(), 3)
    expect(landingPath(auth, finance)).toBe('/')
    auth.setAuthData(authAs('member', 'b'))
    finance.setHouseholdDoc(withoutB(), 3)
    expect(landingPath(auth, finance)).toBe('/start')
    auth.setAuthData(authAs('viewer', 'b'))
    expect(landingPath(auth, finance)).toBe('/')
    finance.setHouseholdDoc(defaultSyncDoc(), 4)
    expect(landingPath(auth, finance)).toBe('/')
  })

  // PV-06 (ушёл вместе с мастером; ревью Блока 3 Н-13): надгробия — не данные. Иначе семья с
  // удалённой целью и удалённым обязательством миновала бы первый запуск.
  it('landingPath: семья только с надгробиями (удалённая цель и удалённое обязательство) → /start', () => {
    const auth = useAuthStore()
    const plan = planFamilyDoc()
    const tomb = { deletedAt: '2026-09-20T07:00:00.000Z' }
    const finance = family('member', 'a', {
      ...defaultSyncDoc(),
      setupDoneAt: null,
      people: [{ ...plan.people[0], salary: 0, onboardedAt: '2026-09-24T07:00:00.000Z' }],
      goals: [{ ...plan.goals[0], ...tomb }],
      obligations: [{ ...plan.obligations[0], ...tomb }],
    })
    expect(landingPath(auth, finance)).toBe('/start')
    // Та же семья с живой целью — данные есть, участник отмечен: главный.
    finance.setHouseholdDoc({ ...finance.householdDoc, goals: [plan.goals[0]] }, 2)
    expect(landingPath(auth, finance)).toBe('/')
  })

  it('гард: без данных всё ведёт на /start, /setup — тоже; viewer без данных остаётся на главном', async () => {
    family('member', 'a', defaultSyncDoc())
    const router = createAppRouter(createMemoryHistory())
    for (const path of ['/', '/goals/new', '/setup', '/start/questions']) {
      await router.push(path)
      expect(router.currentRoute.value.path.startsWith('/start')).toBe(true)
    }
    await router.push('/start/month')
    expect(router.currentRoute.value.path).toBe('/start/month')
    // Посреди потока (доход записан, семья не настроена): и /start, и главный открыты.
    useFinanceStore().setPerson('a', { name: 'Ильяс', salary: 700_000, payday: 10 })
    await router.push('/start/questions')
    expect(router.currentRoute.value.path).toBe('/start/questions')
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/')

    setActivePinia(createPinia())
    family('viewer', 'b', defaultSyncDoc())
    const viewer = createAppRouter(createMemoryHistory())
    await viewer.push('/')
    expect(viewer.currentRoute.value.path).toBe('/')
    await viewer.push('/start')
    expect(viewer.currentRoute.value.path).toBe('/')
  })

  it('гард: настроенная семья — /start открыт партнёру без записи и закрыт участнику, прошедшему свой запуск; /access ведёт по landingPath', async () => {
    family('member', 'b', withoutB())
    const partner = createAppRouter(createMemoryHistory())
    await partner.push('/start')
    expect(partner.currentRoute.value.path).toBe('/start')
    await partner.push('/')
    expect(partner.currentRoute.value.path).toBe('/')
    await partner.push('/access')
    expect(partner.currentRoute.value.path).toBe('/start')

    setActivePinia(createPinia())
    const done = planFamilyDoc()
    done.people = done.people.map((p) => ({ ...p, onboardedAt: '2026-09-02T07:00:00.000Z' }))
    family('member', 'a', done)
    const member = createAppRouter(createMemoryHistory())
    await member.push('/start')
    expect(member.currentRoute.value.path).toBe('/')
    await member.push('/access')
    expect(member.currentRoute.value.path).toBe('/')
  })

  it('гард: партнёр посреди своего запуска (доход записан, onboardedAt нет) после перезагрузки остаётся на вопросах; прошёл — главный', async () => {
    const finance = family('member', 'b', withoutB())
    await createAppRouter(createMemoryHistory()).push('/start/questions')
    // «Да, это зарплата» — запись участника есть, запуск ещё не закончен.
    finance.setPerson('b', { name: 'Аруна', salary: 500_000, payday: 20 })
    const reloaded = createAppRouter(createMemoryHistory())
    await reloaded.push('/start/questions')
    expect(reloaded.currentRoute.value.path).toBe('/start/questions')
    // Главный тоже открыт — landingPath уже «/».
    await reloaded.push('/')
    expect(reloaded.currentRoute.value.path).toBe('/')

    // «Готово» — onboardedAt: /start закрыт.
    finance.setPerson('b', { onboardedAt: '2026-09-24T07:00:00.000Z' })
    await reloaded.push('/start/questions')
    expect(reloaded.currentRoute.value.path).toBe('/')

    // Viewer без onboardedAt на /start не остаётся.
    setActivePinia(createPinia())
    family('viewer', 'b', planFamilyDoc())
    const viewer = createAppRouter(createMemoryHistory())
    await viewer.push('/start/questions')
    expect(viewer.currentRoute.value.path).toBe('/')
  })
})
