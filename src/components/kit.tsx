import type { ComponentProps, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { clean, caretAt, sigBefore, type NumKind } from '@/lib/num'
import { cn } from '@/lib/utils'

export function Card({
  children, className, flush = false,
}: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[18px] border border-line bg-surface',
        flush ? 'overflow-hidden p-0' : 'p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Section({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mt-1.5 flex items-baseline justify-between px-0.5">
      <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}
      </h2>
      {action}
    </div>
  )
}

/**
 * Строка списка. Если её можно открыть, это видно: справа стоит шеврон, а не
 * догадка. Раньше нажималась вся строка, но выглядела она как текст, и было
 * непонятно, куда целиться.
 *
 * Тап после прокрутки не считается: палец, который вёл список и остановился на
 * строке, не должен открывать её правку. Порог в 8 пикселей отделяет нажатие
 * от движения — меньше этого палец сдвигается и при обычном тапе.
 */
export function Row({
  icon, title, note, value, sub, onClick, accent,
}: {
  icon?: ReactNode
  title: ReactNode
  note?: ReactNode
  value?: ReactNode
  sub?: ReactNode
  onClick?: () => void
  accent?: string
}) {
  const Tag = onClick ? 'button' : 'div'
  const from = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)

  return (
    <Tag
      onPointerDown={(e) => {
        from.current = { x: e.clientX, y: e.clientY }
        dragged.current = false
      }}
      onPointerMove={(e) => {
        const p = from.current
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) dragged.current = true
      }}
      onClick={onClick && (() => { if (!dragged.current) onClick() })}
      className={cn(
        'flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0',
        onClick && 'hover:bg-surface-2 active:bg-surface-3',
      )}
    >
      {icon && (
        <span
          className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-surface-3"
          style={accent ? { color: accent, background: 'transparent', border: '1px solid var(--line)' } : undefined}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium">{title}</span>
        {note && <span className="block text-[12.5px] text-ink-3">{note}</span>}
      </span>
      {(value || sub) && (
        <span className="shrink-0 text-right">
          {value && <span className="block text-[14.5px] font-semibold num">{value}</span>}
          {sub && <span className="block text-[12px] text-ink-3">{sub}</span>}
        </span>
      )}
      {onClick && (
        <svg
          width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden
          stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          className="ml-0.5 shrink-0 text-ink-3"
        >
          <path d="M1 1l5.5 6L1 13" />
        </svg>
      )}
    </Tag>
  )
}

/**
 * Показывает «Сохранено», когда запись действительно изменилась.
 *
 * Формы правки применяют изменение по уходу из поля, без кнопки. Это тихо:
 * заказчик решил, что правка не сработала — а она не сработала совсем по
 * другой причине, и отличить одно от другого было нечем.
 *
 * Отметка висит на updatedAt самой записи, а не на событии в форме: значит,
 * показано ровно то, что легло в хранилище, и соврать она не может.
 *
 * Запись передаётся вместе с её id, и это не украшение. Диалог висит в дереве
 * всегда, а закрытым показывает пустоту — без id открытие любой записи
 * выглядело как изменение с «ничего» на «что-то», и отметка загоралась сразу
 * при открытии, ничего не сохранив.
 */
export function useSavedMark(id?: string | null, stamp?: string): boolean {
  const [on, setOn] = useState(false)
  const seen = useRef<{ id?: string | null; stamp?: string }>({ id, stamp })

  useEffect(() => {
    if (seen.current.id !== id) {
      seen.current = { id, stamp }
      setOn(false)
      return
    }
    if (seen.current.stamp === stamp) return
    seen.current = { id, stamp }
    setOn(true)
    const t = setTimeout(() => setOn(false), 1800)
    return () => clearTimeout(t)
  }, [id, stamp])

  return on
}

export function SavedMark({ on }: { on: boolean }) {
  return (
    <span
      aria-live="polite"
      className={cn(
        'text-[12px] font-normal text-brand transition-opacity duration-200',
        on ? 'opacity-100' : 'opacity-0',
      )}
    >
      Сохранено
    </span>
  )
}

export function Callout({
  tone = 'warn', title, children,
}: { tone?: 'warn' | 'good'; title: string; children: ReactNode }) {
  const good = tone === 'good'
  return (
    <div
      className={cn(
        'flex gap-3 rounded-[14px] border p-3 px-3.5',
        good ? 'border-brand bg-brand-soft' : 'border-warn-line bg-warn-soft',
      )}
    >
      <svg
        width="17" height="17" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8"
        className={cn('mt-px shrink-0', good ? 'text-brand' : 'text-warn')}
      >
        {good ? <path d="M5 12l5 5L20 7" /> : (<><path d="M12 8v5M12 17h.01" /><circle cx="12" cy="12" r="9" /></>)}
      </svg>
      <div>
        <b className="block text-[13px] font-semibold">{title}</b>
        <span className="text-[12.5px] leading-snug text-ink-2">{children}</span>
      </div>
    </div>
  )
}

export function Tag({
  children, tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'gold' | 'brand' }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'gold' && 'bg-gold-soft text-gold',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'neutral' && 'bg-surface-3 text-ink-2',
      )}
    >
      {children}
    </span>
  )
}

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface px-3.5 py-3">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="mt-0.5 font-display text-[19px] font-semibold tracking-[-0.02em] num" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-[3px] rounded-[11px] bg-surface-3 p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-[9px] px-1.5 py-2 text-[13.5px] transition-colors',
            o.value === value
              ? 'bg-surface font-semibold text-ink shadow-card'
              : 'text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({
  label, children,
}: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 flex flex-col gap-1.5">
      <span className="text-[12.5px] text-ink-3">{label}</span>
      {children}
    </label>
  )
}

export function Hero({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mb-3.5 font-display text-[38px] font-semibold leading-[1.1] tracking-[-0.03em] num">
        {value}
      </div>
    </>
  )
}

/**
 * Поле для чисел: показывает набранное по правилам из lib/num и возвращает
 * курсор на место. Разряды сдвигают текст под курсором, поэтому браузеру
 * нельзя доверить его положение — иначе он уезжает в конец строки.
 */
export function NumField({
  value, onValue, kind = 'money', className, ...rest
}: {
  value: string
  onValue: (v: string) => void
  kind?: NumKind
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null)
  const wanted = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && wanted.current !== null && document.activeElement === el) {
      el.setSelectionRange(wanted.current, wanted.current)
    }
    wanted.current = null
  })

  return (
    <Input
      ref={ref}
      value={value}
      inputMode={kind === 'rate' ? 'decimal' : 'numeric'}
      className={cn('num', className)}
      onChange={(e) => {
        const el = e.currentTarget
        const upto = el.value.slice(0, el.selectionStart ?? el.value.length)
        const sig = sigBefore(upto)
        const next = clean(el.value, kind, value)
        wanted.current = caretAt(next, sig)
        onValue(next)
      }}
      {...rest}
    />
  )
}

/**
 * То же поле, но хранит набранное само и отдаёт его по уходу из поля.
 * Часть форм написана так намеренно: правка применяется целиком, а не на
 * каждый нажатый символ, иначе промежуточное «2» из «250 000» успевает
 * уехать в общий бюджет и на второе устройство.
 *
 * Если значение поменялось снаружи — правка партнёра приехала синхронизацией —
 * поле показывает новое, а не держит устаревшее набранное.
 */
export function NumFieldBlur({
  initial, onCommit, kind = 'money', ...rest
}: {
  initial: string
  onCommit: (v: string) => void
  kind?: NumKind
} & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur' | 'defaultValue'>) {
  const [text, setText] = useState(() => clean(initial, kind))
  const seen = useRef(initial)
  if (seen.current !== initial) {
    seen.current = initial
    setText(clean(initial, kind))
  }
  return (
    <NumField
      value={text}
      onValue={setText}
      kind={kind}
      onBlur={() => onCommit(text)}
      {...rest}
    />
  )
}
