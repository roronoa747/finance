import { inject, onBeforeUnmount, provide, ref, watchEffect, type InjectionKey, type Ref } from 'vue'

/**
 * Шапка оболочки поверх фото (пачка 2 «Figma», FG-21): пока на «Мечтах» есть главная мечта, шапку оболочки не рисуем —
 * её место занимает верхняя строка обложки (`Dreams`). Флаг даёт оболочка, экран включает его, пока `on()` истинно, и
 * снимает при уходе — второй шапки или пропавшей шапки на других экранах нет.
 */
const SHELL_HERO: InjectionKey<Ref<boolean>> = Symbol('ff-shell-hero')

/** Оболочка: флаг «шапка на фото экрана». */
export function provideShellHero(): Ref<boolean> {
  const hero = ref(false)
  provide(SHELL_HERO, hero)
  return hero
}

/** Экран: шапка на его фото, пока `on()` — правда; уход с экрана снимает флаг. Без оболочки (тесты экрана) — ничего. */
export function useShellHero(on: () => boolean): void {
  const hero = inject(SHELL_HERO, null)
  if (!hero) return
  watchEffect(() => {
    hero.value = on()
  })
  onBeforeUnmount(() => {
    hero.value = false
  })
}
