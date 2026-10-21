// Anonymiseur des scénarios de rejeu (spec vérif. §5.1, D9). Module pur : aucune entrée-sortie,
// déterministe pour un dictionnaire neuf. Principe de liste blanche : toute chaîne qui n'est pas
// d'une forme connue est remplacée par du lorem de même largeur en cellules ; ce qui est gardé est
// ce que le mod interprète (structure d'une commande bridge, code de sortie, lignes de journal,
// textes connus du bridge et du moteur, titres de plan, bloc meta d'un workflow).
//
// Les motifs des textes du bridge sont recopiés ici depuis mode-clair/tests/replay/REFERENCE.md et
// les sources de bridge-mcp, jamais importés de mode-clair/hooks/ (l'anonymiseur ne dépend pas du mod).
//
// Deux barrières, indépendantes de l'anonymiseur : assertClean (liste noire, chemins personnels,
// adresses, jetons) et assertKnownForms (chaque mot de chaque champ est d'un vocabulaire connu ou
// du lorem). Leurs messages ne recopient jamais la chaîne trouvée.

import type { ToolCallResult } from 'claude-code'
import { RECORDED_REFUSALS } from '../../mode-clair/tests/pure/engine-texts'
import type { ReplayEvent, Scenario } from '../../mode-clair/tests/replay/scenarios.generated'

// --- Types -------------------------------------------------------------------------------------

/** Appel tel que lu dans le transcript : horodatages absolus (ms), valeurs réelles. */
export type RawToolCall = {
  kind: 'tool.call'
  at: number
  doneAt: number
  tool: string
  toolUseId: string
  agentId?: string
  input: unknown
  result: ToolCallResult
}
export type RawEvent =
  | RawToolCall
  | { kind: 'turn.complete'; at: number; agentId?: string }
  | { kind: 'session.append'; at: number; text: string }
export type RawScenario = { id: string; events: RawEvent[]; files: Record<string, string> }

/** Correspondances réelles → synthétiques, construites pour un seul scénario. */
export type Dict = {
  hosts: Map<string, string>
  ids: Map<string, string>
  counters: Map<string, number>
  uuids: Map<string, string>
  labels: Map<string, string>
  components: Map<string, string>
}

export function newDict(): Dict {
  return {
    hosts: new Map(),
    ids: new Map(),
    counters: new Map(),
    uuids: new Map(),
    labels: new Map(),
    components: new Map(),
  }
}

// --- Lorem -------------------------------------------------------------------------------------

/** Flux de lettres du lorem ; sans « sk », « xox », « ghp » ni « akia » (motifs de jetons). */
const LOREM = 'loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmodtemporincididuntutlaboreetdoloremagnaaliqua'
/** Plus longue suite de lignes libres gardée (le corps d'une sortie ne décide rien, REFERENCE §R47). */
const MAX_FREE_LINES = 40
/** Plus longue ligne libre gardée, en caractères. */
const MAX_LINE = 400
/** Séquence CSI (couleurs) : gardée telle quelle dans le lorem, retirée avant la lecture d'un motif. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) ouvre les séquences, c'est voulu
const CSI = /(\x1b\[[0-?]*[ -/]*[@-~])/
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) ouvre les séquences, c'est voulu
const CSI_ALL = /\x1b\[[0-?]*[ -/]*[@-~]/g
/** Séquence OSC (lien hypertexte : peut porter une URL) : retirée. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) et BEL (0x07) bornent la séquence, c'est voulu
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

/**
 * Lorem de même largeur en cellules : chaque lettre ou chiffre ASCII (et `@`) devient une lettre du
 * flux, le reste (espaces, ponctuation, caractères non ASCII, séquences CSI) est gardé à sa place.
 */
export function lorem(text: string, offset = 0): string {
  let i = offset
  return text
    .replace(OSC, '')
    .split(CSI)
    .map((part, k) => (k % 2 === 1 ? part : part.replace(/[A-Za-z0-9@]/g, () => LOREM[i++ % LOREM.length] as string)))
    .join('')
}

/** Lorem sans ponctuation d'ASCII (remplacée par `-`) : sûr entre guillemets d'un script. */
function loremLabel(text: string, offset: number): string {
  return lorem(text, offset).replace(/[!-,/:-@[-^`{-~]/g, '-')
}

/** Garde les morceaux qui correspondent à l'un des motifs (drapeau g), lorem pour le reste. */
function loremExcept(text: string, keeps: readonly RegExp[]): string {
  const spans: [number, number][] = []
  for (const re of keeps) for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length])
  spans.sort((a, b) => a[0] - b[0])
  let out = ''
  let at = 0
  for (const [from, to] of spans) {
    if (from < at) continue
    out += lorem(text.slice(at, from)) + text.slice(from, to)
    at = to
  }
  return out + lorem(text.slice(at))
}

// --- Dictionnaire ------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function letters(n: number): string {
  return n < 26 ? String.fromCharCode(97 + n) : letters(Math.floor(n / 26) - 1) + letters(n % 26)
}

function count(dict: Dict, key: string): number {
  const n = (dict.counters.get(key) ?? 0) + 1
  dict.counters.set(key, n)
  return n
}

/** Machine → host-a, host-b… dans l'ordre d'apparition ; `$VAR` reste une variable (machine non affirmée). */
export function hostOf(dict: Dict, real: string): string {
  if (real === '') return ''
  if (real.startsWith('$')) return `$${lorem(real.slice(1))}`
  const known = dict.hosts.get(real)
  if (known !== undefined) return known
  const synthetic = `host-${letters(dict.hosts.size)}`
  dict.hosts.set(real, synthetic)
  return synthetic
}

function uuidOf(dict: Dict, real: string): string {
  const key = real.toLowerCase()
  const known = dict.uuids.get(key)
  if (known !== undefined) return known
  const synthetic = `00000000-0000-4000-8000-${String(dict.uuids.size + 1).padStart(12, '0')}`
  dict.uuids.set(key, synthetic)
  return synthetic
}

/** Identifiant → préfixe gardé (`toolu_`, `wf_`…) + `r0001` ; UUID → UUID synthétique. */
export function idOf(dict: Dict, real: string): string {
  if (real === '') return ''
  if (UUID.test(real)) return uuidOf(dict, real)
  const known = dict.ids.get(real)
  if (known !== undefined) return known
  const prefix = /^[a-z]{1,8}_/.exec(real)?.[0] ?? 'id_'
  const synthetic = `${prefix}r${String(count(dict, prefix)).padStart(4, '0')}`
  dict.ids.set(real, synthetic)
  return synthetic
}

/** Libellé affiché (nom de workflow, phase, étiquette) : lorem distinct par libellé distinct. */
function labelOf(dict: Dict, real: string): string {
  const known = dict.labels.get(real)
  if (known !== undefined) return known
  const synthetic = loremLabel(real, dict.labels.size * 7)
  dict.labels.set(real, synthetic)
  return synthetic
}

// --- Chemins -----------------------------------------------------------------------------------

/** Composants de chemin gardés : structure, jamais un nom choisi par l'utilisateur. */
const STRUCT = new Set([
  'home',
  'user',
  'var',
  'tmp',
  'etc',
  'usr',
  'bin',
  'opt',
  'log',
  'srv',
  'proc',
  'dev',
  'mnt',
  'root',
  '.claude',
  '.config',
  'projects',
  'subagents',
  'tool-results',
  'tasks',
  'workflows',
  'docs',
  'superpowers',
  'plans',
  'specs',
  'src',
  'tests',
  'target',
  'debug',
  'release',
  'bridge-mcp',
  'mcp-ssh-bridge',
  'claude-mods',
  'mode-clair',
  'hooks',
  'replay',
  'journal',
  'scripts',
  'config',
  'output',
  'outputs',
])
/** Extensions gardées. */
const EXT = new Set([
  'md',
  'jsonl',
  'json',
  'txt',
  'log',
  'output',
  'yaml',
  'yml',
  'toml',
  'js',
  'mjs',
  'ts',
  'tsx',
  'sh',
  'rs',
  'py',
  'html',
  'csv',
])

function componentOf(dict: Dict, c: string, prev: string | undefined): string {
  if (c === '' || c === '.' || c === '..' || c === '~' || c.length <= 2) return c
  if (prev === 'home') return 'user'
  if (STRUCT.has(c)) return c
  if (UUID.test(c)) return uuidOf(dict, c)
  const dot = c.lastIndexOf('.')
  const hasExt = dot > 0 && EXT.has(c.slice(dot + 1))
  const base = hasExt ? c.slice(0, dot) : c
  const ext = hasExt ? c.slice(dot) : ''
  if (STRUCT.has(base) || base.length <= 2) return base + ext
  if (UUID.test(base)) return uuidOf(dict, base) + ext
  const host = dict.hosts.get(base)
  if (host !== undefined) return host + ext
  const id = dict.ids.get(base)
  if (id !== undefined) return id + ext
  // Dossier de projet de Claude Code : -home-<nom>-<projet>.
  const project = /^-home-[^-]+(.*)$/.exec(base)
  if (project !== null) return `-home-user${lorem(String(project[1]))}${ext}`
  const known = dict.components.get(base)
  if (known !== undefined) return known + ext
  const synthetic = lorem(base, dict.components.size * 5)
  dict.components.set(base, synthetic)
  return synthetic + ext
}

/** Chemin : composant par composant ; `/home/<nom>` → `/home/user`. */
export function pathOf(dict: Dict, real: string): string {
  const parts = real.split('/')
  return parts.map((c, i) => componentOf(dict, c, i > 0 ? parts[i - 1] : undefined)).join('/')
}

// --- Textes connus (liste blanche) -------------------------------------------------------------

type Slot = 'host' | 'hosts' | 'n' | 'size' | 'tool' | 'path' | 'id' | 'free' | 'ts' | 'level' | 'sp' | 'user'
type Template = { id: string; re: RegExp; slots: Slot[]; literals: string[] }

const SLOT_RE: Record<Slot, string> = {
  host: '([^\\s:,\'"`@()]+)',
  hosts: '(.+?)',
  n: '(\\d+)',
  size: '([\\d.]+\\s?[KMGT]?i?B)',
  tool: '([A-Za-z0-9_.:-]+)',
  path: '(\\S+)',
  id: '([A-Za-z0-9_-]+)',
  free: '(.*?)',
  ts: '(\\d{4}-\\d{2}-\\d{2}T[\\d:.]+Z)',
  level: '(TRACE|DEBUG|INFO|WARN|ERROR)',
  sp: '(\\s+)',
  user: '([^@\\s]*)',
}

function template(id: string, pattern: string): Template {
  const parts = pattern.split(/\{(\w+)\}/)
  const slots: Slot[] = []
  const literals: string[] = []
  let re = '^'
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      literals.push(part)
      re += part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
    } else {
      slots.push(part as Slot)
      re += SLOT_RE[part as Slot]
    }
  })
  return { id, re: new RegExp(`${re}$`, 's'), slots, literals }
}

/** Textes de bridge-mcp et de Claude Code que le mod lit (REFERENCE.md R27-R52, bridge-mcp/src). */
const TEMPLATES: readonly Template[] = [
  // Bash : code de sortie, bloc de la sous-commande exec, code distant (REFERENCE R26-R40)
  template('exit-code', 'Exit code {n}'),
  template('exec-exit', 'Exit code: {n}'),
  template('exec-host', 'Host: {host}'),
  template('exec-command', 'Command: {free}'),
  template('exit-tag', '[exit:{n}]'),
  template('exit-tag-text', '[exit:{n}] {free}'),
  // Journal tracing de la CLI (stderr, horodaté) : forme gardée, message remplacé
  template('tracing', '{ts}{sp}{level}{sp}{free}'),
  // R32 : barrière destructive sans terminal (bridge-mcp/src/cli/runner.rs:2180-2186)
  template(
    'deny-yes',
    'Command denied: `{tool}` is annotated destructive and stdin is not a terminal, so there is nobody to confirm with. Pass --yes to confirm in advance, or set security.require_elicitation_on_destructive: false to disable this gate entirely.',
  ),
  template('deny-yes-loose', 'Command denied: {free}Pass --yes{free}'),
  // R31, R42 : liste noire, liste blanche
  template('deny-blacklist', 'Command denied: Command matches blacklist pattern: {free}'),
  template('deny-whitelist', 'Command denied: Command not in whitelist{free}'),
  template('denied', 'Command denied: {free}'),
  // R29, R41, R14 : hôte inconnu
  template('unknown-host', 'Unknown host: {host}'),
  template('unknown-hosts', 'MCP invalid request: Unknown hosts: {hosts}'),
  // R43 : erreurs d'usage
  template('mcp-invalid', 'MCP invalid request: {free}'),
  template('mcp-missing', 'MCP missing parameter: {free}'),
  template('unknown-tool', 'Unknown tool: {tool}'),
  template('group-disabled', 'Tool `{tool}` is registered but its group `{tool}` is not enabled.{free}'),
  template('mcp-call-tool', 'mcp_call_tool: {free}'),
  template('clap', "error: unexpected argument '{free}' found{free}"),
  template('os-only', "Tool '{tool}' is only available on Windows hosts.{free}"),
  template('os-not', "Tool '{tool}' is not available on Windows hosts.{free}"),
  template('sudo-windows', "'sudo' is not supported on Windows host{free}"),
  template('sudo-posix', "'sudo' requires a POSIX shell{free}"),
  // R28 : configuration
  template('config-load', 'Failed to load config from {path}{free}'),
  template('config-error', 'Configuration error: {free}'),
  // R36 : limite de débit
  template('rate-host', "Rate limit exceeded for host '{host}'{free}"),
  template('rate', 'Rate limit exceeded{free}'),
  // R44, R45 : réponse au formulaire de confirmation
  template('declined', 'User declined execution of destructive tool `{tool}`{free}'),
  template('cancelled', 'User cancelled confirmation for destructive tool `{tool}`{free}'),
  template('not-granted', 'Confirmation for destructive tool `{tool}` was not granted;{free}'),
  template(
    'no-elicitation',
    'Tool `{tool}` is destructive and `require_elicitation_on_destructive` is enabled, but {free}',
  ),
  template('no-prompt', 'Could not build a confirmation prompt for `{tool}`{free}'),
  // R30, R35, R48, R49, R50 : connexion, authentification, délai, annulation
  template('auth', 'SSH authentication failed for {user}@{host}{free}'),
  template('hostkey-mismatch', 'SSH host key mismatch for {host}{free}'),
  template('hostkey-unknown', 'SSH host key unknown for {host}{free}'),
  template('conn-refused', 'SSH connection failed to {host}: Connection refused (os error {n})'),
  template('conn-timeout', 'SSH connection failed to {host}: Connection timeout after {n}s'),
  template('conn', 'SSH connection failed to {host}: {free}'),
  template('winrm', 'SSH command execution failed: WinRM HTTP error: error sending request{free}'),
  template('cmd-timeout', 'SSH command timeout after {n}s{free}'),
  template('client-cancelled', 'Request cancelled by client{free}'),
  // R37 : texte hors table, gardé tel quel pour le classement « échec »
  template('cache', 'Output cache is not available.{free}'),
  // R06 : dry-run (bridge-mcp/src/main.rs:127-131)
  template('dry-run', "[dry-run] Would execute on host '{host}': {free}"),
  template('dry-run-dir', '[dry-run] Working directory: {path}'),
  template('dry-run-timeout', '[dry-run] Timeout: {n}s'),
  // R51 : drapeaux de troncature et sortie persistée
  template('truncated', '--- [truncated: {free}'),
  template('output-id', '{free}output_id="{free}'),
  template('output-stopped', '{free}[output stopped at the {free}'),
  template('persisted-open', '<persisted-output>'),
  template('persisted-close', '</persisted-output>'),
  template('persisted-size', 'Output too large ({size}). Full output saved to: {path}'),
  template('persisted-preview', 'Preview (first {size}):'),
  // R22 : refus du moteur (engine-texts.ts) et interruption
  ...RECORDED_REFUSALS.map((text, i) => template(`refusal-${i}`, text.replace(/[{}]/g, ''))),
  template('refusal-dialog', "The user doesn't want to proceed with this tool use. The tool use was rejected{free}"),
  template(
    'refusal-classifier',
    'Permission for this action was denied by the Claude Code auto mode classifier.{free}',
  ),
  template('interrupted-tool', '[Request interrupted by user for tool use]'),
  template('interrupted', '[Request interrupted by user]'),
  // R08 : appel passé en arrière-plan
  template('background', 'Command running in background with ID: {id}. Output is being written to: {path}'),
]

function slotValue(dict: Dict, slot: Slot, value: string): string {
  switch (slot) {
    case 'host':
      return hostOf(dict, value)
    case 'hosts':
      return value
        .split(/(,\s*)/)
        .map((h, i) => (i % 2 === 1 ? h : hostOf(dict, h.trim())))
        .join('')
    case 'tool':
      return toolName(value)
    case 'path':
      return pathOf(dict, value)
    case 'id':
      return idOf(dict, value)
    case 'free':
    case 'user':
      return lorem(value)
    default:
      return value
  }
}

/** Ligne connue, sans `Error: ` ni marge : id du motif, ou null. */
function matchTemplate(body: string): { t: Template; m: RegExpExecArray } | null {
  for (const t of TEMPLATES) {
    const m = t.re.exec(body)
    if (m !== null) return { t, m }
  }
  return null
}

function split(line: string): { lead: string; err: string; body: string; cr: string } {
  const cr = line.endsWith('\r') ? '\r' : ''
  const plain = (cr === '' ? line : line.slice(0, -1)).replace(OSC, '').replace(CSI_ALL, '')
  const m = /^(\s*)(Error: )?(.*)$/s.exec(plain) as RegExpExecArray
  return { lead: String(m[1]), err: m[2] ?? '', body: String(m[3]), cr }
}

/** Classe d'une ligne pour la signature d'un scénario : id du motif connu, sinon `other`. */
export function classifyLine(line: string): string {
  return matchTemplate(split(line).body)?.t.id ?? 'other'
}

/** Ligne reconnue, réécrite (machines, chemins et identifiants remplacés, texte libre en lorem) ; sinon null. */
function keepLine(dict: Dict, line: string): string | null {
  const { lead, err, body, cr } = split(line)
  if (body === '' && err === '') return null
  const found = matchTemplate(body)
  if (found === null) return null
  const { t, m } = found
  let out = ''
  t.literals.forEach((literal, i) => {
    out += literal
    const slot = t.slots[i]
    if (slot !== undefined) out += slotValue(dict, slot, String(m[i + 1]))
  })
  return lead + err + out + cr
}

/** Le JSON qui va de cette ligne à la fin, s'il se lit. */
function jsonFrom(rest: string): unknown {
  const end = rest.trimEnd()
  if (!end.endsWith('}') && !end.endsWith(']')) return undefined
  try {
    return JSON.parse(rest)
  } catch {
    return undefined
  }
}

/**
 * Texte libre (sortie d'un outil, message) : un JSON est anonymisé champ par champ ; sinon ligne par
 * ligne, chaque ligne connue réécrite, toute autre ligne en lorem (suites longues coupées).
 */
export function anonymizeText(dict: Dict, text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let free = 0
  let tries = 0
  for (const [i, line] of lines.entries()) {
    if (/^\s*[[{]/.test(line) && tries < 3) {
      tries++
      const rest = lines.slice(i).join('\n')
      const parsed = jsonFrom(rest)
      if (parsed !== undefined) {
        const value = anonValue(dict, '', parsed)
        out.push(rest.includes('\n') ? JSON.stringify(value, null, 2) : JSON.stringify(value))
        break
      }
    }
    const kept = keepLine(dict, line)
    if (kept !== null) {
      out.push(kept)
      free = 0
      continue
    }
    if (line.trim() === '') out.push(line.replace(/\S/g, ''))
    else if (free++ < MAX_FREE_LINES) out.push(lorem(line.slice(0, MAX_LINE)))
  }
  return out.join('\n')
}

// --- Commandes Bash ----------------------------------------------------------------------------

const SUBCOMMANDS = new Set([
  'tool',
  't',
  'exec',
  'upload',
  'download',
  'list-tools',
  'describe-tool',
  'validate',
  'status',
  'config-diff',
  'history',
  'serve',
  'help',
])
/** Options globales et de sous-commande de bridge-mcp (bridge-mcp/src/cli/mod.rs) ; valeur : sa nature. */
const BRIDGE_FLAGS = new Map<string, 'none' | 'path' | 'host' | 'number' | 'json' | 'free'>([
  ['--json', 'none'],
  ['--yes', 'none'],
  ['-y', 'none'],
  ['--dry-run', 'none'],
  ['--help', 'none'],
  ['-h', 'none'],
  ['--verbose', 'none'],
  ['-v', 'none'],
  ['--groups-only', 'none'],
  ['--config', 'path'],
  ['-c', 'path'],
  ['--workdir', 'path'],
  ['-w', 'path'],
  ['--timeout', 'number'],
  ['-t', 'number'],
  ['--limit', 'number'],
  ['-n', 'number'],
  ['--host', 'host'],
  ['--json-args', 'json'],
  ['--jq', 'free'],
  ['--columns', 'free'],
  ['--output-format', 'free'],
  ['--group', 'free'],
  ['--search', 'free'],
])
/** Clés d'arguments `k=v` gardées (les autres deviennent du lorem). */
const ARG_KEYS = new Set([
  'host',
  'hosts',
  'command',
  'path',
  'paths',
  'output_id',
  'offset',
  'limit',
  'lines',
  'service',
  'columns',
  'output_format',
  'session_id',
  'timeout',
  'pattern',
  'name',
  'namespace',
  'resource',
  'container',
  'unit',
  'since',
  'level',
  'sudo',
  'cwd',
  'max_output',
])
const HOST_KEYS = new Set(['host', 'hostname', 'target_host'])
const ID_ARG_KEYS = new Set(['output_id', 'session_id'])
const PATH_ARG_KEYS = new Set(['path', 'paths', 'cwd'])
/** Mots du shell gardés ; ceux qui ouvrent une commande simple remettent l'analyse à zéro. */
const SHELL_WORDS = new Set([
  'for',
  'while',
  'until',
  'if',
  'then',
  'do',
  'done',
  'else',
  'elif',
  'fi',
  'case',
  'esac',
  'in',
  '{',
  '}',
  '!',
])
const RESTART_WORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!'])
/** Préfixes d'une commande simple (REFERENCE R05) : gardés avec leurs nombres et options. */
const WRAPPERS = new Set(['timeout', 'env', 'sudo', 'nice', 'nohup', 'time', 'command', 'exec'])
const SHELLS = new Set(['bash', 'sh', 'zsh'])
/** Variables d'environnement dont le nom est gardé. */
const ENV_NAMES = new Set(['RUST_LOG', 'NO_COLOR', 'TERM', 'HOME', 'PATH', 'BRIDGE_CONFIG', 'RUST_BACKTRACE'])

type Piece = { kind: 'space' | 'op' | 'word'; text: string }

const SHELL_TOKEN =
  /(\s+)|(&&|\|\||;;|<<-?|[0-9]?>&[0-9]|[0-9]?>>?|[;|&()<])|((?:'[^']*'?|"(?:\\.|[^"\\])*"?|[^\s;|&()<>'"]+)+)/g

function pieces(command: string): Piece[] {
  const out: Piece[] = []
  for (const m of command.matchAll(SHELL_TOKEN)) {
    if (m[1] !== undefined) out.push({ kind: 'space', text: m[1] })
    else if (m[2] !== undefined) out.push({ kind: 'op', text: m[2] })
    else out.push({ kind: 'word', text: String(m[3]) })
  }
  return out
}

/** Nature d'un opérateur : séparateur de commandes simples, redirection, document intégré, ou duplication (`2>&1`). */
function opKind(op: string): 'separator' | 'redirect' | 'heredoc' | 'dup' {
  if (/^[0-9]?>&[0-9]$/.test(op)) return 'dup'
  if (op === '<<' || op === '<<-') return 'heredoc'
  if (/^[0-9]?>>?$/.test(op) || op === '<') return 'redirect'
  return 'separator'
}

function unquote(word: string): { q: string; inner: string } {
  const q = word[0]
  if ((q === "'" || q === '"') && word.length >= 2 && word.endsWith(q)) return { q, inner: word.slice(1, -1) }
  return { q: '', inner: word }
}

function requote(q: string, inner: string): string {
  return q + inner + q
}

const TOOL_SHAPE = /^(?:ssh|win|mcp)_[a-z0-9_]+$/

/** Nom d'outil du bridge gardé ; tout autre nom devient du lorem. */
function toolName(name: string): string {
  return TOOL_SHAPE.test(name) ? name : lorem(name)
}

function isPathLike(word: string): boolean {
  return /^(?:~|\.{1,2})?\//.test(word)
}

function basename(word: string): string {
  return unquote(word).inner.split('/').pop() ?? ''
}

type Seg = {
  mode: 'start' | 'bridge' | 'shell' | 'other'
  sub: string | undefined
  tool: string | undefined
  positional: number
  expect: 'none' | 'path' | 'host' | 'number' | 'json' | 'free'
  shellC: boolean
}

const freshSeg = (): Seg => ({
  mode: 'start',
  sub: undefined,
  tool: undefined,
  positional: 0,
  expect: 'none',
  shellC: false,
})

function argValue(dict: Dict, kind: Seg['expect'], word: string): string {
  const { q, inner } = unquote(word)
  switch (kind) {
    case 'host':
      return requote(q, hostOf(dict, inner))
    case 'path':
      return requote(q, pathOf(dict, inner))
    case 'number':
      return /^\d+$/.test(inner) ? word : lorem(word)
    case 'json': {
      try {
        return requote(q, JSON.stringify(anonValue(dict, '', JSON.parse(inner))))
      } catch {
        return lorem(word)
      }
    }
    default:
      return lorem(word)
  }
}

/** `k=v` d'un outil du bridge : clé gardée si connue, valeur selon la clé. */
function toolArg(dict: Dict, word: string): string {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word)
  if (m === null) return TOOL_SHAPE.test(word) ? word : lorem(word)
  const key = String(m[1])
  const value = String(m[2])
  const { q, inner } = unquote(value)
  const outKey = ARG_KEYS.has(key) ? key : lorem(key)
  if (HOST_KEYS.has(key)) return `${outKey}=${requote(q, hostOf(dict, inner))}`
  if (key === 'hosts')
    return `${outKey}=${requote(
      q,
      inner
        .split(',')
        .map((h) => hostOf(dict, h))
        .join(','),
    )}`
  if (ID_ARG_KEYS.has(key)) return `${outKey}=${requote(q, idOf(dict, inner))}`
  if (PATH_ARG_KEYS.has(key) && isPathLike(inner)) return `${outKey}=${requote(q, pathOf(dict, inner))}`
  if (/^\d+$/.test(inner) || inner === 'true' || inner === 'false') return `${outKey}=${value}`
  return `${outKey}=${lorem(value)}`
}

function bridgeWord(dict: Dict, seg: Seg, word: string): string {
  if (seg.expect !== 'none') {
    const kind = seg.expect
    seg.expect = 'none'
    return argValue(dict, kind, word)
  }
  if (word.startsWith('-') && !/^-\d/.test(word)) {
    const eq = word.indexOf('=')
    const flag = eq < 0 ? word : word.slice(0, eq)
    const kind = BRIDGE_FLAGS.get(flag)
    if (kind === undefined) return lorem(word)
    if (eq >= 0) return `${flag}=${argValue(dict, kind, word.slice(eq + 1))}`
    seg.expect = kind
    return word
  }
  if (seg.sub === undefined) {
    seg.sub = SUBCOMMANDS.has(word) ? word : '?'
    return SUBCOMMANDS.has(word) ? word : lorem(word)
  }
  if (seg.sub === 'tool' || seg.sub === 't' || seg.sub === 'describe-tool') {
    if (seg.tool === undefined) {
      seg.tool = word
      return toolName(word)
    }
    return toolArg(dict, word)
  }
  if (seg.sub === 'exec' || seg.sub === 'upload' || seg.sub === 'download') {
    const n = seg.positional++
    if (n === 0) return argValue(dict, 'host', word)
    if (seg.sub !== 'exec' && isPathLike(unquote(word).inner)) return argValue(dict, 'path', word)
    return lorem(word)
  }
  return TOOL_SHAPE.test(word) ? word : lorem(word)
}

function otherWord(dict: Dict, word: string): string {
  const { q, inner } = unquote(word)
  if (q !== '' && /(^|[\s/])bridge-mcp\s/.test(inner)) return requote(q, anonymizeCommand(dict, inner))
  if (/^-?\d+$/.test(word)) return word
  if (isPathLike(word)) return pathOf(dict, word)
  return lorem(word)
}

/** Une ligne de code (hors document intégré) : mots analysés commande simple par commande simple. */
function anonymizeCode(dict: Dict, code: string): string {
  let seg = freshSeg()
  let redirect = false
  let comment = false
  let out = ''
  for (const p of pieces(code)) {
    if (p.kind === 'space') {
      if (p.text.includes('\n')) {
        comment = false
        seg = freshSeg()
      }
      out += p.text
      continue
    }
    if (comment) {
      out += lorem(p.text)
      continue
    }
    if (p.kind === 'op') {
      out += p.text
      const op = opKind(p.text)
      if (op === 'redirect' || op === 'heredoc') redirect = true
      else if (op === 'separator') seg = freshSeg()
      continue
    }
    const word = p.text
    if (word.startsWith('#') && (out === '' || /\s$/.test(out))) {
      comment = true
      out += lorem(word)
      continue
    }
    if (redirect) {
      redirect = false
      out += isPathLike(word) ? pathOf(dict, word) : lorem(word)
      continue
    }
    out += segWord(dict, seg, word)
    if (seg.mode === 'start' && RESTART_WORDS.has(word)) seg = freshSeg()
  }
  return out
}

function segWord(dict: Dict, seg: Seg, word: string): string {
  switch (seg.mode) {
    case 'start': {
      if (SHELL_WORDS.has(word)) {
        if (word === 'for' || word === 'case') seg.mode = 'other'
        return word
      }
      const assign = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word)
      if (assign !== null) {
        const name = String(assign[1])
        return `${ENV_NAMES.has(name) ? name : lorem(name)}=${lorem(String(assign[2]))}`
      }
      if (WRAPPERS.has(word) || /^-?\d+[smhd]?$/.test(word) || (word.startsWith('-') && word.length <= 3))
        return /^[A-Za-z]+$/.test(word) || /^-?\d+[smhd]?$/.test(word) ? word : lorem(word)
      if (basename(word) === 'bridge-mcp') {
        seg.mode = 'bridge'
        const { q, inner } = unquote(word)
        return requote(q, isPathLike(inner) ? pathOf(dict, inner) : inner)
      }
      if (SHELLS.has(word)) {
        seg.mode = 'shell'
        return word
      }
      seg.mode = 'other'
      return otherWord(dict, word)
    }
    case 'bridge':
      return bridgeWord(dict, seg, word)
    case 'shell': {
      if (word === '-c') {
        seg.shellC = true
        return word
      }
      if (seg.shellC) {
        seg.shellC = false
        const { q, inner } = unquote(word)
        if (q !== '') return requote(q, anonymizeCommand(dict, inner))
      }
      return otherWord(dict, word)
    }
    default:
      return otherWord(dict, word)
  }
}

/**
 * Commande Bash : structure gardée (opérateurs, mots du shell, préfixes, segments bridge-mcp avec
 * sous-commande, outil, options, clés d'arguments), machines et chemins remplacés, tout autre mot en
 * lorem. Les documents intégrés (`<<EOF`) sont en lorem ligne à ligne.
 */
export function anonymizeCommand(dict: Dict, command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  let code: string[] = []
  let heredoc: string | null = null
  const flush = () => {
    if (code.length > 0) out.push(anonymizeCode(dict, code.join('\n')))
    code = []
  }
  for (const line of lines) {
    if (heredoc !== null) {
      out.push(line.trim() === heredoc ? lorem(line) : lorem(line.slice(0, MAX_LINE)))
      if (line.trim() === heredoc) heredoc = null
      continue
    }
    code.push(line)
    const doc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (doc !== null) {
      heredoc = String(doc[2])
      flush()
    }
  }
  flush()
  return out.join('\n')
}

/** Segments bridge-mcp d'une commande : sous-commande et outil (formes gardées seulement). */
export function bridgeCalls(command: string): { sub: string; tool: string }[] {
  const dict = newDict()
  const found: { sub: string; tool: string }[] = []
  const visit = (code: string) => {
    let seg = freshSeg()
    let atStart = true
    for (const p of pieces(code)) {
      if (p.kind === 'space') {
        if (p.text.includes('\n')) seg = freshSeg()
        continue
      }
      if (p.kind === 'op') {
        if (opKind(p.text) === 'separator') seg = freshSeg()
        continue
      }
      const before = seg.mode
      segWord(dict, seg, p.text)
      if (before === 'start' && seg.mode === 'bridge') found.push({ sub: '?', tool: '?' })
      if (seg.mode === 'bridge' && found.length > 0) {
        const last = found[found.length - 1] as { sub: string; tool: string }
        if (seg.sub !== undefined) last.sub = SUBCOMMANDS.has(seg.sub) ? seg.sub : '?'
        if (seg.tool !== undefined) last.tool = TOOL_SHAPE.test(seg.tool) ? seg.tool : '?'
      }
      if (seg.mode === 'shell' && seg.shellC === false && atStart === false) {
        const { q, inner } = unquote(p.text)
        if (q !== '') visit(inner)
      }
      atStart = false
    }
  }
  visit(command)
  return found
}

/** Une ligne Bash qui lance bridge-mcp en tête d'une commande simple (aussi sous `bash -c '…'`). */
export function isBridgeCommand(command: string): boolean {
  return bridgeCalls(command).length > 0
}

// --- Plans, scripts, journaux, notifications ---------------------------------------------------

const PLAN_SUFFIX = /\s+[—–-]?\s*Implementation Plan$/gi
const TASK_HEADING = /^(?:Task|Tâche|T{1,2})\s*\d+\b/g

/** Plan ou spec Superpowers : titres (`#`, `### Task n`), clôtures gardées ; tout texte en lorem. */
export function anonymizePlan(text: string): string {
  let inFence = false
  let free = 0
  const out: string[] = []
  for (const line of text.split('\n')) {
    const fence = /^(\s*(?:```|~~~))(.*)$/.exec(line)
    if (fence !== null) {
      inFence = !inFence
      out.push(String(fence[1]) + lorem(String(fence[2])))
      free = 0
      continue
    }
    const heading = /^(#{1,6})(\s+)(.*)$/.exec(line)
    if (!inFence && heading !== null) {
      const marks = String(heading[1])
      const rest = String(heading[3])
      const keeps = marks === '#' ? [PLAN_SUFFIX] : [TASK_HEADING]
      out.push(marks + String(heading[2]) + loremExcept(rest, keeps))
      free = 0
      continue
    }
    if (line.trim() === '') out.push('')
    else if (free++ < MAX_FREE_LINES) out.push(lorem(line.slice(0, MAX_LINE)))
  }
  return out.join('\n')
}

/** Bloc `export const meta = { name, phases: [{ title }] }` (forme lue par le mod), ou null. */
function metaOf(script: string): { name: string | null; phases: string[] } | null {
  const found = /export\s+const\s+meta\s*=\s*\{/.exec(script)
  if (found === null) return null
  const open = found.index + found[0].length - 1
  let depth = 0
  let end = script.length - 1
  for (let i = open; i < script.length; i++) {
    if (script[i] === '{') depth++
    else if (script[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const meta = script.slice(open, end + 1)
  const name = meta.match(/\bname\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/)?.[2] ?? null
  const afterPhases = /\bphases\s*:\s*\[([\s\S]*)/.exec(meta)?.[1] ?? ''
  const phases = Array.from(afterPhases.matchAll(/\btitle\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/g), (m) => String(m[2]))
  return { name, phases }
}

/** Script de workflow : seul le bloc meta est reconstruit (nom et titres de phases en lorem) ; sans bloc, vide. */
export function anonymizeScript(dict: Dict, script: string): string {
  const meta = metaOf(script)
  if (meta === null) return ''
  const lines = ['export const meta = {']
  if (meta.name !== null) lines.push(`  name: '${labelOf(dict, meta.name)}',`)
  lines.push('  phases: [')
  for (const title of meta.phases) lines.push(`    { title: '${labelOf(dict, title)}' },`)
  lines.push('  ],', '}', '')
  return lines.join('\n')
}

const JOURNAL_TYPES = new Set(['started', 'result', 'failed', 'progress', 'phase', 'log', 'completed'])

/** Journal de workflow : par ligne JSON, seuls `type`, `agentId`, `label` et `phase` restent. */
export function anonymizeJournal(dict: Dict, text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line
      let row: unknown
      try {
        row = JSON.parse(line)
      } catch {
        return lorem(line.slice(0, MAX_LINE))
      }
      if (typeof row !== 'object' || row === null || Array.isArray(row)) return lorem(line.slice(0, MAX_LINE))
      const r = row as Record<string, unknown>
      const out: Record<string, unknown> = {}
      if (typeof r.type === 'string') out.type = JOURNAL_TYPES.has(r.type) ? r.type : lorem(r.type)
      if (typeof r.agentId === 'string') out.agentId = idOf(dict, r.agentId)
      if (typeof r.label === 'string') out.label = labelOf(dict, r.label)
      if (typeof r.phase === 'string') out.phase = labelOf(dict, r.phase)
      return JSON.stringify(out)
    })
    .join('\n')
}

const NOTICE_TAGS = new Set([
  'task-notification',
  'task-id',
  'tool-use-id',
  'output-file',
  'status',
  'summary',
  'result',
  'usage',
  'note',
  'task-type',
])

/** Notification de tâche : balises gardées, identifiants, chemin et statut remplacés, texte en lorem. */
export function anonymizeNotice(dict: Dict, text: string): string {
  let out = ''
  let at = 0
  for (const m of text.matchAll(/<([a-z-]+)>([\s\S]*?)<\/\1>/g)) {
    const tag = String(m[1])
    const body = String(m[2])
    out += anonymizeText(dict, text.slice(at, m.index))
    at = m.index + m[0].length
    if (!NOTICE_TAGS.has(tag)) {
      out += lorem(m[0].slice(0, MAX_LINE))
      continue
    }
    let inner: string
    if (tag === 'task-notification') inner = anonymizeNotice(dict, body)
    else if (tag === 'task-id' || tag === 'tool-use-id') inner = idOf(dict, body.trim())
    else if (tag === 'output-file') inner = pathOf(dict, body.trim())
    else if (tag === 'status' || tag === 'task-type') inner = enumOf(body.trim())
    else inner = anonymizeText(dict, body)
    out += `<${tag}>${inner}</${tag}>`
  }
  return out + anonymizeText(dict, text.slice(at))
}

// --- Valeurs structurées -----------------------------------------------------------------------

/** Valeurs d'énumération gardées (statuts, types, modèles, types d'agent). */
const ENUMS = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
  'running',
  'pending',
  'cancelled',
  'error',
  'success',
  'ok',
  'async_launched',
  'remote_launched',
  'local_workflow',
  'local_bash',
  'local_agent',
  'teammate_spawned',
  'started',
  'result',
  'text',
  'create',
  'update',
  'general-purpose',
  'Explore',
  'Plan',
  'fork',
  'claude',
  'code-reviewer',
  'security-auditor',
  'test-amplifier',
  'quality-checker',
  'statusline-setup',
  'claude-code-guide',
  'web-fetch',
  'opus',
  'sonnet',
  'haiku',
  'fable',
  'inherit',
  'worktree',
  'remote',
])
const MODEL = /^(?:claude-)?(?:opus|sonnet|haiku|fable)(?:-[0-9a-z]+)*(?:\[1m\])?$/

function enumOf(value: string): string {
  return ENUMS.has(value) || MODEL.test(value) ? value : lorem(value)
}

/** Skills Superpowers connus (REFERENCE R83-R90) ; tout autre nom devient du lorem. */
const SP_SKILLS = new Set([
  'brainstorming',
  'writing-plans',
  'executing-plans',
  'subagent-driven-development',
  'requesting-code-review',
  'receiving-code-review',
  'finishing-a-development-branch',
  'using-superpowers',
  'systematic-debugging',
  'test-driven-development',
  'verification-before-completion',
  'dispatching-parallel-agents',
  'using-git-worktrees',
  'writing-skills',
  'diagnosing-superpowers',
])

function skillOf(dict: Dict, value: string): string {
  const m = /^superpowers:(.*)$/.exec(value)
  if (m === null) return labelOf(dict, value)
  const name = String(m[1])
  return `superpowers:${SP_SKILLS.has(name) ? name : labelOf(dict, name)}`
}

/** Description et prompt d'Agent : `Task n`, `final review`, `code-reviewer.md` gardés (REFERENCE R86, R88). */
const AGENT_KEEPS: readonly RegExp[] = [
  /\b(?:Task|Tâche|T{1,2})\s*\d+\b/g,
  /final (?:code )?review/gi,
  /code-reviewer\.md/g,
]

/** Clés gardées dans un objet (schéma des outils, du moteur et des sorties JSON du bridge). */
const KEYS = new Set([
  // entrées des outils
  'command',
  'description',
  'run_in_background',
  'timeout',
  'dangerouslyDisableSandbox',
  'skill',
  'args',
  'prompt',
  'subagent_type',
  'model',
  'name',
  'team_name',
  'isolation',
  'mode',
  'file_path',
  'content',
  'old_string',
  'new_string',
  'replace_all',
  'script',
  'host',
  'hosts',
  'arguments',
  'path',
  'session_id',
  'output_id',
  'offset',
  'limit',
  'service',
  // résultats du moteur
  'stdout',
  'stderr',
  'interrupted',
  'isImage',
  'noOutputExpected',
  'backgroundTaskId',
  'returnCodeInterpretation',
  'commandName',
  'success',
  'agentId',
  'agent_id',
  'status',
  'outputFile',
  'isAsync',
  'canReadOutputFile',
  'canContinueAgent',
  'resolvedModel',
  'runId',
  'taskId',
  'taskType',
  'scriptPath',
  'transcriptDir',
  'workflowName',
  'summary',
  'filePath',
  'type',
  'userModified',
  // sorties JSON du bridge (REFERENCE R13, R15, R19)
  'total_hosts',
  'results',
  'exit_code',
  'error',
  'id',
  'text',
  'isError',
  'truncated',
  'duration_ms',
  'created_at',
])
/** Clés écartées : copies de fichiers et différences, que le mod ne lit pas. */
const DROP = new Set(['originalFile', 'structuredPatch', 'bashEditDiff', 'oldString', 'newString', 'allowedTools'])
const ID_KEYS = new Set([
  'id',
  'session_id',
  'output_id',
  'agentId',
  'agent_id',
  'backgroundTaskId',
  'runId',
  'taskId',
  'tool_use_id',
  'teammate_id',
])
const PATH_KEYS = new Set(['file_path', 'filePath', 'scriptPath', 'transcriptDir', 'outputFile', 'cwd'])
const ENUM_KEYS = new Set([
  'status',
  'taskType',
  'subagent_type',
  'model',
  'resolvedModel',
  'type',
  'isolation',
  'mode',
])

/** Valeur d'un champ, selon sa clé ; un objet garde ses clés connues, les autres en lorem. */
function anonValue(dict: Dict, key: string, value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map((v) => anonValue(dict, key, v))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (DROP.has(k)) continue
      out[KEYS.has(k) ? k : (dict.hosts.get(k) ?? labelOf(dict, k))] = anonValue(dict, k, v)
    }
    return out
  }
  if (typeof value !== 'string') return null
  if (HOST_KEYS.has(key) || key === 'hosts') return hostOf(dict, value)
  if (ID_KEYS.has(key)) return idOf(dict, value)
  if (PATH_KEYS.has(key) || (key === 'path' && isPathLike(value))) return pathOf(dict, value)
  if (ENUM_KEYS.has(key)) return enumOf(value)
  if (key === 'skill' || key === 'commandName') return skillOf(dict, value)
  if (key === 'name') return TOOL_SHAPE.test(value) ? value : labelOf(dict, value)
  if (key === 'workflowName') return labelOf(dict, value)
  if (key === 'description' || key === 'prompt') return loremExcept(value.slice(0, 4 * MAX_LINE), AGENT_KEEPS)
  if (key === 'script') return anonymizeScript(dict, value)
  return anonymizeText(dict, value)
}

/** Entrée d'un appel : la commande Bash est analysée, les écritures sous docs/superpowers/ gardent leurs titres. */
function anonInput(dict: Dict, tool: string, input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return anonValue(dict, '', input)
  const raw = input as Record<string, unknown>
  const out = anonValue(dict, '', raw) as Record<string, unknown>
  if (tool === 'Bash' && typeof raw.command === 'string') out.command = anonymizeCommand(dict, raw.command)
  if (
    (tool === 'Write' || tool === 'Edit') &&
    typeof raw.file_path === 'string' &&
    /docs\/superpowers\//.test(raw.file_path)
  ) {
    for (const k of ['content', 'old_string', 'new_string'])
      if (typeof raw[k] === 'string') out[k] = anonymizePlan(raw[k] as string)
  }
  return out
}

/** Nom de l'outil : outils du moteur gardés ; MCP bridge gardé ; autre serveur MCP en lorem. */
const CORE_TOOLS = new Set([
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Agent',
  'Skill',
  'Workflow',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'Monitor',
  'TaskStop',
  'SendMessage',
  'ToolSearch',
])

function toolOf(dict: Dict, tool: string): string {
  if (CORE_TOOLS.has(tool)) return tool
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(tool)
  if (m === null) return labelOf(dict, tool)
  const server = String(m[1])
  const name = String(m[2])
  const keepServer = /^[a-z0-9-]*bridge[a-z0-9-]*$/.test(server)
  return `mcp__${keepServer ? server : labelOf(dict, server)}__${TOOL_SHAPE.test(name) ? name : labelOf(dict, name)}`
}

function anonResult(dict: Dict, tool: string, r: ToolCallResult): ToolCallResult {
  const text = typeof r.text === 'string' ? anonymizeText(dict, r.text) : undefined
  if (r.deny !== undefined) return { deny: anonymizeText(dict, r.deny) }
  const result =
    (tool === 'Write' || tool === 'Edit') && typeof r.result === 'object' && r.result !== null
      ? anonValue(dict, '', pick(r.result as Record<string, unknown>, ['filePath', 'type', 'userModified']))
      : anonValue(dict, '', r.result)
  if (r.isError === true) return text === undefined ? { isError: true, result } : { isError: true, result, text }
  return text === undefined ? { result } : { result, text }
}

function pick(o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in o) out[k] = o[k]
  return out
}

function anonFile(dict: Dict, path: string, text: string): string {
  if (path.endsWith('/journal.jsonl')) return anonymizeJournal(dict, text)
  if (/docs\/superpowers\//.test(path)) return anonymizePlan(text)
  if (/\.(?:m?js|ts)$/.test(path) || /export\s+const\s+meta\s*=/.test(text)) return anonymizeScript(dict, text)
  return anonymizeText(dict, text)
}

function pass(raw: RawScenario, dict: Dict): Scenario {
  const start = raw.events.reduce((min, e) => Math.min(min, e.at), Number.POSITIVE_INFINITY)
  const t = (at: number) => Math.max(0, Math.round(at - (Number.isFinite(start) ? start : at)))
  const events: ReplayEvent[] = raw.events.map((e) => {
    if (e.kind === 'turn.complete')
      return e.agentId === undefined
        ? { t: t(e.at), kind: 'turn.complete' }
        : { t: t(e.at), kind: 'turn.complete', agentId: idOf(dict, e.agentId) }
    if (e.kind === 'session.append') return { t: t(e.at), kind: 'session.append', text: anonymizeNotice(dict, e.text) }
    const input = anonInput(dict, e.tool, e.input)
    const call: ReplayEvent = {
      t: t(e.at),
      kind: 'tool.call',
      tool: toolOf(dict, e.tool),
      toolUseId: idOf(dict, e.toolUseId),
      input,
      result: anonResult(dict, e.tool, e.result),
      afterMs: Math.max(0, Math.round(e.doneAt - e.at)),
    }
    return e.agentId === undefined ? call : { ...call, agentId: idOf(dict, e.agentId) }
  })
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries(raw.files)) files[pathOf(dict, path)] = anonFile(dict, path, text)
  return { id: raw.id, source: 'replay', events, files }
}

/**
 * Scénario anonymisé. Deux passes sur le même dictionnaire : la première relève toutes les machines
 * et tous les identifiants (dans l'ordre d'apparition), la seconde les remplace partout, y compris
 * dans un chemin vu avant l'entrée qui nomme la machine.
 */
export function anonymize(s: RawScenario, dict: Dict): Scenario {
  pass(s, dict)
  return pass(s, dict)
}

// --- Barrières ---------------------------------------------------------------------------------

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

const LEAKS: readonly { what: string; re: RegExp }[] = [
  { what: 'chemin personnel', re: /\/home\/(?!user\b)/ },
  { what: 'dossier de projet personnel', re: /-home-(?!user\b)[A-Za-z0-9]/ },
  { what: 'adresse e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  { what: 'adresse IPv4', re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/ },
  { what: 'adresse IPv6', re: /\b(?:[0-9a-f]{1,4}:){5,7}[0-9a-f]{1,4}\b/i },
  { what: 'jeton sk-', re: /\bsk-[A-Za-z0-9_-]{10,}/ },
  { what: 'jeton GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { what: 'jeton Slack', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { what: 'clé AWS', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { what: 'clé privée', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { what: 'suite hexadécimale longue', re: /[0-9a-fA-F]{32,}/ },
]
const BASE64_RUN = /[A-Za-z0-9+]{32,}/g

/**
 * Lève si le texte contient une entrée de la liste noire (casse et accents ignorés), un chemin
 * `/home/<autre que user>`, une adresse e-mail ou IP, ou une chaîne qui ressemble à un jeton.
 * Le message dit ce qui a été trouvé et où, jamais la chaîne elle-même.
 */
export function assertClean(text: string, denylist: readonly string[]): void {
  const folded = fold(text)
  for (const entry of denylist) {
    const e = fold(entry.trim())
    if (e !== '' && folded.includes(e))
      throw new Error(`liste noire : une entrée (${e.length} caractères) paraît à la position ${folded.indexOf(e)}`)
  }
  for (const { what, re } of LEAKS) {
    const m = re.exec(text)
    if (m !== null) throw new Error(`${what} à la position ${m.index}`)
  }
  for (const m of text.matchAll(BASE64_RUN)) {
    const run = m[0]
    if (/\d/.test(run) && /[A-Z]/.test(run) && /[a-z]/.test(run))
      throw new Error(`suite base64 longue à la position ${m.index}`)
  }
}

/** Sources du vocabulaire connu : tout mot gardé par l'anonymiseur vient de l'une d'elles. */
const VOCAB_SOURCES: readonly string[] = [
  ...TEMPLATES.flatMap((t) => t.literals),
  ...RECORDED_REFUSALS,
  ...STRUCT,
  ...EXT,
  ...SUBCOMMANDS,
  ...BRIDGE_FLAGS.keys(),
  ...ARG_KEYS,
  ...SHELL_WORDS,
  ...WRAPPERS,
  ...SHELLS,
  ...ENV_NAMES,
  ...JOURNAL_TYPES,
  ...NOTICE_TAGS,
  ...ENUMS,
  ...SP_SKILLS,
  ...KEYS,
  ...CORE_TOOLS,
  'host toolu id user home bridge-mcp superpowers mcp ssh bridge true false null',
  'export const meta name phases title Implementation Plan Task Tâche final code review code-reviewer.md',
  'TRACE DEBUG INFO WARN ERROR agentId label phase',
]
const WORD = /[A-Za-z0-9]+/g
const VOCAB = new Set(VOCAB_SOURCES.flatMap((s) => (s.match(WORD) ?? []).map((w) => w.toLowerCase())))
/** Formes entières acceptées avant le découpage en mots. */
const WHOLE_FORMS: readonly RegExp[] = [
  CSI_ALL,
  /\d{4}-\d{2}-\d{2}T[\d:.]+Z/g,
  /\bmcp__[a-z0-9-]*bridge[a-z0-9-]*__[a-z0-9_]+\b/g,
  /\b(?:ssh|win|mcp)_[a-z0-9_]+\b/g,
  UUID_ANY,
]

function knownWord(w: string): boolean {
  const lower = w.toLowerCase()
  return (
    w.length <= 2 ||
    /^\d+$/.test(w) ||
    VOCAB.has(lower) ||
    LOREM.repeat(Math.ceil(lower.length / LOREM.length) + 1).includes(lower) ||
    /^r\d{4}$/.test(w) ||
    /^T{1,2}\d+$/.test(w) ||
    /^\d+(?:[KMGT]?i?B|ms|s|m|h)$/i.test(w) ||
    /^\d+(?:st|nd|rd|th)$/.test(w)
  )
}

/** Premier mot inconnu, ou null. */
function unknownIn(text: string): string | null {
  let rest = text
  for (const re of WHOLE_FORMS) rest = rest.replace(re, ' ')
  for (const w of rest.match(WORD) ?? []) if (!knownWord(w)) return w
  return null
}

function walk(value: unknown, where: string, check: (s: string, where: string) => void): void {
  if (typeof value === 'string') check(value, where)
  else if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) walk(v, `${where}[${i}]`, check)
  } else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      check(k, `${where}.<clé>`)
      walk(v, `${where}.${KEYS.has(k) ? k : '?'}`, check)
    }
}

/**
 * Lève si un champ du scénario (outil, identifiants, entrée, résultat, texte, fichiers) contient un
 * mot hors du vocabulaire connu et hors du lorem : la marque d'une chaîne que l'anonymiseur a laissée
 * passer. Le message donne le scénario, le champ et la longueur du mot, jamais le mot.
 */
export function assertKnownForms(s: Scenario): void {
  const [first] = unknownWords(s)
  if (first !== undefined)
    throw new Error(`forme inconnue dans ${s.id} à ${first.where} (mot de ${first.word.length} caractères)`)
}

/** Chaque mot inconnu du scénario et son champ (pour assertKnownForms, et le débogage local). */
export function unknownWords(s: Scenario): { where: string; word: string }[] {
  const found: { where: string; word: string }[] = []
  const check = (text: string, where: string) => {
    const word = unknownIn(text)
    if (word !== null) found.push({ where, word })
  }
  s.events.forEach((e, i) => {
    const at = `events[${i}]`
    if (e.kind === 'session.append') {
      check(e.text, `${at}.text`)
      return
    }
    if (e.agentId !== undefined) check(e.agentId, `${at}.agentId`)
    if (e.kind === 'turn.complete') return
    check(e.tool, `${at}.tool`)
    check(e.toolUseId, `${at}.toolUseId`)
    walk(e.input, `${at}.input`, check)
    walk(e.result, `${at}.result`, check)
  })
  for (const [path, text] of Object.entries(s.files)) {
    check(path, 'files.<chemin>')
    check(text, 'files.<contenu>')
  }
  return found
}
