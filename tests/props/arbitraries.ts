// Arbitraires fast-check : états, appels et suites d'événements du cycle de vie.
// Noms de machine neutres (le dépôt est public) ; CJK, emoji et chaînes aléatoires sont libres.
import * as fc from 'fast-check'
import type { Outcome, ParsedCall } from '../../mode-clair/hooks/bridge'
import { STATE_TABLE } from '../../mode-clair/hooks/state'
import { TOOLS } from '../../mode-clair/hooks/tools.generated'
import type {
  Accord,
  BridgeCall,
  CallState,
  ClairState,
  Nature,
  Stage,
  Superpowers,
  Workflow,
  WorkflowStatus,
} from '../../mode-clair/types'

export type Ev =
  | { kind: 'start'; toolUseId: string; agentId?: string; parsed: ParsedCall[] }
  | { kind: 'finish'; toolUseId: string; outcomes: Outcome[] }
  | { kind: 'refuse'; toolUseId: string }
  | { kind: 'turnEnd'; agentId?: string }
  | { kind: 'wait'; tool: string; host: string | null; callId: string | null; clear: boolean }
  | { kind: 'accord'; callId: string | null; granted: boolean }
  | { kind: 'drop'; toolUseId: string }

const STATES = Object.keys(STATE_TABLE) as CallState[]
const FINAL_STATES = STATES.filter((s) => s !== 'en-cours')
const TOOL_NAMES = [...Object.keys(TOOLS).slice(0, 40), 'exec', 'upload', 'download']

/** Contrôles C0 (hors \t \n \r), DEL, C1 et ESC : ce que le terminal interpréterait. */
export const CONTROLS = ['\x00', '\x07', '\x08', '\x0b', '\x0c', '\x1b', '\x1b[31m', '\x7f', '\x85', '\x9b']

const FIXED_HOSTS = [
  'host-a',
  'host-b',
  'web-01',
  'db.example.test',
  'serveur-été',
  'café-münchen',
  'ホスト',
  '主机服务器',
  'host-😀',
  '👨‍👩‍👧‍👦',
  'éé',
  '',
  'x'.repeat(80),
  'ホ'.repeat(40),
]

/** Machine : ASCII, accents, CJK, emoji, vide, 80 caractères, ou texte libre (graphèmes). */
export const arbHost = (): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom(...FIXED_HOSTS) },
    { weight: 2, arbitrary: fc.string({ unit: 'grapheme', maxLength: 90 }) },
    { weight: 1, arbitrary: fc.string({ unit: 'grapheme-ascii', minLength: 80, maxLength: 80 }) },
  )

/** Texte libre : une raison d'échec, éventuellement longue ; avec `controls`, des contrôles y sont mêlés. */
export const arbText = (controls = false): fc.Arbitrary<string> => {
  const plain = fc.string({ unit: 'grapheme', maxLength: 100 })
  if (!controls) return plain
  return fc
    .tuple(plain, fc.constantFrom(...CONTROLS), plain)
    .map(([a, c, b]) => `${a}${c}${b}`)
    .chain((t) => fc.constantFrom(t, t.replaceAll(' ', '\x1b')))
}

const arbNature = fc.constantFrom<Nature>('lecture', 'peut-modifier', 'inconnu')
const arbAccord = fc.constantFrom<Accord>('aucun', 'option', 'formulaire-oui', 'formulaire-non')
const arbAgent = fc.option(fc.constantFrom('ag-1', 'ag-2'), { nil: undefined })

export const arbParsed = (): fc.Arbitrary<ParsedCall> =>
  fc.record({
    via: fc.constantFrom<'cli' | 'mcp'>('cli', 'mcp'),
    tool: fc.constantFrom(...TOOL_NAMES),
    host: fc.option(arbHost(), { nil: null }),
    nature: arbNature,
    accordByOption: fc.boolean(),
    ownsExit: fc.boolean(),
    inLoop: fc.boolean(),
    sessionId: fc.option(fc.constantFrom('sess-1', 'sess-2'), { nil: undefined }),
  }) as fc.Arbitrary<ParsedCall>

export const arbOutcome = (): fc.Arbitrary<Outcome> =>
  fc
    .record({
      state: fc.constantFrom(...FINAL_STATES),
      code: fc.option(fc.integer({ min: 0, max: 255 }), { nil: undefined }),
      truncated: fc.boolean(),
      reason: fc.option(arbText(), { nil: undefined }),
    })
    .map(({ state, code, truncated, reason }) => ({
      state,
      ...(code === undefined ? {} : { code }),
      truncated,
      ...(reason === undefined ? {} : { reason }),
    }))

// Identifiants en petit nombre : les collisions (même tool_use_id, événement sur un appel inconnu) sont voulues.
const arbToolUse = fc.constantFrom('toolu_0', 'toolu_1', 'toolu_2', 'toolu_3', 'toolu_4')
const arbCallId = fc.option(
  fc.tuple(arbToolUse, fc.integer({ min: 0, max: 2 })).map(([t, n]) => `${t}#${n}`),
  { nil: null },
)

export const arbEvent = (): fc.Arbitrary<Ev> =>
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc.record(
        {
          kind: fc.constant('start' as const),
          toolUseId: arbToolUse,
          agentId: arbAgent,
          parsed: fc.array(arbParsed(), { maxLength: 3 }),
        },
        { requiredKeys: ['kind', 'toolUseId', 'parsed'] },
      ) as fc.Arbitrary<Ev>,
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('finish' as const),
        toolUseId: arbToolUse,
        outcomes: fc.array(arbOutcome(), { maxLength: 3 }),
      }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('refuse' as const), toolUseId: arbToolUse }) },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('turnEnd' as const), agentId: arbAgent }, { requiredKeys: ['kind'] }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('wait' as const),
        tool: fc.constantFrom(...TOOL_NAMES),
        host: fc.option(arbHost(), { nil: null }),
        callId: arbCallId,
        clear: fc.boolean(),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('accord' as const), callId: arbCallId, granted: fc.boolean() }),
    },
    { weight: 1, arbitrary: fc.record({ kind: fc.constant('drop' as const), toolUseId: arbToolUse }) },
  )

export const arbEvents = (): fc.Arbitrary<Ev[]> => fc.array(arbEvent(), { maxLength: 40 })

/**
 * Beaucoup de débuts d'appel d'identifiants distincts (le plafond de 200). Un appel sur `keepOpen` reste
 * ouvert (0 : aucun), les autres sont finis, les fins s'intercalant avec les débuts.
 */
export const arbBulk = (): fc.Arbitrary<Ev[]> =>
  fc
    .tuple(fc.integer({ min: 150, max: 320 }), fc.integer({ min: 0, max: 8 }), arbParsed(), arbOutcome())
    .map(([n, keepOpen, parsed, outcome]) => {
      const evs: Ev[] = []
      for (let i = 0; i < n; i++) {
        evs.push({ kind: 'start', toolUseId: `bulk_${i}`, parsed: [parsed] })
        if (keepOpen === 0 || i % keepOpen !== 0)
          evs.push({ kind: 'finish', toolUseId: `bulk_${i}`, outcomes: [outcome] })
      }
      return evs
    })

// --- États complets ---------------------------------------------------------------------------

const arbCallWith = (i: number, controls: boolean): fc.Arbitrary<BridgeCall> =>
  fc
    .record({
      n: fc.integer({ min: 0, max: 2 }),
      agentId: arbAgent,
      via: fc.constantFrom<'cli' | 'mcp'>('cli', 'mcp'),
      tool: fc.constantFrom(...TOOL_NAMES),
      host: fc.option(fc.oneof(arbHost(), arbHostMaybeDirty(controls)), { nil: null }),
      nature: arbNature,
      state: fc.constantFrom(...STATES),
      code: fc.option(fc.integer({ min: 0, max: 255 }), { nil: undefined }),
      truncated: fc.boolean(),
      reason: fc.option(arbText(controls), { nil: undefined }),
      accord: arbAccord,
      startedAt: fc.integer({ min: 0, max: 100_000 }),
      lasted: fc.integer({ min: 0, max: 5_000 }),
    })
    .map((r): BridgeCall => {
      const toolUseId = `toolu_${i}`
      return {
        id: `${toolUseId}#${r.n}`,
        toolUseId,
        ...(r.agentId === undefined ? {} : { agentId: r.agentId }),
        via: r.via,
        tool: r.tool,
        host: r.host,
        nature: r.nature,
        state: r.state,
        ...(r.code === undefined ? {} : { code: r.code }),
        truncated: r.truncated,
        ...(r.reason === undefined ? {} : { reason: r.reason }),
        accord: r.accord,
        startedAt: r.startedAt,
        ...(r.state === 'en-cours' ? {} : { endedAt: r.startedAt + r.lasted }),
      }
    })

function arbHostMaybeDirty(controls: boolean): fc.Arbitrary<string> {
  return controls ? arbText(true) : arbHost()
}

const arbSuperpowers = (controls: boolean): fc.Arbitrary<Superpowers | null> =>
  fc.option(
    fc.record({
      stage: fc.constantFrom<Stage>('cadrage', 'spec', 'plan', 'taches', 'relecture', 'fin'),
      planTitle: fc.option(arbText(controls), { nil: null }),
      planPath: fc.option(fc.constant('docs/superpowers/plans/demo.md'), { nil: null }),
      tasks: fc.integer({ min: 0, max: 30 }),
      current: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
      lastEventAt: fc.integer({ min: 0, max: 100_000 }),
      isStale: fc.boolean(),
      runningAgents: fc.array(fc.constantFrom('ag-1', 'ag-2'), { maxLength: 2 }),
    }),
    { nil: null },
  )

const arbWorkflow = (i: number, controls: boolean): fc.Arbitrary<Workflow> =>
  fc.record({
    key: fc.constant(`wf_${i}`),
    toolUseId: fc.constant(`toolu_wf${i}`),
    name: arbText(controls),
    phases: fc.array(arbText(controls), { maxLength: 3 }),
    journalPath: fc.constant<string | null>('/var/tmp/wf.jsonl'),
    consumed: fc.constant(0),
    agents: fc.array(
      fc.record({
        id: fc.constantFrom('agent-1', 'agent-2', 'agent-3'),
        label: arbText(controls),
        phase: fc.option(arbText(controls), { nil: null }),
        state: fc.constantFrom<'en-cours' | 'fait' | 'echec'>('en-cours', 'fait', 'echec'),
      }),
      { maxLength: 3 },
    ),
    status: fc.constantFrom<WorkflowStatus>('en-cours', 'fini', 'echec', 'arrete', 'sans-nouvelles', 'distant'),
    lastGrowthAt: fc.integer({ min: 0, max: 100_000 }),
    startedAt: fc.integer({ min: 0, max: 100_000 }),
  })

/** Un état complet : appels (identifiants distincts), attente, Superpowers, workflows. `controls` : contrôles dans les textes libres. */
export const arbState = (options: { controls?: boolean } = {}): fc.Arbitrary<ClairState> => {
  const controls = options.controls === true
  return fc
    .integer({ min: 0, max: 8 })
    .chain((n) =>
      fc.tuple(
        fc.tuple(...Array.from({ length: n }, (_, i) => arbCallWith(i, controls))),
        fc.array(arbHost(), { maxLength: 3 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.option(
          fc.record({
            tool: fc.constantFrom(...TOOL_NAMES),
            host: fc.option(fc.oneof(arbHost(), arbHostMaybeDirty(controls)), { nil: null }),
            pick: fc.nat(),
            since: fc.integer({ min: 0, max: 100_000 }),
          }),
          { nil: null },
        ),
        arbSuperpowers(controls),
        fc
          .array(fc.nat({ max: 99 }), { maxLength: 2 })
          .chain((ids) => fc.tuple(...ids.map((_, i) => arbWorkflow(i, controls)))),
      ),
    )
    .map(([calls, extraHosts, seenAt, waiting, superpowers, workflows]): ClairState => {
      const hostOrder: string[] = []
      for (const h of [...calls.map((c) => c.host), ...extraHosts]) {
        if (h !== null && !hostOrder.includes(h)) hostOrder.push(h)
      }
      return {
        calls,
        hostOrder,
        seenAt,
        waiting:
          waiting === null
            ? null
            : {
                tool: waiting.tool,
                host: waiting.host,
                callId:
                  calls.length === 0 || waiting.pick % 4 === 0
                    ? null
                    : (calls[waiting.pick % calls.length]?.id ?? null),
                since: waiting.since,
              },
        superpowers,
        workflows,
        sessions: {},
      }
    })
}
