/**
 * Открытые окна по порядку открытия — листы `Sheet` и полноэкранный отчёт разбора (`AiReport`, бэклог «Разбор», RZ-07):
 * Escape закрывает только верхнее; пока открыто хоть одно — экран за ним не прокручивается и тост «Отменить» стоит
 * поверх (`style.css`, `html[data-sheet-open]`). Один список на всех: лист «Сделать», закрывшись поверх отчёта, не снимает
 * атрибут, пока отчёт открыт, — тост не уходит под отчёт. Список и атрибут — только через `pushSheet` / `popSheet`.
 */
const sheetStack: symbol[] = []

/** Атрибут `html[data-sheet-open]` — по списку открытых окон. */
function lockScreen() {
  if (sheetStack.length) document.documentElement.dataset.sheetOpen = ''
  else delete document.documentElement.dataset.sheetOpen
}

/** Окно открылось — наверх списка. */
export function pushSheet(me: symbol) {
  sheetStack.push(me)
  lockScreen()
}

/** Окно закрылось — из списка; не было в нём — false. */
export function popSheet(me: symbol): boolean {
  const i = sheetStack.indexOf(me)
  if (i < 0) return false
  sheetStack.splice(i, 1)
  lockScreen()
  return true
}

/** Окно — верхнее (Escape и жесты — только ему). */
export const isTopSheet = (me: symbol) => sheetStack[sheetStack.length - 1] === me
