/**
 * Проверка экранов без входа в аккаунт.
 *
 * Экраны монтируются напрямую, минуя ворота доступа: проверять надо разметку и
 * поведение, а не логин. Данные подставляются в хранилище до монтирования, как
 * если бы они приехали синхронизацией.
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import { AppShell } from '@/components/AppShell'
import { Capital } from '@/screens/Capital'
import { Deposit } from '@/screens/Deposit'
import { Goals } from '@/screens/Goals'
import { GoalDetail } from '@/screens/GoalDetail'
import { Budget } from '@/screens/Budget'
import { Overview } from '@/screens/Overview'
import '@/index.css'

const start = new URLSearchParams(location.search).get('at') ?? '/capital'

createRoot(document.getElementById('root')!).render(
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
  </MemoryRouter>,
)
