// Reconnaissance des appels au bridge : une ligne Bash découpée en commandes simples, les appels
// `bridge-mcp` qu'elle contient, et les appels MCP au serveur du bridge (spec §5.1).
//
// Module pur : aucun `$`, aucune horloge, uniquement des `import type`. Le mod ne lance rien :
// la ligne est lue telle que Claude l'a écrite, jamais exécutée.

import type { BridgeCall, CallState, Nature, Via } from '../types'
import type { ToolInfo } from './tools.generated'

export type ParsedCall = {
  via: Via
  tool: string
  host: string | null // null = machine inconnue
  nature: Nature
  accordByOption: boolean // --yes
  ownsExit: boolean // CLI : segment bridge qui est la dernière commande simple de la ligne
  inLoop: boolean // CLI : segment dans for/while
  sessionId?: string // ssh_session_exec
}

export type RunResult = {
  isError: boolean
  text: string // texte tel que le modèle l'a lu (tool.call result.text), ANSI compris
  interrupted: boolean // next.signal.aborted, ou interrupted du résultat Bash
  refusedByClaude: boolean // deny d'un hook, PermissionDenied, ou texte de refus du moteur
}
export type Outcome = { state: CallState; code?: number; truncated: boolean; reason?: string }

type Op = '' | '&&' | '||' | ';' | '|' | '&' | '\n'
type Segment = { words: string[]; op: Op }
type Heredoc = { delim: string; strip: boolean }
type Token = { text: string; next: number }

// --- Découpage shell ---------------------------------------------------------------------------

/** Caractères qui terminent un mot hors guillemets. */
const BREAKS = ' \t\r\n;&|()<>'

function isBlank(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r'
}

function skipBlanks(s: string, i: number): number {
  let j = i
  while (isBlank(s.charAt(j))) j++
  return j
}

/** Index du `'` fermant (ou la fin) d'une chaîne ouverte en `i`. */
function singleEnd(s: string, i: number): number {
  const end = s.indexOf("'", i + 1)
  return end === -1 ? s.length : end
}

/** Index juste après l'accent grave fermant d'une substitution ouverte en `i`. */
function afterBacktick(s: string, i: number): number {
  let j = i + 1
  // Stryker disable next-line EqualityOperator: en j == s.length, charAt rend '' : même chemin que la fin de boucle, même résultat
  while (j < s.length) {
    const c = s.charAt(j)
    if (c === '\\') j += 2
    else if (c === '`') return j + 1
    else j++
  }
  return s.length
}

/** Index juste après la `}` d'un `${ }` dont la `{` est en `i`. */
function afterBrace(s: string, i: number): number {
  const end = s.indexOf('}', i)
  return end === -1 ? s.length : end + 1
}

/** Contenu d'une chaîne entre guillemets doubles ouverte en `i`, échappements résolus. */
function readDouble(s: string, i: number): Token {
  let text = ''
  let j = i + 1
  // Stryker disable next-line EqualityOperator: en j == s.length, charAt rend '' : le tour de plus ne change que next, que personne ne lit au-delà de la fin
  while (j < s.length) {
    const c = s.charAt(j)
    const d = s.charAt(j + 1)
    if (c === '"') break
    if (c === '\\' && d === '\n') {
      j += 2
    } else if (c === '\\' && d !== '' && '$`"\\'.includes(d)) {
      text += d
      j += 2
    } else if (c === '$' && d === '(') {
      const e = afterSubst(s, j + 1)
      text += s.slice(j, e)
      j = e
    } else if (c === '`') {
      const e = afterBacktick(s, j)
      text += s.slice(j, e)
      j = e
    } else {
      text += c
      j++
    }
  }
  return { text, next: j + 1 }
}

/** Vrai si un heredoc (`<<`, `<<-`) s'ouvre en `i` ; `<<<` est une here-string, pas un heredoc. */
function isHeredocAt(s: string, i: number): boolean {
  return s.startsWith('<<', i) && s.charAt(i + 2) !== '<'
}

/** Opérateur `<<` ou `<<-` en `i` : le délimiteur, sans guillemets, et l'index qui suit. */
function readHeredoc(s: string, i: number): { doc: Heredoc; next: number } {
  let j = i + 2
  const strip = s.charAt(j) === '-'
  if (strip) j++
  const t = readToken(s, skipBlanks(s, j))
  return { doc: { delim: t.text, strip }, next: t.next }
}

/** Saute les corps de heredoc qui commencent en `i` ; rend l'index qui suit le dernier délimiteur. */
function skipBodies(s: string, i: number, docs: readonly Heredoc[]): number {
  let j = i
  for (const doc of docs) {
    // Stryker disable next-line EqualityOperator: en j == s.length, la ligne lue est vide ; seul l'index rendu passe de s.length à s.length + 1, et tous les appelants s'arrêtent dès j >= s.length
    while (j < s.length) {
      const eol = s.indexOf('\n', j)
      const end = eol === -1 ? s.length : eol
      const line = doc.strip ? s.slice(j, end).replace(/^\t+/, '') : s.slice(j, end)
      j = end + 1
      if (line === doc.delim) break
    }
  }
  return j
}

/** Index juste après la `)` d'un `$( )` dont la `(` est en `i` (guillemets et heredocs compris). */
function afterSubst(s: string, i: number): number {
  let depth = 1
  let docs: Heredoc[] = []
  let j = i + 1
  // Stryker disable next-line EqualityOperator: en j == s.length, charAt rend '' : le tour de plus n'avance que j et le repli rend s.length comme la fin de boucle
  while (j < s.length) {
    const c = s.charAt(j)
    if (c === '\\') {
      j += 2
    } else if (c === "'") {
      j = singleEnd(s, j) + 1
    } else if (c === '"') {
      j = readDouble(s, j).next
    } else if (c === '`') {
      j = afterBacktick(s, j)
    } else if (isHeredocAt(s, j)) {
      const h = readHeredoc(s, j)
      docs.push(h.doc)
      j = h.next
    } else if (c === '\n') {
      // Sans heredoc en attente, skipBodies rend `j + 1` : même effet que d'avancer d'un caractère.
      j = skipBodies(s, j + 1, docs)
      docs = []
    } else {
      if (c === '(') depth++
      if (c === ')') depth--
      j++
      if (depth === 0) return j
    }
  }
  return s.length
}

/** Un mot commençant en `i` : guillemets retirés, substitutions gardées telles quelles. */
function readToken(s: string, i: number): Token {
  let text = ''
  let j = i
  // Hors de la chaîne, charAt rend '' et BREAKS.includes('') est vrai : la boucle s'arrête à la fin.
  while (!BREAKS.includes(s.charAt(j))) {
    const c = s.charAt(j)
    const d = s.charAt(j + 1)
    if (c === "'") {
      const end = singleEnd(s, j)
      text += s.slice(j + 1, end)
      j = end + 1
    } else if (c === '"') {
      const t = readDouble(s, j)
      text += t.text
      j = t.next
    } else if (c === '`' || (c === '$' && (d === '(' || d === '{'))) {
      const e = c === '`' ? afterBacktick(s, j) : d === '(' ? afterSubst(s, j + 1) : afterBrace(s, j + 1)
      text += s.slice(j, e)
      j = e
    } else if (c === '\\') {
      if (d !== '\n') text += d
      j += 2
    } else {
      text += c
      j++
    }
  }
  return { text, next: j }
}

/** Redirection en `i` (`>`, `2>&1`, `&>`, `<`, `<<<`, `<<EOF`) : sa cible est retirée des mots. */
function readRedirect(s: string, i: number): { doc: Heredoc | null; next: number } {
  if (isHeredocAt(s, i)) return readHeredoc(s, i)
  let j = i + 1
  // Stryker disable next-line EqualityOperator: en j == s.length, '<>&|'.includes('') est vrai et j passe à s.length + 1, que tous les appelants traitent comme la fin
  while (j < s.length && '<>&|'.includes(s.charAt(j))) j++
  return { doc: null, next: readToken(s, skipBlanks(s, j)).next }
}

/**
 * Découpe une ligne Bash en commandes simples sur `&&`, `||`, `;`, `|`, `&` et les retours à la
 * ligne. Les guillemets, les échappements, `$( )`, les accents graves et les corps de heredoc ne
 * sont jamais coupés ; les commentaires, les parenthèses et les redirections sont retirés.
 * `op` est l'opérateur qui termine le segment (`''` pour le dernier).
 */
export function splitShell(command: string): Segment[] {
  const s = command
  const segments: Segment[] = []
  let words: string[] = []
  let docs: Heredoc[] = []
  let i = 0
  const end = (op: Op): void => {
    if (words.length > 0) segments.push({ words, op })
    words = []
  }
  while (i < s.length) {
    const c = s.charAt(i)
    const d = s.charAt(i + 1)
    if (isBlank(c) || c === '(' || c === ')') {
      i++
    } else if (c === '\\' && d === '\n') {
      i += 2
    } else if (c === '#') {
      const eol = s.indexOf('\n', i)
      i = eol < 0 ? s.length : eol
    } else if (c === '\n') {
      end('\n')
      i = skipBodies(s, i + 1, docs)
      docs = []
    } else if (c === ';') {
      end(';')
      i++
    } else if (c === '&' && d === '&') {
      end('&&')
      i += 2
    } else if (c === '|' && d === '|') {
      end('||')
      i += 2
    } else if (c === '|') {
      end('|')
      i++ // `|&` : le `&` qui suit ne termine aucune commande, la boucle le saute
    } else if (c === '<' || c === '>' || (c === '&' && d === '>')) {
      const r = readRedirect(s, i)
      if (r.doc !== null) docs.push(r.doc)
      i = r.next
    } else if (c === '&') {
      end('&')
      i++
    } else {
      const t = readToken(s, i)
      const isFd = /^\d+$/.test(t.text) && (s.charAt(t.next) === '<' || s.charAt(t.next) === '>')
      if (!isFd) words.push(t.text)
      i = t.next
    }
  }
  end('')
  return segments
}

// --- Appels CLI --------------------------------------------------------------------------------

/** Préfixes sautés avant le mot programme, avec leurs options qui prennent une valeur. */
const PREFIXES: ReadonlyMap<string, readonly string[]> = new Map([
  ['timeout', ['-s', '-k']],
  ['env', ['-u', '-C']],
  ['sudo', ['-u', '-g']],
  ['nice', ['-n']],
])
const KEYWORDS = ['do', 'then']
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const LOOPS = ['for', 'while', 'until']

/** Options globales de bridge-mcp qui prennent une valeur (refs/bridge-facts.md §1.1). */
const GLOBAL_VALUED = ['-c', '--config', '--jq', '--columns', '--limit', '--output-format']
/** Options propres à chaque sous-commande comptée, qui prennent une valeur (§1.2). */
const SUB_VALUED: ReadonlyMap<string, readonly string[]> = new Map([
  ['tool', ['--json-args']],
  ['t', ['--json-args']],
  ['exec', ['-t', '--timeout', '-w', '--working-dir']],
  ['upload', ['--mode', '--chunk-size']],
  ['download', ['--mode', '--chunk-size']],
])
/** Sous-commandes qui touchent une machine, et l'outil MCP qui donne leur nature. */
const HOST_SUBCOMMANDS: ReadonlyMap<string, string> = new Map([
  ['exec', 'ssh_exec'],
  ['upload', 'ssh_upload'],
  ['download', 'ssh_download'],
])
const HELP = ['-h', '--help', '-V', '--version']
/** Méta-outils du bridge : jamais comptés (§6.4). */
const META_TOOLS = ['mcp_list_tool_groups', 'mcp_search_tools', 'mcp_describe_tool', 'mcp_call_tool']

type Flags = { yes: boolean; dryRun: boolean; help: boolean; jsonArgs: string | null }
type Base = Pick<ParsedCall, 'via' | 'accordByOption' | 'ownsExit' | 'inLoop'>

/** Les mots de la commande elle-même : affectations, préfixes et mots-clés `do`/`then` sautés. */
function commandWords(words: readonly string[]): string[] {
  let i = 0
  // Stryker disable next-line EqualityOperator: en i == words.length, le mot de repli '' n'est ni mot-clé ni affectation ni préfixe : la boucle s'arrête comme à la fin
  while (i < words.length) {
    // Stryker disable next-line StringLiteral: la boucle garantit i < words.length, le repli n'est jamais lu
    const w = words[i] ?? ''
    const valued = PREFIXES.get(w)
    if (KEYWORDS.includes(w) || ASSIGNMENT.test(w)) {
      i++
    } else if (valued !== undefined) {
      i++
      for (let opt = words[i]; opt?.startsWith('-'); opt = words[i]) i += valued.includes(opt) ? 2 : 1
      if (w === 'timeout') i++
    } else {
      break
    }
  }
  return words.slice(i)
}

function isProgram(word: string): boolean {
  return word.slice(word.lastIndexOf('/') + 1) === 'bridge-mcp'
}

/** Lit l'option `w`, le mot en `i` ; rend l'index qui suit, valeur comprise. */
function readOption(words: readonly string[], i: number, w: string, valued: readonly string[], f: Flags): number {
  const eq = w.indexOf('=')
  const name = eq === -1 ? w : w.slice(0, eq)
  if (name === '--yes') f.yes = true
  if (name === '--dry-run') f.dryRun = true
  if (HELP.includes(name)) f.help = true
  // Stryker disable next-line StringLiteral: option finale sans valeur ; '' et tout autre texte sont un JSON illisible
  const next = words[i + 1] ?? ''
  if (name === '--json-args') f.jsonArgs = eq === -1 ? next : w.slice(eq + 1)
  return valued.includes(name) && eq === -1 ? i + 2 : i + 1
}

function isOption(w: string | undefined): w is string {
  return w?.startsWith('-') === true && w.length > 1
}

/** Valeur littérale utilisable, ou null (absente, vide, variable ou substitution du shell). */
function literal(v: unknown): string | null {
  return typeof v === 'string' && v !== '' && !/[$`]/.test(v) ? v : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
    // Stryker disable next-line BlockStatement: un catch vide rend undefined comme `return undefined`
  } catch {
    return undefined
  }
}

function lookup(tools: Readonly<Record<string, ToolInfo>>, name: string): ToolInfo | undefined {
  return Object.hasOwn(tools, name) ? tools[name] : undefined
}

/** Un appel par machine nommée ; aucun pour un outil sans machine. */
function callsOf(base: Base, tool: string, args: Record<string, unknown>, info: ToolInfo | undefined): ParsedCall[] {
  const nature: Nature = info === undefined ? 'inconnu' : info.nature
  const one = (host: string | null): ParsedCall => ({ ...base, tool, host, nature })
  if (info?.session === true) {
    const sessionId = literal(args['session_id'])
    return [sessionId === null ? one(null) : { ...one(null), sessionId }]
  }
  if (info?.hostless === true) return []
  if (base.inLoop) return [one(null)]
  if (info?.multi === true) {
    const hosts = args['hosts']
    return Array.isArray(hosts) && hosts.length > 0 ? hosts.map((h) => one(literal(h))) : [one(null)]
  }
  return [one(literal(args['host']))]
}

/** Arguments d'un `tool` : `--json-args` s'il est là (les clé=valeur sont alors ignorées), sinon les clé=valeur. */
function toolArgs(words: readonly string[], jsonArgs: string | null): Record<string, unknown> {
  if (jsonArgs !== null) {
    const v = parseJson(jsonArgs)
    return isRecord(v) ? v : {}
  }
  const args: Record<string, unknown> = {}
  for (const w of words) {
    const eq = w.indexOf('=')
    if (eq === -1) continue
    const key = w.slice(0, eq)
    const value = w.slice(eq + 1)
    // Le bridge lit un argument de type tableau comme du JSON (§1.2) ; seul hosts en est un ici.
    args[key] = key === 'hosts' ? parseJson(value) : value
  }
  return args
}

/** Les appels d'un segment dont le mot programme est bridge-mcp ; `rest` = les mots qui le suivent. */
function cliCalls(
  rest: readonly string[],
  ownsExit: boolean,
  inLoop: boolean,
  tools: Readonly<Record<string, ToolInfo>>,
): ParsedCall[] {
  const f: Flags = { yes: false, dryRun: false, help: false, jsonArgs: null }
  let i = 0
  for (let w = rest[i]; isOption(w); w = rest[i]) i = readOption(rest, i, w, GLOBAL_VALUED, f)
  // Stryker disable next-line StringLiteral: sans sous-commande, '' et tout autre texte tombent dans la même sortie vide
  const sub = rest[i] ?? ''
  const extra = SUB_VALUED.get(sub)
  const valued = extra === undefined ? GLOBAL_VALUED : [...GLOBAL_VALUED, ...extra]
  const positionals: string[] = []
  let isOptionZone = true
  for (i++; i < rest.length; ) {
    // Stryker disable next-line StringLiteral: la boucle garantit i < rest.length, le repli n'est jamais lu
    const w = rest[i] ?? ''
    if (isOptionZone && w === '--') {
      isOptionZone = false
      i++
    } else if (isOptionZone && isOption(w)) {
      i = readOption(rest, i, w, valued, f)
    } else {
      positionals.push(w)
      i++
      // `tool` : après le premier argument qui suit le nom, tout mot est un argument (§0.1.2).
      if ((sub === 'tool' || sub === 't') && positionals.length === 2) {
        positionals.push(...rest.slice(i))
        break
      }
    }
  }
  if (f.help) return []
  const base: Base = { via: 'cli', accordByOption: f.yes, ownsExit, inLoop }
  if (sub === 'tool' || sub === 't') {
    const name = positionals[0]
    if (name === undefined || f.dryRun || META_TOOLS.includes(name)) return []
    return callsOf(base, name, toolArgs(positionals.slice(1), f.jsonArgs), lookup(tools, name))
  }
  const mcpName = HOST_SUBCOMMANDS.get(sub)
  if (mcpName === undefined || (sub === 'exec' && f.dryRun)) return []
  const info = lookup(tools, mcpName)
  const nature: Nature = info === undefined ? 'inconnu' : info.nature
  return [{ ...base, tool: sub, host: inLoop ? null : literal(positionals[0]), nature }]
}

/**
 * Les appels au bridge d'une ligne Bash, dans l'ordre de la ligne. Une ligne sans bridge-mcp,
 * une sous-commande locale, `--dry-run` sur `tool`/`exec`, un outil sans machine : aucun appel.
 */
export function parseCli(command: string, tools: Readonly<Record<string, ToolInfo>>): ParsedCall[] {
  const segments = splitShell(command)
  const calls: ParsedCall[] = []
  let depth = 0
  segments.forEach((seg, index) => {
    const words = commandWords(seg.words)
    // Stryker disable next-line StringLiteral: une commande vide ('' ou autre texte) n'est ni boucle, ni done, ni bridge-mcp
    const first = words[0] ?? ''
    if (LOOPS.includes(first)) depth++
    if (isProgram(first)) {
      const ownsExit = index === segments.length - 1 && seg.op !== '&'
      calls.push(...cliCalls(words.slice(1), ownsExit, depth > 0, tools))
    }
    if (first === 'done' && depth > 0) depth--
  })
  return calls
}

// --- Appels MCP --------------------------------------------------------------------------------

/** Noms connus du serveur ou du plugin du bridge ; une sous-chaîne ne compte jamais (§5.1). */
const KNOWN_SERVERS = ['ssh-bridge', 'bridge-mcp', 'mcp-ssh-bridge']
const MCP_NAME = /^mcp__(.+?)__(.+)$/
const PLUGIN_SEGMENT = /^plugin_([^_]+)_(.+)$/

/** `'mcp__plugin_x_ssh-bridge__y'` -> `'ssh-bridge'` ; null pour un outil qui n'est pas MCP. */
export function serverOf(tool: string): string | null {
  const m = MCP_NAME.exec(tool)
  if (m === null) return null
  // Stryker disable next-line StringLiteral: le motif garantit le groupe 1, le repli n'est jamais lu
  const segment = m[1] ?? ''
  return PLUGIN_SEGMENT.exec(segment)?.[2] ?? segment
}

/** Vrai pour un nom de serveur connu, ou un segment `plugin_<plugin>_<serveur>` dont l'un des deux l'est. */
export function isBridgeServer(server: string): boolean {
  if (KNOWN_SERVERS.includes(server)) return true
  const p = PLUGIN_SEGMENT.exec(server)
  // Stryker disable next-line StringLiteral: le motif garantit les groupes 1 et 2, les replis ne sont jamais lus
  return p !== null && (KNOWN_SERVERS.includes(p[1] ?? '') || KNOWN_SERVERS.includes(p[2] ?? ''))
}

/**
 * Les appels d'un outil MCP du bridge : un par machine (un seul hors `multi`), aucun pour un
 * autre serveur, un méta-outil ou un outil sans machine. En mode progressif, `mcp_call_tool`
 * nomme l'outil dans `name` et ses arguments dans `arguments`.
 */
export function parseMcp(tool: string, input: unknown, tools: Readonly<Record<string, ToolInfo>>): ParsedCall[] {
  const m = MCP_NAME.exec(tool)
  // Stryker disable next-line StringLiteral: le motif garantit les groupes 1 et 2, les replis ne sont jamais lus
  if (m === null || !isBridgeServer(m[1] ?? '')) return []
  // Stryker disable next-line StringLiteral: idem
  let name = m[2] ?? ''
  let args: Record<string, unknown> = isRecord(input) ? input : {}
  if (name === 'mcp_call_tool') {
    const inner = args['name']
    name = typeof inner === 'string' ? inner.trim() : ''
    const innerArgs = args['arguments']
    args = isRecord(innerArgs) ? innerArgs : {}
  }
  if (name === '' || META_TOOLS.includes(name)) return []
  return callsOf({ via: 'mcp', accordByOption: false, ownsExit: true, inLoop: false }, name, args, lookup(tools, name))
}

// ─── Tâche 5 : classement d'un appel terminé (spec §5.1, amendements A3, A4, A7, A8) ───────────

type Step = { label: string; mark: 'ok' | 'ko' | 'off' }
type JsonObject = Record<string, unknown>

/** Séquence CSI (couleurs SGR du journal de bridge-mcp, bridge-facts §0.1.1, mais aussi effacement, curseur…). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) ouvre les séquences, c'est voulu
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g
/** Séquence OSC (lien hypertexte, titre de fenêtre), terminée par BEL ou ST. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) et BEL (0x07) bornent la séquence, c'est voulu
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
/** Caractères de contrôle restants : C0 sauf \n et \t, DEL, C1. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: c'est précisément ce qu'on retire
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** Ce qui suit le dernier \r de la ligne, \r finaux exclus. Linéaire : pas d'expression à ancre finale (quadratique sur une suite de \r). */
function afterLastCr(line: string): string {
  let end = line.length
  while (line[end - 1] === '\r') end -= 1
  return line.slice(line.lastIndexOf('\r', end - 1) + 1, end)
}

/**
 * Texte tel qu'un terminal l'afficherait, sans ses commandes : séquences CSI et OSC retirées, puis tout
 * caractère C0 (sauf \n et \t), DEL et C1. Un \r non suivi de \n ramène au début de la ligne : seul ce
 * qui suit le dernier \r de la ligne reste (barres de progression). \r+\n est un saut de ligne, et un \r final
 * sans rien après lui n'efface rien (un terminal garde le texte).
 */
export function stripControls(text: string): string {
  return text.replace(OSC, '').replace(CSI, '').split('\n').map(afterLastCr).join('\n').replace(CONTROLS, '')
}

/** Ligne du journal tracing de bridge-mcp, couleur retirée (amendement A3, bridge-facts §0.1.1). */
const TRACING_LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s/
/** Première ligne du texte d'un Bash sorti en erreur (bridge-facts §0). */
const BASH_EXIT_LINE = /^Exit code (\d+)$/
/** Ligne du bloc écrit par la sous-commande exec, avec deux-points (bridge-facts §3.10). */
const EXEC_EXIT_LINE = /^Exit code: (\d+)$/
/** Code distant en première ligne (bridge-facts §3.9). */
const EXIT_TAG = /^\[exit:(\d+)\]$/
/** Code distant dans un JSON : ssh_session_exec, ssh_exec_multi, exec --json (bridge-facts §6.1, §1.4). */
const JSON_EXIT_CODE = /"exit_code":\s*(\d+)/
/** Marques de troncature du bridge (bridge-facts §4.1 à §4.3) ; l'en-tête de ssh_output_fetch n'en est pas une (§4.4). */
const TRUNCATION_MARKS: readonly RegExp[] = [/output_id="/, /^--- \[truncated: /, /\[output stopped at the /]
/** Sous-commandes sans table de codes de sortie : seule la table des textes s'applique (amendement A4). */
const PLAIN_SUBCOMMANDS: readonly string[] = ['exec', 'upload', 'download']
/** Caractères qu'un texte relevé doit voir échappés pour devenir un motif littéral. */
const REGEX_SPECIALS = /[\\^$.*+?()[\]{}|]/g

/**
 * Début stable de chaque texte de refus du moteur, recopié à l'étape 8 de la tâche 5 depuis le spec §10,
 * ligne « Texte exact d'un refus au dialogue de permission et d'un refus du classifieur » (amendement A2),
 * dans l'ordre de RECORDED_REFUSALS (tests/pure/engine-texts.ts). Lu au début de la première ligne utile.
 */
const ENGINE_REFUSAL_PREFIXES: readonly string[] = [
  "The user doesn't want to proceed with this tool use. The tool use was rejected",
  'Permission for this action was denied by the Claude Code auto mode classifier.',
]
/**
 * Début stable de la marque de sortie persistée de Claude Code, recopié à l'étape 8 de la tâche 5 depuis
 * le spec §10, ligne « Marque de sortie Bash persistée par Claude Code », dans l'ordre de
 * RECORDED_PERSISTED. Cherché sur toute ligne utile d'un appel CLI (spec §5.1, drapeau tronqué).
 */
const ENGINE_PERSISTED_PREFIXES: readonly string[] = ['<persisted-output>']

function literalPatterns(prefixes: readonly string[], anchor: '^' | ''): RegExp[] {
  const patterns: RegExp[] = []
  for (const prefix of prefixes) patterns.push(new RegExp(anchor + prefix.replace(REGEX_SPECIALS, '\\$&')))
  return patterns
}

/** Seule source des textes du moteur dans le mod : classify les lit, register.tsx n'en garde aucune copie. */
export const ENGINE_REFUSAL_TEXTS: readonly RegExp[] = literalPatterns(ENGINE_REFUSAL_PREFIXES, '^')
export const ENGINE_PERSISTED_TEXTS: readonly RegExp[] = literalPatterns(ENGINE_PERSISTED_PREFIXES, '')

/**
 * Textes du bridge, lus sur la seule première ligne utile d'un appel en échec, `Error: ` retiré.
 * Première ligne qui correspond. Chaque motif cite sa source dans bridge-facts.
 */
export const BRIDGE_TEXTS: readonly { re: RegExp; state: CallState }[] = [
  // §3.1 : barrière destructive de la CLI, sans terminal et sans --yes (avant la ligne générale)
  { re: /^Command denied: .*\bPass --yes\b/, state: 'confirmation-manquante' },
  // §3.1 : liste noire, liste blanche, validateurs, élévation
  { re: /^Command denied: /, state: 'refuse' },
  // §3.2 : hôte absent de la configuration (avant la ligne générale « MCP invalid request »)
  { re: /^Unknown host: /, state: 'machine-inconnue' },
  { re: /^MCP invalid request: Unknown hosts: /, state: 'machine-inconnue' },
  // §3.4 : argument inconnu, champ inconnu ou manquant, paramètre de réduction refusé
  { re: /^MCP invalid request: /, state: 'erreur-usage' },
  { re: /^MCP missing parameter: /, state: 'erreur-usage' },
  { re: /^Unknown tool: /, state: 'erreur-usage' },
  { re: /^Tool `[^`]+` is registered but its group `[^`]+` is not enabled\./, state: 'erreur-usage' },
  { re: /^mcp_call_tool: /, state: 'erreur-usage' },
  // §1.2 : erreur d'analyse de clap (sous-commandes sans table de codes)
  { re: /^error: unexpected argument '/, state: 'erreur-usage' },
  // §2.2 : configuration illisible (sous-commandes sans table de codes)
  { re: /^Failed to load config from /, state: 'erreur-config' },
  // §3.3 : par hôte (texte complet) et dans le JSON des outils multi (texte court)
  { re: /^Rate limit exceeded\b/, state: 'limite' },
  // §3.8 : réponse au formulaire
  { re: /^User (declined execution of|cancelled confirmation for) destructive tool `/, state: 'decline' },
  { re: /^Confirmation for destructive tool `[^`]+` was not granted;/, state: 'confirmation-impossible' },
  {
    re: /^Tool `[^`]+` is destructive and `require_elicitation_on_destructive` is enabled, but /,
    state: 'confirmation-impossible',
  },
  { re: /^Could not build a confirmation prompt for `/, state: 'confirmation-impossible' },
  // §3.5 : authentification SSH et WinRM, clé d'hôte
  { re: /^SSH authentication failed for /, state: 'acces-refuse' },
  { re: /^SSH host key (mismatch|unknown) for /, state: 'acces-refuse' },
  // §3.5 : connexion SSH (refusée, sans route, DNS, délai de connexion)
  { re: /^SSH connection failed to /, state: 'injoignable' },
  // §2.3 : transport WinRM, sortie 1 (jamais tcp connect error ni Connection refused, §0.1.5)
  { re: /^SSH command execution failed: WinRM HTTP error: error sending request\b/, state: 'injoignable' },
  // §3.6 : la commande a pu tourner
  { re: /^SSH command timeout after \d+s\b/, state: 'delai-depasse' },
  { re: /^Request cancelled by client\b/, state: 'interrompu' },
  // §3.7 : garde d'OS et sudo, rien n'a tourné
  { re: /^Tool '[^']+' is (only|not) available on Windows hosts\./, state: 'erreur-usage' },
  { re: /^'sudo' (is not supported on Windows host|requires a POSIX shell)/, state: 'erreur-usage' },
]

/** Lignes utiles : séquences de contrôle retirées (stripControls), lignes de journal du bridge et lignes vides sautées, chaque ligne rognée. */
export function usefulLines(text: string): string[] {
  return stripControls(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !TRACING_LINE.test(line))
}

/** Première ligne utile, sans le préfixe `Error: ` de la CLI (bridge-facts §3, conventions). */
function headOf(lines: readonly string[]): string {
  return (lines[0] ?? '').replace(/^Error: /, '')
}

function tableState(head: string): CallState | undefined {
  return BRIDGE_TEXTS.find((row) => row.re.test(head))?.state
}

/** Code de la première ligne `[exit:N]` (bridge-facts §3.9), ou undefined si elle n'y est pas. */
function exitTag(lines: readonly string[]): number | undefined {
  // Stryker disable next-line StringLiteral: '' et tout autre texte ne sont pas une ligne [exit:N]
  const m = EXIT_TAG.exec(lines[0] ?? '')
  return m === null ? undefined : Number(m[1])
}

/**
 * Le JSON qui commence à la première ligne ouverte par `{` et va jusqu'à la fin, s'il se lit.
 * Un texte qui s'ouvre par `{` et se lit est un objet : aucun autre type n'est à écarter.
 */
function jsonIn(lines: readonly string[]): JsonObject | null {
  for (const [at, line] of lines.entries()) {
    if (!line.startsWith('{')) continue
    try {
      return JSON.parse(lines.slice(at).join('\n')) as JsonObject
    } catch {
      return null
    }
  }
  return null
}

/** `--json` : lignes utiles de `content[].text` (bridge-facts §1.4), ou null sans enveloppe. */
function contentLines(lines: readonly string[]): string[] | null {
  const doc = jsonIn(lines)
  if (doc === null || !Array.isArray(doc.content)) return null
  const texts: string[] = []
  for (const item of doc.content) {
    if (isRecord(item) && typeof item.text === 'string') texts.push(item.text)
  }
  return usefulLines(texts.join('\n'))
}

/** Entrée de cet hôte dans `results` d'un outil multi (bridge-facts §6.1), ou null. */
function hostEntry(lines: readonly string[], host: string | null): JsonObject | null {
  if (host === null) return null
  const doc = jsonIn(lines)
  if (doc === null || !Array.isArray(doc.results)) return null
  for (const item of doc.results) {
    if (isRecord(item) && item.host === host) return item
  }
  return null
}

/** `persisted` : lire aussi la marque de sortie persistée de Claude Code, que seule la CLI peut porter. */
function hasTruncation(lines: readonly string[], persisted: boolean): boolean {
  const marks = persisted ? TRUNCATION_MARKS.concat(ENGINE_PERSISTED_TEXTS) : TRUNCATION_MARKS
  return lines.some((line) => marks.some((mark) => mark.test(line)))
}

/** Code distant d'un appel qui a tourné : `[exit:N]` pour tout outil, `"exit_code":N` pour un outil codeWithoutError à un seul hôte. */
function remoteCode(lines: readonly string[], info: ToolInfo | undefined): number | undefined {
  const tag = exitTag(lines)
  if (tag !== undefined) return tag
  if (info?.codeWithoutError !== true || info.multi) return undefined
  const json = JSON_EXIT_CODE.exec(lines.join('\n'))
  return json === null ? undefined : Number(json[1])
}

/** Appel en échec : table des textes sur la première ligne utile, sinon `echec` avec cette ligne brute. */
function failed(head: string, truncated: boolean): Outcome {
  const state = tableState(head)
  if (state !== undefined) return { state, truncated }
  return head === '' ? { state: 'echec', truncated } : { state: 'echec', truncated, reason: head }
}

/** Appel réussi : `code N` si un code distant non nul est lu (A7, règle 4), sinon `fait`. */
function succeeded(lines: readonly string[], info: ToolInfo | undefined, truncated: boolean): Outcome {
  const code = remoteCode(lines, info)
  return code === undefined || code === 0 ? { state: 'fait', truncated } : { state: 'code', code, truncated }
}

/** La commande a tourné et a échoué : `echec-machine`, code et première ligne qui suit `[exit:N]`. */
function ranAndFailed(lines: readonly string[], truncated: boolean): Outcome {
  const code = exitTag(lines)
  if (code === undefined) return { state: 'echec-machine', truncated }
  const detail = lines[1]
  return detail === undefined
    ? { state: 'echec-machine', code, truncated }
    : { state: 'echec-machine', code, truncated, reason: detail }
}

function codeOutcome(code: number | undefined, truncated: boolean): Outcome {
  return code === undefined ? { state: 'code', truncated } : { state: 'code', code, truncated }
}

function fromHostEntry(entry: JsonObject, truncated: boolean): Outcome {
  if (typeof entry.error === 'string') return failed(entry.error, truncated)
  const code = entry.exit_code
  return typeof code === 'number' && code !== 0 ? { state: 'code', code, truncated } : { state: 'fait', truncated }
}

/** Code de la sous-commande exec : bloc `Exit code: N` (§3.10), sinon `"exit_code":N` de `exec --json` (§1.4). */
function execCode(lines: readonly string[]): number | undefined {
  for (const line of lines) {
    const block = EXEC_EXIT_LINE.exec(line)
    if (block !== null) return Number(block[1])
  }
  const json = JSON_EXIT_CODE.exec(lines.join('\n'))
  return json === null ? undefined : Number(json[1])
}

/** exec, upload, download : pas de table de codes, seule la table des textes (A4) ; exec est une commande libre. */
function classifySubcommand(tool: string, exit: number, lines: readonly string[]): Outcome {
  const truncated = hasTruncation(lines, true)
  const code = tool === 'exec' ? execCode(lines) : undefined
  // Un code distant 0 ne rend pas ✓ un Bash en échec : la sortie locale non nulle reste un échec.
  if (code !== undefined && (code !== 0 || exit === 0)) {
    return code === 0 ? { state: 'fait', truncated } : { state: 'code', code, truncated }
  }
  return exit === 0 ? { state: 'fait', truncated } : failed(headOf(lines), truncated)
}

function classifyCli(p: ParsedCall, lines: readonly string[], isError: boolean, info: ToolInfo | undefined): Outcome {
  // Stryker disable next-line StringLiteral: '' et tout autre texte ne sont pas une ligne `Exit code N`
  const bash = BASH_EXIT_LINE.exec(lines[0] ?? '')
  // Sortie locale : le code de l'en-tête Bash, ou 1 si isError le démontre (un « Exit code 0 » qui l'accompagne ne le démentit pas).
  const header = bash === null ? 0 : Number(bash[1])
  const exit = header !== 0 ? header : isError ? 1 : 0
  const raw = bash === null ? lines : lines.slice(1)
  if (PLAIN_SUBCOMMANDS.includes(p.tool)) return classifySubcommand(p.tool, exit, raw)
  const content = contentLines(raw)
  const body = content ?? raw
  const truncated = hasTruncation(raw, true) || (content !== null && hasTruncation(content, true))
  const entry = info?.multi === true ? hostEntry(body, p.host) : null
  if (entry !== null) return fromHostEntry(entry, truncated)
  switch (exit) {
    case 0:
      return succeeded(body, info, truncated)
    case 2:
      return { state: 'erreur-usage', truncated }
    case 3:
      return { state: tableState(headOf(body)) === 'machine-inconnue' ? 'machine-inconnue' : 'injoignable', truncated }
    case 4:
      return {
        state: tableState(headOf(body)) === 'confirmation-manquante' ? 'confirmation-manquante' : 'refuse',
        truncated,
      }
    case 5:
      return { state: 'erreur-config', truncated }
    case 6:
      return info?.codeWithoutError === true
        ? codeOutcome(remoteCode(body, info), truncated)
        : ranAndFailed(body, truncated)
    default:
      return failed(headOf(body), truncated)
  }
}

function classifyMcp(p: ParsedCall, lines: readonly string[], isError: boolean, info: ToolInfo | undefined): Outcome {
  const truncated = hasTruncation(lines, false)
  const entry = info?.multi === true ? hostEntry(lines, p.host) : null
  if (entry !== null) return fromHostEntry(entry, truncated)
  if (!isError) return succeeded(lines, info, truncated)
  if (exitTag(lines) !== undefined) return ranAndFailed(lines, truncated)
  return failed(headOf(lines), truncated)
}

/**
 * Classement d'un appel terminé (spec §5.1, règles 0 à 5) : refus de Claude Code, puis interruption,
 * puis segment CLI qui ne possède pas le code de sortie (incertain), puis CLI ou MCP.
 */
export function classify(p: ParsedCall, r: RunResult, tools: Readonly<Record<string, ToolInfo>>): Outcome {
  const lines = usefulLines(r.text)
  if (r.refusedByClaude || ENGINE_REFUSAL_TEXTS.some((re) => re.test(headOf(lines)))) {
    return { state: 'refuse-claude', truncated: false }
  }
  if (r.interrupted) return { state: 'interrompu', truncated: false }
  const info: ToolInfo | undefined = tools[p.tool]
  if (p.via === 'mcp') return classifyMcp(p, lines, r.isError, info)
  if (p.inLoop || !p.ownsExit) return { state: 'incertain', truncated: false }
  return classifyCli(p, lines, r.isError, info)
}

// ─── Pipeline réel (spec §5.1) ──────────────────────────────────────────────────────────────

const NOTHING_RAN: Step = { label: 'rien n’a tourné', mark: 'off' }

/** États décidés avant l'accord ou à sa place : aucune étape « accord » devant eux. */
const BEFORE_ACCORD: readonly CallState[] = [
  'refuse-claude',
  'decline',
  'confirmation-impossible',
  'confirmation-manquante',
]

/** Étape qui a décidé du résultat, par état ; `rien n’a tourné` suit les états où rien n'a tourné. */
const DECISIVE: Readonly<Record<CallState, (host: string, code: number | undefined) => Step[]>> = {
  'en-cours': (host) => [{ label: `${host} en cours`, mark: 'off' }],
  fait: (host) => [{ label: host, mark: 'ok' }],
  code: (host, code) => [{ label: `${host} code ${code ?? '?'}`, mark: 'ok' }],
  injoignable: (host) => [{ label: `${host} injoignable`, mark: 'ko' }, NOTHING_RAN],
  'machine-inconnue': (host) => [{ label: `${host} inconnue`, mark: 'ko' }, NOTHING_RAN],
  refuse: () => [{ label: 'refusé par le bridge', mark: 'ko' }, NOTHING_RAN],
  limite: () => [{ label: 'limité par le bridge', mark: 'ko' }, NOTHING_RAN],
  'confirmation-impossible': () => [{ label: 'confirmation impossible', mark: 'ko' }, NOTHING_RAN],
  'confirmation-manquante': () => [{ label: 'confirmation manquante', mark: 'ko' }, NOTHING_RAN],
  'echec-machine': (host, code) => [
    { label: code === undefined ? `${host} échec` : `${host} code ${code}`, mark: 'ko' },
  ],
  echec: () => [{ label: 'échec', mark: 'ko' }],
  'acces-refuse': (host) => [{ label: `${host} accès refusé`, mark: 'ko' }, NOTHING_RAN],
  'delai-depasse': (host) => [{ label: `${host} délai dépassé`, mark: 'ko' }],
  'erreur-usage': () => [{ label: 'erreur d’usage', mark: 'ko' }, NOTHING_RAN],
  'erreur-config': () => [{ label: 'erreur de config', mark: 'ko' }, NOTHING_RAN],
  'refuse-claude': () => [{ label: 'refusé par Claude Code', mark: 'off' }, NOTHING_RAN],
  decline: () => [{ label: 'accord', mark: 'ko' }, NOTHING_RAN],
  interrompu: () => [{ label: 'interrompu', mark: 'off' }],
  incertain: () => [{ label: 'incertain', mark: 'off' }],
}

function accordSteps(accord: BridgeCall['accord']): Step[] {
  if (accord === 'option') return [{ label: 'accord par --yes', mark: 'ok' }]
  return accord === 'formulaire-oui' ? [{ label: 'accord', mark: 'ok' }] : []
}

/**
 * Pipeline réel d'un appel : seules les étapes qui ont eu lieu ou qui ont décidé du résultat, aucune
 * étape ✓/✗ après un ✗ (seule la conclusion `rien n’a tourné` peut suivre). Une machine inconnue
 * s'écrit `machine`.
 */
export function steps(c: BridgeCall): Step[] {
  const host = c.host ?? 'machine'
  if (c.accord === 'formulaire-non') return DECISIVE.decline(host, c.code)
  const accord = BEFORE_ACCORD.includes(c.state) ? [] : accordSteps(c.accord)
  return accord.concat(DECISIVE[c.state](host, c.code))
}

// --- Tâche 11 : lecture des résultats du moteur, sortie de register.tsx (spec §6) ---------------
// Tests : tests/pure/glue.test.ts.

/** stdout puis stderr d'un résultat Bash ; une chaîne (texte d'erreur) telle quelle ; sinon rien. */
function outputText(result: unknown): string {
  if (typeof result === 'string') return result
  if (!isRecord(result)) return ''
  return [result.stdout, result.stderr].filter((x): x is string => typeof x === 'string').join('\n')
}

/**
 * Le RunResult d'un tool.call terminé, ce que classify lit. Sans résultat (`ran` absent : le cœur
 * a rejeté), l'appel est en erreur, interrompu, sans texte. Le `deny` d'un hook est une erreur et
 * un refus de Claude Code. Le texte est celui que le modèle a lu (`text`), sinon le `deny`, sinon
 * la sortie Bash. Interrompu : `aborted` (next.signal.aborted) ou `interrupted` du résultat Bash.
 * `refusedByClaude` de l'appelant est gardé tel quel.
 */
export function runResultOf(
  ran: { deny?: string; isError?: boolean; text?: string; result?: unknown } | undefined,
  aborted: boolean,
  refusedByClaude: boolean,
): RunResult {
  if (ran === undefined) return { isError: true, text: '', interrupted: true, refusedByClaude }
  const denied = typeof ran.deny === 'string'
  return {
    isError: denied || ran.isError === true,
    text: typeof ran.text === 'string' ? ran.text : typeof ran.deny === 'string' ? ran.deny : outputText(ran.result),
    interrupted: aborted || (isRecord(ran.result) && ran.result.interrupted === true),
    refusedByClaude: refusedByClaude || denied,
  }
}

/** Résultat Bash d'un appel passé en arrière-plan en cours de route : `backgroundTaskId` présent (spec §5.1). */
export function hasBackgroundTask(result: unknown): boolean {
  return isRecord(result) && typeof result.backgroundTaskId === 'string'
}

/** Nom de l'outil du formulaire : entre accents graves, ou bloc clôturé pour un nom non simple (refs/bridge-facts.md §5.1, §5.3). */
const CONFIRM_TOOL = /Confirm destructive operation: (?:`([^`]+)`|\n```\w*\n([^\n]+))/
/** `"host":"…"` du résumé JSON des arguments, trié et coupé à 300 caractères : peut manquer (amendement A9). */
const CONFIRM_HOST = /"host"\s*:\s*"([^"]+)"/

/**
 * Outil et machine que nomme le message du formulaire « Confirm destructive operation » ; null pour
 * ce qu'il tait. Jamais JSON.parse : le résumé des arguments peut être coupé (refs/bridge-facts.md §5.1).
 */
export function parseConfirmation(message: string): { tool: string | null; host: string | null } {
  const named = CONFIRM_TOOL.exec(message)
  return { tool: named?.[1] ?? named?.[2] ?? null, host: CONFIRM_HOST.exec(message)?.[1] ?? null }
}

/** Champs `id` et `host` du SessionInfo de ssh_session_create (refs/bridge-facts.md §6.1). */
const SESSION_ID = /"id"\s*:\s*"([^"]+)"/
const SESSION_HOST = /"host"\s*:\s*"([^"]+)"/

/**
 * La session que rend ssh_session_create, lue dans son SessionInfo
 * (`{"id":…,"host":…,"cwd":…,…}`, refs/bridge-facts.md §6.1) ; null si l'identifiant ou la
 * machine manque (tout autre texte).
 */
export function sessionFromCreate(text: string): { id: string; host: string } | null {
  const id = SESSION_ID.exec(text)?.[1]
  const host = SESSION_HOST.exec(text)?.[1]
  return id === undefined || host === undefined ? null : { id, host }
}
