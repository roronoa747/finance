/**
 * Где показать пояснение `Hint` (React `kit.tsx:370-379`): окно закреплено на экране под
 * знаком вопроса и прижато к краям с отступом 12 px. Привязка к самому знаку не работает:
 * на телефоне окно шире, чем расстояние от него до любого края, и уезжало за границу.
 */
export function hintPosition(
  rect: { left: number; bottom: number },
  innerWidth: number,
): { left: number; top: number; width: number } {
  const width = Math.min(268, innerWidth - 24)
  const left = Math.min(Math.max(12, rect.left), innerWidth - width - 12)
  return { left, top: rect.bottom + 6, width }
}
