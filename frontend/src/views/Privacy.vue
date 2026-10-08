<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * Политика конфиденциальности (B2C-26, Р-14): публичная страница — без входа, лёгким чанком;
 * ссылка — на экране входа, в настройках, на лэндинге и в магазинах. Статический текст: что
 * храним и что нет, где, кому передаём, как удалить, контакт. Краткая английская версия — для
 * ревью магазинов.
 */
const CONTACT = 'ilyas.muratbek.99@gmail.com'
const UPDATED = '8 октября 2026'
</script>

<template>
  <article class="mx-auto w-full max-w-[640px] px-5 py-8 text-left text-[14.5px] leading-relaxed text-ink-2">
    <RouterLink to="/" class="text-[13px] text-brand">‹ Family Finance</RouterLink>
    <h1 class="mt-4 type-h1 text-ink">Политика конфиденциальности</h1>
    <p class="mt-1 type-meta">Обновлено {{ UPDATED }}</p>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Кто мы</h2>
      <p class="mt-1.5">
        Family Finance — приложение для семейного бюджета пар и одиночек в Казахстане. Ведёт его частное лицо;
        связаться можно по почте <a :href="`mailto:${CONTACT}`" class="text-brand">{{ CONTACT }}</a>.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Что храним</h2>
      <ul class="mt-1.5 list-disc space-y-1 pl-5">
        <li>Почту, имя и идентификатор аккаунта Google — чтобы вы входили.</li>
        <li>Общий документ семьи: доходы, платежи, цели, желания, итоги трат по разделам — его видят участники семьи.</li>
        <li>Ваши операции из выписок — продавец, дата, сумма, раздел и банк. Без ФИО, номеров карт и счетов. Видны только вам.</li>
        <li>Фото целей и желаний, которые вы добавили.</li>
        <li>Подписки на уведомления, если вы их включите.</li>
        <li>События использования (открыли приложение, завершили неделю) — только для наших цифр удержания, без сторонней аналитики.</li>
      </ul>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Что не храним</h2>
      <p class="mt-1.5">
        Файл выписки не покидает телефон: PDF разбирается на устройстве, на сервер уходят только строки операций из списка выше.
        Пароли банков и данные карт мы не получаем никогда.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Где хранится</h2>
      <p class="mt-1.5">
        Сервер приложения — Vercel, база данных — Supabase (PostgreSQL); оба размещены в регионе Сеул (Южная Корея).
        Соединение защищено HTTPS.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Кому передаём</h2>
      <p class="mt-1.5">
        Google — только для входа. ИИ-разбор (Google Gemini) — лишь если вы его включите и сами нажмёте: уходит название
        продавца, без сумм и имён; сейчас эта функция выключена. Для рекламы и третьим лицам — ничего.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Удаление</h2>
      <p class="mt-1.5">
        Настройки → «Удалить аккаунт и данные»: аккаунт, ваши операции, выписки и фото удаляются сразу и безвозвратно.
        Если вы в семье не один, общий бюджет остаётся у партнёра (в нём остаются записи с вашим именем). Если один —
        удаляется всё.
      </p>
    </section>

    <section class="mt-6">
      <h2 class="type-h3 text-ink">Расчёт, не совет</h2>
      <p class="mt-1.5">Цифры приложения — расчёт по вашим данным, а не финансовая рекомендация.</p>
    </section>

    <section class="mt-10 border-t border-line pt-6" lang="en">
      <h2 class="type-h3 text-ink">Privacy policy (summary)</h2>
      <p class="mt-1.5">
        Family Finance stores your Google email, name and account id; your household's shared budget document; your own
        statement transactions (merchant, date, amount, category, bank — no names or card/account numbers), goal photos,
        notification subscriptions and first-party usage events. Bank statement files never leave your phone. Data is hosted
        on Vercel and Supabase in Seoul (South Korea). We share nothing for advertising; Google is used for sign-in only.
        Delete your account and data any time in Settings → “Удалить аккаунт и данные”. Contact:
        <a :href="`mailto:${CONTACT}`" class="text-brand">{{ CONTACT }}</a>. Updated October 8, 2026.
      </p>
    </section>
  </article>
</template>
