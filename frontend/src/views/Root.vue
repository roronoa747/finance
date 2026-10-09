<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/components/AppShell.vue'

/**
 * Корень «/» (B2C-27): вошедшему — приложение (оболочка с вкладками и вложенными экранами), анониму —
 * лэндинг тем же адресом. PWA открывает `start_url` «/» — вошедший сразу в приложении. Лэндинг —
 * ленивым чанком.
 */
const Landing = defineAsyncComponent(() => import('@/views/Landing.vue'))
const auth = useAuthStore()
// 401 на вложенном экране: вход сброшен, роутер уводит на `/access` — лэндинг тут не мелькает.
const route = useRoute()
</script>

<template>
  <AppShell v-if="auth.isAuthenticated" />
  <Landing v-else-if="route.path === '/'" />
</template>
