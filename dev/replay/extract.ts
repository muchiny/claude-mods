// Extraction des scénarios de rejeu : npm run replay:extract -- <dossier des projets> [options]
//
// Parcourt les *.jsonl du dossier (chemin passé en argument, jamais écrit dans le dépôt), un fichier à
// la fois, en flux ligne à ligne ; sélectionne les fenêtres (select.ts), garde la première de chaque
// signature, l'anonymise (anonymize.ts) et la passe aux deux barrières. Une seule fenêtre qui ne
// passe pas fait échouer l'extraction : code de sortie 1, aucun fichier écrit.
//
// Options :
//   --out <fichier>    sortie (défaut : /var/tmp/replay-real/scenarios.generated.ts, hors dépôt)
//   --commit-ok        écrit dans mode-clair/tests/replay/scenarios.generated.ts (après relecture
//                      de l'échantillon par l'utilisateur)
//   --sample <fichier> échantillon lisible de 10 scénarios tirés au hasard (défaut :
//                      /var/tmp/replay-real/sample-10.md)
//   --denylist <f>     liste noire (défaut : ~/.config/claude-mods/denylist.txt, obligatoire)
//
// REPLAY_DEBUG=1 : relève tous les refus et montre les mots refusés (console locale seulement), puis
// échoue sans rien écrire.
//
// Exécuté par bun, hors du programme TypeScript du dépôt (pas de types Node) ; select.ts et
// anonymize.ts, purs, sont vérifiés par tsc et testés dans tests/dev.

import { spawnSync } from 'node:child_process'
import { createReadStream, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Scenario } from '../../mode-clair/tests/replay/scenarios.generated'
import { anonymize, assertClean, assertKnownForms, newDict, unknownWords } from './anonymize'
import { TranscriptScan, windows } from './select'

const REPO = resolve(import.meta.dirname, '../..')
const REPO_OUT = join(REPO, 'mode-clair/tests/replay/scenarios.generated.ts')
const PRIVATE_DIR = '/var/tmp/replay-real'
/** Fichiers lus par le mod au-delà de cette taille : traités comme illisibles (REFERENCE R81). */
const MAX_FILE = 4 * 1024 * 1024

export const HEADER = `// format replay/1
// Scénarios de rejeu anonymisés, écrits par dev/replay/extract.ts (npm run replay:extract) : ne pas éditer.
// Seuls des événements attestés par les transcripts (spec vérif. D9).
import type { ToolCallResult } from 'claude-code'

export type ReplayEvent =
  | {
      t: number
      kind: 'tool.call'
      tool: string
      toolUseId: string
      agentId?: string
      input: unknown
      result: ToolCallResult
      afterMs: number
    }
  | { t: number; kind: 'turn.complete'; agentId?: string }
  | { t: number; kind: 'session.append'; text: string }

export type Scenario = {
  id: string
  source: 'replay' | 'synthetic'
  events: ReplayEvent[]
  files: Record<string, string>
  oracleNote?: string
}

`

function fail(message: string): never {
  process.stderr.write(`replay:extract : ${message}\n`)
  process.exit(1)
}

type Options = { root?: string; out?: string; commitOk: boolean; sample?: string; denylist?: string }

function options(argv: string[]): Options & { root: string } {
  const o: Options = { commitOk: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--commit-ok') o.commitOk = true
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--sample') o.sample = argv[++i]
    else if (a === '--denylist') o.denylist = argv[++i]
    else if (a.startsWith('--')) fail(`option inconnue ${a}`)
    else o.root = a
  }
  if (o.root === undefined) fail('dossier des projets manquant (ex. ~/.claude/projects)')
  return o as Options & { root: string }
}

function inside(path: string, dir: string): boolean {
  const rel = relative(dir, path)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))
}

/** Les *.jsonl sous `root`, triés (ordre déterministe), sans suivre les liens. */
function jsonlFiles(root: string): string[] {
  const found: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  visit(root)
  return found
}

async function scanFile(path: string) {
  const scan = new TranscriptScan()
  const lines = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  for await (const line of lines) scan.line(line)
  return scan.finish()
}

function readFiles(paths: readonly string[]): Record<string, string> {
  const files: Record<string, string> = {}
  for (const path of paths) {
    try {
      const st = statSync(path)
      if (st.isFile() && st.size <= MAX_FILE) files[path] = readFileSync(path, 'utf8')
    } catch {
      // absent du disque : le scénario n'en a pas (D9)
    }
  }
  return files
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

function write(path: string, text: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, { mode })
  renameSync(tmp, path)
}

function sampleOf(scenarios: readonly Scenario[], n: number): string {
  const pool = [...scenarios]
  const picked: Scenario[] = []
  while (picked.length < n && pool.length > 0)
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0] as Scenario)
  const lines = ['# Échantillon de scénarios anonymisés (à relire)', '']
  for (const s of picked) {
    lines.push(`## ${s.id}`, '')
    for (const e of s.events) {
      if (e.kind === 'tool.call') {
        lines.push(
          `- t=${e.t} ms · ${e.tool} · ${e.toolUseId}${e.agentId ? ` · agent ${e.agentId}` : ''} · après ${e.afterMs} ms`,
        )
        lines.push('', '  entrée :', '', '```json', JSON.stringify(e.input, null, 2), '```', '')
        const text = typeof e.result.text === 'string' ? e.result.text : JSON.stringify(e.result)
        lines.push(
          `  résultat${e.result.isError ? ' (erreur)' : ''} :`,
          '',
          '```',
          text.split('\n').slice(0, 30).join('\n'),
          '```',
          '',
        )
      } else if (e.kind === 'turn.complete')
        lines.push(`- t=${e.t} ms · fin de tour${e.agentId ? ` (${e.agentId})` : ''}`, '')
      else lines.push(`- t=${e.t} ms · notification`, '', '```', e.text, '```', '')
    }
    for (const [path, text] of Object.entries(s.files))
      lines.push(`- fichier ${path}`, '', '```', text.split('\n').slice(0, 30).join('\n'), '```', '')
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const o = options(process.argv.slice(2))
  const out = o.commitOk ? REPO_OUT : resolve(o.out ?? join(PRIVATE_DIR, 'scenarios.generated.ts'))
  if (!o.commitOk && inside(out, REPO)) fail('sortie dans le dépôt sans --commit-ok')
  const samplePath = resolve(o.sample ?? join(PRIVATE_DIR, 'sample-10.md'))
  if (inside(samplePath, REPO)) fail('échantillon dans le dépôt : interdit')
  const denyPath = o.denylist ?? join(homedir(), '.config/claude-mods/denylist.txt')
  let denylist: string[] = []
  try {
    denylist = readFileSync(denyPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
  } catch {
    fail('liste noire illisible (~/.config/claude-mods/denylist.txt)')
  }

  const files = jsonlFiles(resolve(o.root))
  const seen = new Set<string>()
  const ids = new Set<string>()
  const scenarios: Scenario[] = []
  const counts: Record<string, number> = {}
  let windowsSeen = 0
  const debug = process.env.REPLAY_DEBUG === '1'
  const refused = new Map<string, number>()
  for (const [n, path] of files.entries()) {
    if (n % 250 === 0) process.stderr.write(`fichiers ${n}/${files.length}, scénarios ${scenarios.length}\n`)
    const events = await scanFile(path)
    for (const c of windows(events)) {
      windowsSeen++
      if (seen.has(c.signature)) continue
      seen.add(c.signature)
      let id = c.id
      for (let k = 2; ids.has(id); k++) id = `${c.id}-${k}`
      ids.add(id)
      const s = anonymize({ id, events: c.events, files: readFiles(c.filePaths) }, newDict())
      if (debug) {
        // Débogage local : tous les refus relevés, l'extraction échoue à la fin sans rien écrire.
        for (const u of unknownWords(s))
          refused.set(
            `${u.where.replace(/\d+/g, 'N')} ${u.word}`,
            (refused.get(`${u.where.replace(/\d+/g, 'N')} ${u.word}`) ?? 0) + 1,
          )
        try {
          assertClean(JSON.stringify(s), denylist)
        } catch (e) {
          refused.set(`assertClean ${(e as Error).message}`, 1)
        }
      } else {
        try {
          assertClean(JSON.stringify(s), denylist)
          assertKnownForms(s)
        } catch (e) {
          fail(`${id} refusé : ${(e as Error).message}`)
        }
      }
      scenarios.push(s)
      counts[c.type] = (counts[c.type] ?? 0) + 1
    }
  }
  if (refused.size > 0) {
    for (const [k, n] of [...refused].sort((a, b) => b[1] - a[1])) process.stderr.write(`${n}\t${k}\n`)
    fail(`${refused.size} refus (débogage)`)
  }
  scenarios.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const text = format(`${HEADER}export const SCENARIOS: readonly Scenario[] = ${JSON.stringify(scenarios, null, 2)}\n`)
  assertClean(text, denylist)
  write(out, text, o.commitOk ? 0o644 : 0o600)
  if (!o.commitOk) write(samplePath, sampleOf(scenarios, 10), 0o600)
  process.stdout.write(
    `${JSON.stringify({ fichiers: files.length, fenêtres: windowsSeen, scénarios: scenarios.length, parType: counts, octets: Buffer.byteLength(text) })}\n`,
  )
}

await main()
