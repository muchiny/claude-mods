// Aides Node de tests/dev/paint-home.test.ts (le programme TypeScript du dépôt n'a pas les types Node).
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHome, removeHome } from '../../dev/paint/home.mjs'

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
  removeHome(home)
  return { ...r, exists: existsSync(home) }
}

export function failing(base) {
  try {
    createHome({ base, repo: '/depot', fakeBridge: '/bin/true', credentials: join(base, 'absent.json') })
    return 'pas d’erreur'
  } catch {
    return 'erreur'
  }
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
    const p = spawn(process.execPath.endsWith('bun') ? 'node' : process.execPath, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
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
