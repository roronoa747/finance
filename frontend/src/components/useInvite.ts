import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authErrorText } from '@/lib/authErrors'
import type { PersonId } from '@/types/finance'

/**
 * Созданный код — один на сессию и семью: «С кем» в Настройках и шаг первого запуска видят
 * один и тот же код, второй не создаётся. После выхода и входа в другую семью код не виден.
 */
const shared = ref<{ household: string; code: string } | null>(null)

/**
 * Состав семьи одним местом (ревью frontend Б4 Н-2, Р-124): с сервера (`GET /api/household/members`,
 * B2C-23) — все, включая viewer, с ролями; имя — из документа по слоту. Сервер не ответил (нет
 * сети, демо) — живые люди документа (без надгробия `deletedAt`). `fullMembers` — сколько из них
 * полноправных: по нему «Пригласить» (после ухода партнёра его запись в документе остаётся, а
 * сервер считает одного).
 */
export function useMembers() {
  const authStore = useAuthStore()
  const financeStore = useFinanceStore()
  const rows = computed(() => {
    const people = financeStore.people.filter((p) => !p.deletedAt)
    if (!authStore.members.length)
      return people.map((p) => ({ id: p.id as PersonId, name: p.name, role: p.id === authStore.slot && authStore.isViewer ? 'viewer' : 'member' }))
    return authStore.members.map((m) => ({
      id: m.slot as PersonId,
      name: people.find((p) => p.id === m.slot)?.name || m.display_name,
      role: m.role,
    }))
  })
  const fullMembers = computed(() => rows.value.filter((r) => r.role === 'member').length)
  return { rows, fullMembers }
}

/**
 * Код приглашения второго участника — «С кем» в Настройках (дом приглашения, приёмка Блока 3
 * п. 8) и шаг первого запуска (PV-21). Ошибка — русским текстом на экране, а не в консоли
 * (Б-14, `authErrorText`).
 */
export function useInvite() {
  const authStore = useAuthStore()
  const household = computed(() => authStore.household?.id ?? '')
  const code = computed(() => (shared.value && shared.value.household === household.value ? shared.value.code : null))
  const busy = ref(false)
  const error = ref('')
  const copied = ref(false)
  const { fullMembers } = useMembers()
  // Код создаёт участник с правом правки (viewer получил бы 403), в демо сервера нет; в семье уже
  // двое участников — кода нет (сервер третьего и не впустит). После ухода партнёра — снова есть.
  const canInvite = computed(() => fullMembers.value < 2 && !authStore.isViewer && !authStore.isDemo)

  async function make() {
    busy.value = true
    error.value = ''
    try {
      const at = household.value
      shared.value = { household: at, code: (await authStore.createInvite()).code }
    } catch (e) {
      error.value = authErrorText(e instanceof Error ? e.message : String(e), 'invite')
    } finally {
      busy.value = false
    }
  }

  async function copy() {
    if (!code.value) return
    try {
      await navigator.clipboard.writeText(code.value)
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    } catch {
      // Буфер может быть недоступен — код и так виден на экране.
    }
  }

  return { code, canInvite, busy, error, copied, make, copy }
}
