import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { Overview } from '@/screens/Overview'
import { Budget } from '@/screens/Budget'
import { Goals } from '@/screens/Goals'
import { GoalDetail } from '@/screens/GoalDetail'
import { Capital } from '@/screens/Capital'
import { Deposit } from '@/screens/Deposit'
import { Ritual } from '@/screens/Ritual'
import { useThemeSync } from '@/lib/useTheme'
import { AccessGate } from '@/screens/Access'
import { Setup } from '@/screens/Setup'
import { useStore } from '@/store/useStore'
import { cloudEnabled } from '@/lib/supabase'

/**
 * Мастер настройки показывается, пока бюджет не заведён, и отдельно —
 * присоединившемуся участнику, у которого ещё нет своего дохода.
 */
function SetupGate({ children }: { children: React.ReactNode }) {
  const setupDoneAt = useStore((s) => s.setupDoneAt)
  const people = useStore((s) => s.people)
  const membership = useStore((s) => s.membership)
  const householdId = useStore((s) => s.householdId)

  // Без облака мастер тоже нужен: приложение стартует с пустого листа.
  if (cloudEnabled && !householdId) return <>{children}</>

  if (!setupDoneAt) return <Setup />

  const mySlot = membership.find((m) => people.some((p) => p.id === m.slot))?.slot
  const me = mySlot ? people.find((p) => p.id === mySlot) : undefined
  if (membership.length > 0 && me && me.salary === 0) return <Setup />

  return <>{children}</>
}

export default function App() {
  useThemeSync()
  return (
    <AccessGate>
    <SetupGate>
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="budget" element={<Budget />} />
          <Route path="goals" element={<Goals />} />
          <Route path="goals/:id" element={<GoalDetail />} />
          <Route path="capital" element={<Capital />} />
          <Route path="capital/:id" element={<Deposit />} />
          <Route path="ritual" element={<Ritual />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
    </SetupGate>
    </AccessGate>
  )
}
