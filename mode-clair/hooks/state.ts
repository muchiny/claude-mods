// L'état de mode-clair : la table des états (spec §5.4), les réducteurs et
// les sélecteurs.
//
// Module pur : aucun `$`, aucune horloge (l'heure arrive en argument `now`),
// seulement des `import type`. Un réducteur qui ne change rien rend la MÊME
// référence : register.tsx n'écrit alors rien, et rien n'est redessiné.

import type { BridgeCall, CallState, ClairState, Superpowers, Tone, Waiting, Workflow } from '../types'
import type { Outcome, ParsedCall } from './bridge'

export type StateRow = {
  sign: '●' | '✓' | '✗' | '○' | '?'
  tone: Tone
  inLook: boolean
  counted: boolean
  isCall: boolean
  label: string
}

/**
 * Spec §5.4, une ligne par état, plus 'acces-refuse' et 'delai-depasse'
 * (amendement A8). `inLook` : dans « à regarder » ; `counted` : compté dans
 * `clair ✗ n` ; `isCall` : compté comme appel de la machine. Le libellé de
 * 'code' est suivi du code distant par view.ts (`code 3`, `code ?`).
 */
export const STATE_TABLE: Readonly<Record<CallState, StateRow>> = {
  'en-cours': { sign: '●', tone: 'accent', inLook: false, counted: false, isCall: true, label: 'en cours' },
  fait: { sign: '✓', tone: 'ok', inLook: false, counted: false, isCall: true, label: 'fait' },
  code: { sign: '✓', tone: 'texte', inLook: false, counted: false, isCall: true, label: 'code' },
  injoignable: { sign: '✗', tone: 'erreur', inLook: true, counted: true, isCall: false, label: 'injoignable' },
  'machine-inconnue': {
    sign: '✗',
    tone: 'erreur',
    inLook: true,
    counted: true,
    isCall: false,
    label: 'machine inconnue',
  },
  refuse: { sign: '✗', tone: 'erreur', inLook: true, counted: true, isCall: false, label: 'refusé' },
  limite: { sign: '✗', tone: 'attention', inLook: true, counted: true, isCall: false, label: 'limité' },
  'confirmation-impossible': {
    sign: '✗',
    tone: 'erreur',
    inLook: true,
    counted: true,
    isCall: false,
    label: 'confirmation impossible',
  },
  'confirmation-manquante': {
    sign: '✗',
    tone: 'attention',
    inLook: true,
    counted: true,
    isCall: false,
    label: 'confirmation manquante',
  },
  'echec-machine': {
    sign: '✗',
    tone: 'erreur',
    inLook: true,
    counted: true,
    isCall: true,
    label: 'échec sur la machine',
  },
  echec: { sign: '✗', tone: 'erreur', inLook: true, counted: true, isCall: true, label: 'échec' },
  'acces-refuse': { sign: '✗', tone: 'erreur', inLook: true, counted: true, isCall: false, label: 'accès refusé' },
  'delai-depasse': { sign: '✗', tone: 'attention', inLook: true, counted: true, isCall: true, label: 'délai dépassé' },
  'erreur-usage': {
    sign: '✗',
    tone: 'attention',
    inLook: true,
    counted: false,
    isCall: false,
    label: 'erreur d’usage',
  },
  'erreur-config': {
    sign: '✗',
    tone: 'attention',
    inLook: true,
    counted: false,
    isCall: false,
    label: 'erreur de config',
  },
  'refuse-claude': {
    sign: '○',
    tone: 'attenue',
    inLook: false,
    counted: false,
    isCall: false,
    label: 'refusé par Claude Code',
  },
  decline: { sign: '○', tone: 'attenue', inLook: false, counted: false, isCall: false, label: 'décliné' },
  interrompu: { sign: '○', tone: 'attenue', inLook: false, counted: false, isCall: true, label: 'interrompu' },
  incertain: { sign: '?', tone: 'attenue', inLook: false, counted: false, isCall: true, label: 'incertain' },
}

/** Appels gardés au plus ; seuls les appels terminés sont évincés. */
export const MAX_CALLS = 200

export const EMPTY: ClairState = {
  calls: [],
  hostOrder: [],
  seenAt: 0,
  waiting: null,
  superpowers: null,
  workflows: [],
  sessions: {},
}

/**
 * Plafond de MAX_CALLS : les plus anciens appels terminés partent d'abord ;
 * un appel en cours n'est jamais évincé, quitte à dépasser le plafond.
 */
function capped(calls: BridgeCall[]): BridgeCall[] {
  let excess = calls.length - MAX_CALLS
  return calls.filter((c) => {
    if (excess > 0 && c.state !== 'en-cours') {
      excess -= 1
      return false
    }
    return true
  })
}

/**
 * Un appel en cours par élément de `parsed`, d'identifiant `${toolUseId}#${n}`.
 * L'hôte d'un `ssh_session_exec` vient de la session retenue par
 * rememberSession, sinon il reste inconnu (null). Une machine entre dans
 * hostOrder à sa première apparition ; une machine inconnue n'y entre jamais.
 * Rien à suivre, ou appels déjà commencés pour ce toolUseId : même référence.
 */
export function startCalls(
  s: ClairState,
  toolUseId: string,
  agentId: string | undefined,
  parsed: ParsedCall[],
  now: number,
): ClairState {
  if (parsed.length === 0 || s.calls.some((c) => c.toolUseId === toolUseId)) return s
  const fresh = parsed.map(
    (p, n): BridgeCall => ({
      id: `${toolUseId}#${n}`,
      toolUseId,
      ...(agentId === undefined ? {} : { agentId }),
      via: p.via,
      tool: p.tool,
      host: p.host ?? Object.entries(s.sessions).find(([id]) => id === p.sessionId)?.[1] ?? null,
      nature: p.nature,
      state: 'en-cours',
      truncated: false,
      accord: p.accordByOption ? 'option' : 'aucun',
      startedAt: now,
    }),
  )
  const hostOrder = [...s.hostOrder]
  for (const c of fresh) {
    if (c.host !== null && !hostOrder.includes(c.host)) hostOrder.push(c.host)
  }
  return { ...s, calls: capped([...s.calls, ...fresh]), hostOrder }
}

/** Les appels d'un tool_use_id, dans l'ordre de leurs rangs. */
export function callsOf(s: ClairState, toolUseId: string): BridgeCall[] {
  return s.calls.filter((c) => c.toolUseId === toolUseId)
}

/** Index de couleur d'une machine : son rang d'apparition, -1 si elle n'est jamais apparue. */
export function hostIndex(s: ClairState, host: string): number {
  return s.hostOrder.indexOf(host)
}

/** Retient l'hôte d'une session ssh (réponse de ssh_session_create). */
export function rememberSession(s: ClairState, sessionId: string, host: string): ClairState {
  return s.sessions[sessionId] === host ? s : { ...s, sessions: { ...s.sessions, [sessionId]: host } }
}

/** Les appels en cours : tous, ou seulement ceux de l'agent `agentId` quand il est donné. */
export function running(s: ClairState, agentId?: string): BridgeCall[] {
  return s.calls.filter((c) => c.state === 'en-cours' && (agentId === undefined || c.agentId === agentId))
}

const UNKNOWN: Outcome = { state: 'incertain', truncated: false }
const REFUSED: Outcome = { state: 'refuse-claude', truncated: false }
const INTERRUPTED: Outcome = { state: 'interrompu', truncated: false }

/** Le rang n de l'identifiant `${toolUseId}#${n}`. */
function rankOf(c: BridgeCall): number {
  return Number(c.id.slice(c.id.lastIndexOf('#') + 1))
}

/** L'appel fermé par l'issue `o` à l'heure `now` ; aucune clé ne vaut `undefined`. */
function closed(c: BridgeCall, o: Outcome, now: number): BridgeCall {
  return {
    id: c.id,
    toolUseId: c.toolUseId,
    ...(c.agentId === undefined ? {} : { agentId: c.agentId }),
    via: c.via,
    tool: c.tool,
    host: c.host,
    nature: c.nature,
    state: o.state,
    ...(o.code === undefined ? {} : { code: o.code }),
    truncated: o.truncated,
    ...(o.reason === undefined ? {} : { reason: o.reason }),
    accord: c.accord,
    startedAt: c.startedAt,
    endedAt: now,
  }
}

function sameOutcome(c: BridgeCall, o: Outcome): boolean {
  return c.state === o.state && c.code === o.code && c.truncated === o.truncated && c.reason === o.reason
}

/**
 * `s` avec ces appels, l'attente « à toi » effacée si elle désigne l'un des
 * appels `ids` (spec §5.1 : elle s'efface quand le tool.call de l'appel se
 * termine) ; `s` lui-même si rien n'a changé.
 */
function withCalls(s: ClairState, calls: BridgeCall[], ids: readonly string[]): ClairState {
  const w = s.waiting
  const waiting = w !== null && w.callId !== null && ids.includes(w.callId) ? null : w
  if (waiting === w && calls.every((c, i) => c === s.calls[i])) return s
  return { ...s, calls, waiting }
}

/**
 * Fin du tool.call `toolUseId` : l'appel de rang n reçoit `outcomes[n]`
 * (`incertain` s'il manque). Un refus de Claude Code reste un refus, quel
 * que soit l'ordre des événements. Même issue sur un appel déjà terminé :
 * inchangé. L'attente « à toi » qui désigne un de ces appels est effacée.
 */
export function finishCalls(s: ClairState, toolUseId: string, outcomes: Outcome[], now: number): ClairState {
  const ids: string[] = []
  const calls = s.calls.map((c) => {
    if (c.toolUseId !== toolUseId) return c
    ids.push(c.id)
    if (c.state === 'refuse-claude') return c
    const o = outcomes[rankOf(c)] ?? UNKNOWN
    return c.endedAt !== undefined && sameOutcome(c, o) ? c : closed(c, o, now)
  })
  return withCalls(s, calls, ids)
}

/** Refus de Claude Code (PermissionDenied) : tous les appels du tool_use_id, terminés ou non. */
export function refuseByClaude(s: ClairState, toolUseId: string, now: number): ClairState {
  const ids: string[] = []
  const calls = s.calls.map((c) => {
    if (c.toolUseId !== toolUseId) return c
    ids.push(c.id)
    return c.state === 'refuse-claude' ? c : closed(c, REFUSED, now)
  })
  return withCalls(s, calls, ids)
}

/**
 * Filet du turn.complete : les appels encore en cours de la boucle `agentId`
 * (undefined = boucle principale, donc appels sans agentId) deviennent
 * `interrompu`. Les appels des autres boucles ne bougent pas.
 */
export function interruptOpen(s: ClairState, agentId: string | undefined, now: number): ClairState {
  const ids: string[] = []
  const calls = s.calls.map((c) => {
    if (c.state !== 'en-cours' || c.agentId !== agentId) return c
    ids.push(c.id)
    return closed(c, INTERRUPTED, now)
  })
  return withCalls(s, calls, ids)
}

function sameWaiting(a: Waiting | null, b: Waiting | null): boolean {
  if (a === null || b === null) return a === b
  return a.tool === b.tool && a.host === b.host && a.callId === b.callId && a.since === b.since
}

/** Pose, remplace ou efface (null) l'attente « à toi » ; mêmes valeurs : même référence. */
export function setWaiting(s: ClairState, w: Waiting | null): ClairState {
  return sameWaiting(s.waiting, w) ? s : { ...s, waiting: w }
}

/**
 * Réponse au formulaire de confirmation : `formulaire-oui` seulement si
 * l'accord est donné (action 'accept' et content.confirm === true, décidé
 * par register.tsx), `formulaire-non` sinon. callId null ou inconnu, ou
 * accord déjà noté : même référence.
 */
export function recordAccord(s: ClairState, callId: string | null, granted: boolean): ClairState {
  const accord: BridgeCall['accord'] = granted ? 'formulaire-oui' : 'formulaire-non'
  const calls = s.calls.map((c) => (c.id === callId && c.accord !== accord ? { ...c, accord } : c))
  return withCalls(s, calls, [])
}

/** Marqueur « vu » posé par /clair. */
export function markSeen(s: ClairState, now: number): ClairState {
  return s.seenAt === now ? s : { ...s, seenAt: now }
}

export function withSuperpowers(s: ClairState, f: (sp: Superpowers | null) => Superpowers | null): ClairState {
  const sp = f(s.superpowers)
  return sp === s.superpowers ? s : { ...s, superpowers: sp }
}

export function withWorkflows(s: ClairState, f: (list: Workflow[]) => Workflow[]): ClairState {
  const list = f(s.workflows)
  return list === s.workflows ? s : { ...s, workflows: list }
}

/** Problème compté dans `clair ✗ n` et terminé après le dernier /clair. */
function isUnseenProblem(c: BridgeCall, seenAt: number): boolean {
  return STATE_TABLE[c.state].counted && (c.endedAt ?? 0) > seenAt
}

/** « À regarder » : états marqués inLook ou appels tronqués, le plus récemment terminé d'abord. */
export function problems(s: ClairState): BridgeCall[] {
  return s.calls
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => STATE_TABLE[c.state].inLook || c.truncated)
    .sort((a, b) => (b.c.endedAt ?? 0) - (a.c.endedAt ?? 0) || b.i - a.i)
    .map(({ c }) => c)
}

/** Le n de `clair ✗ n` : problèmes comptés, terminés après le dernier /clair. */
export function unseenProblems(s: ClairState): number {
  return s.calls.filter((c) => isUnseenProblem(c, s.seenAt)).length
}

type Machine = { host: string; index: number; calls: number; last: BridgeCall; hasUnseenProblem: boolean }

/**
 * Une entrée par machine qui a encore au moins un appel gardé, dans l'ordre
 * d'apparition : son index de couleur, ses appels au sens de §5.4 (colonne
 * « compté comme appel de la machine »), son dernier appel commencé, et si
 * un problème non vu existe sur elle.
 */
export function machines(s: ClairState): Machine[] {
  const out: Machine[] = []
  s.hostOrder.forEach((host, index) => {
    const mine = s.calls.filter((c) => c.host === host)
    const last = mine.at(-1)
    if (last === undefined) return
    out.push({
      host,
      index,
      calls: mine.filter((c) => STATE_TABLE[c.state].isCall).length,
      last,
      hasUnseenProblem: mine.some((c) => isUnseenProblem(c, s.seenAt)),
    })
  })
  return out
}

// --- Tâche 11 : sorties de register.tsx (spec §6). Tests : tests/pure/glue.test.ts ---------------

/**
 * Appel Bash parti en arrière-plan en cours de route (`backgroundTaskId`) : ses appels sont retirés,
 * comme s'ils n'avaient jamais été suivis (spec §5.1 : aucune ligne, aucun compte) ; `hostOrder`
 * n'est pas touché (l'index de couleur reste réservé). Même référence quand aucun appel ne porte
 * ce tool_use_id.
 */
export function dropCalls(s: ClairState, toolUseId: string): ClairState {
  return s.calls.some((c) => c.toolUseId === toolUseId)
    ? { ...s, calls: s.calls.filter((c) => c.toolUseId !== toolUseId) }
    : s
}

/**
 * L'attente « à toi » d'un formulaire (outil et machine lus par parseConfirmation) : l'appel MCP
 * en cours le plus récent qui a cet outil et cette machine (ce que le message tait ne filtre pas),
 * sinon le plus récent appel MCP en cours (amendement A9), sinon aucun. Ce que le message tait est
 * repris de l'appel retenu.
 */
export function waitingFor(
  s: ClairState,
  confirmation: { tool: string | null; host: string | null },
  now: number,
): Waiting {
  const { tool, host } = confirmation
  const open = s.calls.filter((c) => c.via === 'mcp' && c.state === 'en-cours')
  const call =
    open.findLast((c) => (tool === null || c.tool === tool) && (host === null || c.host === host)) ??
    open.at(-1) ??
    null
  return { tool: tool ?? call?.tool ?? '', host: host ?? call?.host ?? null, callId: call?.id ?? null, since: now }
}

/**
 * « À toi » s'efface quand le tool.call de l'appel attendu se termine, réponse vue ou non
 * (spec §5.1) : l'appel désigné par `callId`, ou, attente sans appel connu, tout appel MCP de ce
 * tool_use_id. Même référence sinon.
 */
export function closeWaiting(s: ClairState, toolUseId: string): ClairState {
  const w = s.waiting
  if (w === null) return s
  const calls = callsOf(s, toolUseId)
  const isMine = w.callId === null ? calls.some((c) => c.via === 'mcp') : calls.some((c) => c.id === w.callId)
  return isMine ? setWaiting(s, null) : s
}
