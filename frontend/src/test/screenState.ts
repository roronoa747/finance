import type { ComponentOptions } from 'vue'

type State = Record<string, unknown>

const MISSING = Symbol('нет поля')

/**
 * SSR-тест экрана: поля и нажатия подаются тому компоненту, у которого они есть. Окна
 * Капитала — дочерние компоненты (`components/capital/`, ревью Блока 2 Н-3): сумма
 * калькулятора `payoffAmount` живёт в окне, а какой кредит открыт — `payoffCreditId` —
 * в самом экране. `act` вызывается у первого по созданию компонента, где есть все поля,
 * к которым оно обращается (сам экран создаётся раньше своих окон).
 */
export function screenMixin(state: State = {}, act?: (s: State) => void): ComponentOptions {
  let done = !act
  return {
    created() {
      const s = this.$.setupState as State
      for (const k in state) if (k in s) s[k] = state[k]
      if (!done) done = tryAct(s, act!)
    },
  }
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
