import { describe, expect, test } from 'claude-code/testing'
import { seedFrom } from '../props/settings'

const run = (vars: Record<string, string>, random = 0.5) => {
  const logs: string[] = []
  const seed = seedFrom(
    (n) => vars[n],
    () => random,
    (m) => logs.push(m),
  )
  return { seed, logs }
}

describe('seedFrom', () => {
  test('PROPS_SEED entière : utilisée (même en CI) et affichée', () => {
    const r = run({ PROPS_SEED: '123456789', CI: 'true' })
    expect(r.seed).toBe(123456789)
    expect(r.logs).toEqual(['props : graine 123456789 (PROPS_SEED=123456789 pour rejouer)'])
  })

  test('PROPS_SEED=0 explicite reste 0', () => {
    expect(run({ PROPS_SEED: '0' }).seed).toBe(0)
  })

  test('CI sans PROPS_SEED : 42 (PR reproductibles)', () => {
    expect(run({ CI: 'true' }).seed).toBe(42)
  })

  test('PROPS_SEED vide : traitée comme absente, jamais 0 en silence (42 en CI, aléatoire sinon)', () => {
    expect(run({ PROPS_SEED: '', CI: 'true' }).seed).toBe(42)
    expect(run({ PROPS_SEED: '  ', CI: 'true' }).seed).toBe(42)
    const r = run({ PROPS_SEED: '' }, 0.25)
    expect(r.seed).toBe(2 ** 29)
    expect(r.logs[0]).toContain('graine aléatoire')
  })

  test('PROPS_SEED non entière : erreur', () => {
    for (const bad of ['abc', '1.5', '0x10', '1e3'])
      expect(() => run({ PROPS_SEED: bad })).toThrow('PROPS_SEED invalide')
  })

  test('ni PROPS_SEED ni CI : aléatoire et affichée', () => {
    const r = run({}, 0.25)
    expect(r.seed).toBe(2 ** 29)
    expect(r.logs).toEqual([`props : graine aléatoire ${2 ** 29} (PROPS_SEED=${2 ** 29} pour rejouer)`])
  })
})
