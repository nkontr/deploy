import { describe, expect, it } from 'vitest'
import { shortOrgName } from './shortOrgName'

describe('shortOrgName', () => {
  it('сокращает форму собственности, название не трогает', () => {
    expect(shortOrgName('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ДРСУ-ДОН"')).toBe('ООО "ДРСУ-ДОН"')
    expect(shortOrgName('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ"АСМ-ИНЖИНИРИНГ"')).toBe('ООО"АСМ-ИНЖИНИРИНГ"')
    expect(shortOrgName('АКЦИОНЕРНОЕ ОБЩЕСТВО "СМУ-ДОНДОРСТРОЙ"')).toBe('АО "СМУ-ДОНДОРСТРОЙ"')
    expect(shortOrgName('ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "РОСТЕЛЕКОМ"')).toBe('ПАО "РОСТЕЛЕКОМ"')
    expect(shortOrgName('ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ ИВАНОВ ИВАН')).toBe('ИП ИВАНОВ ИВАН')
  })

  it('уже короткие и без формы — как есть', () => {
    expect(shortOrgName('ООО "НОТА"')).toBe('ООО "НОТА"')
    expect(shortOrgName('ДМИТРИЕНКО АНДРЕЙ ВИТАЛЬЕВИЧ')).toBe('ДМИТРИЕНКО АНДРЕЙ ВИТАЛЬЕВИЧ')
  })
})
