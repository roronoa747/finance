<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { PhArrowLeft, PhCopy, PhUserPlus } from '@phosphor-icons/vue'
import { useAuthStore } from '@/stores/auth'
import { useFinanceStore } from '@/stores/finance'
import { authErrorText } from '@/lib/authErrors'
import { parseMoney, money, ratePct } from '@/lib/money'
import { liveGoals, liveObligations } from '@/lib/finance'
import { setupCreditRate, setupGoalMonthly, setupPlan, type SetupForm, type SetupSkips } from '@/lib/setup'
import { HUES, HUE_KEYS, type HueKey } from '@/lib/palette'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Field from '@/components/kit/Field.vue'
import NumField from '@/components/kit/NumField.vue'
import Segmented from '@/components/kit/Segmented.vue'

type Step = 'income' | 'housing' | 'credit' | 'goal' | 'invite'

const router = useRouter()
const authStore = useAuthStore()
const financeStore = useFinanceStore()

const slot = computed(() => authStore.slot || 'a')
const knownName = computed(() => {
  const existing = financeStore.people.find((p) => p.id === slot.value)
  return existing?.name || authStore.member?.display_name || authStore.user?.email?.split('@')[0] || ''
})

// Если в бюджете уже есть обязательства, цели или флаг setupDone, значит партнёр уже настроил основу.
// Считаются только живые: удалённая цель не делает семью «настроенной» (как в React).
const joining = computed(() => {
  return (
    financeStore.setupDone ||
    liveObligations(financeStore.obligations).length > 0 ||
    liveGoals(financeStore.goals).length > 0
  )
})

const steps = computed<Step[]>(() => {
  if (joining.value) return ['income']
  return ['income', 'housing', 'credit', 'goal', 'invite']
})

const currentStepIndex = ref(0)
const step = computed(() => steps.value[currentStepIndex.value])
const totalSteps = computed(() => steps.value.length)

// Step 1: Income
const name = ref(knownName.value || 'Участник')
const salary = ref('')
const payday = ref('10')

// Step 2: Housing
const tenure = ref<'rent' | 'mortgage' | 'own'>('rent')
const housingAmount = ref('')
const housingDay = ref('5')
const utilitiesAmount = ref('')

// Step 3: Credit
const hasCredit = ref<'no' | 'yes'>('no')
const creditPrincipal = ref('')
const creditPayment = ref('')
const creditRateMode = ref<'rate' | 'term'>('rate')
const creditRate = ref('')
const creditTerm = ref('')
const creditDay = ref('12')

// Step 4: Goal
const goalName = ref('')
const goalNeed = ref('')
const goalHave = ref('0')
const goalMonths = ref('24')
const goalHue = ref<HueKey>('green')

// Step 5: Invite
const inviteCode = ref<string | null>(null)
const inviteError = ref('')
const inviteBusy = ref(false)
const copied = ref(false)

const form = computed<SetupForm>(() => ({
  tenure: tenure.value,
  housing: housingAmount.value,
  housingDay: housingDay.value,
  utilities: utilitiesAmount.value,
  hasCredit: hasCredit.value,
  creditPrincipal: creditPrincipal.value,
  creditPayment: creditPayment.value,
  creditRateMode: creditRateMode.value,
  creditRate: creditRate.value,
  creditTerm: creditTerm.value,
  creditDay: creditDay.value,
  goalName: goalName.value,
  goalNeed: goalNeed.value,
  goalHave: goalHave.value,
  goalMonths: goalMonths.value,
  goalHue: goalHue.value,
}))

// «Пропустить» / «Пока без цели»: введённое остаётся в полях, но не пишется (Р-22).
// «Дальше» того же шага флаг снимает — человек мог вернуться назад и передумать.
const skips = ref<SetupSkips>({ housing: false, credit: false, goal: false })

function go(which: keyof SetupSkips, skip: boolean) {
  skips.value = { ...skips.value, [which]: skip }
  next()
}

const computedCreditRate = computed(() => setupCreditRate(form.value))
// Срок и платёж названы — показываем ставку или честно говорим, что график не сходится.
const termEntered = computed(
  () => creditRateMode.value === 'term' && parseMoney(creditTerm.value) > 0 && parseMoney(creditPayment.value) > 0,
)

const calculatedGoalMonthly = computed(() => setupGoalMonthly(form.value))

function next() {
  if (currentStepIndex.value < steps.value.length - 1) {
    currentStepIndex.value++
  } else {
    finish()
  }
}

function back() {
  if (currentStepIndex.value > 0) {
    currentStepIndex.value--
  }
}

async function handleMakeInvite() {
  inviteBusy.value = true
  inviteError.value = ''
  try {
    const res = await authStore.createInvite()
    inviteCode.value = res.code
  } catch (err) {
    inviteError.value = authErrorText(err instanceof Error ? err.message : String(err), 'invite')
  } finally {
    inviteBusy.value = false
  }
}

async function handleCopy() {
  if (!inviteCode.value) return
  try {
    await navigator.clipboard.writeText(inviteCode.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard might be blocked
  }
}

function finish() {
  // Решение принимается до записи: первая же запись сделала бы семью «настроенной».
  const isJoining = joining.value

  // 1. Сохраняем человека
  financeStore.setPerson(slot.value, {
    name: name.value.trim() || 'Участник',
    salary: parseMoney(salary.value),
    payday: Math.min(28, Math.max(1, parseMoney(payday.value) || 10)),
    onboardedAt: new Date().toISOString(),
  })

  // 2–4. Жильё, кредит и цель — что решил setupPlan (пропущенные шаги не пишутся)
  if (!isJoining) {
    const plan = setupPlan(form.value, skips.value)
    if (plan.housing) {
      for (const o of plan.housing.obligations) financeStore.addObligation(o)
      financeStore.setCategoryAmount('d1', plan.housing.d1)
    }
    if (plan.credit) {
      financeStore.addCredit(plan.credit.credit)
      financeStore.setCategoryAmount('d2', plan.credit.d2)
    }
    if (plan.goal) {
      financeStore.addGoal(plan.goal.goal)
      financeStore.setCategoryAmount('d3', plan.goal.d3)
    }
  }

  // 5. Завершение
  financeStore.finishSetup()
  void financeStore.syncHousehold()
  void router.push('/')
}
</script>

<template>
  <div class="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-5 pb-6 pt-5 text-left">
    <!-- Header with progress bar -->
    <div class="mb-5 flex items-center gap-3">
      <button
        v-if="currentStepIndex > 0"
        type="button"
        aria-label="Назад"
        class="text-ink-2 hover:text-ink cursor-pointer"
        @click="back"
      >
        <PhArrowLeft :size="18" />
      </button>
      <span
        v-else
        class="grid size-7 place-items-center rounded-lg bg-brand font-display text-[12px] font-bold text-brand-ink"
      >
        FF
      </span>

      <div class="flex flex-1 gap-1">
        <i
          v-for="(_, i) in totalSteps"
          :key="i"
          class="h-[3px] flex-1 rounded-full transition-colors"
          :style="{ background: i <= currentStepIndex ? 'var(--brand)' : 'var(--track)' }"
        />
      </div>
    </div>

    <!-- Step Title & Description -->
    <div class="mb-4">
      <h1 class="font-display text-[26px] font-semibold leading-tight tracking-[-0.03em] text-ink">
        <template v-if="step === 'income'">
          {{ joining ? 'Добавьте свой доход' : 'Начнём с дохода' }}
        </template>
        <template v-else-if="step === 'housing'">Жильё</template>
        <template v-else-if="step === 'credit'">Кредиты</template>
        <template v-else-if="step === 'goal'">На что копим</template>
        <template v-else-if="step === 'invite'">Пригласите партнёра</template>
      </h1>

      <p class="mt-1.5 text-[14px] leading-relaxed text-ink-2">
        <template v-if="step === 'income'">
          {{
            joining
              ? 'Жильё и цели партнёр уже завёл. От вас нужна только зарплата.'
              : 'Оклад без бонусов. Нерегулярные премии добавим отдельно.'
          }}
        </template>
        <template v-else-if="step === 'housing'">
          Самая большая статья у большинства пар. С неё считается подушка безопасности.
        </template>
        <template v-else-if="step === 'credit'">
          Если есть — приложение покажет переплату и экономию от досрочного погашения.
        </template>
        <template v-else-if="step === 'goal'">
          Одной цели достаточно. Приложение посчитает, сколько откладывать в месяц.
        </template>
        <template v-else-if="step === 'invite'">
          Бюджет общий: у второго будет свой вход, а цели и покупки — одни на двоих.
        </template>
      </p>
    </div>

    <!-- Step Content -->
    <div class="flex-1 mt-2">
      <!-- Step 1: Income -->
      <div v-if="step === 'income'" class="flex flex-col gap-1">
        <Field label="Как вас зовут">
          <Input v-model="name" placeholder="Имя" />
        </Field>
        <Field label="Зарплата в месяц, ₸">
          <NumField v-model="salary" placeholder="450 000" class-name="text-[17px]" />
        </Field>
        <Field label="День зарплаты (1–28)">
          <NumField v-model="payday" kind="int" placeholder="10" />
        </Field>
      </div>

      <!-- Step 2: Housing -->
      <div v-else-if="step === 'housing'" class="flex flex-col gap-2">
        <Field label="Как живёте">
          <Segmented
            v-model="tenure"
            :options="[
              { value: 'rent', label: 'Аренда' },
              { value: 'mortgage', label: 'Ипотека' },
              { value: 'own', label: 'Своё' },
            ]"
          />
        </Field>
        <Field :label="tenure === 'own' ? 'Содержание в месяц, ₸' : 'Платёж в месяц, ₸'">
          <NumField v-model="housingAmount" placeholder="280 000" class-name="text-[17px]" />
        </Field>
        <Field label="День платежа">
          <NumField v-model="housingDay" kind="int" placeholder="5" />
        </Field>
        <Field label="Коммуналка в месяц, ₸ (примерно)">
          <NumField v-model="utilitiesAmount" placeholder="22 000" />
        </Field>
      </div>

      <!-- Step 3: Credit -->
      <div v-else-if="step === 'credit'" class="flex flex-col gap-2">
        <Field label="Есть действующий кредит или рассрочка?">
          <Segmented
            v-model="hasCredit"
            :options="[
              { value: 'no', label: 'Нет' },
              { value: 'yes', label: 'Есть' },
            ]"
          />
        </Field>

        <template v-if="hasCredit === 'yes'">
          <Field label="Остаток долга, ₸">
            <NumField v-model="creditPrincipal" placeholder="1 600 000" />
          </Field>
          <Field label="Платёж в месяц, ₸">
            <NumField v-model="creditPayment" placeholder="117 000" />
          </Field>
          <Field label="Что знаете про ставку">
            <Segmented
              v-model="creditRateMode"
              :options="[
                { value: 'rate', label: 'Знаю ставку' },
                { value: 'term', label: 'Знаю срок' },
              ]"
            />
          </Field>
          <Field v-if="creditRateMode === 'rate'" label="Ставка (ГЭСВ из договора), % годовых">
            <NumField v-model="creditRate" kind="rate" placeholder="23,4" />
          </Field>
          <Field v-else label="Сколько платежей осталось">
            <NumField v-model="creditTerm" kind="int" placeholder="17" />
          </Field>
          <template v-if="termEntered">
            <div
              v-if="computedCreditRate !== null"
              class="mb-3 rounded-xl border border-brand bg-brand-soft px-3.5 py-3 text-left"
            >
              <span class="text-[12.5px] text-ink-2">Ставка получается</span>
              <div class="font-display text-[20px] font-semibold tracking-[-0.02em] num text-ink">
                {{ ratePct(computedCreditRate, 1) }} годовых
              </div>
            </div>
            <div
              v-else
              class="mb-3 rounded-xl border border-warn-line bg-warn-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-2"
            >
              При таком платеже долг за этот срок не закрывается. Проверьте суммы: скорее
              всего, платёж или число платежей указаны неверно.
            </div>
          </template>
          <Field label="День платежа">
            <NumField v-model="creditDay" kind="int" placeholder="12" />
          </Field>
          <p class="text-[12.5px] leading-relaxed text-ink-3">
            Если ставку знаете — берите ГЭСВ из договора, а не с витрины: там она называется
            «годовая эффективная ставка вознаграждения» и учитывает комиссии. Если не знаете —
            укажите, сколько платежей осталось, и ставка посчитается сама.
          </p>
        </template>
      </div>

      <!-- Step 4: Goal -->
      <div v-else-if="step === 'goal'" class="flex flex-col gap-2">
        <Field label="Название цели">
          <Input v-model="goalName" placeholder="Первая квартира" />
        </Field>
        <Field label="Сколько нужно, ₸">
          <NumField v-model="goalNeed" placeholder="6 000 000" class-name="text-[17px]" />
        </Field>
        <Field label="Уже накоплено, ₸">
          <NumField v-model="goalHave" placeholder="0" />
        </Field>
        <Field label="За сколько месяцев хотите накопить">
          <NumField v-model="goalMonths" kind="int" placeholder="24" />
        </Field>
        <Field label="Цвет">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="h in HUE_KEYS"
              :key="h"
              type="button"
              :aria-label="HUES[h].label"
              :class="[
                'size-7 rounded-xl border-2 transition-all cursor-pointer',
                goalHue === h ? 'border-ink scale-105 shadow-xs' : 'border-transparent',
              ]"
              :style="{ background: HUES[h].light }"
              @click="goalHue = h"
            />
          </div>
        </Field>
        <div v-if="calculatedGoalMonthly > 0" class="rounded-xl border border-brand bg-brand-soft p-3.5">
          <span class="text-[12.5px] text-ink-2">Откладывать в месяц</span>
          <div class="font-display text-[21px] font-semibold num text-ink">
            {{ money(calculatedGoalMonthly) }}
          </div>
        </div>
      </div>

      <!-- Step 5: Invite -->
      <div v-else-if="step === 'invite'" class="flex flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-6 text-center">
        <span class="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
          <PhUserPlus :size="24" />
        </span>

        <template v-if="inviteCode">
          <div>
            <div class="text-[13px] text-ink-2">Код приглашения</div>
            <button
              type="button"
              class="mt-1 flex items-center justify-center gap-2 font-display text-[28px] font-semibold tracking-[0.14em] num text-ink cursor-pointer"
              @click="handleCopy"
            >
              {{ inviteCode }}
              <PhCopy :size="18" class="text-ink-3" />
            </button>
          </div>
          <p class="text-[12.5px] leading-relaxed text-ink-2 max-w-[280px]">
            Продиктуйте его партнёру. Он войдёт по коду и присоединится к вашей семье.
          </p>
          <span v-if="copied" class="text-[12px] font-medium text-brand">Скопировано в буфер</span>
        </template>
        <template v-else>
          <p class="text-[13px] leading-relaxed text-ink-2">
            Создадим короткий код — его удобно продиктовать вслух. Код действует две недели.
          </p>
          <Button class="w-full" :disabled="inviteBusy" @click="handleMakeInvite">
            {{ inviteBusy ? 'Создаём…' : 'Создать код приглашения' }}
          </Button>
          <p v-if="inviteError" role="alert" class="text-[12.5px] text-warn">{{ inviteError }}</p>
        </template>
      </div>
    </div>

    <!-- Step Footer Actions -->
    <div class="mt-6 flex flex-col gap-2">
      <Button
        v-if="step === 'income'"
        :disabled="!parseMoney(salary) || !name.trim()"
        @click="joining ? finish() : next()"
      >
        {{ joining ? 'Готово' : 'Дальше' }}
      </Button>

      <template v-else-if="step === 'housing'">
        <Button @click="go('housing', false)">Дальше</Button>
        <Button variant="ghost" @click="go('housing', true)">Пропустить</Button>
      </template>

      <template v-else-if="step === 'credit'">
        <Button @click="go('credit', false)">
          {{ hasCredit === 'yes' ? 'Дальше' : 'Кредитов нет' }}
        </Button>
        <Button v-if="hasCredit === 'yes'" variant="ghost" @click="go('credit', true)">Пропустить</Button>
      </template>

      <template v-else-if="step === 'goal'">
        <Button @click="go('goal', false)">Дальше</Button>
        <Button variant="ghost" @click="go('goal', true)">Пока без цели</Button>
      </template>

      <template v-else-if="step === 'invite'">
        <Button @click="finish">
          {{ inviteCode ? 'Готово' : 'Перейти к бюджету' }}
        </Button>
        <p v-if="!inviteCode" class="text-center text-[12px] text-ink-3">
          Можно пригласить позже — кнопка есть на главном экране.
        </p>
      </template>
    </div>
  </div>
</template>
