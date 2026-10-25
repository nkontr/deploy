import { describe, expect, it } from 'vitest'
import { createGroupMarker, groupTooltip, offscreenMunicipality } from './groupMarker'
import type { MapGroup } from '../api/types'

const g = (over: Partial<MapGroup>): MapGroup => ({
  label: 'х. Победа', municipalityId: 7, settlement: 'х. Победа', lat: 46.94, lon: 39.63,
  total: 47, ours: 3, others: 44, excluded: 0, ...over,
})

describe('groupMarker', () => {
  it('подсказка: сколько, сколько наших, где искать', () => {
    expect(groupTooltip(g({}))).toBe(
      'х. Победа: 47 компаний без точного адреса, из них 3 наших. В реестре только населённый пункт — компании в списке справа.'
    )
    expect(groupTooltip(g({ total: 1, ours: 0 }))).toContain('1 компания без точного адреса.')
  })

  it('только район — так и говорим', () => {
    expect(groupTooltip(g({ label: 'Аксайский р-н', settlement: null, ours: 0 }))).toMatch(
      /^Аксайский р-н \(населённый пункт не указан\): 47 компаний/
    )
  })

  it('значок: число внутри, пунктир; цвет — есть ли наши', () => {
    const withOurs = createGroupMarker(g({}))
    expect(withOurs.textContent).toBe('47')
    expect(withOurs.style.border).toContain('dashed')
    expect(withOurs.style.border).toContain('var(--rt-purple)')
    expect(createGroupMarker(g({ ours: 0 })).style.border).toContain('var(--rt-orange)')
    expect(createGroupMarker(g({ total: 12400 })).textContent).toBe('12k')
  })

  it('окраина города: группа города вне кадра — подсказываем; в кадре или далеко — нет', () => {
    const munis = [
      { id: 1, name: 'г. Ростов-на-Дону', lat: 47.2223, lon: 39.7199 },
      { id: 2, name: 'Аксайский р-н', lat: 47.3, lon: 39.9 },
    ]
    const outskirts = { lat: 47.28, lon: 39.66 } // Каменка, ~7 км от центра
    expect(offscreenMunicipality(outskirts, munis, [])?.id).toBe(1)
    expect(offscreenMunicipality(outskirts, munis, [{ municipalityId: 1, settlement: null }])).toBeNull()
    expect(offscreenMunicipality({ lat: 49.8, lon: 41.3 }, munis, [])).toBeNull() // далеко от всех
  })
})
