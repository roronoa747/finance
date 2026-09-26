<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhFileArrowUp } from '@phosphor-icons/vue'
import Button from '@/components/ui/Button.vue'
import Select from '@/components/kit/Select.vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { useOperationsStore, type DraftFile } from '@/stores/operations'
import { money } from '@/lib/money'
import { monthKey, monthTitle, weekKey, weekRange } from '@/lib/dates'
import { DEFAULT_SPEND_CATEGORIES, UNKNOWN_CATEGORY } from '@/lib/statements/dictionary'
import { draftSummary, partnerHints, picture, unknownGroups, type UnknownGroup } from '@/lib/statements/model'
import { parseStatement, StatementFormatError } from '@/lib/statements/parsers'
import type { MerchantRule } from '@/lib/statements/types'
import type { PersonId } from '@/types/finance'

/**
 * «Выписки» (B2C-07) — черновой экран недельного ритма до редизайна (Блоки 2–3): выписка
 * разбирается на телефоне, вопросы о незнакомом, отправка; картина недели и месяца по разделам
 * трат обоих. Файл никуда не уходит — только разобранные операции (Р-4).
 */
const auth = useAuthStore()
const finance = useFinanceStore()
const store = useOperationsStore()

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom' }
const INTERNAL = '__internal'
const PERSON = '__person'

const canUpload = computed(() => !auth.isViewer)
const me = computed<PersonId>(() => auth.slot ?? 'a')
const reading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const openCategory = ref<string | null>(null)
/** Группа, для которой вводят «кому → что», и сам текст. */
const personFor = ref<string | null>(null)
const personText = ref('')

const categories = computed(() => {
  const list = finance.householdDoc.spendCategories?.filter((c) => !c.deletedAt)
  return (list?.length ? list : DEFAULT_SPEND_CATEGORIES).slice().sort((a, b) => a.order - b.order)
})
const categoryName = (id: string) =>
  id === UNKNOWN_CATEGORY ? 'Не разобрано' : (categories.value.find((c) => c.id === id)?.name ?? 'Прочее')
const personName = (slot: string) => finance.people.find((p) => p.id === slot)?.name ?? 'Участник'
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`

// Черновик.
const summary = computed(() => draftSummary(store.draftOps, (id) => id in store.ops))
const unknown = computed(() => unknownGroups(store.draftOps))
const hints = computed(() => partnerHints(store.draftOps, finance.people, me.value, finance.merchantRules))

// Картина недели и месяца.
const week = weekKey()
const month = monthKey()
const rows = computed(() => picture(finance.householdDoc.spendTotals ?? [], week, month))
const totals = computed(() => rows.value.reduce((s, r) => ({ week: s.week + r.week, month: s.month + r.month }), { week: 0, month: 0 }))
const missing = computed(() => {
  const { from, to } = weekRange(week)
  return finance.people
    .filter((p) => !p.deletedAt)
    .filter((p) => !store.uploads.some((u) => u.slot === p.id && u.period_to >= from && u.period_from <= to))
    .map((p) => p.name)
})
const monthOps = computed(() => store.all.filter((o) => o.date.startsWith(month)))
const openGroups = computed(() =>
  openCategory.value === null
    ? []
    : unknownGroups(monthOps.value, openCategory.value === UNKNOWN_CATEGORY ? null : openCategory.value),
)

const groupKey = (g: UnknownGroup) => JSON.stringify(g.match)
const options = (g: UnknownGroup) => [
  { value: '', label: 'Раздел…' },
  ...categories.value.map((c) => ({ value: c.id, label: c.name })),
  { value: INTERNAL, label: 'Внутренний перевод — не трата' },
  ...(g.match.counterparty ? [{ value: PERSON, label: 'Кому → что…' }] : []),
]

function ruleTarget(value: string): MerchantRule['to'] | null {
  if (!value) return null
  if (value === INTERNAL) return { internal: true }
  return { categoryId: value }
}

function choose(g: UnknownGroup, value: string, retro = false) {
  if (value === PERSON) {
    personFor.value = groupKey(g)
    personText.value = ''
    return
  }
  const to = ruleTarget(value)
  if (!to) return
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
}

function savePerson(g: UnknownGroup, retro = false) {
  const what = personText.value.trim()
  if (!what) return
  const to = { person: what }
  if (retro) void store.recategorize(g.match, to)
  else store.answer(g.match, to)
  personFor.value = null
}

async function pick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  if (!files.length) return
  reading.value = true
  const ok: DraftFile[] = []
  const errors: { name: string; message: string }[] = []
  try {
    // pdf.js — ленивым чанком, только когда выбрали файл.
    const { pdfToRows } = await import('@/lib/statements/pdf')
    for (const f of files) {
      try {
        ok.push({ name: f.name, parsed: parseStatement(await pdfToRows(await f.arrayBuffer())) })
      } catch (err) {
        const message =
          err instanceof StatementFormatError && err.code === 'empty'
            ? 'В файле не нашлось операций'
            : err instanceof StatementFormatError
              ? 'Пока понимаю выписки Kaspi и Freedom'
              : 'Не получилось прочитать файл'
        errors.push({ name: f.name, message })
      }
    }
    store.setDraft(ok, errors)
  } finally {
    reading.value = false
    input.value = ''
  }
}

onMounted(() => {
  void store.loadUploads()
  void store.pull()
})
</script>

<template>
  <div class="flex flex-col gap-4 pt-1 text-left">
    <div class="flex items-center justify-between px-0.5">
      <h2 class="font-display text-[20px] font-semibold tracking-[-0.02em] text-ink">Выписки</h2>
      <span v-if="auth.isDemo" class="text-[12px] text-ink-3">демо: только на этом телефоне</span>
    </div>

    <!-- ЧЕРНОВИК: разбор → вопросы → отправка -->
    <template v-if="store.draft">
      <div
        v-for="f in store.draft.files"
        :key="f.name"
        class="rounded-2xl border border-line bg-surface p-3.5 text-[13.5px] text-ink-2"
      >
        <b class="font-semibold text-ink">{{ BANKS[f.parsed.bank] }}</b>
        · {{ shortDate(f.parsed.from) }}–{{ shortDate(f.parsed.to) }}
        · {{ f.parsed.operations.length }} операций
        <span v-if="f.parsed.skippedForeign" class="block text-[12.5px] text-ink-3">
          В валюте — {{ f.parsed.skippedForeign }}: их пока не считаем.
        </span>
      </div>
      <p
        v-for="e in store.draft.errors"
        :key="e.name"
        role="alert"
        class="rounded-xl border border-warn-line bg-warn-soft p-3 text-[13px] text-ink-2"
      >
        {{ e.name }}: {{ e.message }}
      </p>

      <template v-if="store.draftOps.length">
        <div class="rounded-2xl border border-line bg-surface p-3.5 text-[13.5px]">
          <div class="flex justify-between"><span class="text-ink-2">Операций</span><b class="num text-ink">{{ summary.total }}</b></div>
          <p v-if="summary.already" class="mt-1 text-[12.5px] text-ink-3">
            {{ summary.already === summary.total ? `Все ${summary.total} уже были — ничего не удвоится` : `Из них уже были: ${summary.already}` }}
          </p>
          <div class="mt-2 flex justify-between"><span class="text-ink-2">Списания</span><span class="num text-ink">{{ money(summary.spent) }}</span></div>
          <div class="flex justify-between"><span class="text-ink-2">Поступления</span><span class="num text-ink">{{ money(summary.received) }}</span></div>
          <div class="flex justify-between"><span class="text-ink-2">Между своими</span><span class="num text-ink-3">{{ money(summary.internal) }}</span></div>
        </div>

        <div v-for="h in hints" :key="h.counterparty" class="rounded-2xl border border-brand bg-brand-soft p-3.5 text-[13.5px]">
          <p class="text-ink">«{{ h.label }}» — это {{ personName(h.person) }}? Переводы между вами не считаются тратами.</p>
          <div class="mt-2 flex gap-2">
            <Button size="sm" @click="store.answer({ counterparty: h.counterparty }, { internal: true })">Да, между нами</Button>
          </div>
        </div>

        <div v-if="unknown.length" class="flex flex-col gap-2">
          <h3 class="px-0.5 text-[12px] uppercase tracking-[0.07em] text-ink-3">Незнакомое — куда отнести</h3>
          <div v-for="g in unknown" :key="groupKey(g)" class="rounded-2xl border border-line bg-surface p-3">
            <div class="mb-2 flex items-baseline justify-between gap-2 text-[13.5px]">
              <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
              <span class="shrink-0 num text-ink-2">{{ g.count }} · {{ money(g.amount) }}</span>
            </div>
            <Select model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v)" />
            <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
              <input
                v-model="personText"
                placeholder="например, няня"
                class="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-ink"
              />
              <Button size="sm" @click="savePerson(g)">Запомнить</Button>
            </div>
          </div>
          <p class="px-0.5 text-[12px] text-ink-3">Можно пропустить — останется «не разобрано».</p>
        </div>
      </template>

      <div class="flex gap-2">
        <Button v-if="store.draftOps.length" class="flex-1" @click="store.send()">Отправить</Button>
        <Button variant="outline" class="flex-1" @click="store.cancelDraft()">Отмена</Button>
      </div>
    </template>

    <!-- ОБЫЧНЫЙ ВИД: загрузка, картина, загрузки семьи -->
    <template v-else>
      <template v-if="canUpload">
        <input ref="fileInput" type="file" accept="application/pdf,.pdf" multiple class="hidden" @change="pick" />
        <Button class="w-full" :disabled="reading" @click="fileInput?.click()">
          <PhFileArrowUp :size="16" />
          {{ reading ? 'Читаем выписку…' : 'Загрузить выписку' }}
        </Button>
        <p class="-mt-2 px-0.5 text-[12px] text-ink-3">PDF из приложения Kaspi или Freedom. Файл остаётся на телефоне.</p>
      </template>
      <p v-if="store.pendingCount" class="rounded-xl border border-line bg-surface-2 p-3 text-[13px] text-ink-2">
        {{ store.pendingCount }} операций отправятся при сети. Итоги уже посчитаны.
      </p>

      <div v-if="rows.length" class="rounded-2xl border border-line bg-surface">
        <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-b border-line px-3.5 py-2 text-[12px] text-ink-3">
          <span>Раздел</span><span class="w-[86px] text-right">Неделя</span><span class="w-[96px] text-right">{{ monthTitle(month).split(' ')[0] }}</span>
        </div>
        <template v-for="r in rows" :key="r.categoryId">
          <button
            type="button"
            class="grid w-full grid-cols-[1fr_auto_auto] gap-x-3 px-3.5 py-2 text-left text-[13.5px] cursor-pointer hover:bg-surface-2"
            @click="openCategory = openCategory === r.categoryId ? null : r.categoryId"
          >
            <span :class="r.categoryId === UNKNOWN_CATEGORY ? 'text-ink-3' : 'text-ink'">{{ categoryName(r.categoryId) }}</span>
            <span class="w-[86px] text-right num text-ink-2">{{ r.week ? money(r.week) : '—' }}</span>
            <span class="w-[96px] text-right num text-ink">{{ money(r.month) }}</span>
          </button>
          <div v-if="openCategory === r.categoryId" class="flex flex-col gap-2 border-y border-line bg-surface-2 px-3.5 py-3">
            <p v-if="!openGroups.length" class="text-[12.5px] text-ink-3">Здесь только ваши траты — у партнёра они в его телефоне.</p>
            <div v-for="g in openGroups" :key="groupKey(g)">
              <div class="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                <span class="min-w-0 truncate text-ink">{{ g.label }}</span>
                <span class="shrink-0 num text-ink-3">{{ money(g.amount) }}</span>
              </div>
              <Select v-if="canUpload" model-value="" :options="options(g)" @update:model-value="(v) => choose(g, v, true)" />
              <div v-if="personFor === groupKey(g)" class="mt-2 flex gap-2">
                <input v-model="personText" placeholder="например, няня" class="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-ink" />
                <Button size="sm" @click="savePerson(g, true)">Запомнить</Button>
              </div>
            </div>
          </div>
        </template>
        <div class="grid grid-cols-[1fr_auto_auto] gap-x-3 border-t border-line px-3.5 py-2 text-[13.5px] font-semibold">
          <span class="text-ink">Всего</span>
          <span class="w-[86px] text-right num text-ink">{{ money(totals.week) }}</span>
          <span class="w-[96px] text-right num text-ink">{{ money(totals.month) }}</span>
        </div>
      </div>
      <p v-else class="px-0.5 text-[13.5px] text-ink-2">
        Загрузите выписку — здесь появятся траты недели и месяца по разделам.
      </p>
      <p v-if="store.uploads.length && missing.length" class="px-0.5 text-[12.5px] text-ink-3">
        За эту неделю без выписки {{ missing.join(', ') }}.
      </p>

      <div v-if="store.uploads.length" class="flex flex-col gap-1">
        <h3 class="px-0.5 text-[12px] uppercase tracking-[0.07em] text-ink-3">Загрузки</h3>
        <div
          v-for="u in store.uploads"
          :key="u.id"
          class="flex items-baseline justify-between gap-2 rounded-xl px-0.5 py-1.5 text-[13.5px]"
        >
          <span class="text-ink">{{ personName(u.slot) }} · {{ BANKS[u.bank] ?? u.bank }}</span>
          <span class="num text-ink-3">{{ shortDate(u.period_from) }}–{{ shortDate(u.period_to) }} · {{ u.ops_count }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
