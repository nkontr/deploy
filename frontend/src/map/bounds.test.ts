import { describe, expect, it } from 'vitest'
import { clampDeg } from './bounds'

describe('clampDeg', () => {
  it('окно шире мира — к границам, которые принимает API; обычное — 4 знака', () => {
    expect(clampDeg(-312.25, 180)).toBe(-180)
    expect(clampDeg(402.5, 180)).toBe(180)
    expect(clampDeg(-91, 90)).toBe(-90)
    expect(clampDeg(39.712345, 180)).toBe(39.7123)
  })
})
