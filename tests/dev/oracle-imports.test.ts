import { expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { readRepo } from './replay-files.mjs'

// L'oracle du rejeu doit rester indépendant du code du mod (spec vérif. §5.1, REFERENCE.md) : il
// implémente la table de référence lui-même et n'importe jamais hooks/*.
const ORACLE = 'mode-clair/tests/replay/oracle.ts'

test('oracle.ts n’importe rien de hooks/*', () => {
  const text: string = readRepo(ORACLE)
  expect(text.includes("from '../../hooks")).toBe(false)
  expect(text.includes("from '../../hooks/")).toBe(false)
})
