// Aides Node de tests/dev/paint-home.test.ts (le programme TypeScript du dépôt n'a pas les types Node).
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { createHome, homeBase, removeHome, STALE_MS, sweepHomes } from '../../dev/paint/home.mjs'

const CHILD = resolve(import.meta.dirname, 'paint-home-child.mjs')
const FAKE = '{"claudeAiOauth":{"accessToken":"factice","refreshToken":"factice"}}'

/** Dossier de base jetable sous /var/tmp, avec un faux fichier d'identifiants (jamais les vrais). */
export function sandbox() {
  const base = mkdtempSync(join('/var/tmp', 'paint-home-test-'))
  const credentials = join(base, 'faux-credentials.json')
  writeFileSync(credentials, FAKE)
  return {
    base,
    credentials,
    homes: () => readdirSync(base).filter((n) => n.startsWith('paint-home-')),
    dispose: () => rmSync(base, { recursive: true, force: true }),
  }
}

export function copied(base, credentials) {
  const home = createHome({ base, repo: '/depot', fakeBridge: '/bin/true', credentials })
  const f = join(home, '.claude', '.credentials.json')
  const r = { home, same: readFileSync(f, 'utf8') === FAKE, mode: statSync(f).mode & 0o777 }
  const removed = removeHome(home, base)
  return { ...r, removed, exists: existsSync(home) }
}

export function failing(base) {
  try {
    createHome({ base, repo: '/depot', fakeBridge: '/bin/true', credentials: join(base, 'absent.json') })
    return 'pas d’erreur'
  } catch {
    return 'erreur'
  }
}

/**
 * removeHome refuse tout ce qui n'est pas un dossier paint-home-* directement sous `base` : rend, pour
 * chaque chemin étranger, [résultat de removeHome, chemin encore là].
 */
export function foreign(base) {
  const other = join(base, 'autre-dossier')
  mkdirSync(other)
  writeFileSync(join(other, 'fichier'), 'à garder')
  const nested = join(base, 'sous', 'paint-home-niche')
  mkdirSync(nested, { recursive: true })
  const target = join(base, 'cible')
  mkdirSync(target)
  writeFileSync(join(target, 'fichier'), 'à garder')
  const link = join(base, 'paint-home-lien')
  symlinkSync(target, link)
  const file = join(base, 'paint-home-fichier')
  writeFileSync(file, 'à garder')
  const r = {}
  for (const [k, path] of Object.entries({ other, nested, link, file, parent: base })) {
    r[k] = [removeHome(path, base), existsSync(path)]
  }
  r.target = existsSync(join(target, 'fichier'))
  // Défaut : la base attendue est $RUNNER_TEMP ou /var/tmp, pas ce dossier de test.
  const ours = mkdtempSync(join(base, 'paint-home-'))
  r.wrongBase = [removeHome(ours), existsSync(ours)]
  r.rightBase = [removeHome(ours, base), existsSync(ours)]
  return r
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Lance le témoin, lui envoie `signal` (ou le laisse lever avec 'throw'), rend l'état après sa sortie. */
export function interrupted(base, credentials, signal) {
  return new Promise((done, fail) => {
    const args = [CHILD, base, credentials, signal === 'throw' ? 'throw' : 'wait']
    // Le témoin tourne sous node (comme drive.ts) ; sa base attendue est la base du test.
    const env = { ...process.env, RUNNER_TEMP: base }
    const p = spawn('node', args, { env, stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    let info = null
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      fail(new Error('témoin bloqué'))
    }, 15_000)
    p.stdout.on('data', (d) => {
      out += d
      if (info === null && out.includes('\n')) {
        info = JSON.parse(out.split('\n')[0])
        if (signal !== 'throw') p.kill(signal)
      }
    })
    p.on('exit', (code) => {
      clearTimeout(timer)
      setTimeout(() => {
        done({
          code,
          started: info?.home.startsWith(base) === true,
          homeLeft: info !== null && existsSync(info.home),
          claudeAlive: info !== null && alive(info.pid),
        })
      }, 200)
    })
  })
}

/** Modes du HOME jetable et de son contenu (identifiants compris), puis effacement. */
export function modes(base, credentials) {
  const home = createHome({ base, repo: '/depot', fakeBridge: '/bin/true', credentials })
  const m = (p) => statSync(join(home, p)).mode & 0o777
  const r = {
    home: m('.'),
    claudeJson: m('.claude.json'),
    claude: m('.claude'),
    creds: m('.claude/.credentials.json'),
    bin: m('bin'),
  }
  removeHome(home, base)
  return r
}

/**
 * Balayage des HOME périmés : un paint-home-* vieux (effacé), un récent, un dossier vieux d'un autre nom, un
 * lien vieux nommé paint-home-* vers un dossier à garder (gardés). Rend le compte et ce qui reste.
 */
export function swept(base) {
  const old = (Date.now() - STALE_MS - 60_000) / 1000
  const mk = (name) => {
    const p = join(base, name)
    mkdirSync(p)
    writeFileSync(join(p, 'f'), 'x')
    return p
  }
  utimesSync(mk('paint-home-vieux'), old, old)
  mk('paint-home-recent')
  utimesSync(mk('autre-vieux'), old, old)
  const target = mk('cible')
  symlinkSync(target, join(base, 'paint-home-lien'))
  const n = sweepHomes(base)
  return {
    n,
    left: readdirSync(base)
      .filter((x) => x !== 'faux-credentials.json')
      .sort(),
    target: existsSync(join(target, 'f')),
  }
}

/** homeBase() sous l'environnement `env` (rétabli ensuite). */
export function baseUnder(env) {
  const keys = ['PAINT_USE_REAL_HOME', 'XDG_RUNTIME_DIR', 'RUNNER_TEMP']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    for (const k of keys) {
      if (env[k] === undefined) delete process.env[k]
      else process.env[k] = env[k]
    }
    return homeBase()
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

/** Un dossier sous `base` au mode demandé (XDG_RUNTIME_DIR factice). */
export function dirWithMode(base, name, mode) {
  const p = join(base, name)
  mkdirSync(p)
  chmodSync(p, mode)
  return p
}

/**
 * sweepHomes() sans argument, sous XDG_RUNTIME_DIR et RUNNER_TEMP factices (deux dossiers 700 de `base`) : un
 * paint-home-* périmé dans chacun. Rend le compte et ce qui reste dans chaque base (environnement rétabli).
 */
export function sweptBoth(base) {
  const xdg = dirWithMode(base, 'run-user', 0o700)
  const tmp = dirWithMode(base, 'var-tmp', 0o700)
  const old = (Date.now() - STALE_MS - 60_000) / 1000
  for (const d of [xdg, tmp]) {
    const p = join(d, 'paint-home-vieux')
    mkdirSync(p)
    utimesSync(p, old, old)
  }
  const keys = ['PAINT_USE_REAL_HOME', 'XDG_RUNTIME_DIR', 'RUNNER_TEMP']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    delete process.env.PAINT_USE_REAL_HOME
    process.env.XDG_RUNTIME_DIR = xdg
    process.env.RUNNER_TEMP = tmp
    const n = sweepHomes()
    return { n, xdg: readdirSync(xdg), tmp: readdirSync(tmp) }
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}
