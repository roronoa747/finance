import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  House, ChartBar, Plus, Target, Vault, PaintBrush, Sparkle,
  ShoppingBag, CreditCard, TrendUp, DownloadSimple, UserPlus,
} from '@phosphor-icons/react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AppearancePanel } from '@/components/AppearancePanel'
import { SyncBadge } from '@/components/SyncBadge'
import { Row } from '@/components/kit'
import { useStore } from '@/store/useStore'
import { monthTitle, monthKey } from '@/lib/dates'
import { cn } from '@/lib/utils'

const TABS = [
  { to: '/', label: 'Обзор', Icon: House },
  { to: '/budget', label: 'Бюджет', Icon: ChartBar },
  null,
  { to: '/goals', label: 'Цели', Icon: Target },
  { to: '/capital', label: 'Капитал', Icon: Vault },
]

const TITLES: Record<string, string> = {
  '/budget': 'Бюджет',
  '/goals': 'Цели и покупки',
  '/capital': 'Капитал',
}

export function AppShell() {
  const [addOpen, setAddOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const people = useStore((s) => s.people)
  const membership = useStore((s) => s.membership)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title =
    pathname === '/' ? monthTitle(monthKey())
    : TITLES[pathname] ?? (pathname.startsWith('/goals') ? 'Цель' : 'Вклад')

  // Высота фиксирована, а не минимальна: при min-height контейнер растёт вместе
  // с содержимым, внутренняя прокрутка не включается, и нижняя панель уезжает
  // вниз страницы вместо того, чтобы стоять на месте.
  return (
    <div className="mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-canvas md:my-8 md:h-[860px] md:max-w-[420px] md:rounded-[42px] md:border md:border-line-strong md:shadow-lift">
      <header className="flex shrink-0 items-center gap-3 bg-canvas px-4.5 pb-3 pt-4.5">
        <div className="flex items-center">
          {people.map((p, i) => (
            <span
              key={p.id}
              className="grid size-7 place-items-center rounded-full border-2 border-canvas text-[12px] font-semibold text-dot-ink"
              style={{ background: `var(--p${p.id})`, marginLeft: i ? -9 : 0 }}
              title={p.name}
            >
              {p.name.slice(0, 1)}
            </span>
          ))}
        </div>
        <div className="mr-auto min-w-0">
          <div className="truncate font-display text-[16px] font-semibold leading-tight tracking-[-0.01em]">
            {title}
          </div>
          <SyncBadge />
        </div>
        <button
          onClick={() => setThemeOpen(true)}
          aria-label="Оформление"
          className="grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <PaintBrush size={18} />
        </button>
        <button
          aria-label="Советник"
          onClick={() => alert('ИИ-советник появится после подключения аккаунтов и биллинга — это следующий этап.')}
          className="grid size-[34px] place-items-center rounded-[10px] text-ink-2 hover:bg-surface-3 hover:text-ink"
        >
          <Sparkle size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-3.5 pb-6 [overscroll-behavior:contain]">
        <Outlet />
      </main>

      <nav className="grid shrink-0 grid-cols-5 border-t border-line bg-surface px-1 pt-1 pb-[max(4px,env(safe-area-inset-bottom))]">
        {TABS.map((t, i) =>
          t ? (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 px-0.5 py-1',
                  isActive ? 'text-brand' : 'text-ink-3',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <t.Icon size={19} weight={isActive ? 'fill' : 'regular'} />
                  <span className="text-[10.5px]">{t.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <button
              key={i}
              onClick={() => setAddOpen(true)}
              aria-label="Добавить"
              className="flex flex-col items-center justify-center py-1"
            >
              <span className="grid size-8 place-items-center rounded-[11px] bg-brand text-brand-ink">
                <Plus size={17} weight="bold" />
              </span>
            </button>
          ),
        )}
      </nav>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-line bg-surface p-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-4 pt-4 pb-1">
            <SheetTitle className="font-display text-[16px]">Добавить</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col pb-2">
            {membership.length < 2 && (
              <Row
                icon={<UserPlus size={16} />} title="Пригласить партнёра" note="код для второго участника"
                onClick={() => { setAddOpen(false); navigate('/') }}
              />
            )}
            <Row
              icon={<TrendUp size={16} />} title="Пополнить цель" note="взнос в накопления"
              onClick={() => { setAddOpen(false); navigate('/goals') }}
            />
            <Row
              icon={<ShoppingBag size={16} />} title="Покупка в дом" note="в семейный список"
              onClick={() => { setAddOpen(false); navigate('/goals?tab=wish') }}
            />
            <Row
              icon={<CreditCard size={16} />} title="Внести по кредиту" note="в том числе досрочно"
              onClick={() => { setAddOpen(false); navigate('/capital') }}
            />
            <Row
              icon={<DownloadSimple size={16} />} title="Импорт выписки" note="Kaspi PDF, Halyk XLS"
              onClick={() => { setAddOpen(false); alert('Импорт выписок — следующий этап. Нужны 2–3 реальных файла, чтобы написать разбор под формат банка.') }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={themeOpen} onOpenChange={setThemeOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[22px] border-line bg-surface pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-0 pb-1">
            <SheetTitle className="font-display text-[16px]">Оформление</SheetTitle>
          </SheetHeader>
          <AppearancePanel />
        </SheetContent>
      </Sheet>
    </div>
  )
}
