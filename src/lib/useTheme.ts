import { useEffect, useState } from 'react'
import { useStore } from '@/store/useStore'
import { applyTheme, prefersDark, resolveDark } from '@/lib/palette'

/**
 * Тема живёт в одном месте: сюда стекаются выбор пользователя и системная
 * настройка, отсюда цвета попадают в DOM. Ни один компонент не трогает
 * documentElement сам.
 */
export function useThemeSync() {
  const settings = useStore((s) => s.settings)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    applyTheme({
      theme: settings.theme,
      accent: settings.accent,
      categories: settings.categories,
    })
  }, [settings.theme, settings.accent, settings.categories, systemDark])
}

/** Тёмная ли тема прямо сейчас — нужно для inline-цветов в SVG. */
export function useIsDark(): boolean {
  const theme = useStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return theme === 'dark' || (theme === 'auto' && systemDark) || resolveDark(theme)
}
