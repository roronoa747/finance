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

export default function App() {
  useThemeSync()
  return (
    <AccessGate>
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
    </AccessGate>
  )
}
