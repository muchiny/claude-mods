import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { isRepoFile, readRepo } from './replay-files.mjs'

// L'oracle du rejeu doit rester indépendant du code du mod (spec vérif. §5.1, REFERENCE.md) : il
// implémente la table de référence lui-même et n'importe jamais hooks/*, ni directement ni par un de ses
// imports locaux.
const ORACLE = 'mode-clair/tests/replay/oracle.ts'

/** Un import (statique, `export … from`, `import()` dynamique, `require()`) dont le chemin passe par hooks/. */
const HOOKS_IMPORT = /(from|import\s*\(|require\s*\()\s*['"][^'"]*\/hooks(\/|['"])/

function hooksImported(text: string): boolean {
  return HOOKS_IMPORT.test(text)
}

/** Chemins relatifs importés par un fichier (`./…`, `../…`), toutes graphies. */
function relativeImports(text: string): string[] {
  const re = /(?:from|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"]*)['"]/g
  return [...text.matchAll(re)].map((m) => m[1] as string)
}

/** Chemin du dépôt normalisé (`a/b/../c` → `a/c`). */
function normalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '.' && part !== '') out.push(part)
  }
  return out.join('/')
}

/** Le fichier qu'un import relatif désigne, comme le résout TypeScript (Bundler) ; null s'il n'existe pas. */
function resolveImport(from: string, spec: string): string | null {
  const base = normalize(`${from.split('/').slice(0, -1).join('/')}/${spec}`)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}/index.ts`, `${base}/index.d.ts`])
    if (isRepoFile(candidate)) return candidate
  return null
}

/** Tous les fichiers atteints depuis `start` par des imports relatifs. */
function reachable(start: string): string[] {
  const seen = new Set<string>([start])
  const todo = [start]
  for (let file = todo.pop(); file !== undefined; file = todo.pop()) {
    for (const spec of relativeImports(readRepo(file))) {
      const target = resolveImport(file, spec)
      expect([file, spec, target !== null]).toEqual([file, spec, true])
      if (target !== null && !seen.has(target)) {
        seen.add(target)
        todo.push(target)
      }
    }
  }
  return [...seen]
}

const PLANTED = [
  "import { x } from '../../hooks/bridge'",
  'import { x } from "../../hooks/bridge"',
  "const m = await import('../../hooks/bridge')",
  "const m = require('../../hooks/bridge')",
  "import { x } from '../../../mode-clair/hooks/x'",
  "import { x } from '../../hooks'",
  "export { x } from '../../hooks/view'",
]

describe('garde d’indépendance de l’oracle', () => {
  test('chaque graphie plantée est prise par la garde', () => {
    for (const line of PLANTED) expect([line, hooksImported(line)]).toEqual([line, true])
  })

  test('aucune fausse alerte sur un import qui ne vise pas hooks/', () => {
    expect(hooksImported("import type { ClairState } from '../../types'")).toBe(false)
    expect(hooksImported("import { RECORDED_REFUSALS } from '../pure/engine-texts'")).toBe(false)
  })

  test('oracle.ts n’importe rien de hooks/*', () => {
    expect(hooksImported(readRepo(ORACLE))).toBe(false)
  })

  test('aucun fichier atteint depuis oracle.ts par ses imports locaux n’est sous mode-clair/hooks', () => {
    const files = reachable(ORACLE)
    expect(files).toContain('mode-clair/tests/pure/engine-texts.ts')
    expect(files.filter((f) => f.startsWith('mode-clair/hooks/'))).toEqual([])
    for (const f of files) expect([f, hooksImported(readRepo(f))]).toEqual([f, false])
  })

  test('le parcours suit les imports : un fichier qui importe hooks/ y mène', () => {
    expect(reachable('mode-clair/tests/pure/bridge-classify.test.ts')).toContain('mode-clair/hooks/bridge.ts')
  })
})
