<script setup lang="ts">
import { ref, computed, watch, provide } from 'vue'
import { useRoute, useRouter, RouterLink, RouterView } from 'vue-router'
import {
  PhHeart,
  PhCalendarBlank,
  PhWallet,
  PhGearSix,
  PhFileArrowUp,
  PhShoppingBag,
  PhCoins,
  PhRepeat,
  PhCreditCard,
  PhCaretLeft,
} from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useOperationsStore } from '@/stores/operations'
import { monthKey, MONTHS_NOM, parseMonthKey, weekKey, weekRangeLabel } from '@/lib/dates'
import { liveGoals, mainGoal, weekPicture, weekTag } from '@/lib/finance'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import IconBox from '@/components/kit/IconBox.vue'
import Row from '@/components/kit/Row.vue'
import Sheet from '@/components/kit/Sheet.vue'
import Tabs from '@/components/kit/Tabs.vue'

/**
 * Оболочка (DESIGN.md §2, §5; B2C-13): шапка `.topbar` — заголовок экрана 30 (системный, пивот 3) с
 * подписью, аватары участников (точка при «не сошлось» — `SyncBadge` compact), шестерёнка →
 * `/settings`; капсула вкладок «Мечты · Неделя · Деньги» и «+»; лист «+» на `Sheet` — шесть
 * действий; у viewer «+» нет вовсе (ТЗ B2C-13 п. 3: лист без действий правки — а добавить
 * покупку viewer тоже не может, критик Блока 3). «Советника» нет.
 *
 * Шапка — как в макетах (возврат смоука): у вкладок справа аватары (шестерёнка — только на
 * «Мечтах», §2; на «Неделе» аватаров нет), у вложенных экранов слева «назад», справа — действия
 * самого экрана (`HeaderActions` переносит их в `#shell-actions`). Экраны-потоки (цель, желания,
 * настройки, разбор и «Ваш порядок») — без вкладок, как в макетах g2/g4/g7.
 */
const route = useRoute()
const router = useRouter()
const financeStore = useFinanceStore()
const authStore = useAuthStore()
const ops = useOperationsStore()

const addOpen = ref(false)
provide('ff-shell-actions', true)

const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
const names = computed(() => people.value.map((p) => p.name).join(' и '))
const monthName = computed(() => MONTHS_NOM[parseMonthKey(monthKey()).month])

const BANKS: Record<string, string> = { kaspi: 'Kaspi', freedom: 'Freedom' }

/** «Неделя»: подпись — даты недели и чьи выписки в итоге (g2 «15–21 сентября · обе выписки»). */
const weekSub = computed(() => {
  const doc = financeStore.householdDoc
  const pic = weekPicture(doc.spendTotals ?? [], doc.spendCategories ?? [], people.value, weekKey(), ops.uploads)
  const tag = weekTag(pic, people.value.length)
  return tag ? `${weekRangeLabel(pic.range)} · ${tag.text}` : weekRangeLabel(pic.range)
})
/** Разбор выписки (g2 «Разбор — предпросмотр»): банк и период файлов черновика. */
const draftSub = computed(() => {
  const files = ops.draft?.files ?? []
  if (!files.length) return undefined
  const from = files.map((f) => f.parsed.from).sort()[0]
  const to = files.map((f) => f.parsed.to).sort().at(-1)!
  return `${[...new Set(files.map((f) => BANKS[f.parsed.bank] ?? f.parsed.bank))].join(', ')} · ${weekRangeLabel({ from, to })}`
})

/** Вкладки — корни (у «Денег» — все три квадрата, пивот 3); остальное — вложенные экраны со стрелкой «назад». */
const ROOTS = ['/', '/week', '/money', '/money/plan', '/money/history']
// «Разбор» выписки живёт на /week, но корнем не считается: «назад» слева, как в g2 (хвост критика Б9).
const isRoot = computed(() => ROOTS.includes(route.path) && !(route.path === '/week' && !!ops.draft))
/** Экраны-потоки без нижней навигации (в макетах — без вкладок): цель, желания, настройки, разбор. */
const noTabs = computed(() => {
  const p = route.path
  return (
    p.startsWith('/goals/') || p === '/wishes' || p.startsWith('/people/') || p.startsWith('/settings') || p === '/week/order' || p === '/week/breakdown'
  )
})

/** «Назад»: по истории, а открытый по ссылке экран — к своему корню. */
function goBack() {
  const p = route.path
  // «Назад» разбора — как «Отмена»: черновик сбрасывается, ничего не отправлено.
  if (p === '/week' && ops.draft) return ops.cancelDraft()
  if (typeof window !== 'undefined' && window.history.state?.back) router.back()
  else void router.push(p.startsWith('/week') ? '/week' : p === '/settings/me' ? '/settings' : '/')
}

/** Заголовок и подпись шапки по маршруту (DESIGN.md §6 «Заголовки экранов»). */
const header = computed<{ title: string; sub?: string }>(() => {
  const p = route.path
  if (p === '/') return { title: 'Мечты', sub: `${monthName.value} · ${names.value}` }
  if (p === '/week/breakdown') {
    // Подпись — откуда деньги (как у бывшей раскладки, g2).
    const from = route.query.from
    const who = people.value.find((x) => x.id === route.query.person)?.name
    const sub =
      from === 'salary' ? (who ? `зарплата · ${who}` : 'зарплата') : from === 'rest' ? 'остаток месяца' : from === 'credit' ? 'закрытый долг' : from === 'plan' ? 'план месяца' : 'освободившийся платёж'
    return { title: 'Разбор', sub }
  }
  if (p === '/week/order') return { title: 'Ваш порядок' }
  if (p.startsWith('/week')) return ops.draft ? { title: 'Разбор', sub: draftSub.value } : { title: 'Неделя', sub: weekSub.value }
  // «Деньги» — один экран с тремя квадратами (пивот 3, Р-31): шапка одна на все.
  if (p === '/money' || p.startsWith('/money/')) return { title: 'Деньги', sub: `${monthName.value} · ${names.value}` }
  if (p === '/goals/new') return { title: 'Новая мечта' }
  if (p.startsWith('/goals/')) {
    // Имя цели заголовком (g4 «Экран цели»): «главная мечта · Ильяс и Дана».
    const goal = liveGoals(financeStore.goals).find((g) => g.id === route.params.id)
    const main = mainGoal(financeStore.goals)?.id === goal?.id
    return goal ? { title: goal.name, sub: `${main ? 'главная мечта' : 'мечта'} · ${names.value}` } : { title: 'Цель' }
  }
  if (p === '/wishes' || p.startsWith('/people/')) return { title: 'Желания', sub: 'не мечты — покупки поменьше' }
  if (p === '/settings/me') return { title: 'Свой кружок' }
  if (p === '/settings') {
    // g7: «Ильяс · ilyas@…» — имя в семье и почта входа.
    const me = people.value.find((x) => x.id === authStore.slot)?.name
    const sub = [me, authStore.user?.email].filter(Boolean).join(' · ')
    return sub ? { title: 'Настройки', sub } : { title: 'Настройки' }
  }
  return { title: 'Family Finance' }
})

const tabs = computed(() => [
  { to: '/', label: 'Мечты', icon: PhHeart, active: route.path === '/' || route.path.startsWith('/goals') || route.path === '/wishes' || route.path.startsWith('/people/') },
  { to: '/week', label: 'Неделя', icon: PhCalendarBlank, active: route.path.startsWith('/week') },
  { to: '/money', label: 'Деньги', icon: PhWallet, active: route.path.startsWith('/money') },
])

// Прокручивается не окно, а <main>: новый экран открывается сверху, а не на прокрутке
// прошлого (после «Выбрать этот план» шаг месяца был за верхом экрана). По path, не
// fullPath: Капитал открывает окна параметром адреса (Б-15) — список не прыгает.
const mainEl = ref<HTMLElement | null>(null)
watch(
  () => route.path,
  () => {
    if (mainEl.value) mainEl.value.scrollTop = 0
  },
  { flush: 'post' },
)

/** Лист «+» (DESIGN.md §2): порядок действий — как в макете; у viewer кнопки «+» нет. */
const actions = computed(() => {
  const edit = !authStore.isViewer
  return [
    edit && { to: '/week?upload=1', title: 'Загрузить выписку', note: 'Kaspi или Freedom — траты недели по разделам', icon: PhFileArrowUp },
    edit && { to: '/goals/new', title: 'Новая мечта', note: 'фото, сумма и срок', icon: PhHeart },
    edit && { to: '/wishes', title: 'Покупка в список желаний', note: 'себе, партнёру или сюрприз', icon: PhShoppingBag },
    edit && { to: '/money?income=1', title: 'Внеплановый доход', note: 'премия, подарок, возврат', icon: PhCoins },
    edit && { to: '/money?add=payment', title: 'Обязательство или подписка', note: 'аренда, связь, страховка', icon: PhRepeat },
    edit && { to: '/money?add=debt', title: 'Кредит или рассрочка', note: 'долг, платёж, график', icon: PhCreditCard },
  ].filter((a): a is Exclude<typeof a, false> => Boolean(a))
})

function navigateAndClose(to: string) {
  addOpen.value = false
  void router.push(to)
}
</script>

<template>
  <div
    class="relative mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-canvas text-left md:my-8 md:h-[860px] md:max-w-[420px] md:rounded-[42px] md:border md:border-line-strong"
  >
    <header class="flex shrink-0 items-center justify-between gap-3 px-5 pb-2 pt-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <button
          v-if="!isRoot"
          type="button"
          aria-label="Назад"
          class="grid size-[38px] shrink-0 place-items-center rounded-[12px] bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink cursor-pointer"
          @click="goBack"
        >
          <PhCaretLeft :size="20" />
        </button>
        <div class="min-w-0">
          <h1 class="type-h1 truncate text-ink">{{ header.title }}</h1>
          <div v-if="header.sub" class="mt-0.5 truncate type-meta">{{ header.sub }}</div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <!-- Действия вложенного экрана (карандаш цели, «+» желаний) — сюда их переносит HeaderActions. -->
        <div id="shell-actions" class="flex items-center gap-2.5 empty:hidden" />
        <template v-if="isRoot">
          <!-- Место под бейдж зарезервировано: в покое он пуст, но аватары не прыгают на каждой записи. -->
          <div class="size-[38px] shrink-0"><SyncBadge compact /></div>
          <!-- Аватары ведут на список желаний участника (B2C-18); на «Неделе» их нет (g2). -->
          <div v-if="people.length && route.path !== '/week'" class="flex">
            <RouterLink v-for="(p, i) in people" :key="p.id" :to="`/people/${p.id}`" :aria-label="`Желания · ${p.name}`" class="rounded-full" :class="i ? '-ml-2' : ''">
              <Avatar :id="p.id" :name="p.name" />
            </RouterLink>
          </div>
          <!-- Настройки — иконка в шапке главного (DESIGN.md §2). -->
          <RouterLink v-if="route.path === '/'" to="/settings" aria-label="Настройки" class="rounded-[12px]">
            <IconBox><PhGearSix :size="20" /></IconBox>
          </RouterLink>
        </template>
      </div>
    </header>

    <!-- Капсула вкладок парит над контентом (макет pivot-3 `.tabs`): снизу запас 96 px, чтобы последняя карточка
         докручивалась из-под неё. -->
    <main ref="mainEl" :class="['flex-1 overflow-y-auto px-4 [overscroll-behavior:contain]', noTabs ? 'pb-6' : 'pb-24']">
      <!-- Смена экрана — короткое проявление (Р-45); ключ — имя маршрута: квадраты «Денег» и цели
           между собой экран не пересоздают. Шапка и капсула вкладок вне — не прыгают. -->
      <RouterView v-slot="{ Component, route: r }">
        <div :key="String(r.name ?? r.path)" class="fx-fade">
          <component :is="Component" />
        </div>
      </RouterView>
    </main>

    <Tabs v-if="!noTabs" :items="tabs" :plus="!authStore.isViewer" plus-label="Добавить" @plus="addOpen = true" />

    <Sheet :open="addOpen" title="Добавить" @close="addOpen = false">
      <div class="flex flex-col">
        <Row v-for="a in actions" :key="a.to" :title="a.title" :note="a.note" clickable dense @click="navigateAndClose(a.to)">
          <template #icon><component :is="a.icon" :size="18" /></template>
        </Row>
      </div>
    </Sheet>
  </div>
</template>
