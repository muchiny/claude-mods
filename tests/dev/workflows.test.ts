import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { grepFinds, hygienePattern } from './workflows.mjs'

const finds = (text: string): boolean => grepFinds(hygienePattern(), text)

describe('ci.yml : grep d’hygiène des fixtures de rejeu (motif exécuté)', () => {
  test('UUID non synthétique et horodatage ISO réel détectés', () => {
    expect(finds("toolUseId: 'deadbeef-cafe-4bad-9fed-0123456789ab'")).toBe(true)
    expect(finds("text: '2026-10-21T10:00:00.123Z  INFO lorem'")).toBe(true)
    expect(finds("text: '1999-12-31T23:59:59Z'")).toBe(true)
  })
  test('formes synthétiques acceptées', () => {
    expect(finds("id: '00000000-0000-4000-8000-000000000001'")).toBe(false)
    expect(finds("text: '2000-01-01T00:00:01.500Z  INFO lorem'")).toBe(false)
    expect(finds("path: '/home/user/-home-user-proj-a/x'")).toBe(false)
  })
  test('formes déjà couvertes toujours détectées', () => {
    expect(finds('/home/quelquun/x')).toBe(true)
    expect(finds('toolu_01ABCdef')).toBe(true)
    expect(finds('10.0.0.1')).toBe(true)
  })
})
