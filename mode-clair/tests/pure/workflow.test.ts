import { describe, expect, test } from 'claude-code/testing'
import {
  active,
  currentPhase,
  doneNotice,
  endWorkflow,
  foldJournal,
  MAX_JOURNAL_BYTES,
  parseMeta,
  QUIET_MS,
  quiet,
  startWorkflow,
} from '../../hooks/workflow'
import type { Workflow } from '../../types'

// Bloc meta réel (script mode-clair-understand-wf_2f1d0568-7cc.js de la session 533d49a4, en tête de fichier).
const SCRIPT_UNDERSTAND = [
  'export const meta = {',
  "  name: 'mode-clair-understand',",
  "  description: 'Read-only audit of the mode-clair mod (UI, logic, test infra, engine API) with adversarial verification, to ground a cleanup plan',",
  '  phases: [',
  "    { title: 'Audit', detail: '4 read-only auditors: UI, logic, test infra, engine API' },",
  "    { title: 'Verify', detail: 'one skeptic per audit tries to refute each finding' },",
  '  ],',
  '}',
  '',
  "const MOD = '/home/user/claude-mods/plugins/mode-clair'",
].join('\n')

const SCRIPT_REFS = [
  'export const meta = {',
  "  name: 'mode-clair-plan-refs',",
  "  description: 'Gather exact engine API, existing-code and bridge-mcp facts for the mode-clair 0.2.0 implementation plan',",
  "  phases: [{ title: 'Gather', detail: '3 read-only reference writers' }],",
  '}',
].join('\n')

// Lignes réelles du journal wf_2f1d0568-7cc (session 533d49a4), champ result raccourci.
const LAUNCHED = '{"type":"launched"}'
const UI =
  '{"type":"started","key":"v2:06261fd506bb15b3851fc8ce548be8d649349cdeb1c0c905a39a515bef804566","agentId":"af7d9e0fa88200f5e","label":"audit:ui","phase":"Audit"}'
const LOGIC =
  '{"type":"started","key":"v2:27b7af3fc7367bda47af957cbe4bc982fba2e17fc8c53dc56f947ca501e8f73a","agentId":"ab6c88883bf7c997a","label":"audit:logic","phase":"Audit"}'
const TESTS =
  '{"type":"started","key":"v2:677122bbe0854d6362484803c7d6298bb4c9f68a1388f2233bca8c1de043ee1e","agentId":"a643351dfadae7d20","label":"audit:tests","phase":"Audit"}'
const API =
  '{"type":"started","key":"v2:605eddb026e3517dc5be3032f883af5cbcebfeec50a209b4b320ad39d099321e","agentId":"a8d2e8fe38b37af93","label":"audit:api","phase":"Audit"}'
const UI_DONE =
  '{"type":"result","key":"v2:06261fd506bb15b3851fc8ce548be8d649349cdeb1c0c905a39a515bef804566","agentId":"af7d9e0fa88200f5e","result":{"summary":"Read-only audit of how mode-clair renders."}}'
const VERIFY_UI =
  '{"type":"started","key":"v2:244cc83a38b54a9d86270c659bd6427951d34523fdcdaa9d27bb6f82ee6510ff","agentId":"a03cabb04186f20e4","label":"verify:ui","phase":"Verify"}'
const TESTS_DONE =
  '{"type":"result","key":"v2:677122bbe0854d6362484803c7d6298bb4c9f68a1388f2233bca8c1de043ee1e","agentId":"a643351dfadae7d20","result":{"summary":"I audited the mode-clair tests read-only."}}'

// Lignes réelles du journal wf_35661d33-c4c (session 533d49a4) : un résultat en texte.
const REFS_CODE =
  '{"type":"started","key":"v2:b3a26a4ee33b6f0ec77d99d5327eb77cf9db7c552e73d3aca6c3636cba9e69fb","agentId":"a81c0e0e2aa190334","label":"refs:code","phase":"Gather"}'
const REFS_CODE_DONE =
  '{"type":"result","key":"v2:b3a26a4ee33b6f0ec77d99d5327eb77cf9db7c552e73d3aca6c3636cba9e69fb","agentId":"a81c0e0e2aa190334","result":"/tmp/claude-1000/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/scratchpad/refs/existing-code.md (1446 lines)"}'

// Lignes réelles du journal wf_294c310e-183 (session bridge-mcp 50452de4, lignes 14-17) : deux agents en échec.
const FIX =
  '{"type":"started","key":"v2:d4eb17cf20881e2f2d66c99e69cfc27847566ce08bb7228e119cdc3be13efc79","agentId":"a703094f7912c6ca0","label":"fix:r1","phase":"Fix"}'
const FIX_FAILED =
  '{"type":"failed","key":"v2:d4eb17cf20881e2f2d66c99e69cfc27847566ce08bb7228e119cdc3be13efc79","agentId":"a703094f7912c6ca0"}'
const E2E =
  '{"type":"started","key":"v2:f2eb9498c34621d2d877188ce3fdd2dc88a6e32cee04a9d63417bfd3ca95e511","agentId":"a041c4196e3684a6a","label":"e2e","phase":"E2E"}'
const E2E_FAILED =
  '{"type":"failed","key":"v2:f2eb9498c34621d2d877188ce3fdd2dc88a6e32cee04a9d63417bfd3ca95e511","agentId":"a041c4196e3684a6a"}'

const lines = (...rows: string[]): string => rows.map((r) => r + '\n').join('')

const JOURNAL =
  '/home/user/.claude/projects/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_2f1d0568-7cc/journal.jsonl'
const UNDERSTAND = {
  key: 'wf_2f1d0568-7cc',
  toolUseId: 'toolu_01MyTHb2wVWnW2Mw3gnCBgxh',
  name: 'mode-clair-understand',
  phases: ['Audit', 'Verify'],
  journalPath: JOURNAL,
  remote: false,
}
const SPEC_REVIEW = {
  key: 'wf_0f41829b-6d3',
  toolUseId: 'toolu_01XB63a8sbmBJCsZYiaAraWY',
  name: 'mode-clair-spec-review',
  phases: ['Review'],
  journalPath:
    '/home/user/.claude/projects/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_0f41829b-6d3/journal.jsonl',
  remote: false,
}

const understand = (now = 1_000): Workflow => startWorkflow([], UNDERSTAND, now)[0] as Workflow

describe('workflow : le bloc meta', () => {
  test('le meta réel donne le nom et les titres des phases, accolades imbriquées comprises', () => {
    expect(parseMeta(SCRIPT_UNDERSTAND)).toStrictEqual({ name: 'mode-clair-understand', phases: ['Audit', 'Verify'] })
    expect(parseMeta(SCRIPT_REFS)).toStrictEqual({ name: 'mode-clair-plan-refs', phases: ['Gather'] })
  })

  test('test 0.1.0 gardé : guillemets simples et doubles, plusieurs phases sur une ligne', () => {
    const script = `export const meta = {
    name: 'audit-disques',
    description: 'trouver ce qui remplit les disques',
    phases: [{ title: 'mesure', detail: 'df' }, { title: 'analyse' }, { title: "ménage" }],
  }
  phase('mesure')`
    expect(parseMeta(script)).toStrictEqual({ name: 'audit-disques', phases: ['mesure', 'analyse', 'ménage'] })
  })

  test('sans bloc meta : null ; bloc sans nom ni phases : rien d’inventé', () => {
    expect(parseMeta("const MOD = '/home/user/claude-mods/plugins/mode-clair'")).toBeNull()
    expect(parseMeta('')).toBeNull()
    expect(parseMeta("export const meta = { description: 'trouver ce qui remplit les disques' }")).toStrictEqual({
      name: null,
      phases: [],
    })
  })

  test('un bloc meta jamais refermé ne fait pas planter', () => {
    expect(parseMeta("export const meta = {\n  name: 'mode-clair-understand',\n  phases: [")).toStrictEqual({
      name: null,
      phases: [],
    })
  })
})

describe('workflow : lancement', () => {
  test('un workflow local démarre en cours, sans agent, rien lu du journal', () => {
    expect(startWorkflow([], UNDERSTAND, 1_000)).toStrictEqual([
      {
        key: 'wf_2f1d0568-7cc',
        toolUseId: 'toolu_01MyTHb2wVWnW2Mw3gnCBgxh',
        name: 'mode-clair-understand',
        phases: ['Audit', 'Verify'],
        journalPath: JOURNAL,
        consumed: 0,
        agents: [],
        status: 'en-cours',
        lastGrowthAt: 1_000,
        startedAt: 1_000,
      },
    ])
  })

  test('un workflow lancé à distance est « distant »', () => {
    const remote = {
      key: 'wc4qc70s7',
      toolUseId: 'toolu_01ENS9FnS8Gf6wM9N3FbdNEk',
      name: 'mode-clair-plan-draft',
      phases: [],
      journalPath: null,
      remote: true,
    }
    expect(startWorkflow([], remote, 1_000)[0]?.status).toBe('distant')
  })

  test('plusieurs workflows coexistent, le plus récent en dernier ; une même clé remplace l’ancienne entrée', () => {
    const two = startWorkflow(startWorkflow([], UNDERSTAND, 1_000), SPEC_REVIEW, 2_000)
    expect(two.map((w) => w.key)).toStrictEqual(['wf_2f1d0568-7cc', 'wf_0f41829b-6d3'])
    const again = startWorkflow(two, UNDERSTAND, 3_000)
    expect(again.map((w) => w.key)).toStrictEqual(['wf_0f41829b-6d3', 'wf_2f1d0568-7cc'])
    expect(again[1]?.startedAt).toBe(3_000)
  })
})

describe('workflow : le journal', () => {
  test('le journal réel fait avancer les agents, et la phase en cours suit', () => {
    const text = lines(LAUNCHED, UI, LOGIC, TESTS, API, UI_DONE, VERIFY_UI)
    const w = foldJournal(understand(), text, 2_000)
    expect(w.agents).toStrictEqual([
      { id: 'af7d9e0fa88200f5e', label: 'audit:ui', phase: 'Audit', state: 'fait' },
      { id: 'ab6c88883bf7c997a', label: 'audit:logic', phase: 'Audit', state: 'en-cours' },
      { id: 'a643351dfadae7d20', label: 'audit:tests', phase: 'Audit', state: 'en-cours' },
      { id: 'a8d2e8fe38b37af93', label: 'audit:api', phase: 'Audit', state: 'en-cours' },
      { id: 'a03cabb04186f20e4', label: 'verify:ui', phase: 'Verify', state: 'en-cours' },
    ])
    expect(w.consumed).toBe(text.length)
    expect(w.lastGrowthAt).toBe(2_000)
    expect(currentPhase(w)).toBe('Verify')
  })

  test('repli incrémental : la suite du journal complète l’état déjà replié', () => {
    const first = lines(LAUNCHED, UI, TESTS)
    const w1 = foldJournal(understand(), first, 2_000)
    const w2 = foldJournal(w1, first + lines(UI_DONE, TESTS_DONE), 3_000)
    expect(w2.agents.map((a) => `${a.label}:${a.state}`)).toStrictEqual(['audit:ui:fait', 'audit:tests:fait'])
    expect(w2.consumed).toBe((first + lines(UI_DONE, TESTS_DONE)).length)
    expect(foldJournal(w2, first + lines(UI_DONE, TESTS_DONE), 4_000)).toBe(w2)
  })

  test('une ligne en cours d’écriture attend le tic suivant', () => {
    const partial = lines(LAUNCHED, UI) + LOGIC.slice(0, 40)
    const w1 = foldJournal(understand(), partial, 2_000)
    expect(w1.consumed).toBe(lines(LAUNCHED, UI).length)
    expect(w1.agents).toHaveLength(1)
    const w2 = foldJournal(w1, lines(LAUNCHED, UI, LOGIC), 3_000)
    expect(w2.agents.map((a) => a.label)).toStrictEqual(['audit:ui', 'audit:logic'])
    const none = understand()
    expect(foldJournal(none, LAUNCHED.slice(0, 10), 2_000)).toBe(none)
  })

  test('lignes failed réelles : agents en échec ; un résultat en texte termine l’agent', () => {
    const w = foldJournal(understand(), lines(FIX, FIX_FAILED, E2E, E2E_FAILED, REFS_CODE, REFS_CODE_DONE), 2_000)
    expect(w.agents.map((a) => `${a.label}:${a.state}`)).toStrictEqual(['fix:r1:echec', 'e2e:echec', 'refs:code:fait'])
    expect(currentPhase(w)).toBe('Gather')
  })

  test('ligne illisible, type inconnu, agent jamais lancé, doublon : sautés sans planter', () => {
    const noLabel =
      '{"type":"started","key":"v2:06261fd506bb15b3851fc8ce548be8d649349cdeb1c0c905a39a515bef804566","agentId":"af7d9e0fa88200f5e"}'
    const text = lines(
      'not json',
      '',
      'null',
      '42',
      '{"type":7,"agentId":"af7d9e0fa88200f5e"}',
      noLabel,
      UI,
      '{"type":"progress","agentId":"af7d9e0fa88200f5e"}',
      TESTS_DONE,
    )
    const w = foldJournal(understand(), text, 2_000)
    expect(w.agents).toStrictEqual([
      { id: 'af7d9e0fa88200f5e', label: 'af7d9e0fa88200f5e', phase: null, state: 'en-cours' },
    ])
    expect(w.consumed).toBe(text.length)
    expect(currentPhase(w)).toBeNull()
  })

  test('journal plus court que ce qui a été lu : relu depuis le début', () => {
    const w1 = foldJournal(understand(), lines(LAUNCHED, UI, LOGIC, TESTS), 2_000)
    const w2 = foldJournal(w1, lines(FIX), 3_000)
    expect(w2.agents.map((a) => a.label)).toStrictEqual(['fix:r1'])
    expect(w2.consumed).toBe(lines(FIX).length)
    const w3 = foldJournal(w1, FIX.slice(0, 20), 3_000)
    expect(w3.agents).toStrictEqual([])
    expect(w3.consumed).toBe(0)
  })

  test('un journal qui grandit réveille un workflow sans nouvelles ; un workflow fini le reste', () => {
    const silent: Workflow = { ...understand(), status: 'sans-nouvelles' }
    expect(foldJournal(silent, lines(UI), 2_000).status).toBe('en-cours')
    const done: Workflow = { ...understand(), status: 'fini' }
    expect(foldJournal(done, lines(UI), 2_000).status).toBe('fini')
  })

  test('la phase en cours : la dernière commencée qui a un agent en cours, sinon la dernière commencée', () => {
    const w = foldJournal(understand(), lines(UI, LOGIC, VERIFY_UI), 2_000)
    expect(currentPhase(w)).toBe('Verify')
    const verifyDone =
      '{"type":"result","key":"v2:244cc83a38b54a9d86270c659bd6427951d34523fdcdaa9d27bb6f82ee6510ff","agentId":"a03cabb04186f20e4","result":{"verdicts":[]}}'
    const w2 = foldJournal(w, lines(UI, LOGIC, VERIFY_UI, verifyDone), 3_000)
    expect(currentPhase(w2)).toBe('Audit')
    const logicDone =
      '{"type":"result","key":"v2:27b7af3fc7367bda47af957cbe4bc982fba2e17fc8c53dc56f947ca501e8f73a","agentId":"ab6c88883bf7c997a","result":{"summary":"done"}}'
    const w3 = foldJournal(w2, lines(UI, LOGIC, VERIFY_UI, verifyDone, UI_DONE, logicDone), 4_000)
    expect(currentPhase(w3)).toBe('Verify')
    expect(currentPhase(understand())).toBeNull()
  })
})

// Notifications réelles (transcripts de ~/.claude/projects, lecture seule), résultat raccourci.
const DONE_COMPLETED = [
  '<task-notification>',
  '<task-id>wqz12faeg</task-id>',
  '<tool-use-id>toolu_01MyTHb2wVWnW2Mw3gnCBgxh</tool-use-id>',
  '<output-file>/tmp/claude-1000/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/tasks/wqz12faeg.output</output-file>',
  '<status>completed</status>',
  '<summary>Dynamic workflow "Read-only audit of the mode-clair mod (UI, logic, test infra, engine API) with adversarial verification, to ground a cleanup plan" completed</summary>',
  '<result>[{"dimension":"ui","audit":{"summary":"Read-only audit of how mode-clair renders."}}]</result>',
  '<usage><agent_count>8</agent_count><agents_done>8</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result><subagent_tokens>1586440</subagent_tokens><tool_uses>557</tool_uses><duration_ms>1413964</duration_ms></usage>',
  '</task-notification>',
].join('\n')
const DONE_FAILED = [
  '<task-notification>',
  '<task-id>bcirshq4x</task-id>',
  '<tool-use-id>toolu_01SDN3Wrhy1sD9fgDEK4aAdB</tool-use-id>',
  '<output-file>/tmp/claude-1000/-home-user-bridge-mcp--claude-worktrees-exit-code-directs/66666666-7777-4888-9999-aaaaaaaaaaaa/tasks/bcirshq4x.output</output-file>',
  '<status>failed</status>',
  '<summary>Monitor "CI jobs for commit 9c80d35 on PR 219, one line per job conclusion" script failed (exit 1)</summary>',
  '<event>NO CI RUN FOUND for 9c80d35</event>',
  "If this event is something the user would act on now, send a PushNotification. Routine or benign output doesn't need one.",
  '</task-notification>',
].join('\n')
const DONE_KILLED = [
  '<task-notification>',
  '<task-id>b131dfzia</task-id>',
  '<tool-use-id>toolu_01J8pUzdPL96ZKBihTGMqJkD</tool-use-id>',
  '<output-file>/tmp/claude-1000/-home-user-bridge-mcp--claude-worktrees-defauts-racines/66666666-7777-4888-9999-aaaaaaaaaaaa/tasks/b131dfzia.output</output-file>',
  '<status>killed</status>',
  '<summary>Background command "Wait for make ci to finish" was stopped</summary>',
  '</task-notification>',
].join('\n')
const DONE_STOPPED = [
  '<task-notification>',
  '<task-id>bxlan6sy9</task-id>',
  '<tool-use-id>toolu_01SXoGrjSXzWCmV6V312swEL</tool-use-id>',
  '<status>stopped</status>',
  "<summary>Background shell command didn't finish before the previous session ended</summary>",
  '</task-notification>',
].join('\n')
const DONE_ORPHANS = [
  '<task-notification>',
  '<task-id>bi5t5yrqc</task-id>',
  '<task-id>by1q17gb6</task-id>',
  '<task-id>__orphan_summary__:shell</task-id>',
  '<status>stopped</status>',
  "<summary>13 background shell command tasks didn't finish before the previous session ended.</summary>",
  '</task-notification>',
].join('\n')

describe('workflow : fin, silence, liste active', () => {
  test('la notification réelle de fin termine le workflow par le tool-use-id de son appel', () => {
    const notice = doneNotice(DONE_COMPLETED)
    expect(notice).toStrictEqual({ key: 'toolu_01MyTHb2wVWnW2Mw3gnCBgxh', status: 'fini' })
    const list = startWorkflow(startWorkflow([], UNDERSTAND, 1_000), SPEC_REVIEW, 2_000)
    const ended = endWorkflow(list, 'toolu_01MyTHb2wVWnW2Mw3gnCBgxh', 'fini')
    expect(ended.map((w) => w.status)).toStrictEqual(['fini', 'en-cours'])
    expect(active(ended).map((w) => w.key)).toStrictEqual(['wf_0f41829b-6d3'])
  })

  test('failed, killed, stopped : échec ou arrêté (notifications réelles)', () => {
    expect(doneNotice(DONE_FAILED)).toStrictEqual({ key: 'toolu_01SDN3Wrhy1sD9fgDEK4aAdB', status: 'echec' })
    expect(doneNotice(DONE_KILLED)).toStrictEqual({ key: 'toolu_01J8pUzdPL96ZKBihTGMqJkD', status: 'arrete' })
    expect(doneNotice(DONE_STOPPED)).toStrictEqual({ key: 'toolu_01SXoGrjSXzWCmV6V312swEL', status: 'arrete' })
  })

  test('sans tool-use-id, la clé est la première task-id (test 0.1.0 gardé, et notification groupée réelle)', () => {
    const old = '<task-notification><task-id>w0rn</task-id><status>completed</status></task-notification>'
    expect(doneNotice(old)).toStrictEqual({ key: 'w0rn', status: 'fini' })
    expect(doneNotice(DONE_ORPHANS)).toStrictEqual({ key: 'bi5t5yrqc', status: 'arrete' })
  })

  test('pas une notification, statut inconnu ou aucune clé : null', () => {
    expect(doneNotice('Workflow launched in background. Task ID: wqz12faeg')).toBeNull()
    expect(doneNotice(DONE_COMPLETED.replace('<status>completed</status>', '<status>running</status>'))).toBeNull()
    expect(doneNotice(DONE_COMPLETED.replace('<status>completed</status>', ''))).toBeNull()
    expect(doneNotice('<task-notification>\n<status>completed</status>\n</task-notification>')).toBeNull()
  })

  test('endWorkflow : par la clé aussi ; clé inconnue ou statut déjà posé : même référence', () => {
    const list = startWorkflow([], UNDERSTAND, 1_000)
    expect(endWorkflow(list, 'w0rn', 'fini')).toBe(list)
    const stopped = endWorkflow(list, 'wf_2f1d0568-7cc', 'arrete')
    expect(stopped[0]?.status).toBe('arrete')
    expect(endWorkflow(stopped, 'wf_2f1d0568-7cc', 'arrete')).toBe(stopped)
  })

  test('sans croissance depuis 30 minutes : sans nouvelles ; un mtime plus récent repousse ; distant et fini jamais', () => {
    const local = understand(1_000)
    const remote: Workflow = { ...understand(1_000), key: 'wc4qc70s7', journalPath: null, status: 'distant' }
    const done: Workflow = { ...understand(1_000), key: 'wf_0f41829b-6d3', status: 'fini' }
    const list = [local, remote, done]
    const asked: string[] = []
    const none = (w: Workflow): number | null => {
      asked.push(w.key)
      return null
    }
    expect(quiet(list, 1_000 + QUIET_MS - 1, none)).toBe(list)
    expect(asked).toStrictEqual(['wf_2f1d0568-7cc'])
    expect(quiet(list, 1_000 + QUIET_MS, none).map((w) => w.status)).toStrictEqual([
      'sans-nouvelles',
      'distant',
      'fini',
    ])
    expect(quiet(list, 1_000 + QUIET_MS, () => 1_000 + 60_000)).toBe(list)
    expect(quiet(list, 1_000 + QUIET_MS, () => 500)[0]?.status).toBe('sans-nouvelles')
  })

  test('active : en cours et distant seulement', () => {
    const statuses = ['en-cours', 'fini', 'echec', 'arrete', 'sans-nouvelles', 'distant'] as const
    const list = statuses.map((status, i): Workflow => ({ ...understand(), key: `w${i}`, status }))
    expect(active(list).map((w) => w.status)).toStrictEqual(['en-cours', 'distant'])
  })

  test('constantes : 30 minutes, 4 Mio', () => {
    expect(QUIET_MS).toBe(1_800_000)
    expect(MAX_JOURNAL_BYTES).toBe(4_194_304)
  })
})

describe('workflow : formes limites du meta, du journal et de la notification', () => {
  test('meta : blancs absents ou multiples autour de export, const, meta et « = », accolade refermée sans blanc', () => {
    expect(parseMeta("export  const  meta={name:'x'}")).toStrictEqual({ name: 'x', phases: [] })
  })

  test('meta : blancs avant les deux-points, titres antérieurs aux phases ignorés', () => {
    const script = "export const meta = { title: 'décor', name : 'N', phases : [ { title : 'A' }, {title : \"B\"} ] }"
    expect(parseMeta(script)).toStrictEqual({ name: 'N', phases: ['A', 'B'] })
  })

  test('meta : sans blanc après les deux-points', () => {
    expect(parseMeta("export const meta = {name:'N',phases:[{title:'A'},{title:'B'}]}")).toStrictEqual({
      name: 'N',
      phases: ['A', 'B'],
    })
  })

  test('journal : un agent sans agentId texte (absent, nombre) n’existe pas ; un label qui n’est pas du texte vaut l’identifiant', () => {
    const text = lines(
      '{"type":"started","label":"sans id"}',
      '{"type":"started","agentId":7,"label":"nombre"}',
      '{"type":"started","agentId":"a1","label":5,"phase":"P"}',
    )
    const w = foldJournal(understand(), text, 2_000)
    expect(w.agents).toStrictEqual([{ id: 'a1', label: 'a1', phase: 'P', state: 'en-cours' }])
  })

  test('journal : une dernière ligne complète mais sans fin de ligne attend le tic suivant', () => {
    const done = lines(UI)
    const w = foldJournal(understand(), done + LOGIC, 2_000)
    expect(w.agents.map((a) => a.id)).toStrictEqual(['af7d9e0fa88200f5e'])
    expect(w.consumed).toBe(done.length)
  })

  test('doneNotice : les balises doivent suivre <task-notification>, celles d’avant ne comptent pas', () => {
    expect(doneNotice('<status>completed</status><tool-use-id>toolu_x</tool-use-id>')).toBeNull()
    const text =
      '<status>failed</status><tool-use-id>toolu_ancien</tool-use-id>\n' +
      '<task-notification><tool-use-id>toolu_nouveau</tool-use-id><status>completed</status>'
    expect(doneNotice(text)).toStrictEqual({ key: 'toolu_nouveau', status: 'fini' })
  })

  test('currentPhase : un agent sans phase ne compte pas', () => {
    const w: Workflow = {
      ...understand(),
      agents: [
        { id: 'a', label: 'a', phase: 'Audit', state: 'fait' },
        { id: 'b', label: 'b', phase: null, state: 'fait' },
      ],
    }
    expect(currentPhase(w)).toBe('Audit')
    const open: Workflow = {
      ...w,
      agents: [...w.agents.slice(0, 1), { id: 'c', label: 'c', phase: null, state: 'en-cours' }],
    }
    expect(currentPhase(open)).toBe('Audit')
  })
})
