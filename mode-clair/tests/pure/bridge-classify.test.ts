// Classement d'un appel bridge terminé et pipeline réel (spec §5.1 ; amendements A2, A3, A4, A7, A8, A14).
// Fixtures : textes copiés de docs/superpowers/plans/refs/bridge-facts.md (section citée à chaque
// fois) ; textes du moteur recopiés du spec §10 dans ./engine-texts.
import { describe, expect, test } from 'claude-code/testing'
import type { ParsedCall, RunResult } from '../../hooks/bridge'
import {
  BRIDGE_TEXTS,
  classify,
  ENGINE_PERSISTED_TEXTS,
  ENGINE_REFUSAL_TEXTS,
  steps,
  usefulLines,
} from '../../hooks/bridge'
import { TOOLS } from '../../hooks/tools.generated'
import type { BridgeCall, CallState } from '../../types'
import { RECORDED_PERSISTED, RECORDED_REFUSALS } from './engine-texts'

/** bridge-facts §0.1.1 : une ligne de journal brute (octets ANSI), puis deux lignes déjà sans couleur. */
const LOGS = [
  '\x1b[2m2026-10-14T23:32:18.505393Z\x1b[0m \x1b[32m INFO\x1b[0m Loading configuration \x1b[3mconfig\x1b[0m\x1b[2m=\x1b[0m/path',
  '2026-10-14T23:33:55.485691Z  INFO Sanitizer initialized builtin_patterns=72 custom_patterns=0 total_patterns=72',
  '2026-10-14T23:33:55.485705Z  INFO Entropy-based secret detection enabled',
].join('\n')

/** Texte Bash d'une CLI sortie avec `code` : `Exit code N`, le journal, puis la sortie (bridge-facts §0, §2.4). */
const bash = (code: number, ...out: string[]): string => [`Exit code ${code}`, LOGS, ...out].join('\n')

const cli = (tool: string, patch: Partial<ParsedCall> = {}): ParsedCall => ({
  via: 'cli',
  tool,
  host: 'raspberry',
  nature: 'lecture',
  accordByOption: false,
  ownsExit: true,
  inLoop: false,
  ...patch,
})
const mcp = (tool: string, host: string | null = 'raspberry'): ParsedCall => ({
  via: 'mcp',
  tool,
  host,
  nature: 'lecture',
  accordByOption: false,
  ownsExit: true,
  inLoop: false,
})
const ok = (text: string): RunResult => ({ isError: false, text, interrupted: false, refusedByClaude: false })
const ko = (text: string): RunResult => ({ isError: true, text, interrupted: false, refusedByClaude: false })

/** Au moins une fixture par ligne de BRIDGE_TEXTS : [source dans bridge-facts, texte, état attendu]. */
const FIXTURES: readonly [string, string, CallState][] = [
  [
    '§3.1 barrière --yes',
    'Command denied: `ssh_exec` is annotated destructive and stdin is not a terminal, so there is nobody to confirm with. Pass --yes to confirm in advance, or set security.require_elicitation_on_destructive: false to disable this gate entirely.',
    'confirmation-manquante',
  ],
  ['§3.1 liste noire', 'Command denied: Command matches blacklist pattern: \\bshutdown\\b', 'refuse'],
  ['§3.1 liste blanche', 'Command denied: Command not in whitelist (standard mode)', 'refuse'],
  ['§3.2 hôte inconnu', 'Unknown host: nohost', 'machine-inconnue'],
  ['§3.2 hôtes inconnus (multi)', 'MCP invalid request: Unknown hosts: a, b', 'machine-inconnue'],
  [
    '§3.4 argument inconnu',
    'MCP invalid request: Unknown argument `hostt` for tool `ssh_service_status`. Did you mean `host`? Call mcp_describe_tool (or `bridge-mcp describe-tool ssh_service_status`) to list valid arguments.',
    'erreur-usage',
  ],
  [
    '§3.4 champ inconnu',
    'MCP invalid request: unknown field `bogus`, expected one of `host`, `service`, `timeout_seconds`, `max_output`, `save_output`',
    'erreur-usage',
  ],
  ['§3.4 champ manquant', 'MCP invalid request: missing field `service`', 'erreur-usage'],
  ['§3.4 paramètre manquant', 'MCP missing parameter: arguments', 'erreur-usage'],
  [
    '§3.4 outil inconnu en MCP',
    'Unknown tool: ssh_nope. Use mcp_search_tools to discover valid names.',
    'erreur-usage',
  ],
  [
    '§3.4 groupe désactivé en MCP',
    'Tool `ssh_k8s_get` is registered but its group `kubernetes` is not enabled. Enable it under `tool_groups.groups` in config.yaml, or run `bridge-mcp validate` to see which groups are active.',
    'erreur-usage',
  ],
  [
    '§3.4 enveloppe mcp_call_tool',
    'mcp_call_tool: missing arguments — expected {"name": "<tool>", "arguments": {…}}',
    'erreur-usage',
  ],
  ['§1.2 erreur clap', "error: unexpected argument '/tmp' found", 'erreur-usage'],
  ['§2.2 configuration illisible', 'Failed to load config from /tmp/…/all-groups.yaml', 'erreur-config'],
  [
    '§3.3 limite par hôte',
    "Rate limit exceeded for host 'raspberry'. Please wait before sending more requests.",
    'limite',
  ],
  ['§3.3 limite dans le JSON multi', 'Rate limit exceeded', 'limite'],
  ['§3.8 decline', 'User declined execution of destructive tool `ssh_exec`.', 'decline'],
  ['§3.8 cancel', 'User cancelled confirmation for destructive tool `ssh_exec`.', 'decline'],
  [
    '§3.8 non accordé',
    'Confirmation for destructive tool `ssh_exec` was not granted; the operation was not run.',
    'confirmation-impossible',
  ],
  [
    '§3.8 sans session',
    'Tool `ssh_exec` is destructive and `require_elicitation_on_destructive` is enabled, but no session context is available — the operation cannot be confirmed.',
    'confirmation-impossible',
  ],
  [
    '§3.8 capacité non déclarée',
    'Tool `ssh_exec` is destructive and `require_elicitation_on_destructive` is enabled, but the client did not declare the `elicitation` capability on this request. Either declare it in `_meta` or set `security.require_elicitation_on_destructive: false`.',
    'confirmation-impossible',
  ],
  [
    '§3.8 formulaire impossible',
    'Could not build a confirmation prompt for `ssh_exec`; the operation was not run.',
    'confirmation-impossible',
  ],
  [
    '§3.5 authentification SSH',
    'SSH authentication failed for nobody@raspberry: authentication failed',
    'acces-refuse',
  ],
  ['§3.5 authentification WinRM', 'SSH authentication failed for unknown@WinRM', 'acces-refuse'],
  // §3.5 : seul le format est relevé (src/error.rs:37, :44) ; ses champs restent tels quels, seul l'hôte est rempli.
  ['§3.5 clé d’hôte changée', 'SSH host key mismatch for raspberry: expected {expected}, got {actual}', 'acces-refuse'],
  ['§3.5 clé d’hôte inconnue', 'SSH host key unknown for raspberry (fingerprint: {fingerprint})', 'acces-refuse'],
  ['§3.5 connexion refusée', 'SSH connection failed to raspberry: Connection refused (os error 111)', 'injoignable'],
  ['§3.5 délai de connexion', 'SSH connection failed to raspberry: Connection timeout after 10s', 'injoignable'],
  [
    '§2.3 WinRM injoignable',
    'SSH command execution failed: WinRM HTTP error: error sending request for url (http://127.0.0.1:55985/wsman)',
    'injoignable',
  ],
  ['§3.6 délai de commande', 'SSH command timeout after 60s', 'delai-depasse'],
  ['§3.6 annulation', 'Request cancelled by client', 'interrompu'],
  [
    '§3.7 outil Windows sur Linux',
    "Tool 'ssh_win_disk_usage' is only available on Windows hosts. Use Linux-specific tools instead.",
    'erreur-usage',
  ],
  [
    '§3.7 outil Linux sur Windows',
    "Tool 'ssh_disk_usage' is not available on Windows hosts. Use Windows-specific tools instead.",
    'erreur-usage',
  ],
  ['§3.7 sudo sur Windows', "'sudo' is not supported on Windows host 'win2025'.", 'erreur-usage'],
  ['§3.7 sudo sans shell POSIX', "'sudo' requires a POSIX shell; host 'win2025' uses 'powershell'.", 'erreur-usage'],
]

/** bridge-facts §3.10 : bloc de la sous-commande exec. */
const EXEC_BLOCK_OK =
  'Host: raspberry\nCommand: uptime\nExit code: 0\nDuration: 412ms\n\n--- STDOUT ---\n 10:00:01 up 3 days, …'

/** bridge-facts §6.1 : JSON de ssh_exec_multi (ordre des champs de la structure), deux hôtes. */
const MULTI_JSON =
  '{"total_hosts":2,"succeeded":0,"failed":2,"results":[' +
  '{"host":"raspberry","success":false,"exit_code":2,"output":"","duration_ms":412},' +
  '{"host":"win2025","success":false,"error":"SSH command execution failed: WinRM HTTP error: error sending request for url (http://127.0.0.1:55985/wsman)"}]}'

describe('usefulLines', () => {
  test('texte Bash observé : Exit code N puis stdout et stderr mêlés (bridge-facts §0)', () => {
    expect(usefulLines('Exit code 3\nOUT1\nERR1\nOUT2')).toEqual(['Exit code 3', 'OUT1', 'ERR1', 'OUT2'])
  })

  test('couleurs ANSI retirées, journal et lignes vides sautés, Exit code gardé (A3)', () => {
    expect(usefulLines(`${bash(3, '', 'Error: Unknown host: nohost')}\n`)).toEqual([
      'Exit code 3',
      'Error: Unknown host: nohost',
    ])
  })

  test('une heure en tête de ligne qui n’est pas du journal reste (bridge-facts §3.10)', () => {
    expect(usefulLines(EXEC_BLOCK_OK)).toEqual([
      'Host: raspberry',
      'Command: uptime',
      'Exit code: 0',
      'Duration: 412ms',
      '--- STDOUT ---',
      '10:00:01 up 3 days, …',
    ])
  })
})

describe('table des textes du bridge, première ligne utile seulement', () => {
  for (const [source, text, state] of FIXTURES) {
    test(`${source} → ${state}`, () => {
      expect(classify(mcp('ssh_service_status'), ko(text), TOOLS)).toEqual({ state, truncated: false })
      expect(classify(cli('ssh_service_status'), ko(bash(1, `Error: ${text}`)), TOOLS)).toEqual({
        state,
        truncated: false,
      })
    })
  }

  test('chaque ligne de la table est la première à répondre pour au moins une fixture', () => {
    const answered = BRIDGE_TEXTS.map((row) =>
      FIXTURES.some(([, text]) => BRIDGE_TEXTS.find((r) => r.re.test(text)) === row),
    )
    expect(answered).toEqual(BRIDGE_TEXTS.map(() => true))
    expect(BRIDGE_TEXTS).toHaveLength(24)
  })

  test('un texte du bridge dans une réponse réussie n’est pas lu (LOGIC-4, tests/MISSED-2)', () => {
    const text = 'SSH connection failed to raspberry: Connection refused (os error 111)'
    expect(classify(mcp('ssh_service_status'), ok(text), TOOLS)).toEqual({ state: 'fait', truncated: false })
    expect(classify(cli('ssh_service_status'), ok(text), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('le tableau des outils dit ce que le classement suppose (bridge-facts §6.1 à §6.3)', () => {
    const flags = (name: string) => ({ multi: TOOLS[name]?.multi, codeWithoutError: TOOLS[name]?.codeWithoutError })
    expect(flags('ssh_exec')).toEqual({ multi: false, codeWithoutError: true })
    expect(flags('ssh_exec_multi')).toEqual({ multi: true, codeWithoutError: true })
    expect(flags('ssh_session_exec')).toEqual({ multi: false, codeWithoutError: true })
    expect(flags('ssh_service_status')).toEqual({ multi: false, codeWithoutError: false })
    expect(flags('ssh_tail')).toEqual({ multi: false, codeWithoutError: false })
    expect(flags('ssh_k8s_get')).toEqual({ multi: false, codeWithoutError: false })
  })
})

describe('CLI, sous-commande tool : codes de sortie (A3, A4, A7)', () => {
  test('2 : outil inconnu → erreur d’usage (§3.4)', () => {
    const r = ko(bash(2, 'Error: MCP unknown tool: ssh_nope'))
    expect(classify(cli('ssh_nope'), r, TOOLS)).toEqual({ state: 'erreur-usage', truncated: false })
  })

  test('3 : Unknown host → machine inconnue (§3.2)', () => {
    const r = ko(bash(3, 'Error: Unknown host: nohost'))
    expect(classify(cli('ssh_service_status', { host: 'nohost' }), r, TOOLS)).toEqual({
      state: 'machine-inconnue',
      truncated: false,
    })
  })

  test('3 : connexion SSH impossible → injoignable (§3.5)', () => {
    const r = ko(bash(3, 'Error: SSH connection failed to raspberry: Connection timeout after 10s'))
    expect(classify(cli('ssh_service_status'), r, TOOLS)).toEqual({ state: 'injoignable', truncated: false })
  })

  test('4 : liste noire → refusé (§3.1)', () => {
    const r = ko(bash(4, 'Error: Command denied: Command matches blacklist pattern: \\bshutdown\\b'))
    expect(classify(cli('ssh_exec'), r, TOOLS)).toEqual({ state: 'refuse', truncated: false })
  })

  test('4 : la barrière demande --yes → confirmation manquante ; la ligne d’audit qui le répète est sautée (§3.1)', () => {
    // Ligne d'audit de §3.1 ; son horodatage, élidé dans le relevé (`2026-…Z`), est celui de la dernière ligne de §0.1.1.
    const audit =
      '2026-10-14T23:33:55.485705Z  INFO Audit: command denied event_type="command_denied" tool_name="ssh_exec" host="nohost" command="ssh_exec {\\"command\\":\\"ls\\",\\"host\\":\\"nohost\\"}" reason="`ssh_exec` is annotated destructive and stdin is not a terminal, so there is nobody to confirm with. Pass --yes to confirm in advance, or set security.require_elicitation_on_destructive: false to disable this gate entirely."'
    const denied =
      'Error: Command denied: `ssh_exec` is annotated destructive and stdin is not a terminal, so there is nobody to confirm with. Pass --yes to confirm in advance, or set security.require_elicitation_on_destructive: false to disable this gate entirely.'
    expect(classify(cli('ssh_exec', { host: 'nohost' }), ko(bash(4, audit, denied)), TOOLS)).toEqual({
      state: 'confirmation-manquante',
      truncated: false,
    })
  })

  test('5 : argument sans signe égal → erreur de config (§3.4)', () => {
    const r = ko(bash(5, "Error: Configuration error: Invalid argument 'nohost': expected key=value format"))
    expect(classify(cli('ssh_service_status'), r, TOOLS)).toEqual({ state: 'erreur-config', truncated: false })
  })

  test('6 sur ssh_exec : code N lu dans [exit:N], neutre (A7, §6.1, §3.9)', () => {
    const r = ko(bash(6, '[exit:1]', 'partial output'))
    expect(classify(cli('ssh_exec'), r, TOOLS)).toEqual({ state: 'code', code: 1, truncated: false })
  })

  test('6 sur ssh_session_exec : code N lu dans "exit_code" (§6.1)', () => {
    const r = ko(bash(6, '{"cwd":"/home/pi","exit_code":2,"output":"","session_id":"s1"}'))
    expect(classify(cli('ssh_session_exec', { host: null }), r, TOOLS)).toEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
  })

  test('6 sur un outil codeWithoutError sans code lisible → code inconnu', () => {
    const r = ko(bash(6, 'partial output'))
    expect(classify(cli('ssh_exec'), r, TOOLS)).toEqual({ state: 'code', truncated: false })
  })

  test('6 sur un autre outil → échec sur la machine, avec le code et la ligne qui suit (§6.3)', () => {
    const r = ko(bash(6, '[exit:1]', 'partial output'))
    expect(classify(cli('ssh_tail'), r, TOOLS)).toEqual({
      state: 'echec-machine',
      code: 1,
      truncated: false,
      reason: 'partial output',
    })
  })

  test('6 sur un autre outil, sans [exit:N] → échec sur la machine sans code', () => {
    const r = ko(bash(6, 'partial output'))
    expect(classify(cli('ssh_tail'), r, TOOLS)).toEqual({ state: 'echec-machine', truncated: false })
  })

  test('1 : cas WinRM observé, journal en couleur avant Error → injoignable (§2.3, A3)', () => {
    const r = ko(
      bash(
        1,
        'Error: SSH command execution failed: WinRM HTTP error: error sending request for url (http://127.0.0.1:55985/wsman)',
      ),
    )
    expect(classify(cli('ssh_win_disk_usage', { host: 'win2025' }), r, TOOLS)).toEqual({
      state: 'injoignable',
      truncated: false,
    })
  })

  test('1 : la CLI passée par le démon ne déclare pas elicitation → confirmation impossible (§0.1.10, §3.8)', () => {
    const r = ko(
      bash(
        1,
        'Error: Tool `ssh_exec` is destructive and `require_elicitation_on_destructive` is enabled, but the client did not declare the `elicitation` capability on this request. Either declare it in `_meta` or set `security.require_elicitation_on_destructive: false`.',
      ),
    )
    expect(classify(cli('ssh_exec', { accordByOption: true }), r, TOOLS)).toEqual({
      state: 'confirmation-impossible',
      truncated: false,
    })
  })

  test('1 : texte inconnu → échec, raison = première ligne utile brute (§1.4)', () => {
    const r = ko(bash(1, 'Output cache is not available. This tool is only supported in MCP server mode.'))
    expect(classify(cli('ssh_output_fetch', { host: null }), r, TOOLS)).toEqual({
      state: 'echec',
      truncated: false,
      reason: 'Output cache is not available. This tool is only supported in MCP server mode.',
    })
  })

  test('erreur sans ligne Exit code → lue comme une sortie 1', () => {
    expect(classify(cli('ssh_service_status'), ko('Error: Unknown host: nohost'), TOOLS)).toEqual({
      state: 'machine-inconnue',
      truncated: false,
    })
  })

  test('0 : [exit:N] sans erreur → code N (ssh_service_status, A7, §6.2, §3.9)', () => {
    const r = ok('[exit:3]\nUnit foo.service could not be found.\n---\n● foo.service')
    expect(classify(cli('ssh_service_status'), r, TOOLS)).toEqual({ state: 'code', code: 3, truncated: false })
  })

  test('0 : sortie ordinaire → fait (§1.4)', () => {
    expect(classify(cli('ssh_history', { host: null }), ok('No command history available.'), TOOLS)).toEqual({
      state: 'fait',
      truncated: false,
    })
  })

  test('--json : le texte est lu dans content[].text (§1.4, exemple relevé)', () => {
    const json = [
      '{',
      '  "content": [',
      '    {',
      '      "type": "text",',
      '      "text": "Output cache is not available. This tool is only supported in MCP server mode."',
      '    }',
      '  ],',
      '  "isError": true',
      '}',
    ]
    expect(classify(cli('ssh_output_fetch', { host: null }), ko(bash(1, ...json)), TOOLS)).toEqual({
      state: 'echec',
      truncated: false,
      reason: 'Output cache is not available. This tool is only supported in MCP server mode.',
    })
  })

  test('--json et sortie 6 : [exit:N] lu dans content[].text (§1.4, §3.9)', () => {
    const json = [
      '{',
      '  "content": [',
      '    {',
      '      "type": "text",',
      '      "text": "[exit:1]\\npartial output"',
      '    }',
      '  ]',
      '}',
    ]
    expect(classify(cli('ssh_exec'), ko(bash(6, ...json)), TOOLS)).toEqual({ state: 'code', code: 1, truncated: false })
  })

  test('ssh_exec_multi : chaque hôte lit sa propre entrée de results (§6.1)', () => {
    expect(classify(cli('ssh_exec_multi'), ok(MULTI_JSON), TOOLS)).toEqual({ state: 'code', code: 2, truncated: false })
  })
})

describe('CLI : segments qui ne possèdent pas le code de sortie', () => {
  test('segment bridge qui n’est pas la dernière commande simple → incertain', () => {
    const r = ko(bash(3, 'Error: Unknown host: nohost'))
    expect(classify(cli('ssh_service_status', { ownsExit: false }), r, TOOLS)).toEqual({
      state: 'incertain',
      truncated: false,
    })
  })

  test('segment dans une boucle → incertain, même s’il est le dernier', () => {
    const p = cli('ssh_service_status', { host: null, inLoop: true })
    expect(classify(p, ok('No command history available.'), TOOLS)).toEqual({ state: 'incertain', truncated: false })
  })
})

describe('CLI, exec, upload, download : seule la table des textes (A4)', () => {
  test('exec sur un hôte inconnu sort en 1 → machine inconnue (§2.2)', () => {
    expect(classify(cli('exec', { host: 'nohost' }), ko(bash(1, 'Error: Unknown host: nohost')), TOOLS)).toEqual({
      state: 'machine-inconnue',
      truncated: false,
    })
  })

  test('upload sur un hôte inconnu sort en 1 → machine inconnue (§2.2)', () => {
    expect(classify(cli('upload', { host: 'nohost' }), ko(bash(1, 'Error: Unknown host: nohost')), TOOLS)).toEqual({
      state: 'machine-inconnue',
      truncated: false,
    })
  })

  test('download sorti en 0 → fait', () => {
    expect(classify(cli('download'), ok(''), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('exec réussi : bloc Exit code: 0 → fait (§3.10)', () => {
    expect(classify(cli('exec'), ok(EXEC_BLOCK_OK), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('exec en échec distant : bloc Exit code: N → code N, neutre (§3.10, A4)', () => {
    // Bloc de §3.10 avec le code 2 au lieu de 0 ; exec sort alors en 1 (§2.2).
    const r = ko(bash(1, 'Host: raspberry', 'Command: uptime', 'Exit code: 2', 'Duration: 412ms'))
    expect(classify(cli('exec'), r, TOOLS)).toEqual({ state: 'code', code: 2, truncated: false })
  })

  test('exec --json : "exit_code" → code N (§1.4)', () => {
    const r = ko(
      bash(
        1,
        '{"command":"uptime","exit_code":2,"host":"raspberry","output":"Host: raspberry\\nCommand: uptime\\nExit code: 2\\nDuration: 412ms"}',
      ),
    )
    expect(classify(cli('exec'), r, TOOLS)).toEqual({ state: 'code', code: 2, truncated: false })
  })

  test('exec, configuration illisible, sortie 5 → erreur de config par le texte (§2.2)', () => {
    const out = [
      'Error: Failed to load config from /tmp/…/all-groups.yaml',
      '',
      'Caused by:',
      '    Invalid configuration: hosts - At least one host must be defined',
    ]
    expect(classify(cli('exec'), ko(bash(5, ...out)), TOOLS)).toEqual({ state: 'erreur-config', truncated: false })
  })

  test('exec, erreur clap, sortie 2 → erreur d’usage par le texte (§1.2)', () => {
    expect(
      classify(cli('exec', { host: 'nohost' }), ko(bash(2, "error: unexpected argument '/tmp' found")), TOOLS),
    ).toEqual({
      state: 'erreur-usage',
      truncated: false,
    })
  })
})

describe('MCP (règle 3, A7)', () => {
  test('[exit:N] puis isError → échec sur la machine ; le corps n’est pas lu comme un texte du bridge (§3.9, LOGIC-4)', () => {
    const r = ko('[exit:1]\nSSH connection failed to raspberry: Connection refused (os error 111)')
    expect(classify(mcp('ssh_k8s_get'), r, TOOLS)).toEqual({
      state: 'echec-machine',
      code: 1,
      truncated: false,
      reason: 'SSH connection failed to raspberry: Connection refused (os error 111)',
    })
  })

  test('[exit:N] seul, stdout et stderr vides → échec sur la machine sans raison (§3.9)', () => {
    expect(classify(mcp('ssh_k8s_get'), ko('[exit:1]\n'), TOOLS)).toEqual({
      state: 'echec-machine',
      code: 1,
      truncated: false,
    })
  })

  test('[exit:N] sans isError → code N (ssh_service_status, A7, §6.2)', () => {
    const r = ok('[exit:3]\nUnit foo.service could not be found.\n---\n● foo.service')
    expect(classify(mcp('ssh_service_status'), r, TOOLS)).toEqual({ state: 'code', code: 3, truncated: false })
  })

  test('ssh_exec réussi avec [exit:N] → code N (§6.1)', () => {
    expect(classify(mcp('ssh_exec'), ok('[exit:1]\npartial output'), TOOLS)).toEqual({
      state: 'code',
      code: 1,
      truncated: false,
    })
  })

  test('ssh_session_exec : "exit_code" non nul → code N, nul ou null → fait (§6.1)', () => {
    const json = (code: string) => ok(`{"cwd":"/home/pi","exit_code":${code},"output":"","session_id":"s1"}`)
    expect(classify(mcp('ssh_session_exec', null), json('2'), TOOLS)).toEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
    expect(classify(mcp('ssh_session_exec', null), json('0'), TOOLS)).toEqual({ state: 'fait', truncated: false })
    expect(classify(mcp('ssh_session_exec', null), json('null'), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('"exit_code" d’un outil qui n’est pas codeWithoutError n’est pas lu', () => {
    const r = ok('{"cwd":"/home/pi","exit_code":2,"output":"","session_id":"s1"}')
    expect(classify(mcp('ssh_service_status'), r, TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('isError, texte inconnu → échec, raison = première ligne brute (§3.5)', () => {
    expect(
      classify(mcp('ssh_win_disk_usage', 'win2025ps'), ko('SSH command execution failed: pipeline stopped'), TOOLS),
    ).toEqual({
      state: 'echec',
      truncated: false,
      reason: 'SSH command execution failed: pipeline stopped',
    })
  })

  test('isError sans texte → échec sans raison', () => {
    expect(classify(mcp('ssh_service_status'), ko(''), TOOLS)).toEqual({ state: 'echec', truncated: false })
  })

  test('ssh_exec_multi : raspberry lit son code, win2025 son erreur (§6.1, §2.3)', () => {
    expect(classify(mcp('ssh_exec_multi', 'raspberry'), ok(MULTI_JSON), TOOLS)).toEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
    expect(classify(mcp('ssh_exec_multi', 'win2025'), ok(MULTI_JSON), TOOLS)).toEqual({
      state: 'injoignable',
      truncated: false,
    })
  })

  test('ssh_exec_multi : un hôte absent de results ne reprend pas le code d’un autre', () => {
    expect(classify(mcp('ssh_exec_multi', 'pi-absent'), ok(MULTI_JSON), TOOLS)).toEqual({
      state: 'fait',
      truncated: false,
    })
    expect(classify(mcp('ssh_exec_multi', null), ok(MULTI_JSON), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('ssh_exec_multi : la forme courte "Rate limit exceeded" dans l’entrée d’un hôte → limité (§3.3, §6.1)', () => {
    const json =
      '{"total_hosts":1,"succeeded":0,"failed":1,"results":[{"host":"raspberry","success":false,"error":"Rate limit exceeded"}]}'
    expect(classify(mcp('ssh_exec_multi'), ok(json), TOOLS)).toEqual({ state: 'limite', truncated: false })
    expect(classify(cli('ssh_exec_multi'), ok(json), TOOLS)).toEqual({ state: 'limite', truncated: false })
  })

  test('ssh_exec_multi : un JSON coupé ne fait pas planter le classement', () => {
    expect(classify(mcp('ssh_exec_multi'), ok('{"total_hosts":2,"succeeded":0,'), TOOLS)).toEqual({
      state: 'fait',
      truncated: false,
    })
  })
})

describe('règles 0 et 1 : refus de Claude Code, interruption', () => {
  const denied = 'Command denied: Command matches blacklist pattern: \\bshutdown\\b'

  test('refusé par Claude Code passe avant tout texte, en CLI comme en MCP (A2)', () => {
    const r: RunResult = { isError: true, text: denied, interrupted: false, refusedByClaude: true }
    expect(classify(mcp('ssh_exec'), r, TOOLS)).toEqual({ state: 'refuse-claude', truncated: false })
    expect(classify(cli('ssh_exec', { ownsExit: false }), r, TOOLS)).toEqual({
      state: 'refuse-claude',
      truncated: false,
    })
  })

  test('le texte de refus relevé au dialogue et au classifieur suffit (spec §10, A2)', () => {
    expect(RECORDED_REFUSALS.length).toBeGreaterThan(0)
    expect(ENGINE_REFUSAL_TEXTS).toHaveLength(RECORDED_REFUSALS.length)
    for (const text of RECORDED_REFUSALS) {
      expect(classify(mcp('ssh_exec'), ko(text), TOOLS)).toEqual({ state: 'refuse-claude', truncated: false })
      expect(classify(cli('ssh_exec', { ownsExit: false }), ko(text), TOOLS)).toEqual({
        state: 'refuse-claude',
        truncated: false,
      })
    }
  })

  test('chaque motif de refus du moteur garde au moins vingt caractères du texte relevé', () => {
    for (const re of ENGINE_REFUSAL_TEXTS) expect(re.source.length).toBeGreaterThanOrEqual(21)
  })

  test('interrompu ne met pas la machine en cause, quel que soit le texte', () => {
    const r: RunResult = { isError: true, text: denied, interrupted: true, refusedByClaude: false }
    expect(classify(mcp('ssh_exec'), r, TOOLS)).toEqual({ state: 'interrompu', truncated: false })
    expect(classify(cli('ssh_exec', { ownsExit: false }), r, TOOLS)).toEqual({ state: 'interrompu', truncated: false })
  })

  test('refusé et interrompu à la fois → refusé par Claude Code', () => {
    const r: RunResult = { isError: true, text: '', interrupted: true, refusedByClaude: true }
    expect(classify(mcp('ssh_exec'), r, TOOLS)).toEqual({ state: 'refuse-claude', truncated: false })
  })
})

describe('drapeau tronqué, que l’appel réussisse ou non (bridge-facts §4)', () => {
  test('CLI sans cache : --- [truncated: … (§4.1)', () => {
    const text =
      '<first lines>\n\n--- [truncated: 5234 lines total, 4410 lines omitted, 412345 → 39980 chars] ---\n\n<last lines>'
    expect(classify(cli('ssh_journal_query'), ok(text), TOOLS)).toEqual({ state: 'fait', truncated: true })
  })

  test('MCP avec cache : output_id=" (§4.2)', () => {
    const text = [
      '<first lines>',
      '',
      '⚠️ MORE DATA AVAILABLE — Truncated: 5234 lines total, 4410 lines omitted (412345 → 39980 chars).',
      'To get the complete output, call: ssh_output_fetch(output_id="3f9c…", offset=0, limit=50000)',
      '',
      '<last lines>',
    ].join('\n')
    expect(classify(mcp('ssh_journal_query'), ok(text), TOOLS)).toEqual({ state: 'fait', truncated: true })
  })

  test('limite du transport SSH, sur un appel en échec (§4.3, §3.9)', () => {
    const text =
      '[exit:1]\npartial output\n\n--- [output stopped at the 10485760 byte transport limit; the command produced 52428800 bytes] ---\n'
    expect(classify(mcp('ssh_k8s_get'), ko(text), TOOLS)).toEqual({
      state: 'echec-machine',
      code: 1,
      truncated: true,
      reason: 'partial output',
    })
  })

  test('l’en-tête de page de ssh_output_fetch n’est pas une troncature (§4.4)', () => {
    const text = '--- output_id=3f9c | offset=0 | chars=50000/412345 | has_more=true ---\n<page>'
    expect(classify(mcp('ssh_output_fetch', null), ok(text), TOOLS)).toEqual({ state: 'fait', truncated: false })
  })

  test('marque de sortie persistée de Claude Code : CLI seulement (spec §10)', () => {
    expect(RECORDED_PERSISTED.length).toBeGreaterThan(0)
    expect(ENGINE_PERSISTED_TEXTS).toHaveLength(RECORDED_PERSISTED.length)
    for (const text of RECORDED_PERSISTED) {
      expect(classify(cli('ssh_journal_query'), ok(text), TOOLS).truncated).toBe(true)
      expect(classify(mcp('ssh_journal_query'), ok(text), TOOLS).truncated).toBe(false)
    }
  })
})

describe('steps : pipeline réel (spec §5.1)', () => {
  const call = (patch: Partial<BridgeCall>): BridgeCall => ({
    id: 'toolu_1#0',
    toolUseId: 'toolu_1',
    via: 'mcp',
    tool: 'ssh_disk_usage',
    host: 'raspberry',
    nature: 'lecture',
    state: 'fait',
    truncated: false,
    accord: 'aucun',
    startedAt: 0,
    endedAt: 400,
    ...patch,
  })
  const NOTHING = { label: 'rien n’a tourné', mark: 'off' }
  const STATES: readonly CallState[] = [
    'en-cours',
    'fait',
    'code',
    'injoignable',
    'machine-inconnue',
    'refuse',
    'limite',
    'confirmation-impossible',
    'confirmation-manquante',
    'echec-machine',
    'echec',
    'acces-refuse',
    'delai-depasse',
    'erreur-usage',
    'erreur-config',
    'refuse-claude',
    'decline',
    'interrompu',
    'incertain',
  ]

  test('une étape décisive par état, sans accord (table de §5.4)', () => {
    const got = Object.fromEntries(STATES.map((state) => [state, steps(call({ state, code: 3 }))]))
    expect(got).toEqual({
      'en-cours': [{ label: 'raspberry en cours', mark: 'off' }],
      fait: [{ label: 'raspberry', mark: 'ok' }],
      code: [{ label: 'raspberry code 3', mark: 'ok' }],
      injoignable: [{ label: 'raspberry injoignable', mark: 'ko' }, NOTHING],
      'machine-inconnue': [{ label: 'raspberry inconnue', mark: 'ko' }, NOTHING],
      refuse: [{ label: 'refusé par le bridge', mark: 'ko' }, NOTHING],
      limite: [{ label: 'limité par le bridge', mark: 'ko' }, NOTHING],
      'confirmation-impossible': [{ label: 'confirmation impossible', mark: 'ko' }, NOTHING],
      'confirmation-manquante': [{ label: 'confirmation manquante', mark: 'ko' }, NOTHING],
      'echec-machine': [{ label: 'raspberry code 3', mark: 'ko' }],
      echec: [{ label: 'échec', mark: 'ko' }],
      'acces-refuse': [{ label: 'raspberry accès refusé', mark: 'ko' }, NOTHING],
      'delai-depasse': [{ label: 'raspberry délai dépassé', mark: 'ko' }],
      'erreur-usage': [{ label: 'erreur d’usage', mark: 'ko' }, NOTHING],
      'erreur-config': [{ label: 'erreur de config', mark: 'ko' }, NOTHING],
      'refuse-claude': [{ label: 'refusé par Claude Code', mark: 'off' }, NOTHING],
      decline: [{ label: 'accord', mark: 'ko' }, NOTHING],
      interrompu: [{ label: 'interrompu', mark: 'off' }],
      incertain: [{ label: 'incertain', mark: 'off' }],
    })
  })

  test('exemple du spec : ✓ accord · ✗ win2025 injoignable · rien n’a tourné', () => {
    expect(steps(call({ host: 'win2025', state: 'injoignable', accord: 'formulaire-oui' }))).toEqual([
      { label: 'accord', mark: 'ok' },
      { label: 'win2025 injoignable', mark: 'ko' },
      NOTHING,
    ])
  })

  test('la liste noire n’apparaît qu’une fois qu’elle a refusé, après l’accord par --yes', () => {
    expect(steps(call({ via: 'cli', tool: 'ssh_exec', state: 'refuse', accord: 'option' }))).toEqual([
      { label: 'accord par --yes', mark: 'ok' },
      { label: 'refusé par le bridge', mark: 'ko' },
      NOTHING,
    ])
  })

  test('formulaire refusé : l’accord est la dernière étape, quel que soit l’état', () => {
    for (const state of ['decline', 'confirmation-impossible', 'en-cours'] as const) {
      expect(steps(call({ state, accord: 'formulaire-non' }))).toEqual([{ label: 'accord', mark: 'ko' }, NOTHING])
    }
  })

  test('aucune étape accord devant un refus de Claude Code ou une confirmation manquante', () => {
    expect(steps(call({ state: 'refuse-claude', accord: 'option' }))).toEqual([
      { label: 'refusé par Claude Code', mark: 'off' },
      NOTHING,
    ])
    expect(steps(call({ state: 'confirmation-manquante', accord: 'formulaire-oui' }))).toEqual([
      { label: 'confirmation manquante', mark: 'ko' },
      NOTHING,
    ])
  })

  test('code inconnu et machine inconnue', () => {
    expect(steps(call({ state: 'code' }))).toEqual([{ label: 'raspberry code ?', mark: 'ok' }])
    expect(steps(call({ state: 'echec-machine' }))).toEqual([{ label: 'raspberry échec', mark: 'ko' }])
    expect(steps(call({ host: null, state: 'injoignable' }))).toEqual([
      { label: 'machine injoignable', mark: 'ko' },
      NOTHING,
    ])
  })

  test('aucune étape ✓ ou ✗ après un ✗, pour tout état et tout accord', () => {
    for (const state of STATES) {
      for (const accord of ['aucun', 'option', 'formulaire-oui', 'formulaire-non'] as const) {
        const marks = steps(call({ state, accord, code: 1 })).map((s) => s.mark)
        const firstKo = marks.indexOf('ko')
        const after = firstKo < 0 ? [] : marks.slice(firstKo + 1)
        expect(after.filter((m) => m !== 'off')).toEqual([])
      }
    }
  })
})

describe('ancres des textes : un texte au milieu d’une ligne n’est pas lu', () => {
  for (const [source, text] of FIXTURES) {
    test(`${source} précédé d’un autre mot`, () => {
      const line = `avant ${text}`
      expect(classify(mcp('ssh_service_status'), ko(line), TOOLS)).toStrictEqual({
        state: 'echec',
        truncated: false,
        reason: line,
      })
    })
  }

  test('le préfixe Error: n’est retiré qu’en tête de ligne', () => {
    expect(classify(mcp('ssh_service_status'), ko('Fatal Error: boom'), TOOLS)).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: 'Fatal Error: boom',
    })
    expect(classify(mcp('ssh_service_status'), ko('Error: boom'), TOOLS)).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: 'boom',
    })
  })

  test('un texte de refus du moteur au milieu de la première ligne n’est pas un refus', () => {
    for (const text of RECORDED_REFUSALS) {
      expect(classify(mcp('ssh_exec'), ko(`note : ${text}`), TOOLS).state).toBe('echec')
      expect(classify(mcp('ssh_exec'), ko(text), TOOLS).state).toBe('refuse-claude')
    }
  })

  test('une ligne de journal ne commence pas au milieu d’une ligne', () => {
    const line = 'vu : 2026-10-14T23:33:55.485691Z  INFO Loading configuration'
    expect(usefulLines(line)).toEqual([line])
    expect(usefulLines('2026-10-14T23:33:55.485691Z  INFO Loading configuration')).toEqual([])
  })

  test('« Exit code N » : la ligne entière, sur tout le nombre', () => {
    expect(classify(cli('ssh_service_status'), ko('Exit code 12\nError: Unknown host: x'), TOOLS)).toEqual({
      state: 'machine-inconnue',
      truncated: false,
    })
    expect(classify(cli('ssh_service_status'), ko('Exit code 1 de plus\nfoo'), TOOLS)).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: 'Exit code 1 de plus',
    })
    expect(classify(cli('ssh_service_status'), ko('sExit code 3\nUnknown host: a'), TOOLS)).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: 'sExit code 3',
    })
  })

  test('[exit:N] : la ligne entière, sur tout le nombre, en tête de texte', () => {
    expect(classify(mcp('ssh_exec'), ok('[exit:12]\nsortie'), TOOLS)).toStrictEqual({
      state: 'code',
      code: 12,
      truncated: false,
    })
    expect(classify(mcp('ssh_exec'), ko('[exit:12]\nboom'), TOOLS)).toStrictEqual({
      state: 'echec-machine',
      code: 12,
      truncated: false,
      reason: 'boom',
    })
    for (const text of ['[exit:3] de plus', 'x[exit:3]', 'sortie\n[exit:3]']) {
      expect(classify(mcp('ssh_exec'), ok(text), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
    }
  })

  test('[exit:N] seul : échec sur la machine sans raison ; sans [exit:N] : sans code', () => {
    expect(classify(mcp('ssh_exec'), ko('[exit:2]'), TOOLS)).toStrictEqual({
      state: 'echec-machine',
      code: 2,
      truncated: false,
    })
    expect(classify(cli('ssh_exec'), ko(bash(6, 'boom')), TOOLS)).toStrictEqual({ state: 'code', truncated: false })
    expect(classify(cli('ssh_k8s_get'), ko(bash(6, 'boom')), TOOLS)).toStrictEqual({
      state: 'echec-machine',
      truncated: false,
    })
  })

  test('"exit_code" d’un outil à un seul hôte : tout le nombre, sur une seule ligne', () => {
    expect(classify(mcp('ssh_exec'), ok('{"exit_code": 12,"output":""}'), TOOLS)).toStrictEqual({
      state: 'code',
      code: 12,
      truncated: false,
    })
    expect(classify(mcp('ssh_exec'), ok('{\n"exit_code": 1\n2\n}'), TOOLS)).toStrictEqual({
      state: 'code',
      code: 1,
      truncated: false,
    })
  })

  test('marque --- [truncated: en tête de ligne seulement', () => {
    expect(classify(mcp('ssh_disk_usage'), ok('vu --- [truncated: 5 lines] ---'), TOOLS).truncated).toBe(false)
    expect(classify(mcp('ssh_disk_usage'), ok('--- [truncated: 5 lines] ---'), TOOLS).truncated).toBe(true)
  })
})

describe('exec, upload, download : détails', () => {
  test('upload et download n’ont pas de table de codes : un code 5 est un échec sans texte connu', () => {
    for (const tool of ['upload', 'download']) {
      expect(classify(cli(tool), ko(bash(5, 'texte inconnu')), TOOLS)).toStrictEqual({
        state: 'echec',
        truncated: false,
        reason: 'texte inconnu',
      })
    }
    expect(classify(cli('ssh_disk_usage'), ko(bash(5, 'texte inconnu')), TOOLS)).toStrictEqual({
      state: 'erreur-config',
      truncated: false,
    })
  })

  test('seul exec lit « Exit code: N » ; upload et download sortis en 0 ont fait', () => {
    for (const tool of ['upload', 'download']) {
      expect(classify(cli(tool), ok(bash(0, 'Exit code: 3')), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
      expect(classify(cli(tool), ok(bash(0, '{"exit_code": 3}')), TOOLS)).toStrictEqual({
        state: 'fait',
        truncated: false,
      })
    }
    expect(classify(cli('exec'), ok(bash(0, 'Exit code: 3')), TOOLS)).toStrictEqual({
      state: 'code',
      code: 3,
      truncated: false,
    })
  })

  test('« Exit code: N » : la ligne entière, sur tout le nombre', () => {
    expect(classify(cli('exec'), ko(bash(1, 'Exit code: 12')), TOOLS)).toStrictEqual({
      state: 'code',
      code: 12,
      truncated: false,
    })
    for (const line of ['Exit code: 2 de plus', 'vu Exit code: 2']) {
      expect(classify(cli('exec'), ko(bash(1, line)), TOOLS)).toStrictEqual({
        state: 'echec',
        truncated: false,
        reason: line,
      })
    }
  })

  test('"exit_code" de exec --json : tout le nombre, sur une seule ligne', () => {
    expect(classify(cli('exec'), ko(bash(1, '{"exit_code": 12}')), TOOLS)).toStrictEqual({
      state: 'code',
      code: 12,
      truncated: false,
    })
    expect(classify(cli('exec'), ko(bash(1, '{"exit_code": 1', '2}')), TOOLS)).toStrictEqual({
      state: 'code',
      code: 1,
      truncated: false,
    })
  })

  test('exec, upload, download : la marque de sortie persistée compte comme tronquée', () => {
    expect(RECORDED_PERSISTED.length).toBeGreaterThan(0)
    for (const tool of ['exec', 'upload', 'download']) {
      for (const text of RECORDED_PERSISTED) {
        expect(classify(cli(tool), ok(bash(0, text)), TOOLS)).toStrictEqual({ state: 'fait', truncated: true })
      }
    }
  })
})

describe('JSON de la CLI : enveloppe content et results', () => {
  const envelope = (...content: unknown[]): string => JSON.stringify({ content })
  const text = (t: string): { type: string; text: string } => ({ type: 'text', text: t })

  test('une marque de troncature dans content[].text, que le JSON échappe, compte', () => {
    const body = envelope(text('début\nPour la suite : ssh_output_fetch(output_id="3f9c", offset=0)'))
    expect(classify(cli('ssh_journal_query'), ok(bash(0, body)), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: true,
    })
    expect(classify(cli('ssh_journal_query'), ok(bash(0, envelope(text('rien')))), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: false,
    })
  })

  test('une marque dans la sortie brute, hors enveloppe, compte aussi', () => {
    const raw = '--- [truncated: 5 lines total] ---'
    expect(classify(cli('ssh_journal_query'), ok(bash(0, raw)), TOOLS).truncated).toBe(true)
    expect(classify(cli('ssh_journal_query'), ok(bash(0, envelope(text('rien')), raw)), TOOLS).truncated).toBe(true)
  })

  test('les blocs de content sont des lignes distinctes, ceux qui ne portent pas de texte sont sautés', () => {
    const body = envelope({ text: 7 }, null, 5, ['x'], text('[exit:3]'), { type: 'image' }, text('boom'))
    expect(classify(cli('ssh_k8s_get'), ko(bash(6, body)), TOOLS)).toStrictEqual({
      state: 'echec-machine',
      code: 3,
      truncated: false,
      reason: 'boom',
    })
  })

  test('le JSON commence à la première ligne ouverte par {, après un texte', () => {
    expect(classify(cli('ssh_exec_multi'), ok(bash(0, 'note', MULTI_JSON)), TOOLS)).toStrictEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
  })

  test('seule la première ligne ouverte par { compte : si elle ne se lit pas, pas de JSON', () => {
    expect(classify(cli('ssh_exec_multi'), ok(bash(0, '{oups', MULTI_JSON)), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: false,
    })
  })

  test('les lignes du JSON sont jointes par un retour à la ligne, jamais collées', () => {
    const split = ['{"results":[{"host":"raspberry","exit_code":1', '2}]}']
    expect(classify(cli('ssh_exec_multi'), ok(bash(0, ...split)), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: false,
    })
  })

  test('results : les entrées qui ne sont pas des objets sont sautées, l’hôte choisit l’entrée', () => {
    const results = (...entries: unknown[]): string => JSON.stringify({ results: entries })
    const body = results(null, 5, ['raspberry'], { host: 'win2025', exit_code: 0 }, { host: 'raspberry', exit_code: 2 })
    expect(classify(cli('ssh_exec_multi'), ok(bash(0, body)), TOOLS)).toStrictEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
    expect(classify(cli('ssh_exec_multi', { host: 'win2025' }), ok(bash(0, body)), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: false,
    })
    expect(classify(mcp('ssh_exec_multi', 'raspberry'), ok(body), TOOLS)).toStrictEqual({
      state: 'code',
      code: 2,
      truncated: false,
    })
  })

  test('une machine inconnue ne choisit aucune entrée, même une entrée sans machine', () => {
    const body = JSON.stringify({ results: [{ host: null, exit_code: 3 }, { exit_code: 4 }] })
    expect(classify(cli('ssh_exec_multi', { host: null }), ok(bash(0, body)), TOOLS)).toStrictEqual({
      state: 'fait',
      truncated: false,
    })
    expect(classify(mcp('ssh_exec_multi', null), ok(body), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
  })

  test('entrée de results : erreur, code non nul, code nul, code absent ou pas un nombre', () => {
    const one = (entry: object): string => JSON.stringify({ results: [{ host: 'raspberry', ...entry }] })
    const run = (entry: object) => classify(mcp('ssh_exec_multi'), ok(one(entry)), TOOLS)
    expect(run({ exit_code: 0 })).toStrictEqual({ state: 'fait', truncated: false })
    expect(run({})).toStrictEqual({ state: 'fait', truncated: false })
    expect(run({ exit_code: '3' })).toStrictEqual({ state: 'fait', truncated: false })
    expect(run({ exit_code: 3 })).toStrictEqual({ state: 'code', code: 3, truncated: false })
    expect(run({ error: 'Rate limit exceeded' })).toStrictEqual({ state: 'limite', truncated: false })
    expect(run({ error: 'inconnue', exit_code: 0 })).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: 'inconnue',
    })
  })

  test('un outil à un seul hôte ne lit pas results ; un outil inconnu non plus', () => {
    const body = JSON.stringify({ results: [{ host: 'raspberry', exit_code: 2 }] })
    expect(classify(cli('ssh_disk_usage'), ok(bash(0, body)), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
    expect(classify(mcp('ssh_disk_usage'), ko(body), TOOLS)).toStrictEqual({
      state: 'echec',
      truncated: false,
      reason: body,
    })
    expect(classify(cli('ssh_nope'), ok(bash(0, body)), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
    expect(classify(mcp('ssh_nope'), ok(body), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
  })

  test('outil absent de la table : classé comme un autre, sans code distant', () => {
    expect(classify(mcp('ssh_nope'), ok('bonjour'), TOOLS)).toStrictEqual({ state: 'fait', truncated: false })
    expect(classify(cli('ssh_nope'), ko(bash(6, '[exit:2]', 'boom')), TOOLS)).toStrictEqual({
      state: 'echec-machine',
      code: 2,
      truncated: false,
      reason: 'boom',
    })
  })
})

describe('steps : accord devant un formulaire refusé', () => {
  const call = (patch: Partial<BridgeCall>): BridgeCall => ({
    id: 'toolu_1#0',
    toolUseId: 'toolu_1',
    via: 'cli',
    tool: 'ssh_exec',
    host: 'raspberry',
    nature: 'peut-modifier',
    state: 'fait',
    truncated: false,
    accord: 'aucun',
    startedAt: 0,
    endedAt: 400,
    ...patch,
  })

  test('decline et confirmation impossible sont décidés avant l’accord : aucune étape accord devant', () => {
    expect(steps(call({ state: 'decline', accord: 'option' }))).toEqual([
      { label: 'accord', mark: 'ko' },
      { label: 'rien n’a tourné', mark: 'off' },
    ])
    expect(steps(call({ state: 'confirmation-impossible', accord: 'formulaire-oui' }))).toEqual([
      { label: 'confirmation impossible', mark: 'ko' },
      { label: 'rien n’a tourné', mark: 'off' },
    ])
    expect(steps(call({ state: 'confirmation-impossible', accord: 'option' }))).toEqual([
      { label: 'confirmation impossible', mark: 'ko' },
      { label: 'rien n’a tourné', mark: 'off' },
    ])
  })
})
