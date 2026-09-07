import { useStore } from '@/store/useStore'
import { ACCENTS, ACCENT_KEYS, HUES, HUE_KEYS } from '@/lib/palette'
import type { AccentKey, CategoryKey, HueKey, ThemeChoice } from '@/lib/palette'
import { Segmented } from '@/components/kit'
import { cn } from '@/lib/utils'

function SubHead({ children }: { children: string }) {
  return (
    <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
      {children}
    </div>
  )
}

function Swatch({
  color, active, onClick, label, small = false,
}: { color: string; active: boolean; onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-[9px] border-2',
        small ? 'size-[22px]' : 'size-[26px]',
        active ? 'border-ink' : 'border-transparent',
      )}
      style={{ background: color }}
    />
  )
}

export function AppearancePanel() {
  const settings = useStore((s) => s.settings)
  const categories = useStore((s) => s.categories)
  const setTheme = useStore((s) => s.setTheme)
  const setAccent = useStore((s) => s.setAccent)
  const setCategoryHue = useStore((s) => s.setCategoryHue)

  return (
    <div className="pb-2">
      <SubHead>Тема</SubHead>
      <Segmented<ThemeChoice>
        value={settings.theme}
        onChange={setTheme}
        options={[
          { value: 'auto', label: 'Авто' },
          { value: 'light', label: 'Светлая' },
          { value: 'dark', label: 'Тёмная' },
        ]}
      />

      <SubHead>Основной цвет</SubHead>
      <div className="flex flex-wrap gap-2">
        {ACCENT_KEYS.map((k: AccentKey) => (
          <Swatch
            key={k}
            color={ACCENTS[k].light}
            label={ACCENTS[k].label}
            active={settings.accent === k}
            onClick={() => setAccent(k)}
          />
        ))}
      </div>

      <SubHead>Цвета разделов</SubHead>
      <div className="flex flex-col">
        {categories.map((c) => (
          <div key={c.key} className="flex items-center gap-2.5 py-2">
            <span className="w-[88px] shrink-0 text-[13.5px] text-ink-2">{c.name}</span>
            <div className="flex flex-wrap gap-1.5">
              {HUE_KEYS.map((h: HueKey) => (
                <Swatch
                  key={h}
                  small
                  color={HUES[h].light}
                  label={HUES[h].label}
                  active={settings.categories[c.key as CategoryKey] === h}
                  onClick={() => setCategoryHue(c.key as CategoryKey, h)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Каждый цвет задан парой значений — для светлой и тёмной темы. Свободного выбора HEX нет
        намеренно: так нельзя получить сочетание, которое станет нечитаемым при смене темы.
      </p>
    </div>
  )
}
