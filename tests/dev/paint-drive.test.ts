import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { paintWith } from './paint-drive.mjs'

type R = { code: number; stdout: string; homesLeft: number; fakeStarted: boolean; fakeAlive: boolean }
const NOTICE = '::notice::peinture sautée : connexion requise'
// Sous bun (tests/dev ne tourne que sous bun), un troisième argument fixe le délai du test ; l'API typée de
// claude-code/testing ne l'a pas.
const SLOW = 60_000
const slowTest = test as unknown as (name: string, body: () => Promise<void>, ms: number) => void

describe('drive.ts de bout en bout, faux claude (sans réseau ni vrai Claude)', () => {
  slowTest(
    'écran de connexion avec le curseur ❯ : notice, scénario sauté, sortie 0, rien ne reste',
    async () => {
      const r = (await paintWith('login')) as R
      expect(r.stdout).toContain(NOTICE)
      expect(r.stdout).not.toContain('écart')
      expect(r.code).toBe(0)
      expect(r).toMatchObject({ homesLeft: 0, fakeStarted: true, fakeAlive: false })
    },
    SLOW,
  )

  slowTest(
    'invite ordinaire (témoin) : le scénario tourne, 0 écart, pas de notice, rien ne reste',
    async () => {
      const r = (await paintWith('prompt')) as R
      expect(r.stdout).not.toContain(NOTICE)
      expect(r.stdout).toContain('repos : 0 écart')
      expect(r.stdout).toContain('repos-menu : 0 écart')
      expect(r.code).toBe(0)
      expect(r).toMatchObject({ homesLeft: 0, fakeStarted: true, fakeAlive: false })
    },
    SLOW,
  )
})
