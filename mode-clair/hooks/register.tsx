// mode-clair 0.2.0 : le branchement, et rien d'autre. Chaque événement passe par les fonctions
// pures (bridge.ts, state.ts, superpowers.ts, workflow.ts) et finit dans $.state ; les rendus
// relisent $.state et dessinent les lignes de view.ts. Les règles vivent dans ces modules,
// testés et mutés sous Node ; ici, chaque hook a son test moteur (tests/engine).
// Le mod n'observe que : chaque hook rend next(e) inchangé, chaque .catch retombe sur next(e).
// Un rendu n'écrit jamais l'état (D:3488) ; un dispatch lit un seul instant (D:3472).

import type { ElementConstructor, EngineInterface, Register, TextProps, Timer, ToolCallResult } from 'claude-code'
import { atom, read, update } from 'claude-code'

import type { BridgeCall, ClairState, Line, Tone, Workflow } from '../types'
import type { ParsedCall } from './bridge'
import {
  classify,
  hasBackgroundTask,
  isBridgeServer,
  parseCli,
  parseConfirmation,
  parseMcp,
  runResultOf,
  sessionFromCreate,
} from './bridge'
import { colorOf } from './colors'
import { fr } from './fr'
import {
  callsOf,
  closeWaiting,
  dropCalls,
  EMPTY,
  finishCalls,
  interruptOpen,
  markSeen,
  recordAccord,
  refuseByClaude,
  rememberSession,
  setWaiting,
  startCalls,
  waitingFor,
  withSuperpowers,
  withWorkflows,
} from './state'
import {
  expire,
  onAgent,
  onAgentDone,
  onAgentLaunched,
  onDocWrite,
  onSkill,
  runningAgentOf,
  STALE_MS,
} from './superpowers'
import { TOOLS } from './tools.generated'
import { bandLines, callLine, cardLines, cardText, fit, modeLabel, parseCard, statusText } from './view'
import {
  active,
  doneNotice,
  endWorkflow,
  foldJournal,
  MAX_JOURNAL_BYTES,
  parseMeta,
  quiet,
  startWorkflow,
} from './workflow'

const STATE = atom({ plugin: 'mode-clair', key: 'state' } as const, EMPTY, { shape: 'clair/0.2' })
const ROWS = { plugin: 'mode-clair', key: 'rows' } as const
const JOURNAL_MS = 3_000

type Engine = EngineInterface
type TextTag = ElementConstructor<TextProps>

// Variables de module : un rechargement les remet à zéro, session.start réarme (spec §5.3).
let shownStatus: string | undefined
let journalTimer: Timer | null = null
let staleTimer: Timer | null = null
const journalSizes = new Map<string, number>()

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const description = fr('Carte du mode clair : machines, problèmes, plan et workflows en cours')
    await $.command.register({ name: 'clair', description, argumentHint: '[machine]' })
    const s = await read($, STATE)
    shownStatus = statusText(s)
    $.ui.status(shownStatus)
    armJournal($, s)
    armStale($, s, await $.clock.now())
    return next(e)
  }).catch(($, e, next) => next(e))

  // /clair : la carte en texte (ce que lit le modèle), puis le marqueur « vu ».
  on('command.run', { command: 'clair' }, async ($, e) => {
    const now = await $.clock.now()
    const text = cardText(cardLines(await read($, STATE), e.args, now))
    await write($, (s) => markSeen(s, now))
    return { text }
  }).catch(() => ({ text: fr('la carte /clair n’a pas pu être calculée') }))

  // --- bridge-mcp : par la CLI dans Bash (jamais en arrière-plan, A10), et par MCP ----------

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const parsed = e.run_in_background === true ? [] : parseCli(e.command, TOOLS)
    if (parsed.length === 0) return next(e)
    return track(
      $,
      e.tool_use_id,
      e.agentId,
      parsed,
      () => next(e),
      () => next.signal.aborted,
    )
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    const { tool, tool_use_id, agentId, ...input } = e
    const parsed = parseMcp(tool, input, TOOLS)
    if (parsed.length === 0) return next(e)
    return track(
      $,
      tool_use_id,
      agentId,
      parsed,
      () => next(e),
      () => next.signal.aborted,
    )
  }).catch(($, e, next) => next(e))

  on('classic.PermissionDenied', async ($, e, next) => {
    const now = await $.clock.now()
    await write($, (s) => refuseByClaude(s, e.tool_use_id, now))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Le formulaire ne porte aucun tool_use_id (D:3978-3998) : waitingFor retrouve l'appel.
  on('classic.Elicitation', async ($, e, next) => {
    const now = await $.clock.now()
    if (isBridgeServer(e.mcp_server_name))
      await write($, (s) => setWaiting(s, waitingFor(s, parseConfirmation(e.message), now)))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Accord seulement sur `accept` avec `confirm: true` (refs/bridge-facts.md §5.5).
  on('classic.ElicitationResult', async ($, e, next) => {
    const granted = e.action === 'accept' && e.content?.confirm === true
    if (isBridgeServer(e.mcp_server_name))
      await write($, (s) => setWaiting(recordAccord(s, s.waiting?.callId ?? null, granted), null))
    return next(e)
  }).catch(($, e, next) => next(e))

  // Fin d'une boucle : ses appels encore ouverts sont interrompus ; un agent suivi par Superpowers est fini.
  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const id = e.agentId
    const after = await write($, (s) =>
      withSuperpowers(interruptOpen(s, id, now), (sp) => (id === undefined ? sp : onAgentDone(sp, id, now))),
    )
    if (id !== undefined) armStale($, after, now)
    return next(e)
  }).catch(($, e, next) => next(e))

  // --- Superpowers ------------------------------------------------------------------------

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const ran = await next(e)
    if (runResultOf(ran, false, false).isError) return ran
    const now = await $.clock.now()
    armStale($, await write($, (s) => withSuperpowers(s, (sp) => onSkill(sp, e.skill, now))), now)
    return ran
  }).catch(($, e, next) => next(e))

  // Un agent lancé en arrière-plan (async_launched) reste suivi jusqu'au turn.complete de sa boucle.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const now = await $.clock.now()
    armStale($, await write($, (s) => withSuperpowers(s, (sp) => onAgent(sp, e.description, e.prompt, now))), now)
    const ran = await next(e)
    const id = runningAgentOf(ran.result)
    if (id === null) return ran
    const at = await $.clock.now()
    armStale($, await write($, (s) => withSuperpowers(s, (sp) => onAgentLaunched(sp, id, at))), at)
    return ran
  }).catch(($, e, next) => next(e))

  // Un fichier n'est relu que si onDocWrite réagit à son chemin : aucun autre fichier n'est lu.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const ran = await next(e)
    const now = await $.clock.now()
    const s = await read($, STATE)
    if (
      runResultOf(ran, false, false).isError ||
      withSuperpowers(s, (sp) => onDocWrite(sp, e.file_path, null, now)) === s
    )
      return ran
    const text = e.tool === 'Write' ? e.content : await attempt($.fs.read(e.file_path))
    armStale($, await write($, (s) => withSuperpowers(s, (sp) => onDocWrite(sp, e.file_path, text, now))), now)
    return ran
  }).catch(($, e, next) => next(e))

  // --- Workflows ultracode : clé runId sinon taskId, journal à côté du transcript -------------

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || ran.result.error !== undefined) return ran
    const r = ran.result
    const inline = e.script === undefined ? null : parseMeta(e.script)
    const script = inline === null && r.scriptPath !== undefined ? await attempt($.fs.read(r.scriptPath)) : null
    const meta = inline ?? (script === null ? null : parseMeta(script))
    const remote = r.status === 'remote_launched'
    const journalPath = !remote && r.transcriptDir !== undefined ? `${r.transcriptDir}/journal.jsonl` : null
    const w = {
      key: r.runId ?? r.taskId,
      toolUseId: e.tool_use_id,
      name: meta?.name ?? e.name ?? r.workflowName ?? '',
      phases: meta?.phases ?? [],
      journalPath,
      remote,
    }
    const now = await $.clock.now()
    armJournal($, await write($, (s) => withWorkflows(s, (list) => startWorkflow(list, w, now))))
    return ran
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    const blocks = Array.isArray(e.message.content)
      ? e.message.content
      : [{ type: 'text', text: String(e.message.content) }]
    const done = doneNotice(blocks.map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n'))
    if (done === null) return stored
    if (
      polled(await write($, (s) => withWorkflows(s, (list) => endWorkflow(list, done.key, done.status)))).length === 0
    )
      stopJournal()
    return stored
  }).catch(($, e, next) => next(e))

  // --- Rendus : ils lisent, ils n'écrivent jamais (D:3488) ----------------------------------

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ctx = {
      now: await $.clock.now(),
      columns: e.props.bodyColumns,
      isWorking: e.props.isWorking,
      viewAgentId: e.props.view.agentId,
    }
    const lines = bandLines(await read($, STATE), ctx)
    if (lines.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const own = await next(e)
    // Le nœud du moteur ne va pas sous une Box à largeur (refusé par 2.1.300, capture d'écran) :
    // seules les lignes du mod sont tenues à bodyColumns, hors de la colonne du [-] (R:142).
    return (
      <Box flexDirection="column">
        {own}
        <Box flexDirection="column" width={e.props.bodyColumns}>
          {lines.map((line, i) => draw(Text, line, `b${i}`))}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // Variante « ToolResult non levé » (spec §10) : la ligne sous la rangée ToolUse de chaque appel ;
  // aucun hook ToolResult, qui doublerait la ligne sous un appel seul (il lève les deux).
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const rows = await rowsOf($, e.props.tool_use_id)
    if (rows.length === 0) return next(e)
    const s = await read($, STATE)
    const { Box, Text } = $.ui.resolve(e)
    const own = await next(e)
    return (
      <Box flexDirection="column">
        {own}
        {rows.map((c, i) => draw(Text, callLine(c, s, e.viewport?.columns ?? 80), `u${i}`))}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // Groupe replié : la ligne du moteur, puis une ligne par appel bridge suivi ; déplié : le moteur.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const ids = e.props.isExpanded
      ? []
      : e.props.calls.flatMap((c) => (c.tool_use_id === undefined ? [] : [c.tool_use_id]))
    const rows = (await Promise.all(ids.map((id) => rowsOf($, id)))).flat()
    if (rows.length === 0) return next(e)
    const s = await read($, STATE)
    const { Box, Text } = $.ui.resolve(e)
    const own = await next(e)
    return (
      <Box flexDirection="column">
        {own}
        {rows.map((c, i) => draw(Text, callLine(c, s, e.viewport?.columns ?? 80), `g${i}`))}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // La carte /clair se redessine depuis son seul texte, jamais l'état vivant (spec §4.4).
  on('ui.render', { component: 'CommandOutput', props: { command: 'clair' } }, ($, e, next) => {
    const lines = parseCard(e.props.text)
    if (lines.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines.map((line, i) => draw(Text, fit(line, e.viewport?.columns ?? 80, true), `c${i}`))}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const label = modeLabel(await read($, STATE))
    if (label === null) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  }).catch(($, e, next) => next(e))
}

// Écrire l'état seulement si le réducteur change quelque chose ; puis les membres `rows`
// des appels touchés (et `alsoRows`) ; puis la ligne d'état si son texte change.
async function write(
  $: Engine,
  change: (s: ClairState) => ClairState,
  alsoRows: readonly string[] = [],
): Promise<ClairState> {
  const seen = await read($, STATE)
  let before = seen
  const after =
    change(seen) === seen
      ? seen
      : await update($, STATE, (s) => {
          before = s
          return change(s)
        })
  const ids = new Set(alsoRows)
  const old = new Set(before.calls)
  for (const c of after.calls) if (!old.has(c)) ids.add(c.toolUseId)
  for (const id of ids) await $.state.set({ ...ROWS, id }, callsOf(after, id))
  const text = statusText(after)
  if (text !== shownStatus) {
    shownStatus = text
    $.ui.status(text)
  }
  return after
}

// Un appel bridge : en cours dès le début de son tool.call (amendement A1), fermé dans tous
// les cas par le finally, retiré s'il est passé en arrière-plan. Un refus déjà noté
// (PermissionDenied) est gardé par finishCalls.
async function track(
  $: Engine,
  toolUseId: string,
  agentId: string | undefined,
  parsed: ParsedCall[],
  run: () => Promise<ToolCallResult>,
  isAborted: () => boolean,
): Promise<ToolCallResult> {
  const startedAt = await $.clock.now()
  await write($, (s) => startCalls(s, toolUseId, agentId, parsed, startedAt))
  let ran: ToolCallResult | undefined
  try {
    ran = await run()
    return ran
  } finally {
    const endedAt = await $.clock.now()
    const result = runResultOf(ran, isAborted(), false)
    const created = parsed.some((p) => p.tool === 'ssh_session_create') ? sessionFromCreate(result.text) : null
    const settle = (s: ClairState): ClairState => {
      const closed = closeWaiting(
        finishCalls(
          s,
          toolUseId,
          parsed.map((p) => classify(p, result, TOOLS)),
          endedAt,
        ),
        toolUseId,
      )
      return created === null ? closed : rememberSession(closed, created.id, created.host)
    }
    if (hasBackgroundTask(ran?.result)) await write($, (s) => dropCalls(s, toolUseId), [toolUseId])
    else await write($, settle)
  }
}

// Superpowers : abandon après STALE_MS sans événement, par un minuteur visé sur
// lastEventAt + STALE_MS (jamais calculé au rendu, spec §5.2). Un minuteur ne passe par aucun
// .catch de hook : il rattrape lui-même son rejet (écriture refusée, $ du dispatch périmé).
function armStale($: Engine, s: ClairState, now: number): void {
  staleTimer?.cancel()
  const sp = s.superpowers
  staleTimer =
    sp === null || sp.isStale
      ? null
      : $.clock.after(Math.max(1, sp.lastEventAt + STALE_MS - now), () => void expireNow($).catch(() => undefined))
}

async function expireNow($: Engine): Promise<void> {
  const now = await $.clock.now()
  armStale($, await write($, (s) => withSuperpowers(s, (sp) => expire(sp, now))), now)
}

// Journal des workflows : un minuteur tant qu'un workflow local est actif ; stat à chaque
// tic, lecture seulement si la taille a changé (spec §5.3). Le tic rattrape son propre rejet.
function polled(s: ClairState): Workflow[] {
  return active(s.workflows).filter((w) => w.journalPath !== null)
}

function armJournal($: Engine, s: ClairState): void {
  if (journalTimer === null && polled(s).length > 0)
    journalTimer = $.clock.every(JOURNAL_MS, () => void tick($).catch(() => undefined))
}

function stopJournal(): void {
  journalTimer?.cancel()
  journalTimer = null
}

async function tick($: Engine): Promise<void> {
  const now = await $.clock.now()
  const mtimes = new Map<string, number>()
  const texts = new Map<string, string>()
  for (const w of polled(await read($, STATE))) {
    if (w.journalPath === null) continue
    const stat = await attempt($.fs.stat(w.journalPath))
    if (stat === null) continue
    mtimes.set(w.key, stat.mtimeMs)
    if (stat.size === journalSizes.get(w.key) || stat.size > MAX_JOURNAL_BYTES) continue
    const text = await attempt($.fs.read(w.journalPath))
    if (text === null) continue
    journalSizes.set(w.key, stat.size)
    texts.set(w.key, text)
  }
  const fold = (ws: Workflow[]) =>
    texts.size === 0 ? ws : ws.map((w) => (texts.has(w.key) ? foldJournal(w, texts.get(w.key) ?? '', now) : w))
  const after = await write($, (s) => withWorkflows(s, (ws) => quiet(fold(ws), now, (w) => mtimes.get(w.key) ?? null)))
  if (polled(after).length === 0) stopJournal()
}

// Les appels d'un tool_use_id, lus dans leur membre de la famille `rows` : une rangée d'outil
// non suivi ne lit que ce membre vide, et n'est donc jamais redessinée par une écriture ailleurs.
async function rowsOf($: Engine, toolUseId: string): Promise<BridgeCall[]> {
  return (await $.state.get({ ...ROWS, id: toolUseId })).value ?? []
}

// Une Line devient un Text par morceau, chacun coupé en fin de ligne, tons du contrat :
// ok success, erreur error, attention warning, accent claude, atténué dimColor, machine sa couleur.
function draw(Text: TextTag, line: Line, key: string) {
  const pieces = line.map((piece, i) => (
    <Text key={`${key}.${i}`} wrap="truncate-end" {...toneProps(piece.tone)}>
      {piece.text}
    </Text>
  ))
  return (
    <Text key={key} wrap="truncate-end">
      {pieces}
    </Text>
  )
}

function toneProps(tone: Tone): Pick<TextProps, 'color' | 'dimColor'> {
  if (typeof tone === 'object') return { color: colorOf(tone.machine) }
  const colors = { ok: 'success', erreur: 'error', attention: 'warning', accent: 'claude' } as const
  return tone === 'attenue' ? { dimColor: true } : tone === 'texte' ? {} : { color: colors[tone] }
}

// Une lecture du moteur qui rejette (fichier absent, refus) vaut null.
function attempt<T>(pending: Promise<T>): Promise<T | null> {
  return pending.catch(() => null)
}
