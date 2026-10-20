<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiClient, ApiError, type AdminMetrics } from '@/api/client'
import type { AdminFamilies, AiCheck } from '@/types/api'
import Card from '@/components/kit/Card.vue'
import AdminWalletDebug from '@/components/applepay/AdminWalletDebug.vue'
import AdminPushStats from '@/components/applepay/AdminPushStats.vue'
import Hint from '@/components/kit/Hint.vue'
import Toast from '@/components/kit/Toast.vue'
import Toggle from '@/components/kit/Toggle.vue'
import { useFlash } from '@/components/kit/useFlash'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import { agoLabel } from '@/lib/dates'
import { pct as share, usdFromMicros, usdWhole } from '@/lib/money'
import { plural } from '@/lib/utils'

/**
 * Цифры для владельца (B2C-28, Р-16): удержание и воронка — таблицами, без графиков. Ручка
 * отвечает только почтам из `ADMIN_EMAILS`; остальным — 404, и экран говорит «нет такой страницы».
 */
const metrics = ref<AdminMetrics | null>(null)
const state = ref<'loading' | 'ok' | 'none' | 'error'>('loading')

/**
 * ИИ семей (бэклог «ИИ», AI-04, Р-7): у каждой семьи свой тумблер — действие у предмета; расход
 * тихой строкой только там, где ИИ включён или уже тратил; лимит один на всех — в подсказке шапки.
 */
const families = ref<AdminFamilies | null>(null)
const familiesError = ref<string | null>(null)
const pending = ref<Set<string>>(new Set())
const checking = ref(false)
const checkFail = ref<string | null>(null)
const { note, flash } = useFlash()

async function loadFamilies() {
  try {
    families.value = await apiClient.adminFamilies()
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) familiesError.value = 'Не получилось загрузить семьи.'
  }
}

async function setAi(id: string, on: boolean) {
  const row = families.value?.families.find((f) => f.id === id)
  if (!row || pending.value.has(id)) return
  pending.value = new Set(pending.value).add(id)
  familiesError.value = null
  row.ai = on
  try {
    Object.assign(row, await apiClient.setFamilyAi(id, on))
  } catch {
    row.ai = !on
    familiesError.value = on ? 'Не получилось включить ИИ.' : 'Не получилось выключить ИИ.'
  } finally {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  }
}

const CHECK_REASONS: Record<Extract<AiCheck, { ok: false }>['reason'], string> = {
  no_key: 'Ключ не задан: ANTHROPIC_API_KEY в env Vercel.',
  failed: 'Claude не ответил: сеть, ключ или сбой у Anthropic.',
  rate_limited: 'Лимит запросов у Anthropic — попробуйте позже.',
  refused: 'Модель отказалась отвечать.',
}

async function check() {
  checking.value = true
  checkFail.value = null
  try {
    const res = await apiClient.aiCheck()
    if (res.ok) {
      flash(`Связь есть · ${res.ms} мс`)
    } else {
      checkFail.value = CHECK_REASONS[res.reason]
      flash('Нет связи')
    }
  } catch {
    checkFail.value = 'Сервер не ответил.'
    flash('Нет связи')
  } finally {
    checking.value = false
  }
}

// Запросы были, а расход 0 — модели нет в таблице цен сервера (Р-14): «≈ —», а не «$0». Запросов нет —
// одна цифра «0 запросов», «$0» рядом ничего не добавляет (правило 12, шумные цифры). Лимит — деньги
// (бэклог «ИИ-польза» Р-11): у расхода — «из $2».
const spent = (requests: number, micros: number, limit: number) => {
  const n = `${requests} ${plural(requests, 'запрос', 'запроса', 'запросов')}`
  if (requests === 0 && micros === 0) return n
  return `${n} · ${micros === 0 ? '≈ —' : `${usdFromMicros(micros)} из ${usdWhole(limit)}`}`
}

/**
 * Список семей (бэклог «Семьи в админке», Р-1…Р-3): порядок — ответа сервера (ИИ, затем свежесть входа); на экране
 * первые 10, остальные — тихой «Ещё N»; поиск по части почты — все совпадения без лимита. Зелёная точка — вход за
 * 7 суток, то же окно, что у «Активные за 7 дней»; подпись «сегодня / вчера / N дней назад» — по дням Алматы.
 */
const FAMILIES_SHOWN = 10
const ACTIVE_MS = 7 * 86_400_000
const query = ref('')
const showAll = ref(false)
const needle = computed(() => query.value.trim().toLowerCase())
const shownFamilies = computed(() => {
  const all = families.value?.families ?? []
  if (needle.value) return all.filter((f) => f.emails.some((e) => e.toLowerCase().includes(needle.value)))
  return showAll.value ? all : all.slice(0, FAMILIES_SHOWN)
})
const moreFamilies = computed(() => (needle.value ? 0 : (families.value?.families.length ?? 0) - shownFamilies.value.length))
const isActive = (at: string | null) => at !== null && Date.now() - Date.parse(at) < ACTIVE_MS

onMounted(async () => {
  void loadFamilies()
  try {
    metrics.value = await apiClient.adminMetrics()
    state.value = 'ok'
  } catch (e) {
    state.value = e instanceof ApiError && e.status === 404 ? 'none' : 'error'
  }
})

const pct = (part: number, whole: number) => (whole ? `${share(part, whole)} %` : '—')
const second = computed(() => metrics.value?.second_upload_14d)
const totals = computed(() => {
  const m = metrics.value
  if (!m) return []
  return [
    ['Пользователи', m.users],
    ['Семьи', m.households],
    ['Семьи с выпиской', m.households_with_upload],
    ['Активные за 7 дней', m.active_7d],
    ['Активные за 28 дней', m.active_28d],
  ] as const
})
const funnel = computed(() => {
  const f = metrics.value?.funnel_28d
  if (!f) return []
  return [
    ['Создали семью', f.created],
    ['Загрузили выписку', f.uploaded],
    ['Выбрали цель', f.goal],
    ['Прошли первый запуск', f.done],
  ] as const
})
</script>

<template>
  <div class="flex flex-col gap-3 pt-1 text-left">
    <!-- Семьи — своя ручка: видны, даже если цифры ниже не загрузились (не-админу обе — 404). -->
    <Card v-if="families" data-families>
      <div class="mb-1 flex items-center gap-1.5">
        <h2 class="type-h3 text-ink">Семьи</h2>
        <Hint label="Про лимит">
          <span data-limit>До {{ usdWhole(families.limit_micros) }} ИИ в месяц на семью.</span>
          Общий потолок — в консоли Anthropic.
        </Hint>
        <span class="flex-1" />
        <!-- -mr-3: текст кнопки — по правому краю тумблеров (у ghost sm поле 12). -->
        <Button variant="ghost" size="sm" class="-mr-3" :disabled="checking" data-ai-check @click="check">Проверить связь</Button>
      </div>
      <p v-if="!families.key" class="mb-1 text-[13px] text-warn" data-no-key>Ключ не задан — ИИ выключен везде</p>
      <!-- Тост уходит, а «Нет связи» остаётся словом — «?» без слова рядом не понять. -->
      <p v-if="checkFail" class="mb-1 flex items-center gap-1.5 text-[13px] text-warn" data-check-fail>
        Нет связи
        <Hint label="Почему нет связи"><span data-check-reason>{{ checkFail }}</span></Hint>
      </p>
      <p v-if="familiesError" role="alert" class="mb-1 text-[13px] text-warn">{{ familiesError }}</p>
      <p v-if="!families.families.length" class="text-[14px] text-ink-2">Семей пока нет.</p>
      <template v-else>
        <!-- Поиск нужен, когда список не помещается в первые 10 (Р-3); type text — у search крестик Chrome своего цвета, не токен. -->
        <Input
          v-if="families.families.length > FAMILIES_SHOWN"
          v-model="query"
          inputmode="search"
          enterkeyhint="search"
          placeholder="Поиск по почте"
          class="mb-1.5 mt-1"
          aria-label="Поиск семьи по почте"
          data-family-search
        />
        <p v-if="!shownFamilies.length" class="py-2.5 text-[14px] text-ink-2" data-family-none>Никого не нашли</p>
        <ul>
          <li
            v-for="f in shownFamilies"
            :key="f.id"
            class="flex items-center gap-3 border-t border-line py-2.5 first:border-0"
            :data-family="f.id"
          >
            <div class="min-w-0 flex-1">
              <!-- Одна линия: точка входа за 7 суток, почты (обрезаются), когда заходили — тихо справа. -->
              <div class="flex items-center gap-2">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="isActive(f.last_active_at) && 'bg-ok'"
                  :data-active="isActive(f.last_active_at) || undefined"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate text-[14px] text-ink" data-emails>{{ f.emails.join(' · ') || '—' }}</span>
                <span v-if="f.last_active_at" class="type-meta shrink-0" data-ago>{{ agoLabel(f.last_active_at) }}</span>
              </div>
              <div v-if="f.ai || f.requests > 0 || f.cost_micros > 0" class="type-meta mt-0.5 pl-4 num" data-spent>{{ spent(f.requests, f.cost_micros, families.limit_micros) }}</div>
            </div>
            <Toggle
              :model-value="f.ai"
              :label="`ИИ: ${f.emails.join(', ') || 'семья'}`"
              :disabled="pending.has(f.id)"
              @update:model-value="(on) => setAi(f.id, on)"
            />
          </li>
        </ul>
        <!-- -ml-3: текст кнопки — по левому краю списка (у ghost sm поле 12). -->
        <Button v-if="moreFamilies > 0" variant="ghost" size="sm" class="-ml-3" data-family-more @click="showAll = true">Ещё {{ moreFamilies }}</Button>
      </template>
    </Card>
    <p v-else-if="familiesError" role="alert" class="text-[14px] text-warn">{{ familiesError }}</p>

    <p v-if="state === 'loading'" class="text-[14px] text-ink-2">Минуту…</p>
    <p v-else-if="state === 'none'" class="text-[14px] text-ink-2">Нет такой страницы.</p>
    <p v-else-if="state === 'error'" role="alert" class="text-[14px] text-warn">Не получилось загрузить цифры.</p>

    <template v-else-if="metrics">
      <Card>
        <div class="type-meta">Вторая выписка за 14 дней</div>
        <div class="type-big num mt-1" data-metric="second">{{ pct(second!.retained, second!.eligible) }}</div>
        <div class="type-meta mt-1">{{ second!.retained }} из {{ second!.eligible }} семей</div>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">Всего</h2>
        <table class="w-full text-[14px]">
          <tr v-for="[label, n] in totals" :key="label" class="border-t border-line first:border-0">
            <td class="py-1.5 text-ink-2">{{ label }}</td>
            <td class="py-1.5 text-right num text-ink">{{ n }}</td>
          </tr>
        </table>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">Первый запуск · 28 дней</h2>
        <table class="w-full text-[14px]">
          <tr v-for="[label, n] in funnel" :key="label" class="border-t border-line first:border-0">
            <td class="py-1.5 text-ink-2">{{ label }}</td>
            <td class="py-1.5 text-right num text-ink">{{ n }}</td>
            <td class="w-14 py-1.5 text-right num text-ink-2">{{ pct(n, metrics.funnel_28d.created) }}</td>
          </tr>
        </table>
      </Card>

      <Card>
        <h2 class="type-h3 mb-2 text-ink">По неделям</h2>
        <table class="w-full text-[13.5px]">
          <thead>
            <tr class="text-ink-2">
              <th class="py-1 text-left font-normal">Неделя</th>
              <th class="py-1 text-right font-normal">Семьи</th>
              <th class="py-1 text-right font-normal">Выписки</th>
              <th class="py-1 text-right font-normal">Недели</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in metrics.weeks" :key="w.week" class="border-t border-line">
              <td class="py-1.5 num text-ink-2">{{ w.week }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.new_households }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.uploads }}</td>
              <td class="py-1.5 text-right num text-ink">{{ w.week_done }}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <!-- Пуши банков (Блок 2 «Apple Pay»): разобрано и не разобрано за 7 дней, банки — под «Подробнее». -->
      <AdminPushStats v-if="metrics.push_stats" :stats="metrics.push_stats" />
      <!-- Apple Pay (Р-13а): формат команды владельца — по первому касанию. -->
      <AdminWalletDebug />
    </template>
    <Toast v-if="note"><span data-check-note>{{ note }}</span></Toast>
  </div>
</template>
