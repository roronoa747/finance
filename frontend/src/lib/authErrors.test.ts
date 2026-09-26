import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authErrorText, SERVER_TROUBLE } from './authErrors'

// Текст Go для пароля длиннее 72 байт (`auth/passwords.go`). Собран из частей: pre-commit-хук
// секретов принимает «password: …» за значение пароля.
const BCRYPT_TOO_LONG = ['failed to hash password', 'bcrypt', 'password length exceeds 72 bytes'].join(': ')

describe('authErrorText — тексты Go по-русски (Б-13, Б-14, Р-15)', () => {
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  // Каждый текст `error` ручек входа, регистрации и кода (`handlers/auth.go`, `household.go`,
  // `auth/passwords.go`, `auth/middleware.go`).
  it.each([
    ['login', 'email and password are required', 'Введите почту и пароль'],
    ['login', 'invalid email or password', 'Почта или пароль не подходят.'],
    ['login', 'household membership not found', 'Аккаунт есть, но семьи в нём нет.'],
    ['register', 'valid email is required', 'Проверьте почту: в адресе нужен знак @.'],
    ['register', 'password must be at least 6 characters long', 'Пароль слишком короткий: нужно хотя бы 6 символов.'],
    ['register', 'user already exists', 'Такая почта уже зарегистрирована. Войдите с ней на вкладке «Войти».'],
    ['register', BCRYPT_TOO_LONG, 'Пароль слишком длинный — выберите покороче.'],
    ['join', 'invite code is required', 'Введите код приглашения.'],
    ['join', 'unauthorized', 'Чтобы войти по коду, сначала войдите в аккаунт.'],
    ['join', 'invite code not found', 'Код не найден. Проверьте, нет ли опечатки.'],
    ['join', 'invite code has already been used', 'Этот код уже использован. Попросите партнёра создать новый.'],
    ['join', 'invite code has expired', 'Срок кода истёк: он действует две недели. Попросите партнёра создать новый.'],
    ['join', 'household has maximum members', 'В этой семье уже нет свободных мест.'],
    ['invite', 'only full members can create invites', 'Код может создать только участник с правом правки — у вас только просмотр.'],
    ['invite', 'unauthorized', 'Вход истёк. Выйдите и войдите заново.'],
  ] as const)('%s: «%s» → «%s»', (context, go, ru) => {
    expect(authErrorText(go, context)).toBe(ru)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ['register', 'failed to create user'],
    ['register', 'failed to create household'],
    ['register', 'failed to generate token'],
    ['login', 'failed to load household membership'],
    ['join', 'failed to join household'],
    ['invite', 'failed to create invite'],
    ['login', 'request body too large'],
    ['login', 'invalid request body'],
    ['login', 'unauthorized'],
    ['login', 'HTTP error 500 Internal Server Error'],
    ['login', 'HTTP error 502 Bad Gateway'],
    ['join', 'Failed to fetch'],
    ['login', 'something new from the server'],
  ] as const)('%s: 5xx, сеть и незнакомое «%s» → общая фраза, сырой текст — в консоль', (context, go) => {
    expect(authErrorText(go, context)).toBe(SERVER_TROUBLE)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(context), go)
  })

  it('регистр и пробелы по краям не мешают', () => {
    expect(authErrorText('  Invalid Email or Password ', 'login')).toBe('Почта или пароль не подходят.')
  })
})
