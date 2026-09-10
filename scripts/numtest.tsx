/**
 * Проверка числовых полей. Открывается дев-сервером, поэтому проверяет ровно
 * тот код, что уходит в сборку, а не его пересказ.
 */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { clean, caretAt, sigBefore } from '@/lib/num'
import { NumField } from '@/components/kit'

type Case = { name: string; got: unknown; want: unknown; ok: boolean }
const t: Case[] = []
const NB = ' '
const eq = (name: string, got: unknown, want: unknown) =>
  t.push({ name, got, want, ok: got === want })

eq('0 + 5 → 5', clean('05', 'money'), '5')
eq('одиночный 0 остаётся', clean('0', 'money'), '0')
eq('0 + 0 → 0', clean('00', 'money'), '0')
eq('разряды', clean('250000', 'money'), '250' + NB + '000')
eq('миллион', clean('6000000', 'money'), '6' + NB + '000' + NB + '000')
eq('буквы отбрасываются', clean('12a3', 'money'), '123')
eq('минус не проходит', clean('-500', 'money'), '500')
eq('день месяца без разрядов', clean('05', 'int'), '5')
eq('ставка 0,5 сохраняет ноль', clean('0,5', 'rate'), '0,5')
eq('ставка 0 + 5 → 5', clean('05', 'rate'), '5')
eq('точка → запятая', clean('16.5', 'rate'), '16,5')
eq('вторая запятая гаснет', clean('16,5,3', 'rate'), '16,53')
eq('уже отформатировано', clean('250' + NB + '000', 'money'), '250' + NB + '000')
eq('курсор после вставки в середину', caretAt(clean('12000', 'money'), sigBefore('12')), 2)
eq('ноль вытесняется слева', clean('50', 'money', '0'), '5')
eq('ноль вытесняется справа', clean('05', 'money', '0'), '5')
eq('честные 50 не трогаем', clean('50', 'money', '5'), '50')
eq('курсор в конце', caretAt('250' + NB + '000', 6), 7)
eq('пустой ввод', caretAt('', 0), 0)

function Probe() {
  const [a, setA] = useState('0')
  const [b, setB] = useState('1000')
  return (
    <>
      <NumField id="zero" value={a} onValue={setA} />
      <NumField id="mid" value={b} onValue={setB} />
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Probe />)

;(window as unknown as { __r: Case[] }).__r = t
