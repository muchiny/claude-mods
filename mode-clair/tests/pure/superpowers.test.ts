import { describe, expect, test } from 'claude-code/testing'

import type { Superpowers } from '../../types'
import { STALE_MS, expire, onAgent, onAgentDone, onAgentLaunched, onDocWrite, onSkill, parsePlan, runningAgentOf, taskNumber } from '../../hooks/superpowers'

// Plans réels de l'utilisateur (lecture seule, ~/archive/exit-code-directs et
// ~/archive/bridge-mcp-main-2026-10-15, docs/superpowers/plans/) : titre et premiers titres de tâche.
const PLAN_T = [
  '# Plan de correction — tout ce qui reste (2026-09-30)',
  '',
  '## Vague 0 — les deux qui ne dépendent de rien',
  '',
  '### T1 — `ssh_net_equip_config` exécute du texte arbitraire avec la whitelist contournée',
  '',
  '### T2 — `ssh_awx_job_follow`, seul des 43 à ne pas vérifier',
  '',
  '### T3 — sortir le mot de passe de la ligne de commande',
].join('\n')

const PLAN_TT = [
  '# Plan — des tests qui testent, et des signaux qui disent la réalité (2026-10-14)',
  '',
  '## Les tâches',
  '',
  '### TT1 — rendre le rapport de survivants lisible (priorité haute, effort S)',
  '',
  '### TT2 — faire du score une mesure qui tient (priorité haute, effort S/M)',
].join('\n')

const PLAN_TASK = [
  '# Reduction: YAML Output, Multi-Document yq, Limit After Filters — Implementation Plan',
  '',
  '### Task 0: Reproduce the three defects live, before touching code',
  '',
  '### Task 1: `post_process` leaves non-table output alone',
  '',
  '### Task 2: `yq_filter` runs on every document of a stream',
  '',
  '### Task 3: `limit` caps the results of `jq_filter` and `yq_filter`',
].join('\n')

describe('superpowers : lecture des plans et des descriptions', () => {
  test('titres ### T1 — et ### TT1 — : le nombre de numéros distincts', () => {
    expect(parsePlan(PLAN_T)).toStrictEqual({ title: 'Plan de correction — tout ce qui reste (2026-09-30)', tasks: 3 })
    expect(parsePlan(PLAN_TT)).toStrictEqual({
      title: 'Plan — des tests qui testent, et des signaux qui disent la réalité (2026-10-14)',
      tasks: 2,
    })
  })

  test('titres ### Task N: et suffixe « Implementation Plan » retiré', () => {
    expect(parsePlan(PLAN_TASK)).toStrictEqual({ title: 'Reduction: YAML Output, Multi-Document yq, Limit After Filters', tasks: 4 })
    const csv = ['# Ajouter l’export CSV Implementation Plan', '### Task 1: Ajouter la commande export', '### Task 2: Lire les résultats', '### Task 3: Écrire le fichier CSV'].join('\n')
    expect(parsePlan(csv)).toStrictEqual({ title: 'Ajouter l’export CSV', tasks: 3 })
  })

  test('titres ### Tâche N : du plan de mode-clair lui-même', () => {
    const plan = ['# mode-clair 0.2.0 — plan d’implémentation', '## Tâches', '### Tâche 7 : superpowers.ts', '### Tâche 8 : workflow.ts'].join('\n')
    expect(parsePlan(plan)).toStrictEqual({ title: 'mode-clair 0.2.0 — plan d’implémentation', tasks: 2 })
  })

  test('un même numéro compté une fois ; ni ### sans numéro ni ## ne comptent', () => {
    const plan = [
      '# Plan de correction — tout ce qui reste (2026-09-30)',
      '### T1 — `ssh_net_equip_config` exécute du texte arbitraire avec la whitelist contournée',
      '### TT1 — rendre le rapport de survivants lisible (priorité haute, effort S)',
      '### Trois issues possibles',
      '## T20 — la seule chose que la lecture ne peut pas trancher : le mot de passe arrive-t-il ?',
    ].join('\n')
    expect(parsePlan(plan)).toStrictEqual({ title: 'Plan de correction — tout ce qui reste (2026-09-30)', tasks: 1 })
  })

  test('un bloc de code clôturé (``` ou ~~~) ne compte ni pour le titre ni pour les tâches', () => {
    for (const fence of ['```', '~~~']) {
      const plan = [
        fence + 'markdown',
        '# Plan — des tests qui testent, et des signaux qui disent la réalité (2026-10-14)',
        '### TT2 — faire du score une mesure qui tient (priorité haute, effort S/M)',
        fence,
        PLAN_T,
      ].join('\n')
      expect(parsePlan(plan)).toStrictEqual({ title: 'Plan de correction — tout ce qui reste (2026-09-30)', tasks: 3 })
    }
  })

  test('sans titre ni tâche : title null, tasks 0', () => {
    expect(parsePlan('')).toStrictEqual({ title: null, tasks: 0 })
    expect(parsePlan('#sans espace\n##   \n')).toStrictEqual({ title: null, tasks: 0 })
  })

  test('taskNumber lit le numéro des descriptions réelles', () => {
    expect(taskNumber('Implement Task 3: remote exit code')).toBe(3)
    expect(taskNumber('Review Task 2 (spec + quality)')).toBe(2)
    expect(taskNumber('Implement T3 sudo password stdin')).toBe(3)
    expect(taskNumber('T9 implementer: write the criterion')).toBe(9)
    expect(taskNumber('Implement Tâche 12 : la carte')).toBe(12)
    expect(taskNumber('TT4 — le méta-test anti-fixture creuse')).toBe(4)
    expect(taskNumber('Implement T11c AWX limit fix')).toBeNull()
    expect(taskNumber('Whole-branch code review wave 6')).toBeNull()
  })
})

const PLAN_T_PATH = '/home/user/archive/exit-code-directs/docs/superpowers/plans/2026-09-30-tout-ce-qui-reste.md'
const PLAN_TT_PATH = '/home/user/archive/exit-code-directs/docs/superpowers/plans/2026-10-14-tests-qui-testent.md'
const SPEC_PATH = '/home/user/claude-mods/docs/superpowers/specs/2026-10-15-mode-clair-propre-design.md'

const state = (patch: Partial<Superpowers>): Superpowers => ({
  stage: 'cadrage',
  planTitle: null,
  planPath: null,
  tasks: 0,
  current: null,
  lastEventAt: 1_000,
  isStale: false,
  runningAgents: [],
  ...patch,
})

describe('superpowers : les skills d’étape', () => {
  test('chaque skill d’étape crée son étape, avec ou sans le préfixe superpowers:', () => {
    const cases: [string, Superpowers['stage']][] = [
      ['superpowers:brainstorming', 'cadrage'],
      ['superpowers:writing-plans', 'plan'],
      ['writing-plans', 'plan'],
      ['superpowers:subagent-driven-development', 'taches'],
      ['superpowers:executing-plans', 'taches'],
      ['superpowers:requesting-code-review', 'relecture'],
      ['superpowers:finishing-a-development-branch', 'fin'],
    ]
    for (const [skill, stage] of cases) {
      expect(onSkill(null, skill, 2_000)).toStrictEqual(state({ stage, lastEventAt: 2_000 }))
    }
  })

  test('brainstorming repart d’un état neuf, même au milieu d’un plan', () => {
    const sp = state({ stage: 'taches', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 19, current: 4 })
    expect(onSkill(sp, 'brainstorming', 9_000)).toStrictEqual(state({ lastEventAt: 9_000 }))
  })

  test('un skill d’étape fait avancer l’état sans perdre le plan, et le réveille', () => {
    const sp = state({ stage: 'plan', planTitle: 'X', planPath: PLAN_T_PATH, tasks: 19, isStale: true })
    expect(onSkill(sp, 'superpowers:subagent-driven-development', 5_000)).toStrictEqual(
      state({ stage: 'taches', planTitle: 'X', planPath: PLAN_T_PATH, tasks: 19, lastEventAt: 5_000 }),
    )
  })

  test('un skill qui n’est pas une étape ne change rien : même référence, jamais de création', () => {
    const sp = state({ stage: 'taches', tasks: 3, current: 2 })
    const others = [
      'superpowers:using-superpowers',
      'superpowers:systematic-debugging',
      'superpowers:test-driven-development',
      'superpowers:verification-before-completion',
      'artifact-design',
      'caveman:caveman-commit',
      'autre-plugin:writing-plans',
    ]
    for (const skill of others) {
      expect(onSkill(sp, skill, 2_000)).toBe(sp)
      expect(onSkill(null, skill, 2_000)).toBeNull()
    }
  })
})

describe('superpowers : les écritures sous docs/superpowers/', () => {
  test('une écriture ne crée jamais d’état', () => {
    expect(onDocWrite(null, PLAN_T_PATH, PLAN_T, 2_000)).toBeNull()
    expect(onDocWrite(null, SPEC_PATH, '# spec', 2_000)).toBeNull()
  })

  test('la spec fait passer le cadrage à l’étape spec, et ne fait jamais reculer', () => {
    expect(onDocWrite(state({}), SPEC_PATH, '# spec', 2_000)).toStrictEqual(state({ stage: 'spec', lastEventAt: 2_000 }))
    const sp = state({ stage: 'taches', planPath: PLAN_T_PATH, tasks: 3, current: 1 })
    expect(onDocWrite(sp, SPEC_PATH, '# spec', 2_000)).toStrictEqual({ ...sp, lastEventAt: 2_000 })
  })

  test('un plan réel aux titres ### T1 — donne son titre et son nombre de tâches', () => {
    expect(onDocWrite(state({ stage: 'spec' }), PLAN_T_PATH, PLAN_T, 3_000)).toStrictEqual(
      state({ stage: 'plan', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 3, lastEventAt: 3_000 }),
    )
    expect(onDocWrite(state({}), PLAN_T_PATH, PLAN_T, 3_000)?.stage).toBe('plan')
  })

  test('pendant l’exécution, relire le même plan garde l’étape et la tâche courante', () => {
    const sp = state({ stage: 'taches', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 2, current: 2 })
    expect(onDocWrite(sp, PLAN_T_PATH, PLAN_T, 4_000)).toStrictEqual({ ...sp, tasks: 3, lastEventAt: 4_000 })
  })

  test('relecture échouée (text null) : le même plan garde ses tâches, un autre plan les oublie', () => {
    const sp = state({ stage: 'taches', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 19, current: 4 })
    expect(onDocWrite(sp, PLAN_T_PATH, null, 4_000)).toStrictEqual({ ...sp, lastEventAt: 4_000 })
    expect(onDocWrite(sp, PLAN_TT_PATH, null, 4_000)).toStrictEqual(
      state({ stage: 'taches', planPath: PLAN_TT_PATH, lastEventAt: 4_000 }),
    )
  })

  test('changer de plan oublie la tâche courante', () => {
    const sp = state({ stage: 'taches', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 19, current: 4 })
    expect(onDocWrite(sp, PLAN_TT_PATH, PLAN_TT, 4_000)).toStrictEqual(
      state({
        stage: 'taches',
        planTitle: 'Plan — des tests qui testent, et des signaux qui disent la réalité (2026-10-14)',
        planPath: PLAN_TT_PATH,
        tasks: 2,
        lastEventAt: 4_000,
      }),
    )
  })

  test('un autre fichier sous docs/superpowers/ ne compte que comme événement', () => {
    const sp = state({ stage: 'plan', planPath: PLAN_T_PATH, tasks: 3, isStale: true })
    const refs = '/home/user/claude-mods/docs/superpowers/plans/refs/engine-api.md'
    expect(onDocWrite(sp, refs, '# Engine API reference for mode-clair 0.2.0, Claude Code 2.1.300', 6_000)).toStrictEqual({
      ...sp,
      lastEventAt: 6_000,
      isStale: false,
    })
    expect(onDocWrite(sp, 'docs/superpowers/audits/2026-10-15-mode-clair-audit.json', '{}', 6_000)?.stage).toBe('plan')
  })

  test('un fichier hors de docs/superpowers/ ne change rien', () => {
    const sp = state({ stage: 'plan' })
    expect(onDocWrite(sp, '/home/user/claude-mods-0.2/plugins/mode-clair/hooks/superpowers.ts', 'export {}', 6_000)).toBe(sp)
    expect(onDocWrite(sp, '/home/user/claude-mods-0.2/mydocs/superpowers/plans/x.md', '# x', 6_000)).toBe(sp)
  })
})

describe('superpowers : les appels Agent', () => {
  test('un Agent ne crée jamais d’état', () => {
    expect(onAgent(null, 'Implement T3 sudo password stdin', '', 2_000)).toBeNull()
  })

  test('pendant le plan ou les tâches, le numéro de la description devient la tâche courante', () => {
    const plan = state({ stage: 'plan', planTitle: 'Plan de correction — tout ce qui reste (2026-09-30)', planPath: PLAN_T_PATH, tasks: 19 })
    const t3 = onAgent(plan, 'Implement T3 sudo password stdin', 'You are implementing T3', 2_000)
    expect(t3).toStrictEqual({ ...plan, stage: 'taches', current: 3, lastEventAt: 2_000 })
    expect(onAgent(t3, 'T9 implementer: write the criterion', '', 3_000)).toStrictEqual({ ...plan, stage: 'taches', current: 9, lastEventAt: 3_000 })
  })

  test('sans numéro, numéro 0 ou au-delà du nombre de tâches : rien ne change', () => {
    const sp = state({ stage: 'taches', planPath: PLAN_T_PATH, tasks: 19, current: 3 })
    expect(onAgent(sp, 'Implement T11c AWX limit fix', '', 2_000)).toBe(sp)
    expect(onAgent(sp, 'Security audit T70 diff', '', 2_000)).toBe(sp)
    expect(onAgent(sp, 'Task 0: Reproduce the three defects live, before touching code', '', 2_000)).toBe(sp)
    expect(onAgent(state({ stage: 'taches', tasks: 19 }), 'T19 — trois limites à documenter, pas à corriger', '', 2_000)?.current).toBe(19)
    expect(onAgent(state({ stage: 'taches', tasks: 0 }), 'Security audit T70 diff', '', 2_000)?.current).toBe(70)
  })

  test('hors du plan et des tâches, un numéro de tâche ne change rien', () => {
    for (const stage of ['cadrage', 'spec', 'relecture', 'fin'] as const) {
      const sp = state({ stage, tasks: 19 })
      expect(onAgent(sp, 'Implement Task 3: remote exit code', '', 2_000)).toBe(sp)
    }
  })

  test('relecture finale : description final review ou prompt qui cite code-reviewer.md', () => {
    const sp = state({ stage: 'taches', planPath: PLAN_T_PATH, tasks: 19, current: 19 })
    expect(onAgent(sp, 'Final review fix wave', '', 2_000)).toStrictEqual({ ...sp, stage: 'relecture', lastEventAt: 2_000 })
    expect(onAgent(sp, 'Run the final code review', '', 2_000)?.stage).toBe('relecture')
    const prompt = 'Use the template at [code-reviewer.md](../requesting-code-review/code-reviewer.md).'
    expect(onAgent(sp, 'Review code changes', prompt, 2_000)?.stage).toBe('relecture')
    const relecture = state({ stage: 'relecture', isStale: true })
    expect(onAgent(relecture, 'Final review fix wave', '', 7_000)).toStrictEqual({ ...relecture, lastEventAt: 7_000, isStale: false })
    const cadrage = state({})
    expect(onAgent(cadrage, 'Final review fix wave', prompt, 2_000)).toBe(cadrage)
  })
})

describe('superpowers : abandon après 30 minutes', () => {
  test('STALE_MS vaut 30 minutes', () => {
    expect(STALE_MS).toBe(1_800_000)
  })

  test('juste avant le délai rien ne change ; au délai l’état est marqué abandonné, pas effacé', () => {
    const sp = state({ stage: 'taches', tasks: 3, current: 2, lastEventAt: 1_000 })
    expect(expire(sp, 1_000 + STALE_MS - 1)).toBe(sp)
    expect(expire(sp, 1_000 + STALE_MS)).toStrictEqual({ ...sp, isStale: true })
    expect(expire(null, 1_000 + STALE_MS)).toBeNull()
    const stale = state({ isStale: true })
    expect(expire(stale, 1_000 + 2 * STALE_MS)).toBe(stale)
  })
})

// Claude Code 2.1.300 lance les agents en arrière-plan par défaut (captures etat-superpowers, tâche 14) :
// le tour principal finit pendant que l'agent tourne. Formes du résultat `Agent` : refs/engine-api.md
// §3.3 (D:17513-17612) ; seuls status et agentId comptent, les autres champs ont des valeurs d'exemple.
// agentId réels : journal wf_0f41829b-6d3 (fixtures de la tâche 8).
const AGENT = 'af6f3b628322fc241'
const OTHER = 'ae24fa2f3e6f689fe'
const OUTPUT = '/tmp/claude-1000/-home-user-claude-mods-0-2/tasks/af6f3b628322fc241.output'

describe('superpowers : les agents lancés sous le plan qui tournent encore', () => {
  test('runningAgentOf : l’agentId d’un agent lancé en arrière-plan, rien pour un agent fini, distant ou un résultat inconnu', () => {
    const launched = { status: 'async_launched', agentId: AGENT, description: 'Implement Task 2', prompt: 'You are implementing Task 2', outputFile: OUTPUT }
    expect(runningAgentOf(launched)).toBe(AGENT)
    expect(runningAgentOf({ ...launched, isAsync: true })).toBe(AGENT)
    // Au premier plan : le résultat porte aussi un agentId, mais l'agent a fini (son turn.complete est déjà passé).
    const completed = { status: 'completed', agentId: AGENT, content: [{ type: 'text', text: 'DONE' }], totalToolUseCount: 3, totalDurationMs: 4_000, totalTokens: 900, prompt: 'You are implementing Task 2' }
    expect(runningAgentOf(completed)).toBeNull()
    const remote = { status: 'remote_launched', taskId: 'r1', sessionUrl: 'https://claude.ai/code/session_1', description: 'Implement Task 2', prompt: '', outputFile: OUTPUT }
    expect(runningAgentOf(remote)).toBeNull()
    for (const odd of [undefined, null, 'Agent failed', {}, { status: 'async_launched' }, { status: 'async_launched', agentId: '' }, { status: 'async_launched', agentId: 7 }, { agentId: AGENT }]) {
      expect(runningAgentOf(odd)).toBeNull()
    }
  })

  test('onAgentLaunched : ajouté pendant les tâches ou la relecture, une seule fois ; l’état se réveille', () => {
    const taches = state({ stage: 'taches', planPath: PLAN_T_PATH, tasks: 19, current: 2, isStale: true })
    const one = onAgentLaunched(taches, AGENT, 5_000)
    expect(one).toStrictEqual({ ...taches, runningAgents: [AGENT], lastEventAt: 5_000, isStale: false })
    expect(onAgentLaunched(one, OTHER, 6_000)).toStrictEqual({ ...taches, runningAgents: [AGENT, OTHER], lastEventAt: 6_000, isStale: false })
    expect(onAgentLaunched(one, AGENT, 7_000)).toBe(one)
    const relecture = state({ stage: 'relecture' })
    expect(onAgentLaunched(relecture, AGENT, 5_000)).toStrictEqual({ ...relecture, runningAgents: [AGENT], lastEventAt: 5_000 })
    expect(onAgentLaunched(null, AGENT, 5_000)).toBeNull()
  })

  test('hors du plan (cadrage, spec, plan, fin) : un agent lancé ne compte pas, même référence', () => {
    for (const stage of ['cadrage', 'spec', 'plan', 'fin'] as const) {
      const sp = state({ stage })
      expect(onAgentLaunched(sp, AGENT, 5_000)).toBe(sp)
    }
  })

  test('onAgentDone : retiré à la fin de sa boucle ; un agent inconnu ne change rien', () => {
    const sp = state({ stage: 'taches', runningAgents: [AGENT, OTHER], lastEventAt: 5_000 })
    expect(onAgentDone(sp, AGENT, 8_000)).toStrictEqual({ ...sp, runningAgents: [OTHER], lastEventAt: 8_000 })
    const stale = state({ stage: 'taches', runningAgents: [AGENT], isStale: true })
    expect(onAgentDone(stale, AGENT, 8_000)).toStrictEqual({ ...stale, runningAgents: [], lastEventAt: 8_000, isStale: false })
    expect(onAgentDone(sp, 'a3634f40baec24679', 8_000)).toBe(sp)
    expect(onAgentDone(null, AGENT, 8_000)).toBeNull()
  })

  test('abandon après 30 minutes : la liste des agents se vide avec lui', () => {
    const sp = state({ stage: 'taches', runningAgents: [AGENT], lastEventAt: 1_000 })
    expect(expire(sp, 1_000 + STALE_MS - 1)).toBe(sp)
    expect(expire(sp, 1_000 + STALE_MS)).toStrictEqual({ ...sp, isStale: true, runningAgents: [] })
  })

  test('les skills d’étape, les écritures et les autres Agent gardent la liste ; brainstorming repart de zéro', () => {
    const sp = state({ stage: 'taches', planPath: PLAN_T_PATH, tasks: 19, current: 2, runningAgents: [AGENT] })
    expect(onSkill(sp, 'superpowers:requesting-code-review', 9_000)?.runningAgents).toStrictEqual([AGENT])
    expect(onDocWrite(sp, PLAN_T_PATH, PLAN_T, 9_000)?.runningAgents).toStrictEqual([AGENT])
    expect(onAgent(sp, 'Implement T3 sudo password stdin', '', 9_000)?.runningAgents).toStrictEqual([AGENT])
    expect(onSkill(sp, 'superpowers:brainstorming', 9_000)?.runningAgents).toStrictEqual([])
  })
})
