import { describe, expect, test } from 'claude-code/testing'

import type { ParsedCall } from '../../hooks/bridge'
import { hasBackgroundTask, parseConfirmation, runResultOf, sessionFromCreate } from '../../hooks/bridge'
import { closeWaiting, dropCalls, EMPTY, finishCalls, setWaiting, startCalls, waitingFor } from '../../hooks/state'

// Ce que register.tsx lisait lui-même en 0.1.0 et que la tâche 11 sort en fonctions pures
// (spec §6 : register.tsx sans règle métier) : le résultat d'un tool.call, le formulaire de
// confirmation, l'identifiant d'une session, l'attente « à toi ».

// --- Fixtures réelles ----------------------------------------------------------------------

// Sortie de ssh_disk_usage, fixture des sources de bridge-mcp (src/mcp/tool_handlers/ssh_disk_usage.rs:344).
const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
// refs/bridge-facts.md §0.1 (1) : lignes de journal que la CLI écrit sur stderr (ANSI retiré).
const CLI_LOG = '2026-10-14T23:33:55.485691Z  INFO Loading configuration config=/path/config.yaml'
// refs/bridge-facts.md §3.5.
const SSH_REFUSED = 'SSH connection failed to raspberry: Connection refused (os error 111)'
// refs/bridge-facts.md §5.2 : les deux messages exacts du formulaire.
const CONFIRM_EXEC =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n{"command":"systemctl restart nginx","host":"raspberry"}\n```\n\n**Command:**\n```sh\nsystemctl restart nginx\n```\n\nProceed?'
const CONFIRM_KILL =
  'Confirm destructive operation: `ssh_process_kill`\n\n**Arguments:**\n```json\n{"host":"raspberry","pid":1234}\n```\n\nProceed?'
// refs/bridge-facts.md §5.1 : sans arguments, le résumé vaut `(no arguments)`.
const CONFIRM_NO_ARGS =
  'Confirm destructive operation: `ssh_exec`\n\n**Arguments:**\n```json\n(no arguments)\n```\n\nProceed?'
// refs/bridge-facts.md §5.1, constructeur appliqué tel quel : résumé trié coupé à 300 caractères
// suivis de `… (truncated)` ; une commande de 320 caractères pousse "host" au-delà de la coupe (§5.3).
const LONG = 'x'.repeat(320)
const CONFIRM_CUT = `Confirm destructive operation: \`ssh_exec\`\n\n**Arguments:**\n\`\`\`json\n${JSON.stringify({ command: LONG, host: 'raspberry' }).slice(0, 300)}… (truncated)\n\`\`\`\n\n**Command:**\n\`\`\`sh\n${LONG}\n\`\`\`\n\nProceed?`
// refs/bridge-facts.md §5.1, `named` : un nom hors [A-Za-z0-9_.-] passe en bloc clôturé, sans info.
const CONFIRM_FENCED =
  'Confirm destructive operation: \n```\nmon outil\n```\n\n**Arguments:**\n```json\n(no arguments)\n```\n\nProceed?'
// SessionInfo de ssh_session_create et réponse de ssh_session_exec (refs/bridge-facts.md §6.1 ;
// champs de src/ssh/session.rs:72-78 ; id UUID v4, src/ssh/session.rs:345).
const SESSION = '7f6d1c2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f'
const SESSION_INFO = `{"id":"${SESSION}","host":"raspberry","cwd":"/home/pi","created_at_secs_ago":0,"last_used_secs_ago":0}`
const SESSION_EXEC = `{"cwd":"/home/pi","exit_code":0,"output":"up 3 days","session_id":"${SESSION}"}`

// Résultats du moteur, formes de refs/engine-api.md §3.3 (ToolCallResult, D:13312-13401).
const OK = { result: { content: [] }, text: DF, isReadOnly: true as const }
const FAILED = { result: SSH_REFUSED, text: SSH_REFUSED, isError: true as const }
// Un deny est le texte libre d'un hook (D:13314-13321).
const DENIED = { deny: 'Refusé par un hook de la session.' }

const call = (via: 'cli' | 'mcp', tool: string, host: string | null): ParsedCall => ({
  via,
  tool,
  host,
  nature: 'peut-modifier',
  accordByOption: false,
  ownsExit: true,
  inLoop: false,
})

// --- Résultat d'un tool.call -----------------------------------------------------------------

describe('runResultOf : le résultat du moteur tel que classify le lit', () => {
  test('un résultat réussi : son texte, ni erreur, ni interruption ; le refus donné par l’appelant est gardé', () => {
    expect(runResultOf(OK, false, false)).toStrictEqual({
      isError: false,
      text: DF,
      interrupted: false,
      refusedByClaude: false,
    })
    expect(runResultOf(OK, false, true).refusedByClaude).toBe(true)
  })

  test('un résultat en erreur : isError, le texte que le modèle a lu', () => {
    expect(runResultOf(FAILED, false, false)).toStrictEqual({
      isError: true,
      text: SSH_REFUSED,
      interrupted: false,
      refusedByClaude: false,
    })
  })

  test('le deny d’un hook : erreur, refus de Claude Code, son texte', () => {
    expect(runResultOf(DENIED, false, false)).toStrictEqual({
      isError: true,
      text: DENIED.deny,
      interrupted: false,
      refusedByClaude: true,
    })
  })

  test('sans text : stdout puis stderr d’un résultat Bash, une chaîne telle quelle, sinon rien', () => {
    expect(runResultOf({ result: { stdout: DF, stderr: CLI_LOG, interrupted: false } }, false, false).text).toBe(
      `${DF}\n${CLI_LOG}`,
    )
    expect(runResultOf({ result: { stdout: DF, interrupted: false } }, false, false).text).toBe(DF)
    expect(runResultOf({ isError: true, result: SSH_REFUSED }, false, false).text).toBe(SSH_REFUSED)
    expect(runResultOf({ result: undefined }, false, false).text).toBe('')
  })

  test('interrompu : next.signal.aborted, ou interrupted du résultat Bash', () => {
    expect(runResultOf(OK, true, false).interrupted).toBe(true)
    expect(
      runResultOf({ result: { stdout: '', stderr: '', interrupted: true }, text: '' }, false, false).interrupted,
    ).toBe(true)
    expect(
      runResultOf({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }, false, false).interrupted,
    ).toBe(false)
  })

  test('le cœur a rejeté (aucun résultat) : erreur interrompue, sans texte', () => {
    expect(runResultOf(undefined, false, false)).toStrictEqual({
      isError: true,
      text: '',
      interrupted: true,
      refusedByClaude: false,
    })
    expect(runResultOf(undefined, false, true).refusedByClaude).toBe(true)
  })
})

describe('hasBackgroundTask : un appel Bash passé en arrière-plan', () => {
  test('backgroundTaskId présent : oui ; absent, ou pas un objet : non', () => {
    expect(hasBackgroundTask({ stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' })).toBe(true)
    expect(hasBackgroundTask({ stdout: DF, stderr: '', interrupted: false })).toBe(false)
    expect(hasBackgroundTask(SSH_REFUSED)).toBe(false)
    expect(hasBackgroundTask(null)).toBe(false)
    expect(hasBackgroundTask(undefined)).toBe(false)
  })
})

// --- Formulaire de confirmation et session ---------------------------------------------------

describe('parseConfirmation : outil et machine du formulaire (refs/bridge-facts.md §5)', () => {
  test('les deux messages exacts de §5.2', () => {
    expect(parseConfirmation(CONFIRM_EXEC)).toStrictEqual({ tool: 'ssh_exec', host: 'raspberry' })
    expect(parseConfirmation(CONFIRM_KILL)).toStrictEqual({ tool: 'ssh_process_kill', host: 'raspberry' })
  })

  test('la machine manque : sans arguments, ou poussée au-delà de la coupe des 300 caractères', () => {
    expect(parseConfirmation(CONFIRM_NO_ARGS)).toStrictEqual({ tool: 'ssh_exec', host: null })
    expect(parseConfirmation(CONFIRM_CUT)).toStrictEqual({ tool: 'ssh_exec', host: null })
  })

  test('un nom en bloc clôturé est lu ; un autre message ne nomme rien', () => {
    expect(parseConfirmation(CONFIRM_FENCED)).toStrictEqual({ tool: 'mon outil', host: null })
    expect(parseConfirmation('Proceed?')).toStrictEqual({ tool: null, host: null })
  })
})

describe('sessionFromCreate : la session que rend ssh_session_create', () => {
  test('le SessionInfo donne l’identifiant et la machine', () => {
    expect(sessionFromCreate(SESSION_INFO)).toStrictEqual({ id: SESSION, host: 'raspberry' })
  })

  test('tout autre texte : rien (ssh_session_exec, erreur, formulaire sans id)', () => {
    expect(sessionFromCreate(SESSION_EXEC)).toBeNull()
    expect(sessionFromCreate(SSH_REFUSED)).toBeNull()
    expect(sessionFromCreate(CONFIRM_EXEC)).toBeNull()
  })
})

// --- Réducteurs de l'état ------------------------------------------------------------------------

describe('dropCalls : appel passé en arrière-plan', () => {
  test('retire les appels de ce tool_use_id et garde les autres, et l’ordre des machines', () => {
    const parsed = [call('cli', 'ssh_disk_usage', 'raspberry')]
    const s = startCalls(startCalls(EMPTY, 'toolu_bg', undefined, parsed, 1_000), 'toolu_fg', undefined, parsed, 1_000)
    const after = dropCalls(s, 'toolu_bg')
    expect(after.calls.map((c) => c.toolUseId)).toEqual(['toolu_fg'])
    expect(after.hostOrder).toEqual(['raspberry'])
  })

  test('rend la même référence quand aucun appel ne porte ce tool_use_id', () => {
    const s = startCalls(EMPTY, 'toolu_fg', undefined, [call('cli', 'ssh_disk_usage', 'raspberry')], 1_000)
    expect(dropCalls(s, 'toolu_absent')).toBe(s)
    expect(dropCalls(EMPTY, 'toolu_absent')).toBe(EMPTY)
  })
})

describe('waitingFor : l’appel qu’attend le formulaire', () => {
  const two = startCalls(
    startCalls(EMPTY, 'toolu_a', undefined, [call('mcp', 'ssh_exec', 'raspberry')], 1_000),
    'toolu_b',
    undefined,
    [call('mcp', 'ssh_disk_usage', 'win2025')],
    2_000,
  )

  test('outil et machine nommés : l’appel en cours qui correspond, même s’il n’est pas le dernier', () => {
    expect(waitingFor(two, { tool: 'ssh_exec', host: 'raspberry' }, 5_000)).toStrictEqual({
      tool: 'ssh_exec',
      host: 'raspberry',
      callId: 'toolu_a#0',
      since: 5_000,
    })
    const three = startCalls(two, 'toolu_c', undefined, [call('mcp', 'ssh_exec', 'raspberry')], 3_000)
    expect(waitingFor(three, { tool: 'ssh_exec', host: 'raspberry' }, 5_000).callId).toBe('toolu_c#0')
  })

  test('la machine manque au message : l’outil suffit, la machine vient de l’appel', () => {
    expect(waitingFor(two, { tool: 'ssh_exec', host: null }, 5_000)).toStrictEqual({
      tool: 'ssh_exec',
      host: 'raspberry',
      callId: 'toolu_a#0',
      since: 5_000,
    })
  })

  test('rien ne correspond : le plus récent appel MCP en cours, le message garde ce qu’il nomme', () => {
    expect(waitingFor(two, { tool: 'ssh_file_write', host: 'pi-k3s' }, 5_000)).toStrictEqual({
      tool: 'ssh_file_write',
      host: 'pi-k3s',
      callId: 'toolu_b#0',
      since: 5_000,
    })
    expect(waitingFor(two, { tool: null, host: null }, 5_000)).toStrictEqual({
      tool: 'ssh_disk_usage',
      host: 'win2025',
      callId: 'toolu_b#0',
      since: 5_000,
    })
  })

  test('un appel CLI ou terminé n’est jamais attendu', () => {
    const cli = startCalls(EMPTY, 'toolu_cli', undefined, [call('cli', 'ssh_exec', 'raspberry')], 1_000)
    const done = finishCalls(
      startCalls(cli, 'toolu_m', undefined, [call('mcp', 'ssh_exec', 'raspberry')], 2_000),
      'toolu_m',
      [{ state: 'fait', truncated: false }],
      3_000,
    )
    expect(waitingFor(done, { tool: 'ssh_exec', host: 'raspberry' }, 5_000)).toStrictEqual({
      tool: 'ssh_exec',
      host: 'raspberry',
      callId: null,
      since: 5_000,
    })
    expect(waitingFor(done, { tool: null, host: null }, 5_000)).toStrictEqual({
      tool: '',
      host: null,
      callId: null,
      since: 5_000,
    })
  })
})

describe('closeWaiting : « à toi » s’efface quand l’appel se termine', () => {
  const s = startCalls(
    startCalls(EMPTY, 'toolu_a', undefined, [call('mcp', 'ssh_exec', 'raspberry')], 1_000),
    'toolu_cli',
    undefined,
    [call('cli', 'ssh_exec', 'raspberry')],
    1_000,
  )
  const both = startCalls(s, 'toolu_b', undefined, [call('mcp', 'ssh_disk_usage', 'win2025')], 2_000)

  test('l’appel attendu se termine : effacé ; un autre : même référence', () => {
    const waiting = setWaiting(both, { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_a#0', since: 3_000 })
    expect(closeWaiting(waiting, 'toolu_a').waiting).toBeNull()
    expect(closeWaiting(waiting, 'toolu_b')).toBe(waiting)
  })

  test('attente sans appel connu : le premier appel MCP qui se termine l’efface, un appel CLI non', () => {
    const waiting = setWaiting(both, { tool: 'ssh_exec', host: 'raspberry', callId: null, since: 3_000 })
    expect(closeWaiting(waiting, 'toolu_cli')).toBe(waiting)
    expect(closeWaiting(waiting, 'toolu_b').waiting).toBeNull()
  })

  test('aucune attente : même référence', () => {
    expect(closeWaiting(both, 'toolu_a')).toBe(both)
    expect(closeWaiting(EMPTY, 'toolu_a')).toBe(EMPTY)
  })
})

describe('formes limites des lectures', () => {
  test('parseConfirmation : bloc clôturé avec une langue, espaces autour des deux-points du host', () => {
    expect(parseConfirmation('Confirm destructive operation: \n```text\nmon outil\n```\n')).toStrictEqual({
      tool: 'mon outil',
      host: null,
    })
    expect(parseConfirmation('Confirm destructive operation: `ssh_exec`\n{"host" : "raspberry"}')).toStrictEqual({
      tool: 'ssh_exec',
      host: 'raspberry',
    })
    expect(parseConfirmation('Confirm destructive operation: `ssh_exec`\n{"hostx": "raspberry"}')).toStrictEqual({
      tool: 'ssh_exec',
      host: null,
    })
  })

  test('sessionFromCreate : l’identifiant sans la machine, ou la machine sans l’identifiant, ne suffit pas', () => {
    expect(sessionFromCreate('{"id":"s-1","cwd":"/"}')).toBeNull()
    expect(sessionFromCreate('{"host":"raspberry","cwd":"/"}')).toBeNull()
    expect(sessionFromCreate('{"id":"s-1","host":"raspberry"}')).toStrictEqual({ id: 's-1', host: 'raspberry' })
  })

  test('un résultat nul, un nombre ou un tableau n’est pas une sortie Bash', () => {
    for (const result of [null, 5, true]) {
      expect(runResultOf({ result }, false, false)).toStrictEqual({
        isError: false,
        text: '',
        interrupted: false,
        refusedByClaude: false,
      })
      expect(hasBackgroundTask(result)).toBe(false)
    }
    expect(hasBackgroundTask({ backgroundTaskId: 7 })).toBe(false)
  })
})
