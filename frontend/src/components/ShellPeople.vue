<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { PhGearSix } from '@phosphor-icons/vue'
import { useFinanceStore } from '@/stores/finance'
import SyncBadge from '@/components/SyncBadge.vue'
import Avatar from '@/components/kit/Avatar.vue'
import IconBox from '@/components/kit/IconBox.vue'

/**
 * Правая группа шапки корня (DESIGN.md §2): бейдж синка, аватары участников и значок настроек — оба → `/settings`
 * (Р-1 «понятность»). Один источник разметки для шапки оболочки и верхней строки обложки «Мечт» (пачка 2 «Figma», FG-21):
 * на фото — та же группа без подложки, как в макете 47:2 (аватары на фото, шестерёнка на своей плашке; бейдж — своя плашка).
 */
const route = useRoute()
const financeStore = useFinanceStore()
const people = computed(() => financeStore.people.filter((p) => !p.deletedAt))
</script>

<template>
  <div class="flex shrink-0 items-center gap-2.5" data-shell-people>
    <!-- Место под бейдж зарезервировано: в покое он пуст, но аватары не прыгают на каждой записи. -->
    <div class="size-[38px] shrink-0"><SyncBadge compact /></div>
    <!-- Аватары — свой и партнёра одинаково — ведут в Настройки, раздел «С кем»; на «Неделе» аватаров нет (g2). -->
    <div v-if="people.length && route.path !== '/week'" class="flex">
      <RouterLink v-for="(p, i) in people" :key="p.id" to="/settings" :aria-label="`Настройки · ${p.name}`" class="rounded-full" :class="i ? '-ml-2' : ''">
        <Avatar :id="p.id" :name="p.name" />
      </RouterLink>
    </div>
    <!-- Настройки — иконка в шапке главного (DESIGN.md §2). -->
    <RouterLink v-if="route.path === '/'" to="/settings" aria-label="Настройки" class="rounded-[12px]">
      <IconBox><PhGearSix :size="20" /></IconBox>
    </RouterLink>
  </div>
</template>
