// Sélection des fenêtres de rejeu dans un transcript de Claude Code (spec vérif. §5.1). Module pur :
// extract.ts lit les fichiers en flux, ligne à ligne, et passe chaque ligne à TranscriptScan ; un
// fichier à la fois, seuls les appels que le mod suit sont gardés en mémoire.
//
// Ne retient que des événements attestés par le transcript (D9) : appels d'outils avec leur
// résultat, fin de tour (`turn_duration`), notifications de tâche. Un appel sans résultat dans le
// fichier n'est pas retenu.

import type { ToolCallResult } from 'claude-code'
import { bridgeCalls, classifyLine, isBridgeCommand, type RawEvent, type RawToolCall } from './anonymize'

export type ScenarioType =
  | 'bridge-cli'
  | 'bridge-mcp'
  | 'workflow'
  | 'superpowers'
  | 'agent'
  | 'plan-write'
  | 'notification'

/** Une fenêtre : ses événements réels, sa signature (formes seulement) et les fichiers que le mod lirait. */
export type Candidate = { type: ScenarioType; id: string; signature: string; events: RawEvent[]; filePaths: string[] }

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Lignes qui peuvent porter un événement retenu (le reste n'est pas analysé). */
const QUICK = /"tool_use"|"tool_result"|turn_duration|task-notification/
const UNDER_DOCS = /(^|\/)docs\/superpowers\//
/** Plus longue fenêtre bridge (appels d'une même boucle entre deux fins de tour). */
const MAX_BRIDGE = 12
/** Plus longue fenêtre Superpowers. */
const MAX_SUPERPOWERS = 60

function serverOf(tool: string): string {
  return /^mcp__(.+?)__/.exec(tool)?.[1] ?? ''
}

function isBridgeTool(tool: string, input: unknown): boolean {
  if (tool === 'Bash') return isRecord(input) && typeof input.command === 'string' && isBridgeCommand(input.command)
  return tool.startsWith('mcp__') && serverOf(tool).includes('bridge')
}

function isSuperpowersSkill(tool: string, input: unknown): boolean {
  return (
    tool === 'Skill' && isRecord(input) && typeof input.skill === 'string' && input.skill.startsWith('superpowers:')
  )
}

function isDocWrite(tool: string, input: unknown): boolean {
  return (
    (tool === 'Write' || tool === 'Edit') &&
    isRecord(input) &&
    typeof input.file_path === 'string' &&
    UNDER_DOCS.test(input.file_path)
  )
}

/** Appels que le mod suit (REFERENCE.md) : bridge, Workflow, Skill Superpowers, Agent, écritures de plans. */
export function interesting(tool: string, input: unknown): boolean {
  return (
    isBridgeTool(tool, input) ||
    tool === 'Workflow' ||
    tool === 'Agent' ||
    isSuperpowersSkill(tool, input) ||
    isDocWrite(tool, input)
  )
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is Json => isRecord(b) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

/** Lecture d'un transcript ligne à ligne : appels suivis appariés à leur résultat, fins de tour, notifications. */
export class TranscriptScan {
  private readonly slots: (RawEvent | null)[] = []
  private readonly pending = new Map<string, { call: Omit<RawToolCall, 'result' | 'doneAt'>; slot: number }>()

  line(text: string): void {
    if (!QUICK.test(text)) return
    let o: unknown
    try {
      o = JSON.parse(text)
    } catch {
      return
    }
    if (!isRecord(o)) return
    const at = Date.parse(String(o.timestamp))
    if (Number.isNaN(at)) return
    const agentId = typeof o.agentId === 'string' ? o.agentId : undefined
    if (o.type === 'system' && o.subtype === 'turn_duration') {
      this.slots.push(agentId === undefined ? { kind: 'turn.complete', at } : { kind: 'turn.complete', at, agentId })
      return
    }
    const message = isRecord(o.message) ? o.message : undefined
    const content = message?.content
    if (o.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (!isRecord(b) || b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') continue
        if (!interesting(b.name, b.input)) continue
        const call = {
          kind: 'tool.call' as const,
          at,
          tool: b.name,
          toolUseId: b.id,
          ...(agentId === undefined ? {} : { agentId }),
          input: b.input,
        }
        this.pending.set(b.id, { call, slot: this.slots.length })
        this.slots.push(null)
      }
      return
    }
    if (o.type !== 'user') return
    const results = Array.isArray(content) ? content.filter((b) => isRecord(b) && b.type === 'tool_result') : []
    if (results.length === 0) {
      const text = contentText(content)
      if (text.includes('<task-notification>')) this.slots.push({ kind: 'session.append', at, text })
      return
    }
    for (const b of results as Json[]) {
      const id = String(b.tool_use_id)
      const open = this.pending.get(id)
      if (open === undefined) continue
      this.pending.delete(id)
      const shown = contentText(b.content)
      const stored = results.length === 1 && o.toolUseResult !== undefined ? o.toolUseResult : shown
      const result: ToolCallResult =
        b.is_error === true ? { isError: true, result: stored, text: shown } : { result: stored, text: shown }
      this.slots[open.slot] = { ...open.call, doneAt: at, result }
    }
  }

  /** Événements retenus, par date ; les appels restés sans résultat sont écartés. */
  finish(): RawEvent[] {
    return this.slots.filter((e): e is RawEvent => e !== null).sort((a, b) => a.at - b.at)
  }
}

// --- Signatures (formes seulement, jamais de contenu) -------------------------------------------

const TRUNCATION = /<persisted-output>|--- \[truncated: |output_id="|\[output stopped at the /

/** Première ligne utile : ni vide, ni `Exit code N`, ni journal tracing. */
function firstUseful(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim() === '' || /^Exit code \d+$/.test(line.trim())) continue
    if (classifyLine(line) === 'tracing') continue
    return line
  }
  return ''
}

function statusOf(result: unknown): string {
  return isRecord(result) && typeof result.status === 'string' && /^[a-z_]+$/.test(result.status) ? result.status : '?'
}

function callSignature(e: RawToolCall): string {
  const input = isRecord(e.input) ? e.input : {}
  const text = typeof e.result.text === 'string' ? e.result.text : ''
  const failed = e.result.isError === true
  const head = classifyLine(firstUseful(text))
  const trunc = TRUNCATION.test(text) ? ':trunc' : ''
  if (e.tool === 'Bash') {
    const segments = bridgeCalls(String(input.command))
      .map((c) => `${c.sub}/${c.tool}`)
      .join(',')
    const code = /^Exit code (\d+)$/m.exec(text)?.[1] ?? '?'
    const bg =
      input.run_in_background === true || (isRecord(e.result.result) && 'backgroundTaskId' in e.result.result)
        ? ':bg'
        : ''
    const dry = /--dry-run\b/.test(String(input.command)) ? ':dry' : ''
    return `cli:${segments}:${failed ? `x${code}` : 'ok'}:${head}${trunc}${bg}${dry}`
  }
  if (e.tool.startsWith('mcp__')) {
    const tool = e.tool.split('__').pop() ?? '?'
    const name = /^(?:ssh|win|mcp)_[a-z0-9_]+$/.test(tool) ? tool : '?'
    const tag = /^\[exit:(\d+)\]/.exec(text.trim())?.[1]
    const exit = tag === undefined ? '' : tag === '0' ? ':exit0' : ':exitN'
    return `mcp:${name}:${failed ? 'err' : 'ok'}:${head}${trunc}${exit}`
  }
  if (e.tool === 'Skill') return `skill:${failed ? 'err' : String(input.skill).replace(/[^a-z:-]/g, '')}`
  if (e.tool === 'Agent') {
    const description = String(input.description ?? '')
    const kind =
      /final (code )?review/i.test(description) || /code-reviewer\.md/.test(String(input.prompt ?? ''))
        ? 'review'
        : /\b(Task|Tâche|T{1,2})\s*\d+\b/.test(description)
          ? 'task'
          : 'plain'
    return `agent:${kind}:${failed ? 'err' : statusOf(e.result.result)}`
  }
  if (e.tool === 'Write' || e.tool === 'Edit') {
    const path = String(input.file_path)
    const where = /docs\/superpowers\/plans\//.test(path)
      ? 'plans'
      : /docs\/superpowers\/specs\//.test(path)
        ? 'specs'
        : 'docs'
    return `${e.tool.toLowerCase()}:${where}:${failed ? 'err' : 'ok'}`
  }
  if (e.tool === 'Workflow')
    return `workflow:${failed ? 'err' : statusOf(e.result.result)}:${typeof input.script === 'string' ? 'inline' : 'file'}`
  return `tool:${failed ? 'err' : 'ok'}`
}

export function eventSignature(e: RawEvent): string {
  if (e.kind === 'turn.complete') return 'turn'
  if (e.kind === 'session.append') {
    const status = /<status>([a-z_]+)<\/status>/.exec(e.text)?.[1] ?? '?'
    return `notice:${status}`
  }
  return callSignature(e)
}

/** Signature d'une fenêtre : suite des signatures, une répétition consécutive écrite une fois avec `+`. */
export function signature(type: ScenarioType, events: readonly RawEvent[]): string {
  const parts: string[] = []
  for (const e of events) {
    const sig = eventSignature(e)
    const last = parts[parts.length - 1]
    if (last === sig || last === `${sig}+`) parts[parts.length - 1] = `${sig}+`
    else parts.push(sig)
  }
  return `${type}|${parts.join(' ')}`
}

/** FNV-1a 32 bits, en hexadécimal : identifiant stable d'une signature. */
function fnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function candidate(type: ScenarioType, events: RawEvent[], filePaths: string[] = []): Candidate {
  const sig = signature(type, events)
  return { type, id: `${type}-${fnv(sig)}`, signature: sig, events, filePaths }
}

const isCall = (e: RawEvent): e is RawToolCall => e.kind === 'tool.call'

function planPaths(events: readonly RawEvent[]): string[] {
  const paths = new Set<string>()
  for (const e of events)
    if (
      isCall(e) &&
      e.tool === 'Edit' &&
      isRecord(e.input) &&
      /docs\/superpowers\/plans\//.test(String(e.input.file_path))
    )
      paths.add(String(e.input.file_path))
  return [...paths]
}

/**
 * Fenêtres d'un transcript : appels bridge d'une même boucle jusqu'à sa fin de tour ; chaque
 * Workflow avec ses notifications ; chaque suite Superpowers (d'un skill Superpowers au prochain
 * `brainstorming`) avec ses agents et ses écritures de plans ; puis, seuls, les agents, écritures
 * et notifications restés hors fenêtre.
 */
export function windows(events: readonly RawEvent[]): Candidate[] {
  const out: Candidate[] = []
  const used = new Set<RawEvent>()

  // Appels bridge, par boucle (agentId), jusqu'à la fin de tour de cette boucle.
  const groups = new Map<string, RawToolCall[]>()
  const emitBridge = (group: RawToolCall[], end?: RawEvent) => {
    const type = group.some((e) => e.tool === 'Bash') ? 'bridge-cli' : 'bridge-mcp'
    out.push(candidate(type, end === undefined ? [...group] : [...group, end]))
  }
  for (const e of events) {
    const key = (e.kind === 'session.append' ? undefined : e.agentId) ?? ''
    if (isCall(e) && isBridgeTool(e.tool, e.input)) {
      const group = groups.get(key) ?? []
      group.push(e)
      groups.set(key, group)
      if (group.length >= MAX_BRIDGE) {
        emitBridge(group)
        groups.delete(key)
      }
    } else if (e.kind === 'turn.complete') {
      const group = groups.get(key)
      if (group !== undefined) emitBridge(group, e)
      groups.delete(key)
    }
  }
  for (const group of groups.values()) emitBridge(group)

  // Workflows et leurs notifications de fin.
  for (const e of events) {
    if (!isCall(e) || e.tool !== 'Workflow') continue
    const r = isRecord(e.result.result) ? e.result.result : {}
    const keys = [`<tool-use-id>${e.toolUseId}</tool-use-id>`]
    if (typeof r.taskId === 'string') keys.push(`<task-id>${r.taskId}</task-id>`)
    const notices = events.filter(
      (n) => n.kind === 'session.append' && n.at >= e.at && keys.some((k) => n.text.includes(k)),
    )
    for (const n of notices) used.add(n)
    const paths: string[] = []
    if (typeof r.scriptPath === 'string') paths.push(r.scriptPath)
    if (typeof r.transcriptDir === 'string' && r.status !== 'remote_launched')
      paths.push(`${r.transcriptDir}/journal.jsonl`)
    out.push(candidate('workflow', [e, ...notices], paths))
  }

  // Suites Superpowers.
  let run: RawEvent[] | null = null
  const closeRun = () => {
    if (run !== null) out.push(candidate('superpowers', run, planPaths(run)))
    run = null
  }
  for (const e of events) {
    if (!isCall(e)) continue
    const skill = isSuperpowersSkill(e.tool, e.input)
    if (skill && (run === null || (e.input as Json).skill === 'superpowers:brainstorming')) {
      closeRun()
      run = []
    }
    const current = run as RawEvent[] | null
    if (current === null || current.length >= MAX_SUPERPOWERS) continue
    if (skill || isDocWrite(e.tool, e.input) || e.tool === 'Agent') {
      current.push(e)
      used.add(e)
    }
  }
  closeRun()

  // Restés seuls.
  for (const e of events) {
    if (used.has(e)) continue
    if (isCall(e) && e.tool === 'Agent') out.push(candidate('agent', [e]))
    else if (isCall(e) && isDocWrite(e.tool, e.input)) out.push(candidate('plan-write', [e], planPaths([e])))
    else if (e.kind === 'session.append') out.push(candidate('notification', [e]))
  }
  return out
}
