import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { copied, failing, interrupted, sandbox } from './paint-home.mjs'

type Box = { base: string; credentials: string; homes: () => string[]; dispose: () => void }

async function inBox(body: (b: Box) => unknown): Promise<void> {
  const b = sandbox() as Box
  try {
    await body(b)
  } finally {
    b.dispose()
  }
}

describe('HOME jetable de la peinture : identifiants jamais laissés derrière', () => {
  test('copie d’un faux fichier d’identifiants en mode 600, effacée par removeHome', () =>
    inBox((b) => {
      expect(copied(b.base, b.credentials)).toMatchObject({ same: true, mode: 0o600, exists: false })
      expect(b.homes()).toEqual([])
    }))

  test('erreur pendant la création (identifiants absents) : rien ne reste', () =>
    inBox((b) => {
      expect(failing(b.base)).toBe('erreur')
      expect(b.homes()).toEqual([])
    }))

  for (const [signal, code] of [
    ['SIGTERM', 143],
    ['SIGINT', 130],
    ['throw', 1],
  ] as const) {
    test(`${signal} : HOME effacé, groupe du Claude tué, sortie ${code}`, () =>
      inBox(async (b) => {
        const r = await interrupted(b.base, b.credentials, signal)
        expect(r).toEqual({ code, started: true, homeLeft: false, claudeAlive: false })
        expect(b.homes()).toEqual([])
      }))
  }
})
