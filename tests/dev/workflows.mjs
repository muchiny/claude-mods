// Aides Node de tests/dev/workflows.test.ts (le programme TypeScript du dépôt n'a pas les types Node) :
// lire un workflow, en tirer le motif du grep d'hygiène des fixtures, l'exécuter avec grep -P.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

/** Texte de .github/workflows/<nom>. */
export function workflow(name) {
  return readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
}

/** Motif PCRE du pas « Replay fixtures are anonymised » de ci.yml. */
export function hygienePattern() {
  const m = /grep -rnP --include='\*\.ts' '(.*)' \\$/m.exec(workflow('ci.yml'))
  if (m === null) throw new Error('motif du grep d’hygiène introuvable dans ci.yml')
  return m[1]
}

/** Vrai si grep -P trouve `pattern` dans `text` (comme le pas de CI, qui échoue alors). */
export function grepFinds(pattern, text) {
  const r = spawnSync('grep', ['-P', pattern], { input: text, encoding: 'utf8' })
  if (r.status === 2) throw new Error(`grep -P : ${r.stderr}`)
  return r.status === 0
}
