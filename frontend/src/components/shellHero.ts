import { inject, onBeforeUnmount, provide, ref, watch, watchEffect, type InjectionKey, type Ref } from 'vue'

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
  watch(hero, (on) => setPhotoThemeColor(on))
  return hero
}

/**
 * Цвет верха iPhone (`theme-color`) под фото: новые iOS заливают зону часов этим цветом с размытием, и светлый `--canvas`
 * ложится белой полосой на тёмное фото обложки (владелец 2026-10-27, скрин iPhone). Пока шапка на фото — обе метки берут
 * тёмный цвет (значение тёмной метки из `index.html`, своего цвета нет), при уходе — прежние значения.
 */
export function setPhotoThemeColor(on: boolean): void {
  if (typeof document === 'undefined') return
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
  const darkMeta = metas.find((m) => /dark/.test(m.getAttribute('media') ?? ''))
  const dark = darkMeta?.dataset.base ?? darkMeta?.content
  for (const m of metas) {
    if (m.dataset.base === undefined) m.dataset.base = m.content
    m.content = on && dark ? dark : m.dataset.base
  }
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
