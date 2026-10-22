import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { checkTools } from '../../dev/check-tools.mjs'

const entree = (nature: string, extra = '') =>
  `{ hostless: false, multi: false, session: false, nature: '${nature}', codeWithoutError: false${extra} }`
const source = (...lignes: string[]) =>
  `export const TOOLS: Readonly<Record<string, ToolInfo>> = {\n${lignes.join('\n')}\n}\n`

describe('checkTools', () => {
  test('table conforme : aucune erreur', () => {
    const src = source(`  ssh_a: ${entree('lecture')},`, `  ssh_b: ${entree('peut-modifier')},`)
    expect(checkTools(src)).toEqual([])
  })

  test("nature hors {lecture, peut-modifier} signalée avec le nom de l'outil", () => {
    const errors = checkTools(source(`  ssh_a: ${entree('inconnue')},`))
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('ssh_a')
    expect(errors[0]).toContain('nature')
  })

  test('champ booléen manquant ou non booléen signalé', () => {
    const sansMulti = "  ssh_a: { hostless: false, session: false, nature: 'lecture', codeWithoutError: false },"
    const errors = checkTools(
      source(sansMulti, `  ssh_b: ${entree('lecture').replace('hostless: false', 'hostless: 1')},`),
    )
    expect(errors.some((e: string) => e.includes('ssh_a') && e.includes('multi'))).toBe(true)
    expect(errors.some((e: string) => e.includes('ssh_b') && e.includes('hostless'))).toBe(true)
  })

  test('table absente ou vide : erreur', () => {
    expect(checkTools('export const X = 1\n')).toHaveLength(1)
    expect(checkTools(source())).toHaveLength(1)
  })

  test("ligne d'entrée illisible signalée", () => {
    expect(checkTools(source('  ssh_a: nimporte quoi,')).length).toBeGreaterThan(0)
  })
})
