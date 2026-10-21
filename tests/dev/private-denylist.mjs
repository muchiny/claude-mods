// Aide Node de tests/dev/fixtures-private.test.ts (le programme TypeScript du dépôt n'a pas les types Node) :
// la liste noire privée de l'utilisateur, ou null en CI ou si elle est absente. Ses entrées ne sont jamais
// affichées : seul le test les passe à assertClean.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export function privateDenylist() {
  if (process.env.CI) return null
  let text
  try {
    text = readFileSync(join(homedir(), '.config/claude-mods/denylist.txt'), 'utf8')
  } catch {
    return null
  }
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  return entries.length === 0 ? null : entries
}
