<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { useFinanceStore } from '@/stores/finance'
import { isDark } from '@/lib/theme'
import { startDemo } from '@/lib/demo'

/**
 * Лэндинг «/» для анонима (B2C-27, Р-14; DESIGN.md §2 g8, §6 «Лэндинг»): «Реально.», «Начать с Google»
 * (→ `/access`) и «Попробовать» (демо без регистрации), три образа, для кого и приватность, подвал с
 * политикой. Картинки — снимки демо в теме экрана (`public/landing/`, webp ≤ 150 КБ). Десктоп — та же
 * страница шире. Ленивым чанком: вошедший на «/» видит приложение и сюда не грузит.
 */
const router = useRouter()
const finance = useFinanceStore()

const CONTACT = 'ilyas.muratbek.99@gmail.com'
/** Ссылки на магазины — Блоки 7–8 (Google Play, App Store); пусто — блока нет. */
const stores: { label: string; href: string }[] = []

const theme = computed(() => (isDark.value ? 'dark' : 'light'))
const img = (name: string) => `/landing/${name}-${theme.value}.webp`

const images = [
  { key: 'dream', title: 'Мечта', text: 'Одна цель с фото — и всегда видно, сколько до неё.' },
  { key: 'free', title: 'Свобода', text: '«Свободно до конца месяца» — по факту, а не по плану.' },
  { key: 'leaks', title: 'Утечки', text: 'Подписки и проценты — спросим об одной за раз.' },
]

// Черновик демо на телефоне — «Попробовать» возвращает к нему.
const hasDemoDraft = computed(() => finance.isDemo)

function tryDemo() {
  startDemo()
  void router.push('/')
}
</script>

<template>
  <div class="min-h-dvh text-left text-ink">
    <div class="mx-auto w-full max-w-[1120px] px-5 md:px-10">
      <nav class="flex items-center justify-between py-4">
        <span class="font-display text-[17px] font-semibold tracking-[-0.02em]">Family Finance</span>
        <div class="flex items-center gap-5 text-[14px] text-ink-2">
          <a href="#how" class="hidden md:inline">Как это работает</a>
          <a href="#privacy" class="hidden md:inline">Приватность</a>
          <RouterLink to="/access" class="rounded-pill bg-surface-2 px-4 py-2 font-medium text-ink">Начать</RouterLink>
        </div>
      </nav>

      <!-- Герой: слово-обещание и одна брендовая кнопка; справа (на телефоне — ниже) — экран «Мечты» -->
      <section class="grid items-center gap-8 pt-6 pb-10 md:grid-cols-2 md:gap-12 md:pt-12" data-landing="hero">
        <div>
          <h1 class="font-display text-[64px] font-semibold leading-[0.95] tracking-[-0.04em] md:text-[112px]">Реально.</h1>
          <p class="mt-4 max-w-[30ch] text-[17px] text-ink-2 md:text-[20px]">
            Фото цели и одна цифра — сколько до неё. Для пар и одиночек в Казахстане.
          </p>
          <div class="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <RouterLink
              to="/access"
              class="press inline-flex h-13 items-center justify-center rounded-pill bg-brand px-7 text-[15.5px] font-semibold text-brand-ink"
            >
              Начать с Google
            </RouterLink>
            <button
              type="button"
              class="press inline-flex h-13 items-center justify-center rounded-pill bg-surface-2 px-7 text-[15.5px] font-semibold text-ink cursor-pointer"
              @click="tryDemo"
            >
              {{ hasDemoDraft ? 'Вернуться в демо' : 'Попробовать' }}
            </button>
          </div>
          <p class="mt-3 text-[13px] text-ink-3">Бесплатно. Без карты. Выписка остаётся на телефоне.</p>
        </div>
        <div class="flex justify-center">
          <img
            :src="img('hero')"
            alt="Экран «Мечты»: фото мечты и процент до неё"
            width="390"
            height="780"
            fetchpriority="high"
            class="w-[300px] rounded-[36px] border border-line shadow-lg md:w-[340px]"
          />
        </div>
      </section>

      <!-- Три образа -->
      <section id="how" class="grid gap-4 py-8 md:grid-cols-3" data-landing="images">
        <figure v-for="i in images" :key="i.key" class="overflow-hidden rounded-card border border-line bg-surface">
          <img
            :src="img(i.key)"
            :alt="i.title"
            width="390"
            height="300"
            loading="lazy"
            class="aspect-[13/10] w-full object-cover object-top"
          />
          <figcaption class="p-4">
            <div class="font-display text-[19px] font-semibold">{{ i.title }}</div>
            <p class="mt-1 text-[14px] text-ink-2">{{ i.text }}</p>
          </figcaption>
        </figure>
      </section>

      <!-- Для кого и приватность -->
      <section id="privacy" class="grid gap-4 py-8 md:grid-cols-2" data-landing="bands">
        <div class="rounded-card bg-surface-2 p-6">
          <h2 class="font-display text-[22px] font-semibold">Для двоих. Или для одного.</h2>
          <p class="mt-2 text-[15px] text-ink-2">
            Партнёр видит итоги по разделам — до тенге. Ваши операции остаются у вас. Один человек — тоже семья.
          </p>
        </div>
        <div class="rounded-card bg-surface-2 p-6">
          <h2 class="font-display text-[22px] font-semibold">Файл не покидает телефон.</h2>
          <p class="mt-2 text-[15px] text-ink-2">
            PDF из Kaspi или Freedom разбирается на месте. На сервере — продавец, дата, сумма и раздел, без номеров и
            ФИО. Удалить всё — одной кнопкой.
          </p>
        </div>
      </section>

      <footer class="flex flex-col gap-2 border-t border-line py-8 text-[13px] text-ink-3 md:flex-row md:justify-between">
        <span>© Family Finance, 2026 · Казахстан</span>
        <span class="flex flex-wrap gap-4">
          <RouterLink to="/privacy">Политика конфиденциальности</RouterLink>
          <a :href="`mailto:${CONTACT}`">Контакты</a>
          <a v-for="s in stores" :key="s.href" :href="s.href">{{ s.label }}</a>
        </span>
      </footer>
    </div>
  </div>
</template>
