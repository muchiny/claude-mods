// Mutation d'un seul module de mode-clair/hooks, avec les seuls tests qui l'atteignent (par imports, transitifs).
// Usage : node dev/mutate-module.mjs <module.ts> [--concurrency N] [--runs N] [--list]
//   --list : affiche les tests retenus sans lancer Stryker.
// Stryker sous instrumentation rend les tests de propriétés ~15 fois plus lents (2 s -> 27 s pour tout le
// dépôt) : PROPS_RUNS est donc réduit (30 par défaut, graine 42) ; les goldens et les tests purs restent entiers.
// Le rapport JSON va dans reports/mutation-pure/<module>.json ; le planchers se vérifient avec dev/mutation-floors.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TEST_DIRS = ['mode-clair/tests/pure', 'tests/golden', 'tests/props', 'tests/width']
export const DEFAULT_PROPS_RUNS = 30
const IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g

function walk(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  )
}

// Fichier relatif au dépôt -> fichiers du dépôt qu'il importe (imports relatifs seulement).
function importsOf(file, read) {
  const found = []
  for (const m of read(file).matchAll(IMPORT)) {
    const base = resolve(ROOT, dirname(file), m[1])
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, 'index.ts')]) {
      if (existsSync(cand) && !cand.endsWith('/') && /\.(ts|tsx|mjs)$/.test(cand)) {
        found.push(relative(ROOT, cand))
        break
      }
    }
  }
  return found
}

/**
 * Les fichiers de test (*.test.ts des dossiers de TEST_DIRS) dont la fermeture d'imports contient `target`
 * (chemin relatif au dépôt). `files` et `read` sont injectables pour les tests.
 */
export function testsFor(target, files = TEST_DIRS.flatMap(walk), read = (f) => readFileSync(join(ROOT, f), 'utf8')) {
  const reaches = (start) => {
    const seen = new Set()
    const stack = [start]
    while (stack.length > 0) {
      const f = stack.pop()
      if (seen.has(f)) continue
      seen.add(f)
      stack.push(...importsOf(f, read))
    }
    return seen.has(target)
  }
  return files
    .filter((f) => f.endsWith('.test.ts'))
    .filter(reaches)
    .sort()
}

/** Configuration Stryker d'un module : la base de stryker.pure.json, mutate, commande et rapport propres. */
export function configFor(base, module, tests, runs = DEFAULT_PROPS_RUNS) {
  const report = `reports/mutation-pure/${module}.json`
  return {
    ...base,
    mutate: [`mode-clair/hooks/${module}`],
    commandRunner: {
      command: `PROPS_RUNS=${runs} PROPS_SEED=42 bun test --timeout 120000 ${tests.map((t) => `./${t}`).join(' ')}`,
    },
    reporters: ['clear-text', 'json'],
    jsonReporter: { fileName: report },
  }
}

/** Un nom de fichier de mode-clair/hooks : minuscules, chiffres, tirets, en .ts ; ni séparateur ni `..`. */
export function validModule(name) {
  return /^[a-z][a-z0-9-]*\.ts$/.test(name)
}

function main(argv) {
  const module = argv.find((a) => !a.startsWith('--') && /\.ts$/.test(a))
  const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined)
  const concurrency = opt('--concurrency') ?? '2'
  const runs = opt('--runs') ?? String(DEFAULT_PROPS_RUNS)
  if (!module || !validModule(module) || !existsSync(join(ROOT, 'mode-clair/hooks', module))) {
    console.error('usage : node dev/mutate-module.mjs <module.ts> [--concurrency N] [--runs N] [--list]')
    return 2
  }
  if (!/^[1-9]\d*$/.test(concurrency) || !/^[1-9]\d*$/.test(runs)) {
    console.error('::error::--concurrency et --runs : entiers >= 1')
    return 2
  }
  const tests = testsFor(`mode-clair/hooks/${module}`)
  if (tests.length === 0) {
    console.error(`::error::aucun test n'atteint ${module}`)
    return 2
  }
  console.log(`mutate-module ${module} : ${tests.length} fichiers de test, PROPS_RUNS=${runs}\n  ${tests.join('\n  ')}`)
  if (argv.includes('--list')) return 0
  const base = JSON.parse(readFileSync(join(ROOT, 'stryker.pure.json'), 'utf8'))
  // Configuration dans un dossier neuf (mkdtemp, mode 700), fichier créé exclusivement (wx), effacée à la fin.
  const dir = mkdtempSync(join('/var/tmp', 'stryker-module-'))
  try {
    const config = join(dir, `${module}.json`)
    writeFileSync(config, JSON.stringify(configFor(base, module, tests, Number(runs))), { flag: 'wx', mode: 0o600 })
    mkdirSync(join(ROOT, 'reports/mutation-pure'), { recursive: true })
    const bin = join(ROOT, 'node_modules/.bin')
    const run = spawnSync(join(bin, 'stryker'), ['run', config, '--concurrency', concurrency], {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, TMPDIR: process.env.TMPDIR ?? '/var/tmp' },
    })
    return run.status ?? 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)))
