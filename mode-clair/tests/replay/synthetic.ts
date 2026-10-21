// Scénarios synthétiques du rejeu (`source: 'synthetic'`) : les chemins que les transcripts réels
// n'ont pas (formulaire oui/non, refus de permission, Review Focus 5) et les lignes de REFERENCE.md
// qu'aucun scénario réel ne couvre. Machines `host-a`, `host-b`… (convention de REFERENCE.md).
//
// Textes du bridge recopiés des fixtures de tests/pure, qui citent refs/bridge-facts.md (section
// rappelée à chaque fois) ; textes du moteur : tests/pure/engine-texts.ts.

import type { ToolCallResult } from 'claude-code'

import { RECORDED_PERSISTED, RECORDED_REFUSALS } from '../pure/engine-texts'
import type { AnyEvent, AnyScenario, Outcome } from './oracle'

// --- Briques ------------------------------------------------------------------------------------

/** bridge-facts §0.1 (1) : journal de la CLI sur stderr, avant tout (ANSI retiré). */
const CLI_LOG = [
  '2026-10-14T23:33:55.485691Z  INFO Loading configuration config=/path/config.yaml',
  '2026-10-14T23:33:55.485705Z  INFO Entropy-based secret detection enabled',
].join('\n')
/** Sortie de ssh_disk_usage (bridge-mcp src/mcp/tool_handlers/ssh_disk_usage.rs:344). */
const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
/** bridge-facts §5.2 : message du formulaire pour ssh_exec. */
const CONFIRM = (host: string) =>
  `Confirm destructive operation: \`ssh_exec\`\n\n**Arguments:**\n\`\`\`json\n{"command":"systemctl restart nginx","host":"${host}"}\n\`\`\`\n\nProceed?`
/** bridge-facts §5.1 : formulaire sans arguments lisibles. */
const CONFIRM_NO_ARGS =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n(no arguments)\n```\n\nProceed?'
/** bridge-facts §3.10 : bloc de la sous-commande exec. */
const EXEC_BLOCK = (code: number) =>
  `Host: host-a\nCommand: uptime\nExit code: ${code}\nDuration: 412ms\n\n--- STDOUT ---\n 10:00:01 up 3 days`
/** bridge-facts §6.1 : SessionInfo de ssh_session_create, réponse de ssh_session_exec. */
const SESSION = '7f6d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const SESSION_INFO = `{"id":"${SESSION}","host":"host-a","cwd":"/home/user","created_at_secs_ago":0,"last_used_secs_ago":0}`
const SESSION_EXEC = `{"cwd":"/home/user","exit_code":0,"output":"up 3 days","session_id":"${SESSION}"}`
/** bridge-facts §6.1 : JSON de ssh_exec_multi, un hôte classé, l'autre en échec. */
const MULTI_JSON =
  '{"total_hosts":2,"succeeded":1,"failed":1,"results":[' +
  '{"host":"host-a","success":true,"exit_code":0,"output":"ok","duration_ms":412},' +
  '{"host":"host-b","success":false,"error":"SSH connection failed to host-b: Connection refused (os error 111)"}]}'
/** Plan au format des plans de l'utilisateur (spec §5.2). */
const PLAN_PATH = '/home/user/projet/docs/superpowers/plans/2026-10-21-exemple.md'
const SPEC_PATH = '/home/user/projet/docs/superpowers/specs/2026-10-21-exemple-design.md'
const PLAN = '# Exemple\n\n### T1 — Première\n\n### T2 — Deuxième\n'
/** Bloc meta d'un script Workflow (D:17484). */
const SCRIPT = "export const meta = { name: 'audit-disques', phases: [{ title: 'Review' }] }"
const WF_DIR =
  '/home/user/.claude/projects/-home-user-projet/11111111-2222-4333-8444-555555555555/subagents/workflows/wf_1'
const notice = (taskId: string, toolUseId: string, status: string) =>
  `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Dynamic workflow "audit-disques" ${status}</summary>\n</task-notification>`

const ok = (text: string): ToolCallResult => ({ result: { content: [] }, text })
const ko = (text: string): ToolCallResult => ({ result: text, text, isError: true })
/** Texte Bash : sortie 0 sans en-tête, sinon `Exit code N`, le journal, puis la sortie (bridge-facts §0, §2.4). */
const sh = (code: number, ...out: string[]): ToolCallResult =>
  code === 0
    ? { result: { stdout: out.join('\n'), stderr: CLI_LOG, interrupted: false }, text: [CLI_LOG, ...out].join('\n') }
    : {
        result: { stdout: out.join('\n'), stderr: CLI_LOG, interrupted: false },
        text: [`Exit code ${code}`, CLI_LOG, ...out].join('\n'),
        isError: true,
      }

function mcp(t: number, id: string, tool: string, input: object, result: ToolCallResult, afterMs = 100): AnyEvent {
  return { t, kind: 'tool.call', tool: `mcp__ssh-bridge__${tool}`, toolUseId: id, input, result, afterMs }
}
function bash(t: number, id: string, command: string, result: ToolCallResult, extra: object = {}): AnyEvent {
  return { t, kind: 'tool.call', tool: 'Bash', toolUseId: id, input: { command, ...extra }, result, afterMs: 100 }
}
function tool(t: number, id: string, name: string, input: object, result: ToolCallResult = ok('')): AnyEvent {
  return { t, kind: 'tool.call', tool: name, toolUseId: id, input, result, afterMs: 0 }
}
const synth = (id: string, events: AnyEvent[], files: Record<string, string> = {}): AnyScenario => ({
  id: `synth-${id}`,
  source: 'synthetic',
  events,
  files,
})

// --- Review Focus 5 et chemins absents des transcripts -------------------------------------------

export const SYNTHETIC: readonly AnyScenario[] = [
  // R54, R56, R58 : formulaire, accord oui, puis le résultat décide.
  synth('formulaire-oui', [
    mcp(0, 'toolu_r1001', 'ssh_exec', { host: 'host-a', command: 'systemctl restart nginx' }, ok('active'), 2_000),
    { t: 500, kind: 'elicitation', server: 'ssh-bridge', message: CONFIRM('host-a') },
    { t: 1_000, kind: 'elicitation.result', server: 'ssh-bridge', action: 'accept', confirm: true },
  ]),
  // R57, R44 : décliné au formulaire ; R55 : formulaire sans hôte lisible, repli sur l'appel en cours.
  synth('formulaire-non', [
    mcp(
      0,
      'toolu_r1002',
      'ssh_exec',
      { host: 'host-a', command: 'systemctl restart nginx' },
      ko('User declined execution of destructive tool `ssh_exec`.'),
      2_000,
    ),
    { t: 500, kind: 'elicitation', server: 'ssh-bridge', message: CONFIRM_NO_ARGS },
    { t: 1_000, kind: 'elicitation.result', server: 'ssh-bridge', action: 'decline' },
  ]),
  // R57 : accepté sans confirm = true (bridge-facts §5.5), le bridge répond « not granted ».
  synth('formulaire-sans-confirm', [
    mcp(
      0,
      'toolu_r1003',
      'ssh_exec',
      { host: 'host-a', command: 'systemctl restart nginx' },
      ko('Confirmation for destructive tool `ssh_exec` was not granted; the operation was not run.'),
      2_000,
    ),
    { t: 500, kind: 'elicitation', server: 'ssh-bridge', message: CONFIRM('host-a') },
    { t: 1_000, kind: 'elicitation.result', server: 'ssh-bridge', action: 'accept', confirm: false },
  ]),
  // R22 : classic.PermissionDenied sur le tool_use_id, puis le texte du classifieur ; refus au dialogue par le texte seul.
  synth('refus-permission', [
    mcp(
      0,
      'toolu_r1004',
      'ssh_exec',
      { host: 'host-a', command: 'systemctl restart nginx' },
      ko(RECORDED_REFUSALS[RECORDED_REFUSALS.length - 1] ?? ''),
      1_000,
    ),
    {
      t: 200,
      kind: 'permission.denied',
      toolUseId: 'toolu_r1004',
      tool: 'mcp__ssh-bridge__ssh_exec',
      input: { host: 'host-a', command: 'systemctl restart nginx' },
    },
    bash(2_000, 'toolu_r1005', 'bridge-mcp tool ssh_disk_usage host=host-b', ko(RECORDED_REFUSALS[0] ?? '')),
  ]),
  // Review Focus 5 : un refus, une réponse de formulaire et une fin de boucle pour un appel jamais vu commencer.
  synth('resultat-sans-appel', [
    {
      t: 0,
      kind: 'permission.denied',
      toolUseId: 'toolu_r1006',
      tool: 'mcp__ssh-bridge__ssh_exec',
      input: { host: 'host-a', command: 'uptime' },
    },
    { t: 100, kind: 'elicitation.result', server: 'ssh-bridge', action: 'accept', confirm: true },
    { t: 200, kind: 'turn.complete' },
  ]),
  // Review Focus 5 : le même tool_use_id deux fois (relivraison) : un seul appel.
  synth('id-duplique', [
    mcp(0, 'toolu_r1007', 'ssh_disk_usage', { host: 'host-a' }, ok(DF)),
    mcp(1_000, 'toolu_r1007', 'ssh_disk_usage', { host: 'host-a' }, ok(DF)),
  ]),
  // Review Focus 5 : /clear puis reprise ; ce qui suit ne vise que des appels jamais vus : rien d'affirmé.
  synth('reprise-apres-clear', [
    mcp(0, 'toolu_r1008', 'ssh_disk_usage', { host: 'host-a' }, ok(DF)),
    { t: 1_000, kind: 'clear' },
    {
      t: 2_000,
      kind: 'permission.denied',
      toolUseId: 'toolu_r1009',
      tool: 'mcp__ssh-bridge__ssh_exec',
      input: { host: 'host-b', command: 'uptime' },
    },
    { t: 2_100, kind: 'elicitation.result', server: 'ssh-bridge', action: 'decline' },
    { t: 2_200, kind: 'turn.complete' },
  ]),

  // --- Reconnaissance (R01-R19) ---------------------------------------------------------------
  synth('reconnaissance-mcp', [
    // R01 mode direct ; R02 serveur qui contient seulement « bridge » ; R03 mode progressif.
    mcp(0, 'toolu_r1010', 'ssh_disk_usage', { host: 'host-a' }, ok(DF)),
    tool(1_000, 'toolu_r1011', 'mcp__cc-plugin-bridge-health__check', { host: 'host-a' }, ok('ok')),
    mcp(
      2_000,
      'toolu_r1012',
      'mcp_call_tool',
      { name: 'ssh_service_status', arguments: { host: 'host-b' } },
      ok('active'),
    ),
    // R04 méta-outils ; R12 outils sans hôte (ssh_status, ssh_history).
    mcp(3_000, 'toolu_r1013', 'mcp_list_tool_groups', {}, ok('[]')),
    mcp(3_100, 'toolu_r1014', 'mcp_call_tool', { name: 'mcp_search_tools', arguments: { query: 'disk' } }, ok('[]')),
    mcp(3_200, 'toolu_r1015', 'ssh_status', {}, ok('{}')),
    mcp(3_300, 'toolu_r1016', 'ssh_history', { host: 'host-a' }, ok('[]')),
    // R09 outil absent de la table : suivi, sur sa machine.
    mcp(4_000, 'toolu_r1017', 'ssh_outil_futur', { host: 'host-a' }, ok('ok')),
  ]),
  synth('reconnaissance-cli', [
    // R05 : chemin, alias t, préfixes VAR=val, timeout, env, sudo, nice ; exec, upload, download.
    bash(0, 'toolu_r1008', './target/debug/bridge-mcp t ssh_disk_usage host=host-a', sh(0, DF)),
    bash(1_000, 'toolu_r1018', 'RUST_LOG=warn timeout 30 bridge-mcp tool ssh_disk_usage host=host-a', sh(0, DF)),
    bash(2_000, 'toolu_r1019', 'env A=1 sudo nice -n 5 bridge-mcp tool ssh_disk_usage host=host-b', sh(0, DF)),
    bash(3_000, 'toolu_r1020', 'bridge-mcp exec host-a uptime', sh(0, EXEC_BLOCK(0))),
    bash(4_000, 'toolu_r1021', 'bridge-mcp upload host-a ./a.txt /tmp/a.txt', sh(0, 'Uploaded 12 bytes')),
    // R04 sous-commandes locales ; R06 --dry-run ; R07 bash -c ; R08 arrière-plan.
    bash(5_000, 'toolu_r1022', 'bridge-mcp list-tools', sh(0, '[]')),
    bash(
      5_100,
      'toolu_r1023',
      'bridge-mcp --dry-run tool ssh_disk_usage host=host-a',
      sh(0, '[dry-run] Would execute'),
    ),
    bash(5_200, 'toolu_r1024', "bash -c 'bridge-mcp tool ssh_disk_usage host=host-a'", sh(0, DF)),
    bash(5_300, 'toolu_r1025', 'bridge-mcp tool ssh_disk_usage host=host-a', sh(0, ''), { run_in_background: true }),
    // R11 hôte en variable ; R12 outil sans hôte.
    bash(6_000, 'toolu_r1026', 'bridge-mcp tool ssh_disk_usage host=$H', sh(0, DF)),
    bash(6_100, 'toolu_r1027', 'bridge-mcp tool ssh_status', sh(0, '{}')),
    // R59 --yes : accord par option ; R19 --json : texte lu dans content[].text.
    bash(7_000, 'toolu_r1028', 'bridge-mcp --yes tool ssh_service_restart host=host-b service=nginx', sh(0, 'ok')),
    bash(
      8_000,
      'toolu_r1029',
      'bridge-mcp --json tool ssh_disk_usage host=host-a',
      sh(0, '{"content":[{"type":"text","text":"Filesystem Size"}],"isError":false}'),
    ),
  ]),
  synth('segments-et-boucles', [
    // R17 : seul le dernier segment simple reçoit code et texte ; les autres segments bridge : incertain.
    bash(
      0,
      'toolu_r1030',
      'bridge-mcp tool ssh_disk_usage host=host-a && bridge-mcp tool ssh_disk_usage host=host-b',
      sh(0, DF, DF),
    ),
    bash(1_000, 'toolu_r1031', 'bridge-mcp tool ssh_disk_usage host=host-a | head -5', sh(0, DF)),
    // R18 : dans une boucle, incertain sur machine inconnue.
    bash(2_000, 'toolu_r1032', 'for h in host-a host-b; do bridge-mcp tool ssh_disk_usage host=$h; done', sh(0, DF)),
    bash(3_000, 'toolu_r1033', 'while read h; do bridge-mcp tool ssh_disk_usage host=host-a; done < hosts', sh(0, DF)),
  ]),
  synth('sessions-et-multi', [
    // R15 session vue créée ; R16 session inconnue.
    mcp(0, 'toolu_r1034', 'ssh_session_create', { host: 'host-a' }, ok(SESSION_INFO)),
    mcp(1_000, 'toolu_r1035', 'ssh_session_exec', { session_id: SESSION, command: 'uptime' }, ok(SESSION_EXEC)),
    mcp(2_000, 'toolu_r1036', 'ssh_session_exec', { session_id: 'autre', command: 'uptime' }, ok(SESSION_EXEC)),
    // R13 : une rangée par hôte, chacune sur son élément de results ; hôte sans élément : incertain.
    mcp(3_000, 'toolu_r1037', 'ssh_exec_multi', { hosts: ['host-a', 'host-b'], command: 'uptime' }, ok(MULTI_JSON)),
    mcp(
      4_000,
      'toolu_r1038',
      'ssh_exec_multi',
      { hosts: ['host-a', 'host-c'], command: 'uptime' },
      ok('{"total_hosts":2,"results":[{"host":"host-a","success":true,"exit_code":0}]}'),
    ),
    // R14 : hôtes inconnus, rejet global.
    mcp(
      5_000,
      'toolu_r1039',
      'ssh_exec_multi',
      { hosts: ['x', 'y'], command: 'uptime' },
      ko('MCP invalid request: Unknown hosts: x, y'),
    ),
  ]),

  // --- Cycle de vie et classement (R20-R52) -------------------------------------------------------
  {
    ...synth('fin-de-boucle', [
      // R20, R21 : en cours dès le début ; R24 : turn.complete de la même boucle → interrompu, l'autre boucle ne bouge pas.
      mcp(0, 'toolu_r1040', 'ssh_disk_usage', { host: 'host-a' }, ok(DF), 5_000),
      {
        t: 0,
        kind: 'tool.call',
        tool: 'mcp__ssh-bridge__ssh_disk_usage',
        toolUseId: 'toolu_r1041',
        agentId: 'agent-1',
        input: { host: 'host-b' },
        result: ok(DF),
        afterMs: 5_000,
      },
      { t: 1_000, kind: 'turn.complete' },
    ]),
    oracleNote:
      'L’oracle gardait « interrompu » après la fin de boucle ; or R24 n’est qu’un filet pour un appel resté ouvert : ' +
      'spec §5.1 « Cycle de vie » (les hooks d’appel ferment toujours l’appel dans un finally) et la règle (un état ' +
      'prouvé par l’événement) font que le résultat arrivé ensuite décide. L’état « interrompu » intermédiaire est ' +
      'vérifié par tests/engine/events.test.tsx (« turn.complete »).',
  },
  synth('cli-codes', [
    // R26 sortie 0 ; R27 code 2 ; R28 code 5 ; R29, R30 code 3 ; R31, R32 code 4 ; R33, R34 code 6.
    bash(0, 'toolu_r1042', 'bridge-mcp tool ssh_disk_usage host=host-a', sh(0, DF)),
    bash(
      1_000,
      'toolu_r1043',
      'bridge-mcp tool ssh_disk_usage host=host-a --bad',
      sh(2, "error: unexpected argument '--bad' found"),
    ),
    bash(
      2_000,
      'toolu_r1044',
      'bridge-mcp tool ssh_disk_usage host=host-a',
      sh(5, 'Error: Failed to load config from /etc/x.yaml'),
    ),
    bash(3_000, 'toolu_r1045', 'bridge-mcp tool ssh_disk_usage host=host-z', sh(3, 'Error: Unknown host: host-z')),
    bash(
      4_000,
      'toolu_r1046',
      'bridge-mcp tool ssh_disk_usage host=host-a',
      sh(3, 'Error: SSH connection failed to host-a: Connection refused (os error 111)'),
    ),
    bash(
      5_000,
      'toolu_r1047',
      'bridge-mcp tool ssh_exec host=host-a command=reboot',
      sh(4, 'Error: Command denied: Command matches blacklist pattern: \\bshutdown\\b'),
    ),
    bash(
      6_000,
      'toolu_r1048',
      'bridge-mcp tool ssh_exec host=host-a command=reboot',
      sh(
        4,
        'Error: Command denied: `ssh_exec` is annotated destructive and stdin is not a terminal, so there is nobody to confirm with. Pass --yes to confirm in advance, or set security.require_elicitation_on_destructive: false to disable this gate entirely.',
      ),
    ),
    bash(7_000, 'toolu_r1049', 'bridge-mcp tool ssh_exec host=host-a command=false', sh(6, '[exit:1]')),
    bash(8_000, 'toolu_r1050', 'bridge-mcp tool ssh_disk_usage host=host-a', sh(6, 'df: /: No such file')),
  ]),
  synth('cli-code-1-et-exec', [
    // R35 table des textes ; R36 limité ; R37 hors table.
    bash(
      0,
      'toolu_r1051',
      'bridge-mcp tool ssh_disk_usage host=host-a',
      sh(
        1,
        'Error: SSH command execution failed: WinRM HTTP error: error sending request for url (http://host-a:5985/wsman)',
      ),
    ),
    bash(
      1_000,
      'toolu_r1052',
      'bridge-mcp tool ssh_disk_usage host=host-a',
      sh(1, "Error: Rate limit exceeded for host 'host-a'. Please wait before sending more requests."),
    ),
    bash(
      2_000,
      'toolu_r1053',
      'bridge-mcp tool ssh_disk_usage host=host-a',
      sh(1, 'Error: Output cache is not available. This tool is only supported in MCP server mode.'),
    ),
    // R38 : exec sort avec le code distant ; bloc Exit code: N lu ; sans bloc, rien n'a tourné.
    bash(3_000, 'toolu_r1054', 'bridge-mcp exec host-a false', sh(2, EXEC_BLOCK(2))),
    bash(4_000, 'toolu_r1055', 'bridge-mcp exec host-z uptime', sh(1, 'Error: Unknown host: host-z')),
  ]),
  synth('mcp-erreurs', [
    // R39 [exit:N] en isError ; R40 [exit:N] sans isError ; R41-R46 table des textes ; R47 motif dans le corps.
    mcp(0, 'toolu_r1056', 'ssh_exec', { host: 'host-a', command: 'false' }, ko('[exit:1]\nboom')),
    mcp(100, 'toolu_r1057', 'ssh_exec', { host: 'host-a', command: 'false' }, ok('[exit:3]\n')),
    mcp(200, 'toolu_r1058', 'ssh_disk_usage', { host: 'host-z' }, ko('Unknown host: host-z')),
    mcp(
      300,
      'toolu_r1059',
      'ssh_exec',
      { host: 'host-a', command: 'reboot' },
      ko('Command denied: Command matches blacklist pattern: \\bshutdown\\b'),
    ),
    mcp(
      400,
      'toolu_r1060',
      'ssh_service_status',
      { host: 'host-a', hostt: 'x' },
      ko('MCP invalid request: Unknown argument `hostt` for tool `ssh_service_status`. Did you mean `host`?'),
    ),
    mcp(
      500,
      'toolu_r1061',
      'ssh_exec',
      { host: 'host-a', command: 'reboot' },
      ko('User cancelled confirmation for destructive tool `ssh_exec`.'),
    ),
    mcp(
      600,
      'toolu_r1062',
      'ssh_exec',
      { host: 'host-a', command: 'reboot' },
      ko('Destructive tool `ssh_exec` cannot be confirmed.'),
    ),
    mcp(700, 'toolu_r1063', 'ssh_disk_usage', { host: 'host-a' }, ko('Something new went wrong')),
    mcp(800, 'toolu_r1064', 'ssh_disk_usage', { host: 'host-a' }, ko('Something failed\nUnknown host: host-q')),
    mcp(900, 'toolu_r1065', 'ssh_disk_usage', { host: 'host-a' }, ok('line one\nCommand denied: in the body')),
  ]),
  synth('mcp-acces-delai-annulation', [
    // R48 accès refusé ; R49 délai dépassé ; R50 annulé par le client ; R51 tronqué ; R52 texte vide.
    mcp(
      0,
      'toolu_r1066',
      'ssh_disk_usage',
      { host: 'host-a' },
      ko('SSH authentication failed for nobody@host-a: authentication failed'),
    ),
    mcp(100, 'toolu_r1067', 'ssh_exec', { host: 'host-a', command: 'sleep 99' }, ko('SSH command timeout after 60s')),
    mcp(200, 'toolu_r1068', 'ssh_disk_usage', { host: 'host-a' }, ko('Request cancelled by client')),
    mcp(
      300,
      'toolu_r1069',
      'ssh_disk_usage',
      { host: 'host-a' },
      ok(`${DF}--- [truncated: 1000 bytes] output_id="abc"`),
    ),
    bash(400, 'toolu_r1070', 'bridge-mcp tool ssh_disk_usage host=host-b', sh(0, RECORDED_PERSISTED[0] ?? '')),
  ]),
  {
    ...synth('resultats-limites', [
      // R26 : sortie 0 de la CLI sans texte : fait (bridge-mcp CLI sortie 0 sans texte, plan tâche 4).
      bash(0, 'toolu_r1071', 'bridge-mcp tool ssh_disk_usage host=host-a', {
        result: { stdout: '', stderr: '', interrupted: false },
        text: '',
      }),
      // R23 : le résultat Bash se dit interrompu : interrompu, quel que soit son texte.
      bash(100, 'toolu_r1072', 'bridge-mcp tool ssh_disk_usage host=host-a', {
        result: { stdout: '', stderr: '', interrupted: true },
        text: 'partial',
      }),
      // R39 : [exit:N] seul en isError.
      mcp(200, 'toolu_r1073', 'ssh_exec', { host: 'host-a', command: 'x' }, ko('[exit:2]')),
    ]),
    oracleNote:
      'L’oracle ne lisait pas `interrupted` du résultat Bash et rendait fait ; or c’est la preuve d’interruption ' +
      'que le moteur porte dans le résultat (spec §5.1 Classement, règle 1 ; R23 : la machine n’est pas mise en cause).',
  },

  // --- Workflows (R74-R82) ----------------------------------------------------------------------
  synth(
    'workflows',
    [
      // R74 meta lisible ; R75 résultat en erreur ; R80 à distance, fini par sa notification ; R78 notification.
      tool(
        0,
        'toolu_r1074',
        'Workflow',
        { script: SCRIPT },
        {
          result: {
            status: 'async_launched',
            taskId: 'wt1',
            taskType: 'local_workflow',
            workflowName: 'audit-disques',
            runId: 'wf_1',
            transcriptDir: WF_DIR,
          },
          text: '',
        },
      ),
      tool(100, 'toolu_r1075', 'Workflow', { script: SCRIPT }, { result: { error: 'Syntax check failed' }, text: '' }),
      tool(
        200,
        'toolu_r1076',
        'Workflow',
        { name: 'distant' },
        {
          result: {
            status: 'remote_launched',
            taskId: 'r1',
            taskType: 'remote_agent',
            sessionUrl: 'https://claude.ai/code/x',
          },
          text: '',
        },
      ),
      tool(
        300,
        'toolu_r1077',
        'Workflow',
        { name: 'integre' },
        {
          result: { status: 'async_launched', taskId: 'wt4', taskType: 'local_workflow', runId: 'wf_4' },
          text: '',
        },
      ),
      { t: 10_000, kind: 'session.append', text: notice('wt1', 'toolu_r1074', 'completed') },
      { t: 11_000, kind: 'session.append', text: notice('r1', 'toolu_r1076', 'killed') },
    ],
    { [`${WF_DIR}/journal.jsonl`]: '{"type":"started","agentId":"a1","label":"review","phase":"Review"}\n' },
  ),

  // --- Superpowers (R83-R92) --------------------------------------------------------------------
  synth('superpowers-cadrage-spec', [
    // R91 écriture sans état : rien ; R83 cadrage ; R84 spec.
    tool(0, 'toolu_r1078', 'Write', { file_path: PLAN_PATH, content: PLAN }),
    tool(100, 'toolu_r1004', 'Skill', { skill: 'superpowers:brainstorming' }),
    tool(200, 'toolu_r1005', 'Write', { file_path: SPEC_PATH, content: '# Spec\n' }),
  ]),
  synth('superpowers-plan-taches', [
    // R85 plan ; R86 tâches ; R90 autre skill sans effet.
    tool(0, 'toolu_r1079', 'Skill', { skill: 'superpowers:writing-plans' }),
    tool(100, 'toolu_r1080', 'Write', { file_path: PLAN_PATH, content: PLAN }),
    tool(200, 'toolu_r1081', 'Skill', { skill: 'superpowers:subagent-driven-development' }),
    tool(300, 'toolu_r1082', 'Agent', { description: 'Implement Task 2', prompt: 'You are implementing Task 2' }),
    tool(400, 'toolu_r1083', 'Skill', { skill: 'superpowers:systematic-debugging' }),
  ]),
  synth('superpowers-relecture', [
    // R87 exécution en ligne ; R88 relecture finale par un Agent.
    tool(0, 'toolu_r1084', 'Skill', { skill: 'superpowers:executing-plans' }),
    tool(100, 'toolu_r1071', 'Agent', { description: 'Final code review', prompt: 'Review the branch' }),
  ]),
  synth('superpowers-fin', [
    // R89 finishing-a-development-branch.
    tool(0, 'toolu_r1085', 'Skill', { skill: 'superpowers:writing-plans' }),
    tool(100, 'toolu_r1086', 'Skill', { skill: 'superpowers:requesting-code-review' }),
    tool(200, 'toolu_r1087', 'Skill', { skill: 'superpowers:finishing-a-development-branch' }),
  ]),
]

// --- Questions ouvertes ---------------------------------------------------------------------------

/**
 * Cas où deux lignes de REFERENCE.md (ou la table et le mod) donnent des réponses différentes sans
 * que la table tranche : question posée à l'utilisateur (rapport de la tâche 8), rien n'est deviné.
 * L'oracle garde la lecture littérale de la table ; le test accepte, pour l'appel visé, l'une des
 * deux réponses (`candidates`), et toute autre réponse fait échouer le rejeu.
 */
export type Question = { id: string; question: string; scenario: AnyScenario; candidates: Record<string, Outcome[]> }

export const QUESTIONS: readonly Question[] = [
  {
    id: 'Q1',
    question:
      'Résultat MCP au texte vide : R52 (« texte vide » → ? incertain) contre R25 (sans isError → ✓ fait) et ' +
      'R46 (isError hors table → ✗ échec). Le mod suit R25/R46.',
    scenario: synth('question-texte-vide', [
      mcp(0, 'toolu_r1088', 'ssh_disk_usage', { host: 'host-a' }, ok('')),
      mcp(100, 'toolu_r1089', 'ssh_disk_usage', { host: 'host-a' }, ko('')),
    ]),
    candidates: { toolu_r1088: ['inconnu', 'succes'], toolu_r1089: ['inconnu', 'echec'] },
  },
  {
    id: 'Q2',
    question:
      'Code de sortie que la CLI n’écrit pas (127 commande introuvable, 130, 137…) : R52 (« pas de code de sortie ' +
      'attribuable » → ? incertain) ou ✗ échec ? Le mod rend échec (spec §5.1 règle 2 n’énumère que 1 à 6).',
    scenario: synth('question-code-inconnu', [
      bash(0, 'toolu_r1080', 'bridge-mcp tool ssh_disk_usage host=host-a', sh(127, 'bridge-mcp: command not found')),
    ]),
    candidates: { toolu_r1080: ['inconnu', 'echec'] },
  },
  {
    id: 'Q3',
    question:
      '`bridge-mcp exec` sorti 0 sans bloc `Exit code: N` : R38 (« sans bloc, rien n’a tourné : table des textes, ' +
      'sinon échec ») ou ✓ fait par le code 0 du processus ? Le mod rend fait ; R38 ne dit rien non plus de ' +
      '`exec --json` (`"exit_code":N`), que le mod lit.',
    scenario: synth('question-exec-sans-bloc', [
      bash(0, 'toolu_r1081', 'bridge-mcp exec host-a uptime', sh(0, 'no block here')),
    ]),
    candidates: { toolu_r1081: ['echec', 'succes'] },
  },
]
