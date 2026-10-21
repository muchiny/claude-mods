import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { runExtract } from './run-extract.mjs'

type Run = { status: number | null; stderr: string; written: boolean }
const run = (o: { deny: string | null; mode?: number; args?: string[] }): Run => runExtract(o)

describe('extract : la liste noire ferme la porte', () => {
  test('liste noire absente : échec, rien d’écrit', () => {
    const r = run({ deny: null })
    expect(r.status).toBe(1)
    expect(r.written).toBe(false)
  })
  test('liste noire lisible par d’autres (644) : échec', () => {
    const r = run({ deny: 'machine-reelle-1\n', mode: 0o644 })
    expect(r.status).toBe(1)
    expect(r.written).toBe(false)
  })
  test('liste noire sans entrée (vide, commentaires, blancs) : échec', () => {
    const r = run({ deny: '# commentaire\n\n   \n' })
    expect(r.status).toBe(1)
    expect(r.written).toBe(false)
  })
  test('--out avec --commit-ok : échec', () => {
    const r = run({ deny: 'machine-reelle-1\n', args: ['--commit-ok'] })
    expect(r.status).toBe(1)
    expect(r.written).toBe(false)
  })
  test('liste noire valide, dossier vide : sortie écrite', () => {
    const r = run({ deny: 'machine-reelle-1\n' })
    expect(r.status).toBe(0)
    expect(r.written).toBe(true)
  })
})
