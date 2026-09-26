/**
 * Ошибки входа, регистрации и кода приглашения по-русски (Б-13, Б-14).
 *
 * Контракт Go не меняется (Р-15): сервер отвечает `{ error: "<английский текст>" }`,
 * а `ApiError.message` несёт этот текст как есть. Здесь — таблица «текст Go → текст
 * на экране». Тексты React (`src/screens/Access.tsx:184-186`) — дословно, где смысл
 * совпадает. Сбой сервера (5xx), сети или незнакомый текст — общая фраза, а сырой
 * текст уходит в консоль: английского на экране не бывает.
 */

export type AuthErrorContext = 'login' | 'register' | 'join' | 'invite'

export const SERVER_TROUBLE = 'Не получилось связаться с сервером. Попробуйте ещё раз.'

const TEXTS: Record<string, string> = {
  // Вход (`handlers/auth.go` Login)
  'email and password are required': 'Введите почту и пароль',
  'invalid email or password': 'Почта или пароль не подходят.',
  'household membership not found': 'Аккаунт есть, но семьи в нём нет.',
  // Регистрация (`handlers/auth.go` Register, `auth/passwords.go`)
  'valid email is required': 'Проверьте почту: в адресе нужен знак @.',
  'password must be at least 6 characters long': 'Пароль слишком короткий: нужно хотя бы 6 символов.',
  'user already exists': 'Такая почта уже зарегистрирована. Войдите с ней на вкладке «Войти».',
  // Код приглашения (`handlers/household.go` Join)
  'invite code is required': 'Введите код приглашения.',
  'invite code not found': 'Код не найден. Проверьте, нет ли опечатки.',
  'invite code has already been used': 'Этот код уже использован. Попросите партнёра создать новый.',
  'invite code has expired': 'Срок кода истёк: он действует две недели. Попросите партнёра создать новый.',
  'household has maximum members': 'В этой семье уже нет свободных мест.',
  // Создание кода (`handlers/household.go` CreateInvite)
  'only full members can create invites': 'Код может создать только участник с правом правки — у вас только просмотр.',
}

/** «unauthorized» мидлвара значит разное: у входа по коду сессии ещё нет, у кода — она истекла. */
const UNAUTHORIZED: Partial<Record<AuthErrorContext, string>> = {
  join: 'Чтобы войти по коду, сначала войдите в аккаунт.',
  invite: 'Вход истёк. Выйдите и войдите заново.',
}

export function authErrorText(message: string, context: AuthErrorContext): string {
  const key = message.trim().toLowerCase()
  const text =
    key === 'unauthorized'
      ? UNAUTHORIZED[context]
      : // bcrypt не берёт пароль длиннее 72 байт — Go отвечает 400 с его текстом.
        key.startsWith('failed to hash password')
        ? 'Пароль слишком длинный — выберите покороче.'
        : TEXTS[key]
  if (text) return text
  console.warn(`[${context}] ошибка сервера:`, message)
  return SERVER_TROUBLE
}
