/**
 * Ошибки входа, регистрации и кода приглашения по-русски (Б-13, Б-14).
 *
 * Контракт Go не меняется (Р-15): сервер отвечает `{ error: "<английский текст>" }`,
 * а `ApiError.message` несёт этот текст как есть. Здесь — таблица «текст Go → текст
 * на экране». Тексты React (`src/screens/Access.tsx:184-186`) — дословно, где смысл
 * совпадает. Сбой сервера (5xx), сети или незнакомый текст — общая фраза, а сырой
 * текст уходит в консоль: английского на экране не бывает.
 */

export type AuthErrorContext = 'login' | 'register' | 'join' | 'invite' | 'google' | 'household'

export const SERVER_TROUBLE = 'Не получилось связаться с сервером. Попробуйте ещё раз.'

const TEXTS: Record<string, string> = {
  // Вход (`handlers/auth.go` Login)
  'email and password are required': 'Введите почту и пароль',
  'invalid email or password': 'Почта или пароль не подходят.',
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
  // Вход через Google (`handlers/auth.go` GoogleLogin, B2C-22)
  'invalid google token': 'Google не подтвердил вход. Попробуйте ещё раз.',
  'google sign-in is not configured': 'Вход через Google пока не настроен.',
  'google sign-in is unavailable': 'Google сейчас недоступен. Попробуйте через минуту.',
  'email is linked to another google account': 'Эта почта уже привязана к другому аккаунту Google.',
  // «С кем» (`handlers/household.go`, B2C-23)
  'already in household': 'Вы уже в семье.',
  'display_name is required': 'Как вас зовут?',
  // Создание кода (`handlers/household.go` CreateInvite)
  'only full members can create invites': 'Код может создать только участник с правом правки — у вас только просмотр.',
}

/**
 * Тот же текст Go — другой смысл: «user already exists» у Google — гонка двух первых входов одной
 * почтой (ревью frontend Б4 Н-4), вкладки «Войти» в проде нет. 401 с токеном экран сам уводит на
 * вход (`/access?expired=1`), поэтому своего текста у «unauthorized» нет.
 */
const BY_CONTEXT: Partial<Record<AuthErrorContext, Record<string, string>>> = {
  google: { 'user already exists': 'Попробуйте ещё раз.' },
}

export function authErrorText(message: string, context: AuthErrorContext): string {
  const key = message.trim().toLowerCase()
  // bcrypt не берёт пароль длиннее 72 байт — Go отвечает 400 с его текстом.
  const text = key.startsWith('failed to hash password')
    ? 'Пароль слишком длинный — выберите покороче.'
    : (BY_CONTEXT[context]?.[key] ?? TEXTS[key])
  if (text) return text
  console.warn(`[${context}] ошибка сервера:`, message)
  return SERVER_TROUBLE
}
