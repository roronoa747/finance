import type { Goal } from '@/types/finance'
import { liveGoals } from '@/lib/finance'
import { templateCredit, templateImageUrl, type GoalTemplate } from '@/lib/goalTemplates'
import { compressImage } from './compress'
import { uploadPhoto } from './store'

/**
 * Фото цели из шаблона или своё (B2C-17): шаблон и цвет пишутся в цель сразу (офлайн цель
 * заводится без картинки), картинка — скачать → сжать → загрузить → `photoId` и автор. Без
 * сети или при сбое остаётся `template` без `photoId` — дозагрузка при следующем открытии
 * с сетью (`retryTemplatePhotos`). В демо сервера нет — картинок нет, только шаблон и цвет.
 * Замена фото на шаблон (у цели уже есть `photoId`) пишет шаблон и цвет только после
 * загрузки: дозагрузка цели с фото не трогает, и отложенный шаблон остался бы без картинки.
 */
export type GoalPhotoStore = {
  goals: Goal[]
  isDemo: boolean
  updateGoal(id: string, patch: Partial<Goal>): void
  setGoalPhoto(id: string, photoId: string | null, credit?: { author: string; url: string } | null): void
}

export type PhotoDeps = {
  fetch: (url: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }>
  compress: (blob: Blob) => Promise<{ blob: Blob }>
  upload: (blob: Blob) => Promise<string>
  online: () => boolean
}

const defaults = (): PhotoDeps => ({
  fetch: (url) => fetch(url),
  compress: (blob) => compressImage(blob),
  upload: (blob) => uploadPhoto(blob),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
})

/**
 * Цели, чья картинка шаблона уже грузится: вторая загрузка той же цели (дозагрузка «Мечт»,
 * пока «Новая мечта» ещё грузит) сделала бы второе фото, а первое осталось бы сиротой.
 */
const inFlight = new Set<string>()

/** Скачать картинку шаблона, сжать и загрузить как фото цели; цель уже грузится — false. */
async function uploadTemplate(store: GoalPhotoStore, goalId: string, t: GoalTemplate, deps: PhotoDeps): Promise<boolean> {
  if (store.isDemo || !deps.online() || inFlight.has(goalId)) return false
  inFlight.add(goalId)
  try {
    const res = await deps.fetch(templateImageUrl(t))
    if (!res.ok) return false
    const { blob } = await deps.compress(await res.blob())
    const id = await deps.upload(blob)
    store.setGoalPhoto(goalId, id, templateCredit(t))
    return true
  } catch {
    return false
  } finally {
    inFlight.delete(goalId)
  }
}

/**
 * Выбран шаблон. Цель без фото получает его сразу, картинка — при сети (`deferred`). Цель с
 * фото меняет шаблон и цвет только вместе с картинкой; не загрузилось — всё прежнее (`offline`).
 */
export async function attachTemplate(
  store: GoalPhotoStore,
  goalId: string,
  t: GoalTemplate,
  deps: PhotoDeps = defaults(),
): Promise<'uploaded' | 'deferred' | 'offline'> {
  const replacing = !!store.goals.find((g) => g.id === goalId)?.photoId
  if (!replacing) store.updateGoal(goalId, { template: t.id, hue: t.hue })
  if (!(await uploadTemplate(store, goalId, t, deps))) return replacing ? 'offline' : 'deferred'
  if (replacing) store.updateGoal(goalId, { template: t.id, hue: t.hue })
  return 'uploaded'
}

/** Своё фото из галереи или камеры: сжать и загрузить; автора нет. */
export async function attachFile(store: GoalPhotoStore, goalId: string, file: Blob, deps: PhotoDeps = defaults()): Promise<boolean> {
  if (store.isDemo || !deps.online()) return false
  try {
    const { blob } = await deps.compress(file)
    const id = await deps.upload(blob)
    store.setGoalPhoto(goalId, id, null)
    store.updateGoal(goalId, { template: null })
    return true
  } catch {
    return false
  }
}

/** Цели с шаблоном без картинки — дозагрузить при сети; сколько получилось. */
export async function retryTemplatePhotos(store: GoalPhotoStore, templates: GoalTemplate[], deps: PhotoDeps = defaults()): Promise<number> {
  if (store.isDemo || !deps.online()) return 0
  let n = 0
  for (const g of liveGoals(store.goals)) {
    if (g.photoId || !g.template) continue
    const t = templates.find((x) => x.id === g.template)
    if (t && (await uploadTemplate(store, g.id, t, deps))) n += 1
  }
  return n
}
