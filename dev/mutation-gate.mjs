// Porte de PR : mutation des seules lignes de mode-clair/hooks ajoutées ou modifiées depuis une base.
// Usage : node dev/mutation-gate.mjs --base origin/main
import { execFileSync, spawnSync } from 'node:child_process'
import { delimiter, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Stryker installé par `npm ci` : jamais `npx`, qui téléchargerait et exécuterait un paquet homonyme.
export const STRYKER = fileURLToPath(new URL('../node_modules/.bin/stryker', import.meta.url))
// Le runner de Stryker lance `bun` par le shell : node_modules/.bin doit être dans le PATH (ce que fait `npm run`).
export const gateEnv = (env = process.env) => ({
  ...env,
  PATH: `${dirname(STRYKER)}${delimiter}${env.PATH ?? ''}`,
})
const IGNORES = new Set(['mode-clair/hooks/tools.generated.ts', 'mode-clair/hooks/register.tsx'])
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

// Lit un diff `git diff -U0` : fichier -> plages [début, fin] de lignes ajoutées ou modifiées.
export function changedRanges(diff) {
  const ranges = new Map()
  let file = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^b\//, '')
      file = path === '/dev/null' || IGNORES.has(path) || !/^mode-clair\/hooks\/[^/]+\.tsx?$/.test(path) ? null : path
      continue
    }
    const hunk = HUNK.exec(line)
    if (!hunk || file === null) continue
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    if (count === 0) continue // pure suppression : rien à muter
    if (!ranges.has(file)) ranges.set(file, [])
    ranges.get(file).push([start, start + count - 1])
  }
  return ranges
}

// Diff -U0 des hooks entre l'ancêtre commun avec `base` et l'arbre de travail : les lignes
// changées seulement sur la base après le point de départ de la branche n'en font pas partie.
export function baseDiff(base, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', cwd })
  const ancestor = git('merge-base', base, 'HEAD').trim()
  return git('diff', '-U0', ancestor, '--', 'mode-clair/hooks/*.ts', 'mode-clair/hooks/*.tsx')
}

function main(argv) {
  const i = argv.indexOf('--base')
  const base = i >= 0 ? argv[i + 1] : undefined
  if (!base) {
    console.error('usage : node dev/mutation-gate.mjs --base <ref>')
    return 2
  }
  const ranges = changedRanges(baseDiff(base))
  if (ranges.size === 0) {
    console.log('mutation-gate : aucune ligne de hooks modifiée')
    return 0
  }
  const targets = [...ranges].flatMap(([file, list]) => list.map(([a, b]) => `${file}:${a}-${b}`))
  console.log(`mutation-gate : ${targets.join(' ')}`)
  const run = spawnSync(STRYKER, ['run', 'stryker.pure.json', '--mutate', targets.join(',')], {
    stdio: 'inherit',
    env: gateEnv(),
  })
  return run.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)))
