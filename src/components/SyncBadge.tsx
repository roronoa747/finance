import { useState } from 'react'
import { ArrowsClockwise, Check, CloudSlash, Warning, Copy } from '@phosphor-icons/react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cloudEnabled, supabase } from '@/lib/supabase'
import { useStore } from '@/store/useStore'
import { createInvite, sync } from '@/store/sync'
import { cn } from '@/lib/utils'

/**
 * Состояние синхронизации показывается всегда и словами, а не значком-загадкой.
 * Человек должен видеть, доехали ли деньги до второго телефона, — иначе он
 * узнает об этом только когда цифры разойдутся.
 */
export function SyncBadge() {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  const status = useStore((s) => s.status)
  const lastError = useStore((s) => s.lastError)
  const lastSyncedAt = useStore((s) => s.lastSyncedAt)
  const membership = useStore((s) => s.membership)
  const householdId = useStore((s) => s.householdId)
  const resetAll = useStore((s) => s.resetAll)
  const people = useStore((s) => s.people)

  if (!cloudEnabled) {
    return (
      <span className="flex items-center gap-1 text-[11.5px] text-ink-3" title="Облако не подключено">
        <CloudSlash size={13} /> локально
      </span>
    )
  }

  const label =
    status === 'syncing' ? 'синхронизация'
    : status === 'dirty' ? 'ждёт отправки'
    : status === 'offline' ? 'нет сети'
    : status === 'error' || status === 'conflict' ? 'не сошлось'
    : 'синхронизировано'

  const bad = status === 'error' || status === 'conflict'

  async function makeInvite() {
    if (!householdId) return
    setBusy(true)
    try {
      setCode(await createInvite(householdId))
    } catch (e) {
      setCode(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Буфер может быть недоступен — код и так виден на экране.
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'flex items-center gap-1 text-[11.5px]',
          bad ? 'text-warn' : status === 'idle' ? 'text-ink-3' : 'text-brand',
        )}
      >
        {status === 'syncing' ? <ArrowsClockwise size={13} className="animate-spin" />
          : bad ? <Warning size={13} />
          : status === 'offline' ? <CloudSlash size={13} />
          : status === 'dirty' ? <ArrowsClockwise size={13} />
          : <Check size={13} />}
        {label}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-[22px] border-line bg-surface pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-0 pb-1">
            <SheetTitle className="font-display text-[16px]">Синхронизация</SheetTitle>
          </SheetHeader>

          <div className="flex flex-col gap-3 pb-3">
            <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-[13.5px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-2">Состояние</span>
                <b className={cn('font-semibold', bad && 'text-warn')}>{label}</b>
              </div>
              {lastSyncedAt && (
                <div className="mt-1.5 flex items-center justify-between text-[12.5px] text-ink-3">
                  <span>Последний обмен</span>
                  <span className="num">{new Date(lastSyncedAt).toLocaleString('ru-RU')}</span>
                </div>
              )}
              {lastError && <p className="mt-2 text-[12.5px] text-warn">{lastError}</p>}
            </div>

            {membership.length > 0 && (
              <div className="rounded-xl border border-line px-3.5 py-3">
                <div className="mb-2 text-[12px] uppercase tracking-[0.07em] text-ink-3">В бюджете</div>
                {membership.map((m) => (
                  <div key={m.userId} className="flex items-center gap-2.5 py-1 text-[14px]">
                    <i className="size-2.5 rounded-full" style={{ background: `var(--p${m.slot})` }} />
                    {people.find((p) => p.id === m.slot)?.name ?? m.displayName}
                    {m.role === 'viewer' && <span className="text-[12px] text-ink-3">только просмотр</span>}
                  </div>
                ))}
              </div>
            )}

            {membership.length < 2 && (
              <div className="rounded-xl border border-brand bg-brand-soft px-3.5 py-3">
                <b className="block text-[13.5px] font-semibold">Пригласить второго</b>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                  Код действует две недели и срабатывает один раз. Его удобно продиктовать вслух.
                </p>
                {code ? (
                  <button
                    onClick={copy}
                    className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-brand bg-surface py-2.5 font-display text-[20px] font-semibold tracking-[0.16em] num"
                  >
                    {code}
                    <Copy size={15} className="text-ink-3" />
                  </button>
                ) : (
                  <Button className="mt-2.5 w-full" onClick={makeInvite} disabled={busy}>
                    {busy ? 'Минуту…' : 'Создать код'}
                  </Button>
                )}
                {copied && <p className="mt-1.5 text-center text-[12px] text-brand">Скопировано</p>}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => void sync()}>
                Синхронизировать
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void supabase?.auth.signOut()}
              >
                Выйти
              </Button>
            </div>

            <p className="text-[12px] leading-relaxed text-ink-3">
              Записи сохраняются на устройстве сразу, даже без сети, и уезжают в облако при первой
              возможности. Если оба правили одно и то же офлайн — взносы и покупки сложатся, а не
              перезатрут друг друга.
            </p>

            <div className="border-t border-line pt-3">
              {confirmReset ? (
                <>
                  <p className="mb-2 text-[12.5px] leading-relaxed text-warn">
                    Сотрутся доходы, цели, покупки, обязательства и счета — у обоих участников
                    и в облаке. Отменить будет нельзя.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setConfirmReset(false)}>
                      Отмена
                    </Button>
                    <Button
                      className="flex-1 bg-destructive text-destructive-foreground"
                      onClick={() => { resetAll(); setConfirmReset(false); setOpen(false); void sync() }}
                    >
                      Стереть всё
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-[12.5px] text-ink-3 hover:text-destructive"
                >
                  Начать бюджет заново
                </button>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
