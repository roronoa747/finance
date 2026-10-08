<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFinanceStore } from '@/stores/finance'
import { useAuthStore } from '@/stores/auth'
import { useFxStore } from '@/stores/fx'
import { money } from '@/lib/money'
import { monthKey } from '@/lib/dates'
import { groupChildren, groupTotal, isSubscription, liveGroups, liveObligations } from '@/lib/finance'
import { cn } from '@/lib/utils'

import Field from '@/components/kit/Field.vue'
import { useFormCheck } from '@/components/kit/useFormCheck'
import Select from '@/components/kit/Select.vue'
import Sheet from '@/components/kit/Sheet.vue'
import DangerZone from '@/components/kit/DangerZone.vue'
import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import PaymentLine from '@/components/money/PaymentLine.vue'

/**
 * Группы подписок (RP-09, Р-20): новая группа (`createOpen`) и лист группы (`groupId`) — название,
 * «спрашивать „оставить?“», подписки внутри с «Оплатил» и итогом в месяц, удаление группы.
 * Viewer — только строки и итог.
 */
const props = defineProps<{ groupId: string | null; createOpen: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'close-create'): void
  (e: 'open-obligation', id: string): void
}>()

const financeStore = useFinanceStore()
const authStore = useAuthStore()
const fx = useFxStore()
const key = computed(() => monthKey())

/** Флаг группы: спрашивать ли «оставить?» о её подписках. */
const NO_ASK_OPTIONS = [
  { value: false, label: 'Спрашивать' },
  { value: true, label: 'Рабочие — нет' },
]
const groupName = ref('')
const groupNoAsk = ref(false)
const form = useFormCheck(() => [['groupName', !groupName.value.trim() && 'Введите название']])

function createGroup() {
  const name = groupName.value.trim()
  if (!name) return
  financeStore.addGroup(name, groupNoAsk.value)
  groupName.value = ''
  groupNoAsk.value = false
  emit('close-create')
}

const activeGroup = computed(() => liveGroups(financeStore.obligations).find((g) => g.id === props.groupId))
/** Подписки, которые можно положить в открытую группу. */
const groupCandidates = computed(() =>
  liveObligations(financeStore.obligations).filter((o) => isSubscription(o) && o.parentId !== props.groupId),
)
</script>

<template>
  <Sheet :open="createOpen" title="Группа подписок" @close="emit('close-create')">
    <Field label="Название" name="groupName">
      <Input v-model="groupName" placeholder="Рабочие, досуг, для дома…" />
    </Field>
    <Field label="Спрашивать «оставить?»" group>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="opt in NO_ASK_OPTIONS"
          :key="opt.label"
          type="button"
          :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', groupNoAsk === opt.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
          @click="groupNoAsk = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
    </Field>
    <Button class="w-full" @click="form.submit(createGroup)">Создать группу</Button>
  </Sheet>

  <Sheet :open="!!activeGroup" :title="activeGroup?.name ?? ''" @close="emit('close')">
    <template v-if="activeGroup" #default="{ close }">
      <template v-if="!authStore.isViewer">
        <Field label="Название">
          <Input
            :default-value="activeGroup.name"
            @blur="(e: Event) => {
              const v = (e.target as HTMLInputElement).value.trim()
              if (v && v !== activeGroup!.name) financeStore.updateObligation(activeGroup!.id, { name: v })
            }"
          />
        </Field>

        <Field label="Спрашивать «оставить?»" group>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="opt in NO_ASK_OPTIONS"
              :key="opt.label"
              type="button"
              :class="cn('rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer', !!activeGroup.noAsk === opt.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface-2 text-ink-2')"
              @click="!!activeGroup.noAsk !== opt.value && financeStore.updateObligation(activeGroup.id, { noAsk: opt.value })"
            >
              {{ opt.label }}
            </button>
          </div>
        </Field>
      </template>

      <!-- Подписки группы — те же строки справочника, что в «Платежах»: нажатие — лист подписки. -->
      <div class="mb-3 flex flex-col">
        <div class="flex justify-between pb-1 text-[13px]">
          <span class="text-ink-2">Итого</span>
          <b class="num text-ink">{{ money(groupTotal(activeGroup, financeStore.obligations, key, fx.book)) }} в месяц</b>
        </div>
        <PaymentLine
          v-for="o in groupChildren(activeGroup, financeStore.obligations)"
          :key="o.id"
          dense
          :item="{ kind: 'obligation', obligation: o }"
          :period="key"
          @open="emit('open-obligation', o.id)"
        />
      </div>

      <template v-if="!authStore.isViewer">
        <Field v-if="groupCandidates.length" label="Добавить подписку">
          <Select
            model-value=""
            :options="[{ value: '', label: 'Выберите…' }, ...groupCandidates.map((o) => ({ value: o.id, label: o.name }))]"
            @update:model-value="(v) => v && financeStore.moveToGroup(v, activeGroup!.id)"
          />
        </Field>

        <Button class="w-full mb-3" @click="close">Готово</Button>

        <DangerZone
          label="Удалить группу"
          warning="Группа исчезнет, подписки останутся — просто без группы."
          @confirm="() => { financeStore.removeGroup(activeGroup!.id); emit('close') }"
        />
      </template>
      <Button v-else class="w-full" @click="close">Готово</Button>
    </template>
  </Sheet>
</template>
