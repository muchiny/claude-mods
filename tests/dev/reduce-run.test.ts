import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { runReduce } from './run-reduce.mjs'

type Run = { status: number | null; stderr: string; imported: boolean; written: boolean }
const run = (o: { where: string; text?: string }): Run => runReduce(o)

describe('replay:reduce : l’entrée n’est importée que depuis le dossier privé', () => {
  test('entrée hors du dossier privé : échec, rien d’importé ni d’écrit', () => {
    expect(run({ where: 'outside' })).toMatchObject({ status: 1, imported: false, written: false })
  })
  test('lien dans le dossier privé vers une entrée hors de lui : échec, rien d’importé', () => {
    expect(run({ where: 'link' })).toMatchObject({ status: 1, imported: false, written: false })
  })
  test('dossier privé lisible par d’autres (755) : échec, rien d’importé', () => {
    expect(run({ where: 'open' })).toMatchObject({ status: 1, imported: false, written: false })
  })
  test('entrée dans le dossier privé, scénario propre : sortie écrite', () => {
    expect(run({ where: 'private' })).toMatchObject({ status: 0, imported: true, written: true })
  })
})

describe('replay:reduce : assertKnownForms sur chaque scénario gardé', () => {
  test('mot inconnu dans un scénario gardé : échec, rien d’écrit, le mot n’est pas recopié', () => {
    const r = run({ where: 'private', text: 'Zorglub' })
    expect(r).toMatchObject({ status: 1, written: false })
    expect(r.stderr).toContain('forme inconnue')
    expect(r.stderr).not.toContain('Zorglub')
  })
  test('horodatage réel dans un scénario gardé : échec, rien d’écrit', () => {
    expect(run({ where: 'private', text: '2026-10-21T10:00:00.123Z  INFO lorem' })).toMatchObject({
      status: 1,
      written: false,
    })
  })
})
