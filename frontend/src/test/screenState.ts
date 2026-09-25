import { createSSRApp, type Component, type ComponentOptions } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createRouter, createMemoryHistory } from 'vue-router'
import { routes } from '@/router'

type State = Record<string, unknown>

const MISSING = Symbol('нет поля')
/** Выполнилось ли действие смеси — `renderScreen` не даёт ему молча пропасть. */
const acted = new WeakMap<ComponentOptions, () => boolean>()

/**
 * SSR-тест экрана: поля и нажатия подаются тому компоненту, у которого они есть. Окна
 * Капитала — дочерние компоненты (`components/capital/`, ревью Блока 2 Н-3): сумма
 * калькулятора `payoffAmount` живёт в окне, а какой кредит открыт — `payoffCreditId` —
 * в самом экране. `act` вызывается у первого по созданию компонента, где есть все поля,
 * к которым оно обращается (сам экран создаётся раньше своих окон).
 */
export function screenMixin(state: State = {}, act?: (s: State) => void): ComponentOptions {
  let done = !act
  const mixin: ComponentOptions = {
    created() {
      const s = this.$.setupState as State
      for (const k in state) if (k in s) s[k] = state[k]
      if (!done) done = tryAct(s, act!)
    },
  }
  acted.set(mixin, () => done)
  return mixin
}

/** Действие над полями компонента; обращение к чужому полю — «не этот компонент». */
function tryAct(s: State, act: (s: State) => void): boolean {
  const strict = new Proxy(s, {
    get(t, k) {
      if (typeof k === 'string' && !(k in t)) throw MISSING
      return Reflect.get(t, k)
    },
    set(t, k, v) {
      t[k as string] = v
      return true
    },
  })
  try {
    act(strict)
    return true
  } catch (e) {
    if (e === MISSING) return false
    throw e
  }
}

/**
 * Экран в SSR на активной Pinia: маршруты приложения без охранника входа — адрес,
 * параметры и запрос те же, что в браузере. Комментарии SSR вырезаны: текст — как его
 * видит человек. `mixins` — поля и нажатия до рендера (`screenMixin`).
 */
export async function renderScreen(
  view: Component,
  path: string,
  props?: Record<string, unknown>,
  mixins: ComponentOptions[] = [],
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const app = createSSRApp(view, props)
  app.use(router)
  for (const m of mixins) app.mixin(m)
  const html = (await renderToString(app)).replace(/<!--[^>]*-->/g, '')
  // Действие не нашло компонента со всеми полями (окно не открылось, опечатка, viewer) —
  // иначе проверка «ничего не изменилось» прошла бы вхолостую.
  if (mixins.some((m) => acted.get(m)?.() === false)) throw new Error('screenMixin: действие не нашло компонента со всеми полями')
  return html
}
