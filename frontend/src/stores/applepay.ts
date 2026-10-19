import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { apiClient, type ApiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import type { WalletStatus } from '@/types/api'

/**
 * Apple Pay (бэклог «Apple Pay», AP-06): статус своего iPhone и ссылки на команду (`GET /api/wallet`, кэш на сессию),
 * подключить и отключить. Ключ телефона в сторе **не живёт**: `connect` отдаёт его листу, лист держит в памяти, пока
 * открыт (Р-5: ключ показывается один раз). Путь телефона (Р-3, Р-17): iOS 27 — команда с триггером, iOS 17–26 —
 * команда + автоматизация руками; версия — по токену `Version/NN` (Safari), не распознана — путь iOS 27 и тихая ссылка
 * «У меня iOS 26 или старше». Демо и viewer — без запросов (Р-20).
 */
export type ApplePayPath = 'ios27' | 'legacy'

/** Major-версия iOS по токену `Version/NN` user-agent Safari; нет токена (PWA с экрана «Домой», не Safari) — null. */
export function iosMajorOf(userAgent: string): number | null {
  const m = /Version\/(\d+)/.exec(userAgent)
  return m ? Number(m[1]) : null
}

export const useApplePayStore = defineStore('applepay', () => {
  const auth = useAuthStore()
  const finance = useFinanceStore()

  /** User-agent — полем: тесты и эмуляция подменяют. */
  const userAgent = ref(typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const status = ref<WalletStatus | null>(null)
  /** «У меня iOS 26 или старше» — выбор человека в листе. */
  const legacyChosen = ref(false)
  let loading: Promise<void> | null = null
  /** Номер последнего запроса статуса: ответ более раннего (до «Подключить», прошлого входа) не пишется. */
  let asked = 0
  /** Чей вход ждёт `loading`. */
  let loadingFor: string | null = null
  // Другой вход — другой человек: статус прошлого не показываем (его запрос в пути `load` не ждёт и не пишет).
  watch(
    () => auth.token,
    () => {
      status.value = null
      legacyChosen.value = false
    },
  )

  const canUse = computed(() => auth.isMember && !auth.isDemo && !finance.isDemo)
  const isIPhone = computed(() => /iPhone/.test(userAgent.value))
  const iosMajor = computed(() => iosMajorOf(userAgent.value))
  /** Версия распознана — выбирать путь не нужно; нет — тихая ссылка на старый путь. */
  const pathKnown = computed(() => iosMajor.value !== null)
  const path = computed<ApplePayPath>(() => (legacyChosen.value || (iosMajor.value !== null && iosMajor.value < 27) ? 'legacy' : 'ios27'))
  const link = computed(() => (status.value ? (path.value === 'ios27' ? status.value.shortcut_url : status.value.shortcut_url_legacy) : ''))
  /**
   * Карточка и строка видны: member, не демо, ссылка на команду для пути этого телефона есть, iOS 17+ или версия не
   * распознана (триггера «Транзакция» до iOS 17 нет, Р-3).
   */
  const available = computed(() => canUse.value && !!link.value && (iosMajor.value === null || iosMajor.value >= 17))
  const connected = computed(() => !!status.value?.connected)
  /**
   * Вторая команда «Пуши банков» (Блок 2, Р-17, Р-23): только путь iOS 27 (триггера «Уведомление» раньше нет) и
   * только когда ссылка есть; пусто — шагов пушей в листе и кнопки в карточке нет.
   */
  const pushLink = computed(() => (available.value && path.value === 'ios27' ? (status.value?.push_shortcut_url ?? '') : ''))

  /**
   * Статус — раз за сессию (`force` — после подключения и отключения: новый запрос, даже если прежний ещё в пути — его
   * ответ уже устарел, критик Б1). Ждём первую оплату (`waiting`) — не кэшируется: первая оплата приходит, пока
   * приложение в фоне (критик возврата 2026-10-19).
   */
  async function load(client: ApiClient = apiClient, force = false) {
    if (!canUse.value) return
    if (status.value && !force && !status.value.waiting) return
    const token = auth.token
    if (loading && !force && loadingFor === token) return loading
    const mine = ++asked
    loadingFor = token
    const run = (async () => {
      try {
        const s = await client.walletStatus()
        if (mine === asked && auth.token === token) status.value = s
      } catch {
        // Без сети или сбой — карточки просто нет; следующий заход спросит снова.
      } finally {
        if (mine === asked) loading = null
      }
    })()
    loading = run
    return run
  }

  /** Новый ключ этого телефона — по «Скопировать ключ»; отдаётся листу и больше нигде не хранится. */
  async function connect(client: ApiClient = apiClient): Promise<string> {
    const { key } = await client.walletConnect()
    void load(client, true)
    return key
  }

  /** «Отключить» — все телефоны человека (Р-13). */
  async function disconnect(client: ApiClient = apiClient) {
    await client.walletDisconnect()
    if (status.value) status.value = { ...status.value, connected: false, phones: 0, waiting: false, last_used_at: undefined }
  }

  function chooseLegacy(on = true) {
    legacyChosen.value = on
  }

  /**
   * Возврат в приложение (`syncEngine`): ждали первую оплату — статус спрашивается снова. Иначе после оплаты карточка
   * писала бы «Ждём первую оплату», а «Неделя» — «Траты сами с Apple Pay» рядом с самой тратой до перезапуска PWA.
   */
  function refreshWaiting(client: ApiClient = apiClient) {
    return status.value?.waiting ? load(client) : undefined
  }

  return { userAgent, status, isIPhone, iosMajor, pathKnown, path, link, pushLink, available, connected, load, connect, disconnect, chooseLegacy, refreshWaiting }
})
