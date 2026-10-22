// Aide Node de tests/dev/fixtures-private.test.ts (le programme TypeScript du dépôt n'a pas les types Node) :
// la liste noire privée de l'utilisateur. Ses entrées ne sont jamais affichées : seul le test les passe à
// assertClean.
//
// Rend { entries } si elle se lit et porte au moins une entrée ; sinon { skip, reason } : skip vaut true
// seulement sous GitHub Actions (GITHUB_ACTIONS=true : la liste n'y existe pas) ou avec
// SKIP_PRIVATE_FIXTURES=1 (choix explicite). Hors de ces cas, une liste absente ou illisible est un échec :
// un `CI` exporté à la main ne suffit pas à sauter la garde.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DENYLIST = join(homedir(), '.config/claude-mods/denylist.txt')

export function privateDenylist({ env = process.env, path = DENYLIST } = {}) {
  const skip = env.GITHUB_ACTIONS === 'true' || env.SKIP_PRIVATE_FIXTURES === '1'
  const why = env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'SKIP_PRIVATE_FIXTURES=1'
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { skip, reason: skip ? `${why} : liste noire absente ou illisible` : 'liste noire absente ou illisible' }
  }
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  if (entries.length === 0)
    return { skip, reason: skip ? `${why} : liste noire sans entrée` : 'liste noire sans entrée' }
  return { entries }
}

/** privateDenylist sur une liste jetable (/var/tmp) : `content` (null : absente) au mode `mode`, sous `env`. */
export function denylistUnder({ env, content, mode = 0o600 }) {
  const dir = mkdtempSync(join('/var/tmp', 'denylist-'))
  try {
    const path = join(dir, 'denylist.txt')
    if (content !== null) {
      writeFileSync(path, content)
      chmodSync(path, mode)
    }
    return privateDenylist({ env, path })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
