import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { compare, scores } from '../../dev/mutation-floors.mjs'

const mutants = (...statuses: string[]) => ({ mutants: statuses.map((status) => ({ status })) })

describe('scores', () => {
  test('score par module, arrondi vers le bas à une décimale, hors mutants ignorés', () => {
    const report = {
      files: {
        'mode-clair/hooks/a.ts': mutants('Killed', 'Timeout', 'Survived', 'Ignored', 'CompileError'),
        'mode-clair/hooks/b.ts': mutants('Killed', 'Killed', 'Survived'),
        'mode-clair/hooks/c.ts': mutants('Ignored'),
      },
    }
    expect(scores(report)).toEqual({ 'a.ts': 66.6, 'b.ts': 66.6, 'c.ts': 100 })
  })
})

describe('compare', () => {
  test('sous le plancher ou absent : échec ; au-dessus : plancher à relever', () => {
    const r = compare({ 'a.ts': 90, 'b.ts': 100 }, { 'a.ts': 95, 'b.ts': 99.5, 'c.ts': 80 })
    expect(r.below).toHaveLength(2)
    expect(r.raised).toEqual({ 'b.ts': 100 })
  })

  test('module mesuré sans plancher : échec (jamais ignoré en silence)', () => {
    const r = compare({ 'a.ts': 100, 'neuf.ts': 100 }, { 'a.ts': 100 })
    expect(r.below).toEqual(['neuf.ts : mesuré mais sans plancher dans dev/mutation-floors.json'])
    expect(r.raised).toEqual({})
  })
})
