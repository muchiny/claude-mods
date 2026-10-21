// Les états dont on garde le rendu, à la main comme dans mode-clair/tests/pure/view.test.ts.
// Noms de machine neutres : le dépôt est public.

import { EMPTY } from '../../mode-clair/hooks/state'
import type { Ctx } from '../../mode-clair/hooks/view'
import type { BridgeCall, ClairState, Superpowers, Workflow } from '../../mode-clair/types'

export type Case = { name: string; state: ClairState; ctx: Ctx; args?: string }

export const COLUMNS = [40, 80, 120, 200] as const

const call = (patch: Partial<BridgeCall> = {}): BridgeCall => ({
  id: 'toolu_a#0',
  toolUseId: 'toolu_a',
  via: 'mcp',
  tool: 'ssh_disk_usage',
  host: 'host-a',
  nature: 'lecture',
  state: 'fait',
  truncated: false,
  accord: 'aucun',
  startedAt: 1_000,
  endedAt: 1_400,
  ...patch,
})

/** Un appel d'identifiant propre : `toolu_<n>#0`. */
const nth = (n: number, patch: Partial<BridgeCall> = {}): BridgeCall =>
  call({ id: `toolu_${n}#0`, toolUseId: `toolu_${n}`, startedAt: 1_000 * n, endedAt: 1_000 * n + 400, ...patch })

const running = (n: number, patch: Partial<BridgeCall> = {}): BridgeCall => {
  const { endedAt: _, ...rest } = nth(n, { state: 'en-cours', ...patch })
  return rest
}

const stateOf = (calls: BridgeCall[], patch: Partial<ClairState> = {}): ClairState => {
  const hostOrder: string[] = []
  for (const c of calls) if (c.host !== null && !hostOrder.includes(c.host)) hostOrder.push(c.host)
  return { ...EMPTY, calls, hostOrder, ...patch }
}

const plan = (patch: Partial<Superpowers> = {}): Superpowers => ({
  stage: 'taches',
  planTitle: 'plan de démonstration',
  planPath: 'docs/superpowers/plans/demo.md',
  tasks: 5,
  current: 2,
  lastEventAt: 5_000,
  isStale: false,
  runningAgents: [],
  ...patch,
})

const workflow = (patch: Partial<Workflow> = {}): Workflow => ({
  key: 'wf_1',
  toolUseId: 'toolu_wf',
  name: 'audit-demo',
  phases: ['Lecture', 'Audit', 'Synthèse'],
  journalPath: '/var/tmp/wf_1.jsonl',
  consumed: 0,
  agents: [
    { id: 'agent-1', label: 'ui', phase: 'Audit', state: 'fait' },
    { id: 'agent-2', label: 'logic', phase: 'Audit', state: 'en-cours' },
  ],
  status: 'en-cours',
  lastGrowthAt: 5_000,
  startedAt: 4_000,
  ...patch,
})

const LONG_HOST = `machine-${'x'.repeat(52)}` // 60 caractères

const waitingCall = running(2, { tool: 'ssh_file_write', nature: 'peut-modifier' })

const FULL_CARD = stateOf(
  [
    nth(1, { host: 'host-a' }),
    nth(2, { host: 'host-b', state: 'injoignable' }),
    nth(3, { host: 'host-a', tool: 'ssh_exec', nature: 'peut-modifier', state: 'code', code: 2 }),
    nth(4, { host: 'host-c', state: 'echec', reason: 'Unexpected failure while reading the cache' }),
    nth(5, { host: 'host-a', tool: 'ssh_journal_query', truncated: true }),
    nth(6, { host: 'host-b', state: 'refuse-claude' }),
    nth(7, { host: 'host-c', state: 'limite' }),
    nth(8, { host: 'host-b', tool: 'ssh_file_write', nature: 'peut-modifier', state: 'delai-depasse' }),
  ],
  { seenAt: 2_500, superpowers: plan(), workflows: [workflow()] },
)

const BASES: { name: string; state: ClairState; isWorking?: boolean; args?: string }[] = [
  { name: 'repos', state: EMPTY, isWorking: false },
  { name: 'appel-en-cours', state: stateOf([running(1)]) },
  { name: 'fait-lecture', state: stateOf([nth(1)]) },
  { name: 'code-2', state: stateOf([nth(1, { tool: 'ssh_exec', nature: 'peut-modifier', state: 'code', code: 2 })]) },
  { name: 'injoignable', state: stateOf([nth(1, { state: 'injoignable' })]) },
  { name: 'refuse', state: stateOf([nth(1, { state: 'refuse' })]) },
  { name: 'refuse-claude', state: stateOf([nth(1, { state: 'refuse-claude' })]) },
  { name: 'decline', state: stateOf([nth(1, { state: 'decline' })]) },
  { name: 'interrompu', state: stateOf([nth(1, { state: 'interrompu' })]) },
  { name: 'incertain', state: stateOf([nth(1, { state: 'incertain' })]) },
  { name: 'incertain-machine-inconnue', state: stateOf([nth(1, { host: null, state: 'incertain' })]) },
  {
    name: 'attente-accord',
    state: stateOf([nth(1), waitingCall], {
      waiting: { tool: 'ssh_file_write', host: 'host-a', callId: waitingCall.id, since: 2_000 },
    }),
  },
  {
    name: 'multi-hotes',
    state: stateOf(
      ['host-a', 'host-b', 'host-c'].map((host, n) => ({
        ...running(1, { tool: 'ssh_exec_multi', host, nature: 'peut-modifier' }),
        id: `toolu_1#${n}`,
      })),
    ),
  },
  {
    name: 'session-ssh',
    state: stateOf(
      [nth(1, { tool: 'ssh_session_create', nature: 'inconnu' }), running(2, { tool: 'ssh_session_exec' })],
      {
        sessions: { 'sess-1': 'host-a' },
      },
    ),
  },
  { name: 'tronque', state: stateOf([nth(1, { tool: 'ssh_journal_query', truncated: true })]) },
  { name: 'workflow-3-phases', state: stateOf([], { workflows: [workflow()] }) },
  { name: 'superpowers-taches', state: stateOf([], { superpowers: plan() }) },
  { name: 'superpowers-perime', state: stateOf([], { superpowers: plan({ isStale: true }) }) },
  { name: 'superpowers-sans-travail', state: stateOf([], { superpowers: plan() }), isWorking: false },
  {
    name: 'nom-60-caracteres',
    state: stateOf([nth(1, { host: LONG_HOST }), running(2, { host: LONG_HOST, tool: 'ssh_disk_usage' })]),
  },
  { name: 'carte-pleine', state: FULL_CARD },
  { name: 'carte-pleine-machine', state: FULL_CARD, args: 'host-b' },
  {
    name: 'carte-probleme-masque',
    state: stateOf([nth(1, { state: 'injoignable' }), nth(2, { tool: 'ssh_uptime' })]),
  },
  {
    name: 'carte-echec-raison',
    state: stateOf([nth(1, { state: 'echec', reason: 'Unexpected failure while reading the cache' })]),
  },
  {
    name: 'carte-echec-deja-vu',
    state: stateOf([nth(1, { state: 'echec', reason: 'Unexpected failure while reading the cache' })], {
      seenAt: 5_000,
    }),
  },
  { name: 'carte-vide', state: EMPTY, isWorking: false },
]

export const CASES: Case[] = BASES.flatMap((b) =>
  COLUMNS.map((columns) => ({
    name: `${b.name}-${columns}`,
    state: b.state,
    ctx: { now: 10_000, columns, isWorking: b.isWorking ?? true },
    ...(b.args === undefined ? {} : { args: b.args }),
  })),
)
