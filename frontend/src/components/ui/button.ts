import { cva, type VariantProps } from 'class-variance-authority'

/**
 * Кнопка (DESIGN.md §4–§5): капсула `--r-pill`, без тени; одна главная кнопка на экране — `default`
 * (бренд), вторичные — `secondary` (`--surface-3`) и `ghost` (текстом), действие в строке у своего
 * предмета — `soft` (бренд тихо) или `secondary`.
 *
 * Размер — по уровню (Р-117, макет Блока 17), не по месту: главная (подтверждение листа, пустой экран)
 * — `default` 52 px (`lg` — то же); вторая — `md` 44 px; в строке — `sm` 32 px. `xs` и `icon*` — значки.
 */
export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap press outline-none focus-visible:ring-[3px] focus-visible:ring-brand/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-[18px] cursor-pointer select-none',
  {
    variants: {
      variant: {
        default: 'bg-brand text-brand-ink hover:bg-brand/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        secondary: 'bg-surface-3 text-ink hover:bg-surface-3/80',
        soft: 'bg-brand-soft text-brand hover:bg-brand-soft/80',
        ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-13 px-6 text-[15.5px]',
        lg: 'h-13 px-6 text-[15.5px]',
        md: 'h-11 px-4 text-[15px]',
        sm: 'h-8 gap-1 px-3 text-[13.5px] [&_svg:not([class*=\'size-\'])]:size-[15px]',
        xs: 'h-7 gap-1 px-2.5 text-[12px] [&_svg:not([class*=\'size-\'])]:size-3',
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
