// Les workflows ultracode vus de l'extérieur : leur bloc `meta`, leur journal
// (une ligne JSON par événement : `launched`, `started`, `result`, `failed`) et
// la notification de fin. Module pur : aucun `$`, aucune horloge.
//
// Le format du journal n'est pas documenté : une ligne inconnue ou illisible
// est sautée, jamais devinée.

import type { Workflow, WorkflowAgent, WorkflowStatus } from '../types'

/** Sans croissance du journal depuis ce délai, le workflow est « sans nouvelles ». */
export const QUIET_MS = 30 * 60_000
/** Au-delà, `$.fs.read` rejette : le journal n'est plus lu. */
export const MAX_JOURNAL_BYTES = 4 * 1024 * 1024

type Ending = 'fini' | 'echec' | 'arrete'

const NOTICE_STATUS: ReadonlyMap<string, Ending> = new Map<string, Ending>([
  ['completed', 'fini'],
  ['failed', 'echec'],
  ['killed', 'arrete'],
  ['stopped', 'arrete'],
])

/** `meta.name` et les titres des phases du bloc qui commence par `export const meta = {` ; null sans ce bloc. */
export function parseMeta(script: string): { name: string | null; phases: string[] } | null {
  const found = /export\s+const\s+meta\s*=\s*\{/.exec(script)
  if (found === null) return null
  const open = found.index + found[0].length - 1
  let depth = 0
  let end = open
  for (const [offset, ch] of script.slice(open).split('').entries()) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = open + offset
        break
      }
    }
  }
  const meta = script.slice(open, end + 1)
  const name = meta.match(/\bname\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/)?.[2] ?? null
  const afterPhases = /\bphases\s*:\s*\[([\s\S]*)/.exec(meta)?.[1] ?? ''
  const phases = Array.from(afterPhases.matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g), (m) => String(m[2]))
  return { name, phases }
}

/** Ajoute un workflow lancé (le plus récent en dernier) ; une même clé remplace l'ancienne entrée. */
export function startWorkflow(
  list: Workflow[],
  w: { key: string; toolUseId: string; name: string; phases: string[]; journalPath: string | null; remote: boolean },
  now: number,
): Workflow[] {
  const started: Workflow = {
    key: w.key,
    toolUseId: w.toolUseId,
    name: w.name,
    phases: w.phases,
    journalPath: w.journalPath,
    consumed: 0,
    agents: [],
    status: w.remote ? 'distant' : 'en-cours',
    lastGrowthAt: now,
    startedAt: now,
  }
  return [...list.filter((x) => x.key !== w.key), started]
}

type Row = { type: unknown; agentId: string; label: string | null; phase: string | null }

function rowOf(line: string): Row | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  // Une valeur JSON qui n'est pas un objet (nombre, texte, tableau) n'a pas d'`agentId` : rejetée plus bas.
  // Le `type` n'est pas validé : seules les comparaisons à 'started', 'result' et 'failed' l'utilisent.
  const r = parsed as Record<string, unknown> | null
  if (r === null || typeof r.agentId !== 'string') return null
  return {
    type: r.type,
    agentId: r.agentId,
    label: typeof r.label === 'string' ? r.label : null,
    phase: typeof r.phase === 'string' ? r.phase : null,
  }
}

/**
 * Replie la partie nouvelle du journal, `text.slice(w.consumed)`, jusqu'à la
 * dernière fin de ligne (une ligne en cours d'écriture attend le tic suivant).
 * Un journal plus court que ce qui a été lu a été remplacé : il est relu depuis
 * le début. Rien de nouveau : même référence.
 */
export function foldJournal(w: Workflow, text: string, now: number): Workflow {
  const from = text.length < w.consumed ? 0 : w.consumed
  const end = text.lastIndexOf('\n') + 1
  if (end <= from) return from === w.consumed ? w : { ...w, consumed: 0, agents: [] }
  let agents: WorkflowAgent[] = from === w.consumed ? w.agents : []
  for (const line of text.slice(from, end).split('\n')) {
    const row = rowOf(line)
    if (row === null) continue
    if (row.type === 'started') {
      if (!agents.some((a) => a.id === row.agentId)) {
        agents = [...agents, { id: row.agentId, label: row.label ?? row.agentId, phase: row.phase, state: 'en-cours' }]
      }
    } else if (row.type === 'result' || row.type === 'failed') {
      const state = row.type === 'result' ? 'fait' : 'echec'
      agents = agents.map((a) => (a.id === row.agentId ? { ...a, state } : a))
    }
  }
  const status: WorkflowStatus = w.status === 'sans-nouvelles' ? 'en-cours' : w.status
  return { ...w, consumed: end, agents, lastGrowthAt: now, status }
}

/** Termine le workflow dont la clé ou le `toolUseId` vaut `key` ; même référence si rien ne change. */
export function endWorkflow(list: Workflow[], key: string, status: Ending): Workflow[] {
  let changed = false
  const next = list.map((w) => {
    if ((w.key !== key && w.toolUseId !== key) || w.status === status) return w
    changed = true
    return { ...w, status }
  })
  return changed ? next : list
}

/**
 * Passe « sans nouvelles » chaque workflow en cours dont le journal n'a pas
 * grandi depuis QUIET_MS : dernière croissance vue au repli, ou `mtimeMs` du
 * fichier s'il est plus récent (null : fichier absent). Un workflow à distance
 * n'a pas de journal et n'est jamais « sans nouvelles ».
 */
export function quiet(list: Workflow[], now: number, mtimeMs: (w: Workflow) => number | null): Workflow[] {
  let changed = false
  const next = list.map((w) => {
    if (w.status !== 'en-cours') return w
    const mtime = mtimeMs(w)
    const last = Math.max(w.lastGrowthAt, mtime ?? w.lastGrowthAt)
    if (now - last < QUIET_MS) return w
    changed = true
    return { ...w, status: 'sans-nouvelles' as const }
  })
  return changed ? next : list
}

/**
 * La notification de fin d'une tâche de fond, au format réel : `<task-notification>`
 * puis une balise par ligne, `<task-id>`, `<tool-use-id>`, `<output-file>`,
 * `<status>`, `<summary>`, puis selon la tâche `<result>` et `<usage>`.
 * La clé rendue est le `tool-use-id` (celui de l'appel Workflow), sinon la
 * première `task-id`. Statut inconnu ou clé absente : null.
 */
export function doneNotice(text: string): { key: string; status: Ending } | null {
  const start = text.indexOf('<task-notification>')
  // Stryker disable next-line ConditionalExpression: sans balise, slice(-1) ne garde qu'un caractère, où aucune balise <status> ne tient : le résultat est null de toute façon.
  if (start < 0) return null
  const head = text.slice(start)
  const word = /<status>([^<]*)<\/status>/.exec(head)?.[1]
  const status = NOTICE_STATUS.get(String(word))
  const key = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(head)?.[1] ?? /<task-id>([^<]+)<\/task-id>/.exec(head)?.[1]
  if (status === undefined || key === undefined) return null
  return { key, status }
}

/** La phase en cours : la dernière commencée qui a encore un agent en cours, sinon la dernière commencée. */
export function currentPhase(w: Workflow): string | null {
  const started: string[] = []
  for (const a of w.agents) if (a.phase !== null && !started.includes(a.phase)) started.push(a.phase)
  const running = started.findLast((phase) => w.agents.some((a) => a.phase === phase && a.state === 'en-cours'))
  return running ?? started.at(-1) ?? null
}

/** Les workflows qui tournent : en cours, ou lancés à distance. */
export function active(list: Workflow[]): Workflow[] {
  return list.filter((w) => w.status === 'en-cours' || w.status === 'distant')
}
