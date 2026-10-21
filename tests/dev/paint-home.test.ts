import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { baseUnder, copied, dirWithMode, failing, foreign, interrupted, modes, sandbox, swept } from './paint-home.mjs'

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
      expect(copied(b.base, b.credentials)).toMatchObject({ same: true, mode: 0o600, removed: true, exists: false })
      expect(b.homes()).toEqual([])
    }))

  test('erreur pendant la création (identifiants absents) : rien ne reste', () =>
    inBox((b) => {
      expect(failing(b.base)).toBe('erreur')
      expect(b.homes()).toEqual([])
    }))

  test('removeHome refuse un chemin étranger : autre nom, niché, lien, fichier, la base, autre base', () =>
    inBox((b) => {
      expect(foreign(b.base)).toEqual({
        other: [false, true],
        nested: [false, true],
        link: [false, true],
        file: [false, true],
        parent: [false, true],
        target: true,
        wrongBase: [false, true],
        rightBase: [true, false],
      })
    }))

  for (const [signal, code] of [
    ['SIGHUP', 129],
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

describe('HOME jetable de la peinture : modes, balayage, base (L4)', () => {
  test('HOME, .claude et bin en 700 ; .claude.json et identifiants en 600', () =>
    inBox((b) => {
      expect(modes(b.base, b.credentials)).toEqual({
        home: 0o700,
        claudeJson: 0o600,
        claude: 0o700,
        creds: 0o600,
        bin: 0o700,
      })
    }))

  test('sweepHomes : seuls les paint-home-* périmés (vrais dossiers) sont effacés', () =>
    inBox((b) => {
      expect(swept(b.base)).toEqual({
        n: 1,
        left: ['autre-vieux', 'cible', 'paint-home-lien', 'paint-home-recent'],
        target: true,
      })
    }))

  test('PAINT_USE_REAL_HOME=1 : $XDG_RUNTIME_DIR préféré s’il est un dossier à soi en 700', () =>
    inBox((b) => {
      const xdg = dirWithMode(b.base, 'run-user', 0o700)
      const open = dirWithMode(b.base, 'run-ouvert', 0o755)
      expect(baseUnder({ PAINT_USE_REAL_HOME: '1', XDG_RUNTIME_DIR: xdg, RUNNER_TEMP: b.base })).toBe(xdg)
      expect(baseUnder({ PAINT_USE_REAL_HOME: '1', XDG_RUNTIME_DIR: open, RUNNER_TEMP: b.base })).toBe(b.base)
      expect(baseUnder({ PAINT_USE_REAL_HOME: '1', RUNNER_TEMP: b.base })).toBe(b.base)
      expect(baseUnder({ XDG_RUNTIME_DIR: xdg, RUNNER_TEMP: b.base })).toBe(b.base)
      expect(baseUnder({ XDG_RUNTIME_DIR: xdg })).toBe('/var/tmp')
    }))
})
