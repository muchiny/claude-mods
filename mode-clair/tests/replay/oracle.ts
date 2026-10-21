// Oracle du rejeu : ce que la table de référence (REFERENCE.md) dit qu'un scénario doit montrer,
// tiré des seuls événements. Indépendant du mod : aucun import de hooks/* (tests/dev/oracle-imports
// .test.ts) ; les seules données reprises sont des faits extérieurs au mod, chacun avec sa source
// (table des outils de bridge-mcp, textes du moteur relevés). Chaque branche cite sa ligne `Rxx`.
//
// Vocabulaire commun (`Truth`) : un appel suivi est `{ toolUseId, host, outcome }`, dans l'ordre de
// son début ; un workflow `{ key, done }` ; l'étape Superpowers. `project` ramène l'état du mod à ce
// vocabulaire par la table `OUTCOME` (CallState → outcome), écrite depuis la table des états de
// REFERENCE.md (§5.4) : la comparaison porte sur ce que l'affichage affirme (machine, ✓/✗/○/?).

import type { ToolCallResult } from 'claude-code'

import type { CallState, ClairState, Stage } from '../../types'
import { RECORDED_REFUSALS } from '../pure/engine-texts'
import type { ReplayEvent, Scenario } from './scenarios.generated'

// --- Vocabulaire ----------------------------------------------------------------------------------

export type Outcome = 'succes' | 'echec' | 'refus' | 'interrompu' | 'attente' | 'inconnu'
export type Truth = {
  calls: { toolUseId: string; host: string | null; outcome: Outcome }[]
  workflows: { key: string; done: boolean }[]
  stage: Stage | null
}

/**
 * Événements que les transcripts n'ont pas (scénarios synthétiques) : refus de permission sur un
 * tool_use_id, formulaire de confirmation et sa réponse, `/clear` suivi d'une reprise.
 */
export type ExtraEvent =
  | { t: number; kind: 'permission.denied'; toolUseId: string; tool: string; input: unknown }
  | { t: number; kind: 'elicitation'; server: string; message: string }
  | {
      t: number
      kind: 'elicitation.result'
      server: string
      action: 'accept' | 'decline' | 'cancel'
      confirm?: boolean
    }
  | { t: number; kind: 'clear' }
export type AnyEvent = ReplayEvent | ExtraEvent
export type AnyScenario = Omit<Scenario, 'events'> & { events: AnyEvent[] }

/**
 * CallState → outcome, depuis la table des états (REFERENCE.md, Conventions) : `✓` (fait, code N)
 * → succes ; `✗` (tous les états d'erreur et d'attention) → echec ; `○` refusé par Claude Code et
 * décliné → refus, interrompu → interrompu ; `?` incertain → inconnu ; `●` en cours → attente.
 */
export const OUTCOME: Readonly<Record<CallState, Outcome>> = {
  'en-cours': 'attente',
  fait: 'succes',
  code: 'succes',
  injoignable: 'echec',
  'machine-inconnue': 'echec',
  refuse: 'echec',
  limite: 'echec',
  'confirmation-impossible': 'echec',
  'confirmation-manquante': 'echec',
  'echec-machine': 'echec',
  echec: 'echec',
  'acces-refuse': 'echec',
  'delai-depasse': 'echec',
  'erreur-usage': 'echec',
  'erreur-config': 'echec',
  'refuse-claude': 'refus',
  decline: 'refus',
  interrompu: 'interrompu',
  incertain: 'inconnu',
}

/** Statuts de workflow terminés (R78) : fini, échec, arrêté ; `sans-nouvelles` n'est pas une fin (R79). */
const WORKFLOW_DONE = new Set(['fini', 'echec', 'arrete'])

/**
 * L'état du mod dans le vocabulaire de l'oracle. Un appel `machine inconnue` n'affirme aucune
 * machine (R29, R41, R69, D10) : sa machine vaut null. Sans état écrit : rien.
 */
export function project(state: ClairState | undefined): Truth {
  if (state === undefined) return { calls: [], workflows: [], stage: null }
  return {
    calls: state.calls.map((c) => ({
      toolUseId: c.toolUseId,
      host: c.state === 'machine-inconnue' ? null : c.host,
      outcome: OUTCOME[c.state],
    })),
    workflows: state.workflows.map((w) => ({ key: w.key, done: WORKFLOW_DONE.has(w.status) })),
    stage: state.superpowers?.stage ?? null,
  }
}

// --- Faits extérieurs au mod ----------------------------------------------------------------------

/**
 * Table des outils de bridge-mcp 3.0.0 (rev 70147fe), sortie de `bridge-mcp --json list-tools` avec
 * tous les groupes (spec §5.1 « Table des outils ») : seules les propriétés dont l'oracle a besoin.
 * Outils sans `host` ni `hosts` dans leur inputSchema, plus l'exception `ssh_history` (R12).
 */
const HOSTLESS: ReadonlySet<string> = new Set(
  (
    'ssh_awx_activity ssh_awx_adhoc_launch ssh_awx_approval_approve ssh_awx_approval_deny ssh_awx_approval_detail ' +
    'ssh_awx_approvals ssh_awx_bulk_launch ssh_awx_credentials ssh_awx_host_create ssh_awx_host_update ' +
    'ssh_awx_inventories ssh_awx_inventory_groups ssh_awx_inventory_hosts ssh_awx_inventory_source_sync ' +
    'ssh_awx_inventory_sources ssh_awx_job_cancel ssh_awx_job_event_detail ssh_awx_job_events ssh_awx_job_follow ' +
    'ssh_awx_job_launch ssh_awx_job_relaunch ssh_awx_job_status ssh_awx_job_stdout ssh_awx_job_summary ssh_awx_jobs ' +
    'ssh_awx_project_sync ssh_awx_project_update_status ssh_awx_project_update_stdout ssh_awx_projects ' +
    'ssh_awx_resolve ssh_awx_schedule_set ssh_awx_schedules ssh_awx_status ssh_awx_template_detail ' +
    'ssh_awx_templates ssh_awx_workflow_approvals ssh_awx_workflow_cancel ssh_awx_workflow_failed_nodes ' +
    'ssh_awx_workflow_launch ssh_awx_workflow_nodes ssh_awx_workflow_relaunch ssh_awx_workflow_status ' +
    'ssh_awx_workflow_templates ssh_config_get ssh_config_set ssh_health ssh_history ssh_output_fetch ' +
    'ssh_recording_list ssh_recording_replay ssh_recording_stop ssh_recording_verify ssh_runbook_list ' +
    'ssh_runbook_validate ssh_session_close ssh_session_list ssh_status ssh_tunnel_close ssh_tunnel_list'
  ).split(' '),
)
/** Propriété `hosts` (tableau d'alias) : une rangée par hôte (R13). */
const MULTI: ReadonlySet<string> = new Set(['ssh_exec_multi', 'ssh_metrics_multi'])
/** Hôte tiré de la session (R15, R16). */
const SESSION_TOOLS: ReadonlySet<string> = new Set(['ssh_session_exec'])
/** `freeCommand` : code distant sans `is_error` (spec §5.1 ; R33, R40). */
const FREE_COMMAND: ReadonlySet<string> = new Set(['ssh_exec', 'ssh_exec_multi', 'ssh_session_exec'])
/** Méta-outils du mode progressif, jamais comptés (R04). */
const META_TOOLS: ReadonlySet<string> = new Set([
  'mcp_list_tool_groups',
  'mcp_search_tools',
  'mcp_describe_tool',
  'mcp_call_tool',
])
/** Serveurs MCP du bridge (spec §5.1 « Reconnaissance MCP ») ; une sous-chaîne ne compte pas (R02). */
const BRIDGE_SERVERS: ReadonlySet<string> = new Set(['ssh-bridge', 'bridge-mcp', 'mcp-ssh-bridge'])
/** Sous-commandes CLI comptées comme appels sur leur hôte (R05) ; toute autre est locale (R04). */
const COUNTED_SUBCOMMANDS: ReadonlySet<string> = new Set(['tool', 't', 'exec', 'upload', 'download'])
/** Options globales de la CLI qui prennent une valeur (bridge-mcp src/cli/mod.rs:71-135). */
const VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '-c',
  '--config',
  '--jq',
  '--columns',
  '--limit',
  '--output-format',
])
/** Marques du drapeau tronqué (R51 ; bridge-mcp src/domain/output_truncator.rs, moteur engine-texts.ts:22). */
const TRUNCATION = ['output_id="', '--- [truncated: ', '[output stopped at the', '<persisted-output>']
/** Début des textes de refus du moteur (moteur, `engine-texts.ts`) : leur première phrase. */
const REFUSAL_HEADS: readonly string[] = RECORDED_REFUSALS.map((t) => t.split('. ')[0] ?? t)

/**
 * Table des textes du bridge (spec §5.1, REFERENCE R35-R50), réduite à ce que l'affichage affirme :
 * décliné → refus (R44) ; annulé par le client → interrompu (R50) ; hôte inconnu → échec sans
 * machine (R29, R41) ; tout le reste de la table → échec.
 */
const DECLINE_TEXTS = ['User declined', 'User cancelled']
const CANCELLED_TEXTS = ['Request cancelled by client']
const UNKNOWN_HOST_TEXTS = ['Unknown host']
/** Le reste de la table, chaque motif avec la ligne qui le porte : tous rendent échec. */
const FAILURE_TEXTS: readonly [string, string][] = [
  ['Command denied', 'R42'],
  ['Rate limit exceeded for host', 'R36'],
  ['Unknown argument', 'R43'],
  ['was not granted', 'R45'],
  ['cannot be confirmed', 'R45'],
  ['did not declare the', 'R45'],
  ['Could not build a confirmation prompt', 'R45'],
  ['SSH authentication failed', 'R48'],
  ['SSH host key mismatch', 'R48'],
  ['SSH host key unknown', 'R48'],
  ['SSH command timeout', 'R49'],
  ['WinRM HTTP error: error sending request', 'R35'],
  ['error trying to connect', 'R35'],
  ['tcp connect error', 'R35'],
  ['Connection refused', 'R35'],
  ['No route to host', 'R35'],
  ['dns error', 'R35'],
  ['failed to lookup address', 'R35'],
  ['SSH connection failed', 'R35'],
  ['WinRM auth failed', 'R35'],
]

// --- Lecture des textes ---------------------------------------------------------------------------

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g')
/** Ligne de journal de la CLI (stderr horodaté, faits §0.1). */
const LOG_LINE = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\b/

/** Lignes utiles : couleurs retirées, `Exit code N` de tête, journal et lignes vides sautés (§5.1 Classement). */
function usefulLines(text: string): string[] {
  const lines = text.replace(ANSI, '').split('\n')
  if (/^Exit code \d+$/.test(lines[0]?.trim() ?? '')) lines.shift()
  return lines.map((l) => l.trim()).filter((l) => l !== '' && !LOG_LINE.test(l))
}

/** Première ligne utile, sans le préfixe `Error: ` de la CLI (bridge-mcp src/main.rs:194). */
function firstLine(text: string): string {
  return (usefulLines(text)[0] ?? '').replace(/^Error: /, '')
}

type Verdict = { outcome: Outcome; hostless?: true }

/** Table des textes appliquée à la première ligne (R35-R50) ; null : hors table. */
function textTable(line: string, hit: Hit): Verdict | null {
  const has = (list: string[]) => list.some((m) => line.includes(m))
  if (has(DECLINE_TEXTS)) return tag(hit, 'R44', { outcome: 'refus' })
  if (has(CANCELLED_TEXTS)) return tag(hit, 'R50', { outcome: 'interrompu' })
  if (has(UNKNOWN_HOST_TEXTS)) return tag(hit, 'R41', { outcome: 'echec', hostless: true })
  const row = FAILURE_TEXTS.find(([m]) => line.includes(m))
  if (row !== undefined) return tag(hit, row[1], { outcome: 'echec' })
  return null
}

/** Refus du moteur : texte de refus du dialogue ou du classifieur en première ligne (R22). */
function refusedByEngine(text: string): boolean {
  const first = usefulLines(text)[0] ?? ''
  return REFUSAL_HEADS.some((h) => first.startsWith(h))
}

const textOf = (r: ToolCallResult): string => (typeof r.text === 'string' ? r.text : '')

// --- Reconnaissance -------------------------------------------------------------------------------

/** Un appel reconnu au début de son tool.call : une rangée (segment, ou hôte d'un outil multi). */
type Parsed = {
  via: 'cli' | 'mcp'
  tool: string
  host: string | null
  sub: string // sous-commande CLI ('mcp' pour MCP)
  ownsExit: boolean // R17 : reçoit le code de sortie et le texte
  inLoop: boolean // R18
  json: boolean // R19
  multi: boolean // R13 : outil multi, classé par élément de `results`
  multiHost: string | null // l'hôte dont l'élément de `results` décide (null : aucun hôte lisible)
}

/** Machine d'une valeur d'argument : une valeur qui commence par `$` n'est pas affirmée (R11). */
function hostValue(v: unknown, hit: Hit): string | null {
  if (typeof v !== 'string' || v === '') return null
  if (v.startsWith('$')) return tag(hit, 'R11', null)
  return v
}

function rowsFor(
  via: 'cli' | 'mcp',
  tool: string,
  args: Record<string, unknown>,
  sessions: Map<string, string>,
  base: Omit<Parsed, 'via' | 'tool' | 'host' | 'multi' | 'multiHost'>,
  hit: Hit,
): Parsed[] {
  if (META_TOOLS.has(tool)) return tag(hit, 'R04', [])
  if (HOSTLESS.has(tool)) return tag(hit, 'R12', [])
  if (MULTI.has(tool)) {
    // R13 : une rangée par hôte de `hosts`.
    // La CLI lit un argument tableau comme du JSON (bridge-mcp src/cli/runner.rs:2312) : `hosts='["a","b"]'`.
    let raw = args.hosts
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        raw = undefined
      }
    }
    const hosts = Array.isArray(raw) ? raw : []
    if (hosts.length > 0) {
      hit('R13')
      return hosts.map((h) => {
        const host = base.inLoop ? null : hostValue(h, hit)
        return { via, tool, host, multi: true, multiHost: host, ...base }
      })
    }
    // hosts illisible : une rangée sans machine, qu'aucun élément de `results` ne peut prouver.
    return [{ via, tool, host: null, multi: true, multiHost: null, ...base }]
  }
  if (SESSION_TOOLS.has(tool)) {
    // R15 : session vue créée ; R16 : sinon machine inconnue.
    const id = args.session_id
    const known = typeof id === 'string' ? sessions.get(id) : undefined
    hit(known === undefined ? 'R16' : 'R15')
    return [{ via, tool, host: base.inLoop ? null : (known ?? null), multi: false, multiHost: null, ...base }]
  }
  hit(via === 'mcp' ? 'R01' : 'R05')
  return [{ via, tool, host: base.inLoop ? null : hostValue(args.host, hit), multi: false, multiHost: null, ...base }]
}

/** R01, R02, R03 : `mcp__<serveur>__<outil>`, préfixe `plugin_<plugin>_` retiré, mode progressif. */
function parseMcp(name: string, input: unknown, sessions: Map<string, string>, hit: Hit): Parsed[] {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  if (m === null) return []
  const server = m[1] as string
  let names = [server]
  const plugin = /^plugin_([^_]+)_(.+)$/.exec(server)
  if (plugin !== null) names = [plugin[1] as string, plugin[2] as string]
  if (!names.some((n) => BRIDGE_SERVERS.has(n))) return tag(hit, 'R02', [])
  let tool = m[2] as string
  let args = (input ?? {}) as Record<string, unknown>
  if (tool === 'mcp_call_tool') {
    if (typeof args.name !== 'string') return []
    hit('R03')
    tool = args.name
    const inner = args.arguments
    args = inner !== null && typeof inner === 'object' ? (inner as Record<string, unknown>) : {}
  }
  const base = { sub: 'mcp', ownsExit: true, inLoop: false, json: false }
  return rowsFor('mcp', tool, args, sessions, base, hit)
}

type Word = { text: string; op?: true }

/** Mots et opérateurs d'une ligne shell, guillemets respectés ; `$(…)` et `` `…` `` restent dans le mot. */
function tokenize(line: string): Word[] {
  const out: Word[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | null = null
  let depth = 0
  const push = () => {
    if (has) out.push({ text: cur })
    cur = ''
    has = false
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string
    const next = line[i + 1]
    if (quote !== null) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && next !== undefined) cur += line[++i]
      else cur += c
      continue
    }
    if (depth > 0) {
      cur += c
      if (c === '(') depth++
      else if (c === ')') depth--
      continue
    }
    if (c === '\\' && next !== undefined) {
      if (next !== '\n') cur += next
      has = true
      i++
    } else if (c === "'" || c === '"') {
      quote = c
      has = true
    } else if (c === '$' && next === '(') {
      cur += '$('
      has = true
      depth = 1
      i++
    } else if (c === '`') {
      const end = line.indexOf('`', i + 1)
      cur += line.slice(i, end < 0 ? line.length : end + 1)
      has = true
      i = end < 0 ? line.length : end
    } else if (c === '#' && !has) {
      while (i + 1 < line.length && line[i + 1] !== '\n') i++
    } else if (c === ' ' || c === '\t') push()
    else if ((c === '&' || c === '|') && next === c) {
      push()
      out.push({ text: c + c, op: true })
      i++
    } else if (c === '&' && (next === '>' || cur.endsWith('>') || cur.endsWith('<'))) {
      cur += c
      has = true
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')') {
      push()
      out.push({ text: c, op: true })
    } else {
      cur += c
      has = true
    }
  }
  push()
  return out
}

/** Retire les redirections (`> f`, `2>&1`, `>/dev/null`, `< f`). */
function dropRedirections(words: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string
    const m = /^\d*(>>|>&|&>|>|<<<|<<|<)(.*)$/.exec(w)
    if (m === null) out.push(w)
    else if (m[2] === '') i++
  }
  return out
}

const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', '{', '}', '!', 'fi', 'esac'])
const LOOPS = new Set(['for', 'while', 'until', 'select'])

/** Préfixes sautés avant le programme : `VAR=val`, `timeout`, `env`, `sudo`, `nice` (R05). */
function skipPrefixes(words: string[]): string[] {
  let i = 0
  for (;;) {
    const w = words[i]
    if (w === undefined) return []
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) i++
    else if (w === 'timeout') {
      i++
      while ((words[i] ?? '').startsWith('-'))
        i += ['-s', '-k', '--signal', '--kill-after'].includes(words[i] as string) ? 2 : 1
      i++ // la durée
    } else if (w === 'env') {
      i++
      while ((words[i] ?? '').startsWith('-')) i += words[i] === '-u' ? 2 : 1
    } else if (w === 'sudo') {
      i++
      while ((words[i] ?? '').startsWith('-')) i += ['-u', '-g', '-C', '-h', '-p'].includes(words[i] as string) ? 2 : 1
    } else if (w === 'nice') {
      i++
      if (words[i] === '-n') i += 2
      else if ((words[i] ?? '').startsWith('-')) i++
    } else return words.slice(i)
  }
}

/** Un segment bridge : sous-commande, outil, arguments ; null s'il n'est pas compté (R04, R06). */
function parseSegment(
  words: string[],
  sessions: Map<string, string>,
  ownsExit: boolean,
  inLoop: boolean,
  hit: Hit,
): Parsed[] | null {
  const [program, ...rest] = skipPrefixes(words)
  if (program === undefined || program.split('/').pop() !== 'bridge-mcp') return null
  let dry = false
  let json = false
  let sub: string | null = null
  const positional: string[] = []
  const args: Record<string, unknown> = {}
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i] as string
    if (w === '--dry-run') dry = true
    else if (w === '--json') json = true
    else if (w === '--json-args') {
      try {
        Object.assign(args, JSON.parse(rest[++i] ?? ''))
      } catch {
        // arguments illisibles : aucune machine
      }
    } else if (VALUE_OPTIONS.has(w)) i++
    else if (w.startsWith('-')) {
      // option sans valeur connue (--yes, -v…) : sautée ; R59 : --yes n'est qu'un accord par option
      if (w === '--yes') hit('R59')
      if (sub === 'exec' && ['-t', '--timeout', '-w', '--working-dir'].includes(w)) i++
    } else if (sub === null) sub = w
    else if ((sub === 'tool' || sub === 't') && positional.length > 0 && /^[A-Za-z_][\w-]*=/.test(w)) {
      const at = w.indexOf('=')
      args[w.slice(0, at)] = w.slice(at + 1)
    } else positional.push(w)
  }
  if (sub === null || !COUNTED_SUBCOMMANDS.has(sub)) return tag(hit, 'R04', null)
  if (dry) return tag(hit, 'R06', null)
  const base = { sub, ownsExit: ownsExit && !inLoop, inLoop, json }
  if (sub === 'tool' || sub === 't') {
    const tool = positional[0]
    if (tool === undefined) return null
    return rowsFor('cli', tool, args, sessions, base, hit)
  }
  // exec, upload, download : hôte en premier argument positionnel (bridge-mcp src/cli/mod.rs:164-301).
  hit('R05')
  return [
    {
      via: 'cli',
      tool: sub,
      host: inLoop ? null : hostValue(positional[0], hit),
      multi: false,
      multiHost: null,
      ...base,
    },
  ]
}

/**
 * R05, R07, R17, R18 : la ligne découpée sur `&&`, `||`, `;`, `|`, `&`, retours à la ligne et
 * parenthèses ; seule la dernière commande simple reçoit le code de sortie ; dans une boucle :
 * incertain sur machine inconnue. `bash -c '…'` n'est pas analysé (le programme est `bash`).
 */
function parseCli(command: string, sessions: Map<string, string>, hit: Hit): Parsed[] {
  const segments: { words: string[]; inLoop: boolean; background: boolean }[] = []
  let words: string[] = []
  let loop = 0
  const close = (op: string | null) => {
    let ws = dropRedirections(words)
    words = []
    let inLoop = loop > 0
    for (;;) {
      const head = ws[0]
      if (head === undefined) break
      if (LOOPS.has(head)) {
        loop++
        inLoop = true
        // l'en-tête `for x in …` n'est pas une commande ; la condition de `while` en est une
        ws = head === 'for' || head === 'select' ? [] : ws.slice(1)
      } else if (head === 'done') {
        loop = Math.max(0, loop - 1)
        ws = ws.slice(1)
      } else if (KEYWORDS.has(head)) ws = ws.slice(1)
      else break
    }
    if (ws.length > 0) segments.push({ words: ws, inLoop, background: op === '&' })
  }
  for (const w of tokenize(command)) {
    if (w.op) close(w.text)
    else words.push(w.text)
  }
  close(null)
  const out: Parsed[] = []
  segments.forEach((s, i) => {
    const last = i === segments.length - 1 && !s.background
    // R07 : `bash -c '…'` (ou `sh -c`) n'est pas analysé : son programme n'est pas bridge-mcp.
    const prog = skipPrefixes(s.words)
    if (['bash', 'sh'].includes(prog[0] ?? '') && prog.includes('-c') && prog.some((w) => w.includes('bridge-mcp')))
      hit('R07')
    const rows = parseSegment(s.words, sessions, last, s.inLoop, hit)
    if (rows === null) return
    if (s.inLoop) hit('R18')
    else if (!last) hit('R17')
    out.push(...rows)
  })
  return out
}

// --- Classement -----------------------------------------------------------------------------------

/** Texte d'un appel CLI `--json` : `content[].text` du JSON (R19), sinon le texte tel quel. */
function jsonText(text: string, hit: Hit): string {
  const body = usefulLines(text).join('\n')
  try {
    const v = JSON.parse(body) as { content?: { text?: unknown }[] }
    if (Array.isArray(v.content)) {
      hit('R19')
      return v.content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n')
    }
  } catch {
    // pas du JSON : le texte reste
  }
  return text
}

/** Classement d'une rangée terminée (spec §5.1 Classement, R22-R52). */
function classify(p: Parsed, r: ToolCallResult, hit: Hit): Verdict {
  const text = textOf(r)
  const isError = r.isError === true
  // R51 : le drapeau tronqué ne change pas l'état principal (aucune branche ne le lit).
  if (TRUNCATION.some((m) => text.includes(m))) hit('R51')
  // R47 : un motif de la table hors de la première ligne utile ne décide rien.
  if (
    usefulLines(text)
      .slice(1)
      .some((l) => textTable(l, () => {}) !== null)
  )
    hit('R47')
  // R22 : refus du moteur (dialogue, classifieur) lu sur son texte.
  if (isError && refusedByEngine(text)) return tag(hit, 'R22', { outcome: 'refus' })
  // R23 : le résultat Bash se dit interrompu (`interrupted`, dev/claude-code.d.ts:21147-21148).
  const inner = r.result as { interrupted?: unknown } | null | undefined
  if (inner !== null && typeof inner === 'object' && inner.interrupted === true)
    return tag(hit, 'R23', { outcome: 'interrompu' })
  if (p.via === 'cli') {
    // R17 : un segment qui n'est pas la dernière commande simple n'a pas de preuve.
    if (!p.ownsExit) return tag(hit, 'R52', { outcome: 'inconnu' })
    // Sortie : l'en-tête `Exit code N` de Bash ; sans lui, isError prouve un échec (R46 : sortie non nulle).
    const header = /^Exit code (\d+)$/m.exec(text.split('\n')[0] ?? '')
    const code = header !== null ? Number(header[1]) : isError ? 1 : 0
    const body = p.json ? jsonText(text, hit) : text
    const first = firstLine(body)
    // R52 : bridge-mcp ne sort qu'avec 0 à 6 ; un autre code vient d'un enrobage (arbitrage Q2).
    const foreign = code > 6
    if (p.sub === 'exec') {
      // R38 : bloc `Exit code: N` : code distant ; sortie 0 sans bloc : fait (Q3) ; sinon table des textes, ou échec.
      hit('R38')
      if (usefulLines(body).some((l) => /^Exit code: \d+$/.test(l))) return { outcome: 'succes' }
      if (code === 0) return { outcome: 'succes' }
      if (foreign) return tag(hit, 'R52', { outcome: 'inconnu' })
      return textTable(first, hit) ?? { outcome: 'echec' }
    }
    if (p.multi) {
      // R13 : chaque hôte sur son propre élément de `results` ; sans élément, sortie 0 ou 6 : incertain (D11).
      // Non spécifié (question ouverte, REFERENCE R13) : sous un code hors de 0 à 6, l'élément propre de l'hôte
      // l'emporte sur la règle du code étranger (R52), comme le fait le mod.
      const v = classifyHost(p, usefulLines(body).join('\n'), hit)
      if (v !== null) return v
      if (code === 0 || code === 6) return tag(hit, 'R52', { outcome: 'inconnu' })
    }
    if (foreign) return tag(hit, 'R52', { outcome: 'inconnu' })
    if (p.sub === 'upload' || p.sub === 'download')
      return code === 0 ? { outcome: 'succes' } : (textTable(first, hit) ?? { outcome: 'echec' })
    switch (code) {
      case 0:
        return tag(hit, 'R26', { outcome: 'succes' })
      case 2:
        return tag(hit, 'R27', { outcome: 'echec' })
      case 5:
        return tag(hit, 'R28', { outcome: 'echec' })
      case 3:
        if (first.includes('Unknown host')) return tag(hit, 'R29', { outcome: 'echec', hostless: true })
        return tag(hit, 'R30', { outcome: 'echec' })
      case 4:
        return tag(hit, first.includes('--yes') ? 'R32' : 'R31', { outcome: 'echec' })
      case 6:
        if (FREE_COMMAND.has(p.tool) && /^\[exit:\d+\]/.test(first)) return tag(hit, 'R33', { outcome: 'succes' })
        return tag(hit, 'R34', { outcome: 'echec' })
      default: {
        // Sortie 1 : table des textes (R35, R36), sinon échec (R37).
        const v = textTable(first, hit)
        if (v !== null) return v
        return tag(hit, 'R37', { outcome: 'echec' })
      }
    }
  }
  if (p.multi && !isError) {
    // R13 : sans élément pour cet hôte : incertain (D11).
    return classifyHost(p, text, hit) ?? tag(hit, 'R52', { outcome: 'inconnu' })
  }
  const first = firstLine(text)
  if (isError) {
    // R39 : `[exit:N]` en isError : la commande a tourné, échec sur la machine.
    if (/^\[exit:\d+\]/.test(first)) return tag(hit, 'R39', { outcome: 'echec' })
    if (first.includes('Unknown hosts')) return tag(hit, 'R14', { outcome: 'echec', hostless: true })
    const v = textTable(first, hit)
    if (v !== null) return v
    // R46 : hors table, texte vide compris (arbitrage Q1) : isError prouve l'échec.
    return tag(hit, 'R46', { outcome: 'echec' })
  }
  // R40 : `[exit:N]` sans isError : code N, neutre ; R25 : sinon fait, texte vide compris (arbitrage Q1).
  if (/^\[exit:[1-9]\d*\]/.test(first)) hit('R40')
  hit('R25')
  return { outcome: 'succes' }
}

/** R13 : un hôte d'un outil multi classé sur son propre élément de `results` ; null : pas d'élément pour lui. */
function classifyHost(p: Parsed, text: string, hit: Hit): Verdict | null {
  let results: unknown[] = []
  try {
    const v = JSON.parse(text) as { results?: unknown }
    if (Array.isArray(v.results)) results = v.results
  } catch {
    // sortie illisible : aucun élément
  }
  const el = results.find(
    (x): x is { host: string; success?: unknown; error?: unknown; exit_code?: unknown } =>
      x !== null && typeof x === 'object' && (x as { host?: unknown }).host === p.multiHost,
  )
  if (el === undefined) return null
  hit('R13')
  if (el.success === true) return { outcome: 'succes' }
  if (typeof el.error === 'string') return textTable(el.error, hit) ?? { outcome: 'echec' }
  if (typeof el.exit_code === 'number' && FREE_COMMAND.has(p.tool)) return { outcome: 'succes' }
  return { outcome: 'echec' }
}

// --- Le déroulé -----------------------------------------------------------------------------------

type Hit = (rule: string) => void

/** Note la ligne `rule` qui décide, puis rend `value`. */
function tag<T>(hit: Hit, rule: string, value: T): T {
  hit(rule)
  return value
}

type Row = {
  toolUseId: string
  agentId: string | undefined
  parsed: Parsed
  host: string | null
  outcome: Outcome
  locked: boolean // refusé par Claude Code (R22) : le résultat ne le change plus
}

type Pending = { at: number; seq: number; e: Extract<AnyEvent, { kind: 'tool.call' }>; rows: Row[] }

const SKILL_STAGE: Readonly<Record<string, Stage>> = {
  brainstorming: 'cadrage', // R83
  'writing-plans': 'plan', // R85
  'subagent-driven-development': 'taches', // R86
  'executing-plans': 'taches', // R86, R87
  'requesting-code-review': 'relecture', // R88
  'finishing-a-development-branch': 'fin', // R89 : la bande n'en montre rien
}

/** Le déroulé d'un scénario ; `hit` reçoit chaque ligne de REFERENCE.md qui a décidé. */
function run(s: AnyScenario, hit: Hit): Truth {
  const rows: Row[] = []
  const sessions = new Map<string, string>()
  const workflows: { key: string; toolUseId: string; taskId: string | null; done: boolean }[] = []
  let stage: Stage | null = null
  const pending: Pending[] = []
  let seq = 0
  let now = 0

  const end = (p: Pending) => {
    const { e } = p
    const r = e.result
    const inner = (r.result ?? null) as Record<string, unknown> | null
    switch (e.tool) {
      case 'Skill': {
        if (r.isError === true) return
        const input = e.input as { skill?: unknown }
        const name = typeof input.skill === 'string' ? input.skill : ''
        const m = /^(?:superpowers:)?([\w-]+)$/.exec(name)
        const next = m === null ? undefined : SKILL_STAGE[m[1] as string]
        if (next === undefined) {
          if (name.startsWith('superpowers:')) hit('R90')
          return
        }
        const rule: Record<Stage, string> = {
          cadrage: 'R83',
          spec: 'R84',
          plan: 'R85',
          taches: m?.[1] === 'executing-plans' ? 'R87' : 'R86',
          relecture: 'R88',
          fin: 'R89',
        }
        hit(rule[next])
        stage = next
        return
      }
      case 'Write':
      case 'Edit': {
        if (r.isError === true) return
        const path = (e.input as { file_path?: unknown }).file_path
        if (typeof path !== 'string' || !path.includes('docs/superpowers/')) return
        // R91 : sans état, rien ; R84 : sous specs/ pendant le cadrage → spec.
        if (stage === null) return hit('R91')
        if (stage === 'cadrage' && path.includes('docs/superpowers/specs/')) {
          hit('R84')
          stage = 'spec'
        }
        return
      }
      case 'Workflow': {
        // R75 : résultat en erreur → aucun workflow.
        if (r.isError === true || r.deny !== undefined || inner === null || inner.error !== undefined) return hit('R75')
        const key = typeof inner.runId === 'string' ? inner.runId : inner.taskId
        if (typeof key !== 'string') return
        hit(inner.status === 'remote_launched' ? 'R80' : 'R74')
        const taskId = typeof inner.taskId === 'string' ? inner.taskId : null
        const at = workflows.findIndex((w) => w.key === key)
        const w = { key, toolUseId: e.toolUseId, taskId, done: false }
        if (at >= 0) workflows[at] = w
        else workflows.push(w)
        if (workflows.length > 1) hit('R82')
        return
      }
    }
    // Appels bridge.
    if (inner !== null && typeof inner.backgroundTaskId === 'string') {
      // R08 : passé en arrière-plan : l'appel est retiré.
      hit('R08')
      for (const row of p.rows) rows.splice(rows.indexOf(row), 1)
      return
    }
    for (const row of p.rows) {
      if (row.locked) continue
      const v = classify(row.parsed, r, hit)
      row.outcome = v.outcome
      if (v.hostless) row.host = null
    }
    // R15 : une session créée donne sa machine aux appels qui la citent.
    const created = p.rows[0]
    if (created?.parsed.tool === 'ssh_session_create' && r.isError !== true) {
      try {
        const info = JSON.parse(textOf(r)) as { id?: unknown; host?: unknown }
        if (typeof info.id === 'string' && typeof info.host === 'string') sessions.set(info.id, info.host)
      } catch {
        // SessionInfo illisible : aucune session
      }
    }
  }

  const flush = (until: number) => {
    for (;;) {
      const due = pending.filter((p) => p.at <= until).sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (due === undefined) return
      pending.splice(pending.indexOf(due), 1)
      end(due)
    }
  }

  const start = (e: Extract<AnyEvent, { kind: 'tool.call' }>) => {
    let parsed: Parsed[] = []
    if (e.tool === 'Bash') {
      const input = e.input as { command?: unknown; run_in_background?: unknown }
      // R08 : lancé en arrière-plan : rien.
      if (input.run_in_background === true) hit('R08')
      else if (typeof input.command === 'string') parsed = parseCli(input.command, sessions, hit)
    } else if (e.tool.startsWith('mcp__')) parsed = parseMcp(e.tool, e.input, sessions, hit)
    else if (e.tool === 'Agent' && stage !== null) {
      // R88 : relecture finale par la description ou le prompt d'un Agent (R86 : la tâche courante ne change pas l'étape).
      const input = e.input as { description?: unknown; prompt?: unknown }
      const d = typeof input.description === 'string' ? input.description : ''
      const pr = typeof input.prompt === 'string' ? input.prompt : ''
      if (/final (code )?review/i.test(d) || pr.includes('code-reviewer.md')) {
        hit('R88')
        stage = 'relecture'
      }
    }
    let mine: Row[] = []
    if (parsed.length > 0) {
      if (rows.some((r) => r.toolUseId === e.toolUseId)) {
        // Review Focus 5 : un tool_use_id déjà vu ne fait pas un second appel.
        hit('R52')
      } else {
        hit('R20')
        mine = parsed.map((parsed) => ({
          toolUseId: e.toolUseId,
          agentId: e.agentId,
          parsed,
          host: parsed.host,
          outcome: 'attente',
          locked: false,
        }))
        rows.push(...mine)
      }
    }
    pending.push({ at: now + e.afterMs, seq: seq++, e, rows: mine })
  }

  for (const e of s.events) {
    now = Math.max(now, e.t)
    flush(now)
    switch (e.kind) {
      case 'tool.call':
        start(e)
        break
      case 'turn.complete':
        // R24 : les appels encore en cours de cette boucle (même agentId) sont interrompus ; filet seulement :
        // un résultat arrivé ensuite décide (oracleNote de synth-fin-de-boucle).
        for (const r of rows)
          if (r.agentId === e.agentId && r.outcome === 'attente' && !r.locked) {
            hit('R24')
            r.outcome = 'interrompu'
          }
        break
      case 'permission.denied':
        // R22 : refus de Claude Code sur le tool_use_id d'un appel suivi ; un id jamais vu : rien.
        for (const r of rows)
          if (r.toolUseId === e.toolUseId) {
            hit('R22')
            r.outcome = 'refus'
            r.locked = true
          }
        break
      case 'session.append': {
        // R78, R80 : notification de fin d'une tâche : le workflow qu'elle nomme est fini.
        const status = /<status>([^<]*)<\/status>/.exec(e.text)?.[1]
        const taskId = /<task-id>([^<]*)<\/task-id>/.exec(e.text)?.[1]
        const toolUseId = /<tool-use-id>([^<]*)<\/tool-use-id>/.exec(e.text)?.[1]
        if (status === undefined || !['completed', 'failed', 'killed', 'stopped'].includes(status)) break
        for (const w of workflows)
          if ((toolUseId !== undefined && w.toolUseId === toolUseId) || (taskId !== undefined && w.taskId === taskId)) {
            hit('R78')
            w.done = true
          }
        break
      }
      // Formulaire, réponse et /clear : rien de ce que `Truth` compare (R54-R58 : « à toi » et accord).
      case 'elicitation':
        hit('R54')
        break
      case 'elicitation.result':
        hit('R56')
        break
      case 'clear':
        break
    }
    flush(now)
  }
  flush(Number.POSITIVE_INFINITY)
  return {
    calls: rows.map((r) => ({ toolUseId: r.toolUseId, host: r.host, outcome: r.outcome })),
    workflows: workflows.map((w) => ({ key: w.key, done: w.done })),
    stage,
  }
}

/** La vérité d'un scénario selon REFERENCE.md. */
export function truthOf(s: AnyScenario): Truth {
  return run(s, () => {})
}

/** Les lignes de REFERENCE.md qui ont décidé dans ce scénario (tableau de couverture). */
export function rulesOf(s: AnyScenario): Set<string> {
  const rules = new Set<string>()
  run(s, (r) => rules.add(r))
  return rules
}
