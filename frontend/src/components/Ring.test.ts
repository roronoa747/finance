import { describe, it, expect, afterEach } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { HUES } from '@/lib/palette'
import { isDark } from '@/lib/theme'
import Ring from './Ring.vue'

describe('PV-08: кольцо цели в тёмной теме (SSR)', () => {
  afterEach(() => {
    isDark.value = false
  })

  const render = () => renderToString(createSSRApp(Ring, { progress: 0.4, hue: 'blue' }))

  it('дуга — оттенок текущей темы: светлая — .light, тёмная — .dark', async () => {
    let html = await render()
    expect(html).toContain(`stroke="${HUES.blue.light}"`)
    expect(html).not.toContain(HUES.blue.dark)

    isDark.value = true
    html = await render()
    expect(html).toContain(`stroke="${HUES.blue.dark}"`)
    expect(html).not.toContain(HUES.blue.light)
  })
})
