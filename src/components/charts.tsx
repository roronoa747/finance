import { hueColor, type HueKey } from '@/lib/palette'
import { useIsDark } from '@/lib/useTheme'
import { money } from '@/lib/money'

export type Seg = { key: string; value: number; color: string; label?: string }

/**
 * Полоса без подписей внутри. На 360 dp подписи в сегментах превращаются
 * в кашу, поэтому расшифровка живёт отдельным списком под полосой.
 */
export function Bar({ segments, thick = false }: { segments: Seg[]; thick?: boolean }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1
  return (
    <div
      className={`flex overflow-hidden rounded-md bg-track ${thick ? 'h-4 rounded-lg' : 'h-3'}`}
      role="img"
      aria-label={segments.map((s) => `${s.label ?? s.key}: ${money(s.value)}`).join(', ')}
    >
      {segments.map((s, i) => (
        <span
          key={s.key}
          className="block h-full"
          style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color,
            boxShadow: i > 0 ? 'inset 2px 0 0 var(--surface)' : undefined,
          }}
        />
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { key: string; color: string; name: string; value: string; sub?: string }[] }) {
  return (
    <div className="mt-3.5 flex flex-col gap-2.5">
      {items.map((it) => (
        <div key={it.key} className="flex items-center gap-2.5 text-[14px]">
          <i className="size-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
          <span className="text-ink-2">{it.name}</span>
          <span className="ml-auto font-medium num">
            {it.value}
            {it.sub && <span className="ml-1 text-[12px] font-normal text-ink-3">{it.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

const R = 34
const C = 2 * Math.PI * R

/**
 * Кольцо цели с меткой плана: видно не только сколько накоплено,
 * но и идём ли мы по графику. Перевыполнение рисуется золотой дугой.
 */
export function Ring({
  progress, plan = 0, size = 44, hue,
}: { progress: number; plan?: number; size?: number; hue: HueKey }) {
  const dark = useIsDark()
  const filled = Math.min(progress, 1) * C
  const over = progress > 1 ? Math.min(progress - 1, 0.25) * C : 0
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className="block">
      <circle cx="40" cy="40" r={R} strokeWidth="7" fill="none" stroke="var(--track)" />
      <circle
        cx="40" cy="40" r={R} strokeWidth="7" fill="none" strokeLinecap="round"
        stroke={hueColor(hue, dark)}
        strokeDasharray={`${filled.toFixed(1)} ${C.toFixed(1)}`}
        transform="rotate(-90 40 40)"
        style={{ transition: 'stroke-dasharray .5s ease' }}
      />
      {over > 0 && (
        <circle
          cx="40" cy="40" r={R} strokeWidth="3" fill="none" strokeLinecap="round"
          stroke="var(--gold)"
          strokeDasharray={`${over.toFixed(1)} ${C.toFixed(1)}`}
          transform="rotate(-90 40 40)"
        />
      )}
      {plan > 0 && (
        <circle
          cx="40" cy="40" r={R} strokeWidth="7" fill="none" stroke="var(--ink-3)"
          strokeDasharray={`1.6 ${(C - 1.6).toFixed(1)}`}
          strokeDashoffset={-plan * C}
          transform="rotate(-90 40 40)"
        />
      )}
    </svg>
  )
}
