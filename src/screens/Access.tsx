import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Vault, WifiSlash } from '@phosphor-icons/react'
import { supabase, cloudEnabled } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, Segmented } from '@/components/kit'
import { useStore } from '@/store/useStore'
import { createHousehold, joinHousehold, loadMembership, startSyncEngine, sync } from '@/store/sync'

function Shell({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center gap-4 px-5 py-10">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-brand text-brand-ink">
          <Vault size={19} weight="fill" />
        </span>
        <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">Казна</span>
      </div>
      <div>
        <h1 className="font-display text-[24px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
        {note && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{note}</p>}
      </div>
      {children}
    </div>
  )
}

function Problem({ text }: { text: string }) {
  if (!text) return null
  return (
    <p className="rounded-xl border border-warn-line bg-warn-soft px-3.5 py-2.5 text-[13px] text-ink-2">
      {text}
    </p>
  )
}

/**
 * Ворота: без облака пускаем сразу (приложение остаётся локальным),
 * с облаком — вход, затем выбор «создать казну» или «войти по коду».
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!cloudEnabled)
  const householdId = useStore((s) => s.householdId)
  const setSync = useStore((s) => s.setSync)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) setSync({ householdId: null, membership: [], rev: 0, status: 'offline' })
    })
    return () => listener.subscription.unsubscribe()
  }, [setSync])

  // Узнаём, в какой семье состоим, и включаем синхронизацию.
  useEffect(() => {
    if (!session) return
    let cancelled = false
    loadMembership()
      .then((membership) => {
        if (cancelled) return
        const mine = membership.find((m) => m.userId === session.user.id)
        setSync({ membership, householdId: mine?.householdId ?? null })
        if (mine) {
          startSyncEngine()
          void sync()
        }
      })
      .catch((e) => setSync({ lastError: e instanceof Error ? e.message : String(e) }))
    return () => {
      cancelled = true
    }
  }, [session, setSync])

  if (!cloudEnabled) return <>{children}</>
  if (!ready) return null
  if (!session) return <SignIn />
  if (!householdId) return <PickHousehold defaultName={session.user.email?.split('@')[0] ?? ''} />
  return <>{children}</>
}

function SignIn() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [sent, setSent] = useState(false)

  async function submit() {
    if (!supabase) return
    setBusy(true)
    setProblem('')
    try {
      if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        // Если в проекте включено подтверждение почты, сессии сразу не будет.
        if (!data.session) setSent(true)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      setProblem(
        /invalid login/i.test(raw) ? 'Почта или пароль не подходят.'
        : /already registered/i.test(raw) ? 'Такая почта уже зарегистрирована — войдите.'
        : /password/i.test(raw) ? 'Пароль слишком короткий: нужно хотя бы 6 символов.'
        : raw,
      )
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Shell title="Проверьте почту" note={`Отправили письмо на ${email}. Откройте ссылку из письма, чтобы подтвердить адрес, и возвращайтесь сюда.`}>
        <Button variant="outline" onClick={() => { setSent(false); setMode('in') }}>Вернуться ко входу</Button>
      </Shell>
    )
  }

  return (
    <Shell
      title={mode === 'in' ? 'Вход' : 'Создать аккаунт'}
      note="Общая казна на двоих. Данные хранятся на вашем устройстве и синхронизируются между телефонами."
    >
      <Segmented<'in' | 'up'>
        value={mode}
        onChange={setMode}
        options={[{ value: 'in', label: 'Войти' }, { value: 'up', label: 'Регистрация' }]}
      />
      <div className="mt-1">
        <Field label="Почта">
          <Input
            value={email} onChange={(e) => setEmail(e.target.value)}
            type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
          />
        </Field>
        <Field label="Пароль">
          <Input
            value={password} onChange={(e) => setPassword(e.target.value)}
            type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          />
        </Field>
      </div>
      <Problem text={problem} />
      <Button onClick={submit} disabled={busy || !email || !password}>
        {busy ? 'Минуту…' : mode === 'in' ? 'Войти' : 'Создать аккаунт'}
      </Button>
      <p className="text-center text-[12.5px] leading-relaxed text-ink-3">
        Вход по Face ID добавим позже — он требует собственного домена, и менять адрес после
        этого будет больно.
      </p>
    </Shell>
  )
}

function PickHousehold({ defaultName }: { defaultName: string }) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState(defaultName)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const setSync = useStore((s) => s.setSync)

  async function go() {
    setBusy(true)
    setProblem('')
    try {
      const id = mode === 'create'
        ? await createHousehold('Наша казна', name.trim() || 'Участник')
        : await joinHousehold(code.trim(), name.trim() || 'Участник')
      const membership = await loadMembership()
      setSync({ householdId: id, membership })
      startSyncEngine()
      await sync()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    await supabase?.auth.signOut()
  }

  return (
    <Shell
      title="Общая казна"
      note={mode === 'create'
        ? 'Создайте казну, а потом пригласите второго — он войдёт по короткому коду.'
        : 'Введите код, который вам продиктовали.'}
    >
      <Segmented<'create' | 'join'>
        value={mode}
        onChange={setMode}
        options={[{ value: 'create', label: 'Создать' }, { value: 'join', label: 'Войти по коду' }]}
      />
      <div className="mt-1">
        <Field label="Как вас зовут">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
        </Field>
        {mode === 'join' && (
          <Field label="Код приглашения">
            <Input
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3D4" autoCapitalize="characters" className="num tracking-[0.12em]"
            />
          </Field>
        )}
      </div>
      <Problem text={problem} />
      <Button onClick={go} disabled={busy || !name.trim() || (mode === 'join' && !code.trim())}>
        {busy ? 'Минуту…' : mode === 'create' ? 'Создать казну' : 'Войти в казну'}
      </Button>
      {mode === 'create' && (
        <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          Всё, что вы уже завели на этом устройстве — цели, покупки, обязательства — уедет в общую
          казну при создании. Ничего не потеряется.
        </p>
      )}
      <button onClick={signOut} className="mt-1 text-center text-[13px] text-ink-3 hover:text-ink">
        Выйти из аккаунта
      </button>
    </Shell>
  )
}

/** Показывается, когда облако не настроено — чтобы это не выглядело поломкой. */
export function LocalOnlyBadge() {
  if (cloudEnabled) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
      <WifiSlash size={13} /> только это устройство
    </span>
  )
}
