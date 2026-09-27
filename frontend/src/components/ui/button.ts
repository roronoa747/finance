import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Кнопка (DESIGN.md §4–§5): капсула `--r-pill`, 15/600, без тени; одна главная кнопка на
 * экране — `default` (бренд), вторичные — `secondary` (`--surface-3`) и `ghost` (текстом).
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-pill text-[15px] font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-[18px] cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: 'bg-brand text-brand-ink hover:bg-brand/90 active:translate-y-px',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:translate-y-px',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2 active:translate-y-px',
        secondary: 'bg-surface-3 text-ink hover:bg-surface-3/80 active:translate-y-px',
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink active:translate-y-px',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-12 px-5',
        xs: 'h-7 gap-1 px-2.5 text-[12px] [&_svg:not([class*=\'size-\'])]:size-3',
        sm: 'h-9 gap-1.5 px-3.5 text-[14px]',
        lg: 'h-13 px-6 text-[16px]',
        icon: 'size-12',
        'icon-xs': 'size-7 [&_svg:not([class*=\'size-\'])]:size-3',
        'icon-sm': 'size-9',
        'icon-lg': 'size-13',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonVariants = VariantProps<typeof buttonVariants>
