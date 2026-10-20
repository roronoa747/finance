<script setup lang="ts">
/**
 * Схема шага подключения Apple Pay (AP-06, Р-3): простой макет экрана iPhone на токенах, не скриншот — что нажать
 * на этом шаге. Видео владельца позже заменит схемы (после MVP).
 */
export type StepArt = 'key' | 'open' | 'add' | 'toggle' | 'automation' | 'cards' | 'action' | 'apps' | 'pushDone' | 'done'
defineProps<{ art: StepArt }>()
</script>

<template>
  <svg viewBox="0 0 160 200" class="mx-auto block h-[200px] w-[160px]" aria-hidden="true" :data-art="art">
    <!-- Корпус и экран -->
    <rect x="22" y="4" width="116" height="192" rx="22" fill="var(--surface-3)" />
    <rect x="28" y="10" width="104" height="180" rx="17" fill="var(--surface)" />
    <rect x="62" y="15" width="36" height="9" rx="4.5" fill="var(--ink)" />

    <!-- Ключ в буфере -->
    <g v-if="art === 'key'">
      <rect x="38" y="78" width="84" height="30" rx="15" fill="var(--brand-soft)" />
      <circle cx="54" cy="93" r="6" fill="none" stroke="var(--brand)" stroke-width="2.5" />
      <path d="M60 93h16m-5 0v5m-5-5v4" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" fill="none" />
      <rect x="84" y="89" width="28" height="8" rx="4" fill="var(--brand)" opacity="0.45" />
      <rect x="50" y="122" width="60" height="8" rx="4" fill="var(--surface-3)" />
    </g>

    <!-- Плитка команды -->
    <g v-else-if="art === 'open'">
      <rect x="52" y="62" width="56" height="56" rx="14" fill="var(--brand)" />
      <path d="M84 72 70 94h10l-4 16 14-22H80z" fill="var(--brand-ink)" />
      <rect x="48" y="128" width="64" height="8" rx="4" fill="var(--ink-3)" />
    </g>

    <!-- «Добавить» и поле ключа -->
    <g v-else-if="art === 'add'">
      <rect x="28" y="96" width="104" height="94" rx="17" fill="var(--surface-2)" />
      <rect x="38" y="108" width="84" height="20" rx="8" fill="var(--surface)" stroke="var(--line-strong)" />
      <circle v-for="i in 6" :key="i" :cx="44 + i * 8" cy="118" r="2.2" fill="var(--ink-2)" />
      <rect x="38" y="140" width="84" height="26" rx="13" fill="var(--brand)" />
      <rect x="62" y="150" width="36" height="6" rx="3" fill="var(--brand-ink)" />
    </g>

    <!-- Тумблер автоматизации -->
    <g v-else-if="art === 'toggle'">
      <rect x="36" y="80" width="88" height="34" rx="10" fill="var(--surface-2)" />
      <rect x="44" y="93" width="38" height="8" rx="4" fill="var(--ink-2)" />
      <rect x="92" y="88" width="26" height="18" rx="9" fill="var(--ok)" />
      <circle cx="109" cy="97" r="7" fill="var(--surface)" />
    </g>

    <!-- Автоматизация → + → Транзакция -->
    <g v-else-if="art === 'automation'">
      <circle cx="116" cy="40" r="9" fill="var(--brand)" />
      <path d="M116 35v10m-5-5h10" stroke="var(--brand-ink)" stroke-width="2.4" stroke-linecap="round" />
      <rect x="36" y="64" width="88" height="24" rx="8" fill="var(--surface-2)" />
      <rect x="36" y="94" width="88" height="24" rx="8" fill="var(--brand-soft)" stroke="var(--brand)" />
      <rect x="44" y="102" width="44" height="8" rx="4" fill="var(--brand)" />
      <rect x="36" y="124" width="88" height="24" rx="8" fill="var(--surface-2)" />
    </g>

    <!-- Карты и «Запускать сразу» -->
    <g v-else-if="art === 'cards'">
      <rect x="40" y="52" width="58" height="36" rx="6" fill="var(--s1)" />
      <rect x="48" y="62" width="58" height="36" rx="6" fill="var(--s3)" />
      <circle cx="112" cy="68" r="7" fill="var(--ok)" />
      <path d="m108.5 68 2.5 2.5 4.5-5" stroke="var(--surface)" stroke-width="2" fill="none" stroke-linecap="round" />
      <rect x="36" y="118" width="88" height="30" rx="10" fill="var(--surface-2)" />
      <rect x="44" y="129" width="36" height="8" rx="4" fill="var(--ink-2)" />
      <rect x="94" y="124" width="24" height="18" rx="9" fill="var(--ok)" />
      <circle cx="109" cy="133" r="7" fill="var(--surface)" />
    </g>

    <!-- Действие «Запустить команду» -->
    <g v-else-if="art === 'action'">
      <rect x="36" y="70" width="88" height="30" rx="10" fill="var(--surface-2)" />
      <rect x="44" y="81" width="46" height="8" rx="4" fill="var(--ink-2)" />
      <path d="M80 106v12m-5-5 5 5 5-5" stroke="var(--ink-3)" stroke-width="2.2" fill="none" stroke-linecap="round" />
      <rect x="44" y="124" width="72" height="30" rx="10" fill="var(--brand)" />
      <path d="M84 129 74 141h7l-3 9 10-12h-7z" fill="var(--brand-ink)" />
    </g>

    <!-- Приложения банков в триггере «Уведомление» (Блок 2): три плитки, отмечены галочкой -->
    <g v-else-if="art === 'apps'">
      <g v-for="(fill, i) in ['var(--s1)', 'var(--s3)', 'var(--s5)']" :key="fill">
        <rect x="36" :y="58 + i * 34" width="88" height="28" rx="9" fill="var(--surface-2)" />
        <rect x="42" :y="63 + i * 34" width="18" height="18" rx="5" :fill="fill" />
        <rect x="66" :y="68 + i * 34" width="30" height="8" rx="4" fill="var(--ink-2)" />
        <circle cx="112" :cy="72 + i * 34" r="7" fill="var(--ok)" />
        <path :d="`m108.5 ${72 + i * 34} 2.5 2.5 4.5-5`" stroke="var(--surface)" stroke-width="2" fill="none" stroke-linecap="round" />
      </g>
    </g>

    <!-- Готово для пушей (ux Б2): уведомление банка вверху экрана и ✓ — не волны касания, пуши не про оплату телефоном -->
    <g v-else-if="art === 'pushDone'">
      <rect x="34" y="34" width="92" height="34" rx="10" fill="var(--surface-2)" />
      <rect x="40" y="41" width="20" height="20" rx="5" fill="var(--s1)" />
      <rect x="66" y="44" width="50" height="6" rx="3" fill="var(--ink-2)" />
      <rect x="66" y="55" width="34" height="6" rx="3" fill="var(--ink-3)" />
      <circle cx="80" cy="124" r="28" fill="var(--ok-soft)" />
      <path d="m67 124 9 9 18-19" stroke="var(--ok)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </g>

    <!-- Готово: оплата касанием -->
    <g v-else>
      <circle cx="80" cy="92" r="28" fill="var(--ok-soft)" />
      <path d="m67 92 9 9 18-19" stroke="var(--ok)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M58 140c8-6 36-6 44 0M64 150c6-4 26-4 32 0" stroke="var(--ink-3)" stroke-width="2.4" fill="none" stroke-linecap="round" />
    </g>
  </svg>
</template>
