import { useEffect, useState } from 'react'
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
import { AccessGate, Splash } from '@/screens/Access'
import { Setup } from '@/screens/Setup'
import { hasBudgetData, mySlot, useStore } from '@/store/useStore'
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
  const userId = useStore((s) => s.userId)
  const cloudAnswered = useStore((s) => s.cloudAnswered)
  const status = useStore((s) => s.status)
  const budgetExists = useStore(hasBudgetData)

  /*
    Пока облако не ответило, «настройки не было» — не факт, а предположение.
    Заказчик видел это секунду с лишним: приложение открывалось на «введите
    зарплату», хотя бюджет у него давно заведён.

    Ждём ответа, но не бесконечно: без сети его не будет вовсе, а запереть
    человека в заставке хуже, чем показать лишний вопрос.
  */
  const [waitedEnough, setWaitedEnough] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaitedEnough(true), 6000)
    return () => clearTimeout(t)
  }, [])
  const settled =
    !cloudEnabled || cloudAnswered || waitedEnough || status === 'error' || status === 'offline'

  // Без облака мастер тоже нужен: приложение стартует с пустого листа.
  if (cloudEnabled && !householdId) return <>{children}</>

  /*
    Данные на устройстве есть — значит бюджет заведён, даже если отметка не
    доехала. Спрашивать в этом случае не о чем, и это единственное, для чего
    признак выводится из данных.
  */
  if (!setupDoneAt && !budgetExists) {
    if (!settled) return <Splash note="Открываем бюджет" />
    return <Setup />
  }

  /*
    Если по какой-то причине не удалось понять, чей это телефон, пускаем
    в приложение. Пустой экран вместо бюджета — худший из возможных исходов:
    человек видит белое поле и не знает, сломалось ли всё или ещё грузится.
  */
  const slot = mySlot({ membership, userId })
  const me = slot ? people.find((x) => x.id === slot) : undefined
  /*
    Признак — явная отметка, а не нулевая зарплата: ноль бывает законным, и
    раньше любое обнуление данных зацикливало мастер. Отметка ИЛИ введённый
    доход: если человек уже вписал зарплату, спрашивать снова нельзя, даже
    если отметка не доехала при слиянии.

    И здесь тоже ждём ответа облака: доход участника мог быть введён на другом
    устройстве, а до этого его карточка выглядит как незаполненная.
  */
  if (slot && me && !me.onboardedAt && me.salary <= 0) {
    if (!settled) return <Splash note="Открываем бюджет" />
    return <Setup />
  }

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
