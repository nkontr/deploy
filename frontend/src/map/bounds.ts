/** Граница окна карты в допустимом для API диапазоне (широта ±90, долгота ±180), 4 знака */
export function clampDeg(value: number, limit: number): number {
  return parseFloat(Math.min(Math.max(value, -limit), limit).toFixed(4))
}
