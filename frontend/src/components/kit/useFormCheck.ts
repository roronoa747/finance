import { computed, inject, nextTick, provide, ref, type ComputedRef, type InjectionKey } from 'vue'

/**
 * Форма говорит сама (Р-114): главная кнопка не блокируется молча. По нажатию правила
 * проверяются по порядку; первое неверное поле получает одну строку «что не так», лист
 * прокручивается к нему, фокус — в поле; действие не выполняется. Исправил поле — строка
 * ушла; следующее неверное покажет следующее нажатие.
 *
 * Правило — `[имя поля, текст ошибки или false]`; имя совпадает с `name` у `kit/Field` в
 * шаблоне той же формы — так поле находит свою строку (`Field` без `label` — обёртка для плиток
 * и выбора). Одна форма на компонент: вторая `useFormCheck` перекроет первую для полей шаблона —
 * разные шаги формы делят одну, правила — по шагу.
 */
export type FormRule = readonly [name: string, error: string | false | null | undefined]

export interface FormCheck {
  /** Ошибка поля — только у поля, на котором споткнулось последнее нажатие, пока оно неверно. */
  errorOf(name: string): string | undefined
  /** Нажатие главной кнопки: всё верно — `action()`, иначе подсветка первого неверного поля. */
  submit(action: () => unknown): void
  /** Форма начата заново (лист открыт снова) — строк ошибок нет. */
  reset(): void
  /** Поле сообщает, где оно лежит: его прокрутим и сфокусируем. */
  register(name: string, el: HTMLElement | null): void
}

const FORM: InjectionKey<FormCheck> = Symbol('form-check')
const FIELD_ERROR: InjectionKey<ComputedRef<{ error?: string; id: string }>> = Symbol('field-error')

export function useFormCheck(rules: () => readonly FormRule[]): FormCheck {
  const shown = ref<string | null>(null)
  const els = new Map<string, HTMLElement>()

  const failing = computed(() => {
    const map = new Map<string, string>()
    for (const [name, error] of rules()) if (error && !map.has(name)) map.set(name, error)
    return map
  })

  const form: FormCheck = {
    errorOf(name) {
      return shown.value === name ? failing.value.get(name) : undefined
    },
    submit(action) {
      const first = [...failing.value.keys()][0]
      if (first === undefined) {
        shown.value = null
        action()
        return
      }
      shown.value = first
      void nextTick(() => {
        const el = els.get(first)
        if (!el) return
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
        const target = el.matches('input, select, textarea, button')
          ? el
          : el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
        target?.focus({ preventScroll: true })
      })
    },
    reset() {
      shown.value = null
    },
    register(name, el) {
      if (el) els.set(name, el)
      else {
        // Поле ушло со страницы (лист закрыт) — его строки больше нет: открытый заново лист чист.
        els.delete(name)
        if (shown.value === name) shown.value = null
      }
    },
  }
  provide(FORM, form)
  return form
}

/** Для `kit/Field`: форма, в которой лежит поле (если есть). */
export function injectForm(): FormCheck | undefined {
  return inject(FORM, undefined)
}

/** Field отдаёт полю ввода внутри себя: неверно ли оно и где строка ошибки. */
export function provideFieldError(state: ComputedRef<{ error?: string; id: string }>) {
  provide(FIELD_ERROR, state)
}

/** Для полей ввода (`ui/Input`, `kit/NumField`, `kit/Select`): атрибуты неверного поля. */
export function useFieldInvalid() {
  const state = inject(FIELD_ERROR, undefined)
  return computed(() =>
    state?.value.error ? { 'aria-invalid': 'true' as const, 'aria-describedby': state.value.id } : {},
  )
}
