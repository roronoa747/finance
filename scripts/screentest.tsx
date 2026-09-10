/**
 * Проверка экранов без входа в аккаунт.
 *
 * Экраны монтируются напрямую, минуя ворота доступа: проверять надо разметку и
 * поведение, а не логин. Данные подставляются в хранилище до монтирования, как
 * если бы они приехали синхронизацией.
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { useThemeSync } from '@/lib/useTheme'
import { hasBudgetData, untilPayday } from '@/store/useStore'
import { debtCost, halfOverpayExtra, lumpSum, prepayment } from '@/lib/finance'
import { AppShell } from '@/components/AppShell'
import { Capital } from '@/screens/Capital'
import { Deposit } from '@/screens/Deposit'
import { Goals } from '@/screens/Goals'
import { GoalDetail } from '@/screens/GoalDetail'
import { Budget } from '@/screens/Budget'
import { Overview } from '@/screens/Overview'
import '@/index.css'

const start = new URLSearchParams(location.search).get('at') ?? '/capital'

/** Тема применяется тем же кодом, что и в приложении, иначе проверять нечего. */
function Harness() {
  useThemeSync()
  return (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="budget" element={<Budget />} />
          <Route path="goals" element={<Goals />} />
          <Route path="goals/:id" element={<GoalDetail />} />
          <Route path="capital" element={<Capital />} />
          <Route path="capital/:id" element={<Deposit />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

// Селектор ворот проверяется напрямую: сами ворота живут выше экранов и в
// стенде не участвуют.
;(window as unknown as { __hasBudgetData: typeof hasBudgetData }).__hasBudgetData = hasBudgetData
;(window as unknown as { __debtCost: typeof debtCost }).__debtCost = debtCost
;(window as unknown as { __untilPayday: typeof untilPayday }).__untilPayday = untilPayday
;(window as unknown as { __payoff: object }).__payoff =
  { lump: lumpSum, half: halfOverpayExtra, pre: prepayment }

createRoot(document.getElementById('root')!).render(<Harness />)
