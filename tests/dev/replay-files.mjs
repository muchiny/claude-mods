// Aides Node de tests/dev/oracle-imports.test.ts et replay-coverage.test.ts (le programme TypeScript du
// dépôt n'a pas les types Node) : lire un fichier du dépôt, écrire un rapport sous reports/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

/** Texte d'un fichier du dépôt, chemin relatif à sa racine. */
export function readRepo(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

/** Écrit un rapport sous reports/ (dossier ignoré par git), chemin relatif à la racine du dépôt. */
export function writeReport(rel, text) {
  const path = join(ROOT, rel)
  if (!rel.startsWith('reports/')) throw new Error(`rapport hors de reports/ : ${rel}`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
