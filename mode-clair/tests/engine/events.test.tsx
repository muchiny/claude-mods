import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { STALE_MS } from '../../hooks/superpowers'
import { RECORDED_REFUSALS } from '../pure/engine-texts'
import { lastState, world, writeFile } from './world'

// --- Fixtures réelles ----------------------------------------------------------

// refs/bridge-facts.md §0.1 (1) : lignes de journal que la CLI écrit sur stderr avant tout (ANSI retiré).
const CLI_LOG = [
  '2026-10-14T23:33:55.485691Z  INFO Loading configuration config=/path/config.yaml',
  '2026-10-14T23:33:55.485691Z  INFO Sanitizer initialized builtin_patterns=72 custom_patterns=0 total_patterns=72',
  '2026-10-14T23:33:55.485705Z  INFO Entropy-based secret detection enabled',
].join('\n')
// Sortie de ssh_disk_usage, fixture des sources de bridge-mcp (src/mcp/tool_handlers/ssh_disk_usage.rs:344).
const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
// refs/bridge-facts.md §2.4 (forme du texte Bash) et §3.2 (`Unknown host`, sortie 3, VERIFIED).
const CLI_UNKNOWN_HOST = `Exit code 3\n${CLI_LOG}\nError: Unknown host: nohost`
// refs/bridge-facts.md §3.5.
const SSH_REFUSED = 'SSH connection failed to raspberry: Connection refused (os error 111)'
// refs/bridge-facts.md §5.2 (message exact du formulaire pour ssh_exec).
const CONFIRM_EXEC =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n{"command":"systemctl restart nginx","host":"raspberry"}\n```\n\n**Command:**\n```sh\nsystemctl restart nginx\n```\n\nProceed?'
// refs/bridge-facts.md §5.1 : sans arguments lisibles, le résumé vaut `(no arguments)`.
const CONFIRM_NO_ARGS = 'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n(no arguments)\n```\n\nProceed?'
// refs/bridge-facts.md §3.8 : refus au formulaire, et accord sans `confirm: true`.
const DECLINED = 'User declined execution of destructive tool `ssh_exec`.'
const CANCELLED = 'User cancelled confirmation for destructive tool `ssh_exec`.'
const NOT_GRANTED = 'Confirmation for destructive tool `ssh_exec` was not granted; the operation was not run.'
// Spec §10, « Texte exact d'un refus au dialogue de permission et d'un refus du classifieur » (tâche 5, engine-texts.ts).
const DIALOG_REFUSAL = RECORDED_REFUSALS[0] ?? ''
const CLASSIFIER_REFUSAL = RECORDED_REFUSALS[RECORDED_REFUSALS.length - 1] ?? ''
// SessionInfo de ssh_session_create (refs/bridge-facts.md §6.1 ; champs de src/ssh/session.rs:72-78 ; id UUID v4,
// src/ssh/session.rs:345) et réponse de ssh_session_exec (JSON trié, §6.1).
const SESSION = '7f6d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const SESSION_INFO = `{"id":"${SESSION}","host":"raspberry","cwd":"/home/pi","created_at_secs_ago":0,"last_used_secs_ago":0}`
const SESSION_EXEC = `{"cwd":"/home/pi","exit_code":0,"output":"up 3 days","session_id":"${SESSION}"}`
// Plan au format des plans de l'utilisateur (spec §5.2 : titres `### T1 — Titre`).
const PLAN_PATH = '/home/user/claude-mods-0.2/docs/superpowers/plans/2026-10-15-exemple.md'
const PLAN_3 = '# Exemple\n\n### T1 — Première\n\n### T2 — Deuxième\n\n### T3 — Troisième\n'
const PLAN_4 = `${PLAN_3}\n### T4 — Quatrième\n`
// Bloc meta d'un script Workflow (D:17484).
const SCRIPT = "export const meta = { name: 'audit-disques', description: 'faire de la place', phases: [{ title: 'Review' }] }"
// Journal réel : les quatre premières lignes de ce fichier, chacune finie par son retour à la ligne
// (JSONL ; foldJournal ne lit que les lignes complètes), relevé le 2026-10-15.
const WF_DIR =
  '/home/user/.claude/projects/-home-user-bridge-mcp/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_0f41829b-6d3'
const JOURNAL = `${WF_DIR}/journal.jsonl`
const JOURNAL_4 = [
  '{"type":"launched"}',
  '{"type":"started","key":"v2:d885cd372066bf210c715493729aa9cfcc90e795e9a167ea161134c9b4279533","agentId":"af6f3b628322fc241","label":"review:coverage","phase":"Review"}',
  '{"type":"started","key":"v2:fdbc6ff4edcfc67e73f95689f83b6279f51a038c8ed92a8f967a47db631aed5f","agentId":"ae24fa2f3e6f689fe","label":"review:consistency","phase":"Review"}',
  '{"type":"started","key":"v2:beba76af0c5af1fd8ec8e5f28b4d0a5f8a6c28a6be7a6d6b52637c7466c3997e","agentId":"a3634f40baec24679","label":"review:feasibility","phase":"Review"}',
  '',
].join('\n')
const WF_RESULT = {
  status: 'async_launched',
  taskId: 'wpt3f122w',
  taskType: 'local_workflow',
  workflowName: 'audit-disques',
  runId: 'wf_0f41829b-6d3',
  transcriptDir: WF_DIR,
} as const
// Notification de fin d'une tâche de fond, forme relevée dans un transcript réel (balises et retours à la ligne).
const NOTICE =
  '<task-notification>\n<task-id>wpt3f122w</task-id>\n<tool-use-id>toolu_wf</tool-use-id>\n<output-file>/tmp/claude-1000/tasks/wpt3f122w.output</output-file>\n<status>completed</status>\n<summary>Dynamic workflow "audit-disques" completed</summary>\n</task-notification>'

const ok = (text: string) => ({ result: { result: { content: [] }, text, isReadOnly: true as const } })
const failed = (text: string) => ({ result: { result: text, text, isError: true as const } })

/**
 * Refuse les `n` prochaines écritures de `'mode-clair'.state` posées par `arm(n)`. Appelé AVANT
 * world(on) : ce hook de test est alors au-dessus de ceux du monde, qui ne notent donc pas une
 * écriture refusée (lastState reste la dernière écriture qui a eu lieu). Un rejet que le mod ne
 * rattrape pas fait échouer le fichier (« the file ran to its end : a rejection nothing handled »).
 */
function refuseStateWrites(on: On): { arm: (n: number) => void; refused: () => number } {
  let left = 0
  let refused = 0
  on('state.set', ($, e, next) => {
    if (left === 0 || e.key !== 'state') return next(e)
    left -= 1
    refused += 1
    return { deny: 'écriture refusée par le test' }
  })
  return { arm: n => void (left = n), refused: () => refused }
}

// --- Session --------------------------------------------------------------------

describe('session.start', () => {
  test('enregistre /clair et ne pose aucune entrée de ligne d’état', async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/home/user', surface: null, isInteractive: true })
    expect(w.commands).toEqual(['clair'])
    expect(w.status.filter(t => t !== undefined)).toHaveLength(0)
  })
})

// --- bridge-mcp par la CLI ------------------------------------------------------------

describe('tool.call Bash', () => {
  test('un appel CLI réussi : fait, lecture, sur sa machine', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_cli', { result: { result: { stdout: DF, stderr: CLI_LOG, interrupted: false }, text: `${CLI_LOG}\n${DF}` } })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_cli', command: 'bridge-mcp tool ssh_disk_usage host=raspberry' })
    expect(w.rows.get('toolu_cli')).toMatchObject([{ via: 'cli', tool: 'ssh_disk_usage', host: 'raspberry', nature: 'lecture', state: 'fait' }])
  })

  test('une commande qui n’appelle pas le bridge ne laisse aucune trace', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_ls', { result: { result: { stdout: 'README.md', stderr: '', interrupted: false }, text: 'README.md' } })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_ls', command: 'ls' })
    expect(w.rows.size).toBe(0)
    expect(w.state).toBeUndefined()
  })

  test('un code de sortie de la CLI arrive avec son texte : machine inconnue', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_nohost', failed(CLI_UNKNOWN_HOST))
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_nohost', command: 'bridge-mcp tool ssh_disk_usage host=nohost' })
    expect(w.rows.get('toolu_nohost')).toMatchObject([{ host: 'nohost', state: 'machine-inconnue' }])
  })

  test('run_in_background : ignoré, rien n’est écrit', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_bg', { result: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: '' }, afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_bg', command: 'bridge-mcp tool ssh_disk_usage host=raspberry', run_in_background: true })
    await w.clock.settle()
    expect(w.state).toBeUndefined()
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.size).toBe(0)
    expect(w.state).toBeUndefined()
  })

  test('passé en arrière-plan en cours de route (backgroundTaskId) : l’appel est retiré', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_auto', { result: { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b2', timedOutAfterMs: 120_000 }, text: '' } })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_auto', command: 'bridge-mcp tool ssh_disk_usage host=raspberry' })
    expect(w.rows.get('toolu_auto')).toEqual([])
    expect(lastState(w)?.calls).toHaveLength(0)
  })
})

// --- bridge-mcp par MCP -------------------------------------------------------------

describe('tool.call mcp__', () => {
  test('en cours dès le début du tool.call, fait à la fin', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_m', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_m', host: 'raspberry' })
    await w.clock.settle()
    expect(w.rows.get('toolu_m')).toMatchObject([{ via: 'mcp', tool: 'ssh_disk_usage', host: 'raspberry', state: 'en-cours' }])
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_m')).toMatchObject([{ state: 'fait', nature: 'lecture' }])
  })

  test('cinq appels en parallèle : aucune écriture perdue', async ($, on) => {
    const w = world(on)
    const hosts = ['raspberry', 'win2012', 'win2025', 'win2025ntlm', 'win2025tls']
    for (const host of hosts) w.answers.set(`toolu_${host}`, { ...ok(DF), afterMs: 1_000 })
    const pending = hosts.map(host => $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: `toolu_${host}`, host }))
    await w.clock.settle()
    expect(lastState(w)?.calls.filter(c => c.state === 'en-cours')).toHaveLength(5)
    await w.clock.advance(1_000)
    await Promise.all(pending)
    expect(lastState(w)?.calls.filter(c => c.state === 'fait')).toHaveLength(5)
    for (const host of hosts) expect(w.rows.get(`toolu_${host}`)).toMatchObject([{ host, state: 'fait' }])
  })

  test('mode progressif : mcp_call_tool donne le vrai outil et la machine', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_p', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__mcp_call_tool', tool_use_id: 'toolu_p', name: 'ssh_disk_usage', arguments: { host: 'raspberry' } })
    expect(w.rows.get('toolu_p')).toMatchObject([{ tool: 'ssh_disk_usage', host: 'raspberry' }])
  })

  test('un serveur dont le nom contient seulement « bridge » n’est pas suivi', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_h', ok('ok'))
    await $.tool.call({ tool: 'mcp__cc-plugin-bridge-health__check', tool_use_id: 'toolu_h', host: 'raspberry' })
    expect(w.rows.size).toBe(0)
    expect(w.state).toBeUndefined()
  })

  test('une machine injoignable : injoignable', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_down', failed(SSH_REFUSED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_down', host: 'raspberry' })
    expect(w.rows.get('toolu_down')).toMatchObject([{ host: 'raspberry', state: 'injoignable' }])
  })

  test('le cœur échoue : l’appel est fermé quand même, interrompu', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_x', { ...ok(DF), throws: true })
    let rejected = false
    try {
      await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_x', host: 'raspberry' })
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
    expect(w.rows.get('toolu_x')).toMatchObject([{ state: 'interrompu' }])
  })

  test('ssh_session_create puis ssh_session_exec : la machine vient de la session', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_sc', ok(SESSION_INFO))
    w.answers.set('toolu_se', ok(SESSION_EXEC))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_session_create', tool_use_id: 'toolu_sc', host: 'raspberry' })
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_session_exec', tool_use_id: 'toolu_se', session_id: SESSION, command: 'uptime' })
    expect(lastState(w)?.sessions).toEqual({ [SESSION]: 'raspberry' })
    expect(w.rows.get('toolu_se')).toMatchObject([{ tool: 'ssh_session_exec', host: 'raspberry' }])
  })
})

// --- Refus de Claude Code -------------------------------------------------------------

describe('classic.PermissionDenied et texte de refus du moteur', () => {
  test('PermissionDenied : refusé par Claude Code, avant même la fin de l’appel', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_cls', { ...failed(CLASSIFIER_REFUSAL), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_cls', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.PermissionDenied({
      tool_name: 'mcp__ssh-bridge__ssh_exec',
      tool_input: { host: 'raspberry', command: 'systemctl restart nginx' },
      tool_use_id: 'toolu_cls',
      reason: 'classifier',
    })
    expect(w.rows.get('toolu_cls')).toMatchObject([{ state: 'refuse-claude' }])
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_cls')).toMatchObject([{ state: 'refuse-claude' }])
  })

  test('le texte du refus au dialogue suffit : refusé par Claude Code', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_dlg', failed(DIALOG_REFUSAL))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_dlg', host: 'raspberry', command: 'systemctl restart nginx' })
    expect(w.rows.get('toolu_dlg')).toMatchObject([{ state: 'refuse-claude' }])
  })
})

// --- Formulaire de confirmation (« à toi ») ---------------------------------------------

describe('classic.Elicitation et classic.ElicitationResult', () => {
  test('la ligne d’état seulement pendant l’attente, puis décliné', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_f', { ...failed(DECLINED), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_f', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    expect(w.status.filter(t => t !== undefined)).toHaveLength(0)
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    expect(lastState(w)?.waiting).toMatchObject({ tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_f#0' })
    expect(w.status.at(-1)).toMatch(/raspberry attend ton accord/)
    await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', action: 'decline' })
    expect(lastState(w)?.waiting).toBeNull()
    expect(w.status.at(-1)).toBeUndefined()
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_f')).toMatchObject([{ state: 'decline', accord: 'formulaire-non' }])
  })

  // Spec §10, « Formulaire Modern input_required » : Échap rend `action` = 'cancel', `content` = null
  // (mesuré ; le type D:3997 ne déclare que `content?`), et le bridge répond son texte d'annulation.
  test('Échap sur le formulaire (cancel, content null) : décliné, accord non, « à toi » effacé', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_esc', { ...failed(CANCELLED), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_esc', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    expect(w.status.at(-1)).toMatch(/raspberry attend ton accord/)
    await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', mode: 'form', action: 'cancel', content: null as never })
    expect(lastState(w)?.waiting).toBeNull()
    expect(w.status.at(-1)).toBeUndefined()
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_esc')).toMatchObject([{ state: 'decline', accord: 'formulaire-non' }])
  })

  test('accepté avec confirm = true : accord oui', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_a', { ...ok('active'), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_a', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', action: 'accept', content: { confirm: true } })
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_a')).toMatchObject([{ accord: 'formulaire-oui' }])
  })

  test('accepté sans confirm = true : accord non (refs/bridge-facts.md §5.5)', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_g', { ...failed(NOT_GRANTED), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_g', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    await $.classic.ElicitationResult({ mcp_server_name: 'ssh-bridge', action: 'accept', content: { confirm: false } })
    await w.clock.advance(1_000)
    await pending
    expect(w.rows.get('toolu_g')).toMatchObject([{ accord: 'formulaire-non' }])
  })

  test('sans hôte lisible dans le message : l’appel MCP bridge en cours le plus récent', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_n', { ...ok('active'), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_n', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_NO_ARGS, mode: 'form' })
    expect(lastState(w)?.waiting).toMatchObject({ host: 'raspberry', callId: 'toolu_n#0' })
    await w.clock.advance(1_000)
    await pending
  })

  test('la réponse n’arrive jamais : « à toi » s’efface quand l’appel se termine', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_r', { ...failed(DECLINED), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_exec', tool_use_id: 'toolu_r', host: 'raspberry', command: 'systemctl restart nginx' })
    await w.clock.settle()
    await $.classic.Elicitation({ mcp_server_name: 'ssh-bridge', message: CONFIRM_EXEC, mode: 'form' })
    await w.clock.advance(1_000)
    await pending
    expect(lastState(w)?.waiting).toBeNull()
    expect(w.status.at(-1)).toBeUndefined()
  })

  test('un formulaire d’un autre serveur MCP ne change rien', async ($, on) => {
    const w = world(on)
    await $.classic.Elicitation({ mcp_server_name: 'github', message: CONFIRM_EXEC, mode: 'form' })
    expect(w.state).toBeUndefined()
  })
})

// --- Fin de boucle -------------------------------------------------------------------------

describe('turn.complete', () => {
  test('les appels de la boucle encore en cours deviennent interrompus', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_t', { ...ok(DF), afterMs: 1_000 })
    const pending = $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_t', host: 'raspberry' })
    await w.clock.settle()
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: true, turnId: 't1', reason: 'aborted' })
    expect(w.rows.get('toolu_t')).toMatchObject([{ state: 'interrompu' }])
    await w.clock.advance(1_000)
    await pending
  })
})

// --- Superpowers -------------------------------------------------------------------------

describe('tool.call Skill, Agent, Write et Edit', () => {
  test('une session Superpowers : plan, tâches, tâche courante', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s1', skill: 'superpowers:writing-plans' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'toolu_w1', file_path: PLAN_PATH, content: PLAN_3 })
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s2', skill: 'superpowers:subagent-driven-development' })
    await $.tool.call({ tool: 'Agent', tool_use_id: 'toolu_a1', description: 'Implement Task 2', prompt: 'You are implementing Task 2' })
    expect(lastState(w)?.superpowers).toMatchObject({ stage: 'taches', tasks: 3, current: 2, isStale: false })
  })

  test('un skill qui n’est pas une étape n’écrit rien', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s3', skill: 'superpowers:systematic-debugging' })
    expect(w.state).toBeUndefined()
  })

  test('Edit d’un plan : le fichier est relu avec $.fs.read', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s4', skill: 'superpowers:writing-plans' })
    await $.tool.call({ tool: 'Write', tool_use_id: 'toolu_w2', file_path: PLAN_PATH, content: PLAN_3 })
    writeFile(w, PLAN_PATH, PLAN_4)
    await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_e1', file_path: PLAN_PATH, old_string: 'Troisième\n', new_string: 'Troisième\n\n### T4 — Quatrième\n' })
    expect(w.reads).toEqual([PLAN_PATH])
    expect(lastState(w)?.superpowers).toMatchObject({ tasks: 4 })
  })

  test('Edit d’un autre fichier : aucune lecture', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s5', skill: 'superpowers:writing-plans' })
    await $.tool.call({ tool: 'Edit', tool_use_id: 'toolu_e2', file_path: '/home/user/claude-mods-0.2/README.md', old_string: 'a', new_string: 'b' })
    expect(w.reads).toHaveLength(0)
  })

  test('30 minutes sans événement : abandonné par le minuteur', async ($, on) => {
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s6', skill: 'superpowers:writing-plans' })
    await w.clock.advance(STALE_MS - 1)
    expect(lastState(w)?.superpowers).toMatchObject({ isStale: false })
    await w.clock.advance(1_000)
    expect(lastState(w)?.superpowers).toMatchObject({ isStale: true })
  })

  test('écriture refusée à l’expiration : le minuteur rattrape son rejet, l’événement suivant le réarme', async ($, on) => {
    const refuse = refuseStateWrites(on)
    const w = world(on)
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s7', skill: 'superpowers:writing-plans' })
    refuse.arm(1)
    await w.clock.advance(STALE_MS)
    expect(refuse.refused()).toBe(1)
    expect(lastState(w)?.superpowers).toMatchObject({ stage: 'plan', isStale: false })
    await $.tool.call({ tool: 'Skill', tool_use_id: 'toolu_s8', skill: 'superpowers:subagent-driven-development' })
    await w.clock.advance(STALE_MS)
    expect(lastState(w)?.superpowers).toMatchObject({ stage: 'taches', isStale: true })
  })
})

// --- Workflows ---------------------------------------------------------------------------

describe('tool.call Workflow, minuteur du journal et session.append', () => {
  test('suivi par son identifiant, phases lues dans le bloc meta', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    expect(lastState(w)?.workflows).toMatchObject([
      { key: 'wf_0f41829b-6d3', toolUseId: 'toolu_wf', name: 'audit-disques', phases: ['Review'], journalPath: JOURNAL, status: 'en-cours' },
    ])
  })

  test('phases lues dans result.scriptPath quand le script n’est pas en ligne', async ($, on) => {
    const w = world(on)
    writeFile(w, `${WF_DIR}/script.mjs`, SCRIPT)
    w.answers.set('toolu_wf', { result: { result: { ...WF_RESULT, scriptPath: `${WF_DIR}/script.mjs` }, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', name: 'audit-disques' })
    expect(lastState(w)?.workflows).toMatchObject([{ phases: ['Review'] }])
  })

  test('le minuteur du journal lit le journal quand sa taille change, et seulement alors', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    writeFile(w, JOURNAL, JOURNAL_4)
    await w.clock.advance(3_000)
    expect(w.reads).toEqual([JOURNAL])
    expect(lastState(w)?.workflows[0]?.agents).toHaveLength(3)
    await w.clock.advance(3_000)
    expect(w.stats).toHaveLength(2)
    expect(w.reads).toHaveLength(1)
  })

  test('écriture refusée pendant un tic : le minuteur rattrape son rejet, le tic suivant écrit', async ($, on) => {
    const refuse = refuseStateWrites(on)
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    // Les deux premières lignes du journal réel, puis les quatre.
    writeFile(w, JOURNAL, `${JOURNAL_4.split('\n').slice(0, 2).join('\n')}\n`)
    refuse.arm(1)
    await w.clock.advance(3_000)
    expect(refuse.refused()).toBe(1)
    expect(lastState(w)?.workflows[0]?.agents).toHaveLength(0)
    writeFile(w, JOURNAL, JOURNAL_4)
    await w.clock.advance(3_000)
    expect(w.reads).toEqual([JOURNAL, JOURNAL])
    expect(lastState(w)?.workflows[0]?.agents).toHaveLength(3)
  })

  test('la notification de fin termine le workflow et arrête le minuteur', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: WF_RESULT, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    await $.session.append({
      message: { type: 'user', content: [{ type: 'text', text: NOTICE }] },
      door: 'delivery',
      origin: { kind: 'task-notification' },
      uuid: 'row-1',
    })
    expect(lastState(w)?.workflows).toMatchObject([{ status: 'fini' }])
    await w.clock.advance(6_000)
    expect(w.stats).toHaveLength(0)
  })

  test('un résultat Workflow en erreur : aucun workflow', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wf', { result: { result: { ...WF_RESULT, error: 'Syntax check failed' }, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wf', script: SCRIPT })
    expect(w.state).toBeUndefined()
  })

  test('un workflow à distance : sans journal, jamais lu', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_wr', { result: { result: { status: 'remote_launched', taskId: 'r1', taskType: 'remote_agent', sessionUrl: 'https://claude.ai/code/x' }, text: '' } })
    await $.tool.call({ tool: 'Workflow', tool_use_id: 'toolu_wr', script: SCRIPT })
    expect(lastState(w)?.workflows).toMatchObject([{ key: 'r1', journalPath: null, status: 'distant' }])
    await w.clock.advance(6_000)
    expect(w.stats).toHaveLength(0)
  })
})
