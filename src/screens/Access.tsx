import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { EnvelopeSimple, WifiSlash } from '@phosphor-icons/react'
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
        <span className="grid size-9 place-items-center rounded-xl bg-brand font-display text-[15px] font-bold tracking-[0.02em] text-brand-ink">
          FF
        </span>
        <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">
          Family Finance
        </span>
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
 * с облаком — вход, затем выбор «создать бюджет» или «войти по коду».
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!cloudEnabled)
  /**
   * Знаем ли мы уже, состоит ли человек в бюджете.
   *
   * Установленное на телефон приложение имеет отдельное хранилище от браузера,
   * поэтому при первом запуске оно не помнит ни сессии, ни семьи. Пока состав
   * не пришёл с сервера, показывать «создать бюджет» нельзя: человек, у
   * которого бюджет давно есть, увидит предложение завести новый.
   */
  const [membershipKnown, setMembershipKnown] = useState(false)
  const householdId = useStore((s) => s.householdId)
  const setSync = useStore((s) => s.setSync)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      // Ставим сразу: без этого приложение не знает, чей это телефон, и
      // экраны, которые на это опираются, оказываются пустыми.
      setSync({ userId: data.session?.user.id ?? null })
      setReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setSync({ userId: next?.user.id ?? null })
      if (!next) setSync({ householdId: null, userId: null, membership: [], rev: 0, status: 'offline' })
    })
    return () => listener.subscription.unsubscribe()
  }, [setSync])

  // Узнаём, в какой семье состоим, и включаем синхронизацию.
  useEffect(() => {
    if (!session) {
      setMembershipKnown(false)
      return
    }
    let cancelled = false
    loadMembership()
      .then((membership) => {
        if (cancelled) return
        const mine = membership.find((m) => m.userId === session.user.id)
        setSync({ membership, householdId: mine?.householdId ?? null, userId: session.user.id })
        setMembershipKnown(true)
        if (mine) {
          startSyncEngine()
          // Сначала забираем общий документ, и только потом заводим участников
          // из состава — иначе создали бы их поверх ещё не полученных данных.
          void sync().then(() => useStore.getState().adoptMembers(membership))
        }
      })
      .catch((e) => {
        if (cancelled) return
        setSync({ lastError: e instanceof Error ? e.message : String(e) })
        // Не пускаем в «создать бюджет» из-за сетевой ошибки: если человек уже
        // в бюджете, он завёл бы второй и растерял данные по двум разным.
        setMembershipKnown(Boolean(useStore.getState().householdId))
      })
    return () => {
      cancelled = true
    }
  }, [session, setSync])

  if (!cloudEnabled) return <>{children}</>
  if (!ready) return <Splash />
  if (!session) return <SignIn />
  // Есть сохранённая привязка — пускаем сразу, не дожидаясь ответа сервера.
  if (!householdId && !membershipKnown) return <Splash note="Открываем бюджет" />
  if (!householdId) return <PickHousehold defaultName={session.user.email?.split('@')[0] ?? ''} />
  return <>{children}</>
}

/** Пока идёт проверка — знак и одна строка вместо пустого экрана или чужого вопроса. */
function Splash({ note }: { note?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <span className="grid size-11 place-items-center rounded-2xl bg-brand font-display text-[17px] font-bold text-brand-ink">
        FF
      </span>
      <span className="text-[13.5px] text-ink-3">{note ?? 'Минуту…'}</span>
    </div>
  )
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
      <Shell title="Осталось подтвердить почту">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="flex items-start gap-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
              <EnvelopeSimple size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] leading-relaxed">
                Письмо ушло на <b className="break-all">{email}</b>
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                Откройте ссылку из письма — она подтвердит адрес. Дальше вернитесь сюда и войдите
                тем же паролем.
              </p>
            </div>
          </div>

          <ol className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
            {[
              'Ссылка может открыть пустую страницу — это нормально, подтверждение всё равно засчитано.',
              'Если письма нет через пару минут, загляните в «Спам» и «Промоакции».',
            ].map((line, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-2">
                <span className="mt-[3px] size-1.5 shrink-0 rounded-full bg-brand" />
                {line}
              </li>
            ))}
          </ol>
        </div>

        <Button onClick={() => { setSent(false); setMode('in') }}>Я подтвердил — войти</Button>
      </Shell>
    )
  }

  return (
    <Shell
      title={mode === 'in' ? 'Вход' : 'Создать аккаунт'}
      note="Общий бюджет на двоих. Данные хранятся на вашем устройстве и синхронизируются между телефонами."
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
        ? await createHousehold("Наш бюджет", name.trim() || "Участник")
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
      title="Общий бюджет"
      note={mode === 'create'
        ? 'Создайте бюджет, а потом пригласите второго — он войдёт по короткому коду.'
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
        {busy ? 'Минуту…' : mode === 'create' ? 'Создать бюджет' : 'Войти в бюджет'}
      </Button>
      {mode === 'create' && (
        <p className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
          Всё, что вы уже завели на этом устройстве — цели, покупки, обязательства — уедет в общий
          бюджет при создании. Ничего не потеряется.
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
