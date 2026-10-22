// Réduit un fichier de scénarios de rejeu sous une taille maximale :
//   bun dev/replay/reduce-run.ts <entrée> --max-bytes <n> [--out <fichier>] [--denylist <f>]
//                                [--private-dir <dossier>]
//
// L'entrée est le fichier complet écrit par extract.ts (hors dépôt, jamais modifié). Elle est importée
// (exécutée) : elle doit donc être un fichier à soi, non inscriptible par d'autres, sous le dossier privé
// (défaut /var/tmp/replay-real, ou --private-dir : un dossier à soi, mode 700, hors du dépôt), liens
// résolus ; sinon rien n'est importé. La sortie (défaut : mode-clair/tests/replay/scenarios.generated.ts)
// est formatée par Biome ; chaque scénario gardé passe assertClean (liste noire, mode 600, obligatoire) et
// assertKnownForms, puis le fichier entier assertClean ; au moindre refus rien n'est écrit.
// Aucun contenu de scénario n'est jamais affiché : seulement des comptes et des tailles.
//
// Exécuté par bun, hors du programme TypeScript du dépôt (pas de types Node) ; reduce.ts, pur,
// est vérifié par tsc et testé dans tests/dev.

import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import type { Scenario } from '../../mode-clair/tests/replay/scenarios.generated'
import { assertClean, assertFixture } from './anonymize'
import { reduceScenarios, typeOf } from './reduce'

const REPO = resolve(import.meta.dirname, '../..')
const REPO_OUT = join(REPO, 'mode-clair/tests/replay/scenarios.generated.ts')
const MARK = 'export const SCENARIOS: readonly Scenario[] = '
const PRIVATE_DIR = '/var/tmp/replay-real'

function fail(message: string): never {
  process.stderr.write(`replay:reduce : ${message}\n`)
  process.exit(1)
}

function inside(path: string, dir: string): boolean {
  const rel = relative(dir, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

/**
 * L'entrée, liens résolus, si elle peut être importée sans risque : un fichier .ts à soi, non inscriptible
 * par le groupe ni les autres, sous `dir` (un dossier à soi, mode 700, hors du dépôt). Sinon échec.
 */
function privateInput(input: string, dir: string): string {
  let realDir: string
  let real: string
  try {
    realDir = realpathSync(dir)
    real = realpathSync(input)
  } catch {
    fail('entrée ou dossier privé introuvable')
  }
  const uid = process.getuid?.()
  const d = statSync(realDir)
  if (!d.isDirectory() || d.uid !== uid || (d.mode & 0o077) !== 0) fail('dossier privé : un dossier à soi, mode 700')
  if (inside(realDir, REPO)) fail('dossier privé dans le dépôt : interdit')
  if (!inside(real, realDir) || real === realDir) fail('entrée hors du dossier privé : non importée')
  const f = statSync(real)
  if (!f.isFile() || f.uid !== uid || (f.mode & 0o022) !== 0 || !real.endsWith('.ts'))
    fail('entrée : un fichier .ts à soi, non inscriptible par d’autres')
  return real
}

function readDenylist(path: string): string[] {
  let mode: number
  let text: string
  try {
    mode = statSync(path).mode
    text = readFileSync(path, 'utf8')
  } catch {
    fail('liste noire absente ou illisible')
  }
  if ((mode & 0o077) !== 0) fail('liste noire lisible par d’autres que son propriétaire : chmod 600')
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  if (entries.length === 0) fail('liste noire sans entrée')
  return entries
}

function format(text: string): string {
  const biome = join(REPO, 'node_modules/.bin/biome')
  const r = spawnSync(biome, ['format', `--stdin-file-path=${REPO_OUT}`, `--files-max-size=${256 * 1024 * 1024}`], {
    input: text,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })
  if (r.status !== 0) fail('Biome n’a pas pu formater la sortie')
  return r.stdout
}

async function main() {
  const argv = process.argv.slice(2)
  let input: string | undefined
  let out = REPO_OUT
  let max = 0
  let deny = join(homedir(), '.config/claude-mods/denylist.txt')
  let dir = PRIVATE_DIR
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--max-bytes') max = Number(argv[++i])
    else if (a === '--out') out = resolve(argv[++i] as string)
    else if (a === '--denylist') deny = argv[++i] as string
    else if (a === '--private-dir') dir = resolve(argv[++i] as string)
    else if (a.startsWith('--')) fail(`option inconnue ${a}`)
    else input = resolve(a)
  }
  if (input === undefined) fail('fichier d’entrée manquant')
  if (!Number.isFinite(max) || max <= 0) fail('--max-bytes <n> obligatoire')
  const denylist = readDenylist(deny)
  input = privateInput(input, dir)
  const source = readFileSync(input, 'utf8')
  const at = source.indexOf(MARK)
  if (at < 0) fail('entrée sans SCENARIOS')
  const header = source.slice(0, at)
  const all = (await import(input)).SCENARIOS as Scenario[]

  // La taille estimée n'est pas celle du fichier formaté : on resserre jusqu'à passer sous la limite.
  let budget = max
  for (let attempt = 0; attempt < 8; attempt++) {
    const kept = reduceScenarios(all, budget)
    const text = format(`${header}${MARK}${JSON.stringify(kept, null, 2)}\n`)
    const bytes = Buffer.byteLength(text)
    if (bytes > max) {
      budget -= bytes - max + 1_000
      continue
    }
    try {
      assertFixture(kept, denylist)
      assertClean(text, denylist)
    } catch (e) {
      fail(`sortie refusée : ${(e as Error).message}`)
    }
    const tmp = `${out}.tmp`
    writeFileSync(tmp, text, { mode: 0o644 })
    renameSync(tmp, out)
    const counts: Record<string, number> = {}
    for (const s of kept) counts[typeOf(s)] = (counts[typeOf(s)] ?? 0) + 1
    process.stdout.write(
      `${JSON.stringify({ gardés: kept.length, sur: all.length, parType: counts, octets: bytes })}\n`,
    )
    return
  }
  fail('impossible de passer sous la limite')
}

await main()
