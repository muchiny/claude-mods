import { describe, expect, test } from 'claude-code/testing'
import stringWidth from 'string-width'
import {
  anonymize,
  assertClean,
  assertKnownForms,
  classifyLine,
  isBridgeCommand,
  lorem,
  newDict,
  type RawEvent,
  type RawScenario,
} from '../../dev/replay/anonymize'
import type { ReplayEvent, Scenario } from '../../mode-clair/tests/replay/scenarios.generated'

// Noms fictifs à la place des vraies machines et du vrai compte : aucun nom réel dans ce fichier.
const M1 = 'machine-reelle-1'
const M2 = 'machine-reelle-2'
const DENY = [M1, M2, 'quelquun']

const call = (
  tool: string,
  toolUseId: string,
  input: unknown,
  text: string,
  extra: { isError?: true; result?: unknown; at?: number; agentId?: string } = {},
): RawEvent => ({
  kind: 'tool.call',
  at: extra.at ?? 1_000,
  doneAt: (extra.at ?? 1_000) + 250,
  tool,
  toolUseId,
  ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
  input,
  result:
    extra.isError === true
      ? { isError: true, result: extra.result ?? text, text }
      : { result: extra.result ?? text, text },
})

const scenario = (events: RawEvent[], files: Record<string, string> = {}): RawScenario => ({
  id: 'essai-0001',
  events,
  files,
})

type Call = Extract<ReplayEvent, { kind: 'tool.call' }>
const calls = (s: Scenario): Call[] => s.events.filter((e): e is Call => e.kind === 'tool.call')
const textOf = (e: Call): string => String(e.result.text)
const json = (s: Scenario): string => JSON.stringify(s)
const fields = (c: Call | undefined): Record<string, string> => (c as Call).input as Record<string, string>
const inputOf = (s: Scenario, i: number): Record<string, string> => fields(calls(s)[i])

describe('anonymize : machines', () => {
  test('host-a, host-b dans l’ordre d’apparition, cohérentes dans l’entrée, le texte et les chemins', () => {
    const s = anonymize(
      scenario([
        call('mcp__ssh-bridge__ssh_disk_usage', 'toolu_01AAA', { host: M1 }, 'Unknown host: machine-reelle-1', {
          isError: true,
        }),
        call(
          'Bash',
          'toolu_01BBB',
          { command: `bridge-mcp tool ssh_disk_usage host=${M2}` },
          `Exit code 3\nError: SSH connection failed to ${M2}: Connection refused (os error 111)`,
          { isError: true },
        ),
        {
          kind: 'session.append',
          at: 2_000,
          text: `<task-notification>\n<task-id>b1c2d3e4f</task-id>\n<output-file>/var/log/${M1}/sortie.log</output-file>\n<status>failed</status>\n<summary>rapport privé</summary>\n</task-notification>`,
        },
      ]),
      newDict(),
    )
    const [mcp, cli] = calls(s)
    expect(mcp?.input).toEqual({ host: 'host-a' })
    expect(textOf(mcp as Call)).toBe('Unknown host: host-a')
    expect(fields(cli).command).toBe('bridge-mcp tool ssh_disk_usage host=host-b')
    expect(textOf(cli as Call)).toBe(
      'Exit code 3\nError: SSH connection failed to host-b: Connection refused (os error 111)',
    )
    const notice = s.events[2] as { text: string }
    expect(notice.text).toContain('<output-file>/var/log/host-a/')
    expect(notice.text).toContain('<status>failed</status>')
    expect(json(s)).not.toContain('machine-reelle')
  })

  test('hosts d’un outil multi et JSON de résultat : chaque hôte suit la même table', () => {
    const result = JSON.stringify({
      total_hosts: 2,
      results: [
        { host: M2, success: true, exit_code: 0, stdout: 'secret' },
        { host: M1, success: false, exit_code: 1, error: `Unknown host: ${M1}` },
      ],
    })
    const s = anonymize(
      scenario([call('mcp__ssh-bridge__ssh_exec_multi', 'toolu_1', { hosts: [M1, M2] }, result)]),
      newDict(),
    )
    const [c] = calls(s)
    expect(c?.input).toEqual({ hosts: ['host-a', 'host-b'] })
    const parsed = JSON.parse(textOf(c as Call))
    expect(parsed.results[0].host).toBe('host-b')
    expect(parsed.results[1].host).toBe('host-a')
    expect(parsed.results[1].error).toBe('Unknown host: host-a')
    expect(parsed.results[0].exit_code).toBe(0)
    expect(parsed.results[0].stdout).not.toBe('secret')
  })
})

describe('anonymize : chemins et identifiants', () => {
  test('/home/<nom>/x devient /home/user/<lorem> (composant court compris)', () => {
    const s = anonymize(
      scenario([call('Write', 'toolu_1', { file_path: '/home/quelquun/x', content: 'a' }, 'ok')]),
      newDict(),
    )
    expect(inputOf(s, 0).file_path).toBe('/home/user/l')
  })

  test('toolu_01ABC devient toolu_r0001, partout où il paraît', () => {
    const s = anonymize(
      scenario([
        call('Workflow', 'toolu_01ABC', { name: 'audit' }, 'lancé', {
          result: { status: 'async_launched', taskId: 'k9x8w7v6u', runId: 'wf_1a2b3c4d-5e6' },
        }),
        {
          kind: 'session.append',
          at: 3_000,
          text: '<task-notification>\n<task-id>k9x8w7v6u</task-id>\n<tool-use-id>toolu_01ABC</tool-use-id>\n<status>completed</status>\n</task-notification>',
        },
      ]),
      newDict(),
    )
    const [c] = calls(s)
    expect(c?.toolUseId).toBe('toolu_r0001')
    const r = c?.result.result as { taskId: string; runId: string; status: string }
    expect(r.status).toBe('async_launched')
    expect(r.runId).toBe('wf_r0001')
    const notice = (s.events[1] as { text: string }).text
    expect(notice).toContain('<tool-use-id>toolu_r0001</tool-use-id>')
    expect(notice).toContain(`<task-id>${r.taskId}</task-id>`)
    expect(notice).toContain('<status>completed</status>')
  })

  test('UUID : un UUID synthétique stable, le même partout dans le scénario', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
    const s = anonymize(
      scenario([
        call('Read', 'toolu_1', { file_path: `/var/tmp/${uuid}/a.txt`, note: uuid }, `vu ${uuid}`),
        call('Read', 'toolu_2', { file_path: `/var/tmp/${uuid}.jsonl` }, 'ok'),
      ]),
      newDict(),
    )
    const [a, b] = calls(s)
    const pa = fields(a).file_path
    const pb = fields(b).file_path
    expect(pa).toBe('/var/tmp/00000000-0000-4000-8000-000000000001/l.txt')
    expect(pb).toBe('/var/tmp/00000000-0000-4000-8000-000000000001.jsonl')
    expect(json(s)).not.toContain(uuid)
  })

  test('déterministe : deux passes avec un dictionnaire neuf donnent le même scénario', () => {
    const raw = scenario([
      call('Bash', 'toolu_9', { command: `bridge-mcp exec ${M1} 'df -h /srv'` }, 'Host: x\nsecret'),
      { kind: 'turn.complete', at: 5_000 },
    ])
    expect(anonymize(raw, newDict())).toEqual(anonymize(raw, newDict()))
  })

  test('temps relatifs : t depuis le premier événement, afterMs = fin − début', () => {
    const s = anonymize(
      scenario([
        call('Skill', 'toolu_1', { skill: 'superpowers:brainstorming' }, 'ok', { at: 10_000 }),
        { kind: 'turn.complete', at: 12_500 },
      ]),
      newDict(),
    )
    expect(s.events[0]).toMatchObject({ t: 0, afterMs: 250 })
    expect(s.events[1]).toEqual({ t: 2_500, kind: 'turn.complete' })
  })
})

describe('anonymize : texte libre', () => {
  test('ligne libre remplacée par du lorem de même largeur en cellules, lignes reconnues gardées', () => {
    const lines = [
      'Exit code 6',
      '2026-10-21T10:00:00.123456Z  INFO bridge_mcp::cli: connexion à machine-reelle-1 établie',
      'Error: Unknown host: machine-reelle-1',
      '[exit:2]',
      'mot de passe: hunter2 dans /etc/privé',
      'données 漢字 réseau',
    ]
    const s = anonymize(
      scenario([
        call('Bash', 'toolu_1', { command: 'bridge-mcp tool ssh_exec host=machine-reelle-1' }, lines.join('\n'), {
          isError: true,
        }),
      ]),
      newDict(),
    )
    const out = textOf(calls(s)[0] as Call).split('\n')
    expect(out[0]).toBe('Exit code 6')
    expect(out[1]?.startsWith('2000-01-01T00:00:00.000Z  INFO ')).toBe(true)
    expect(out[1]).not.toContain('machine-reelle')
    expect(out[2]).toBe('Error: Unknown host: host-a')
    expect(out[3]).toBe('[exit:2]')
    // Ligne 1 : l'horodatage devient synthétique (précision ms), le message garde sa largeur.
    expect(stringWidth(out[1] ?? '')).toBe(stringWidth(lines[1] ?? '') - 3)
    for (const i of [1, 4, 5]) {
      expect(out[i]).not.toBe(lines[i])
      if (i === 1) continue
      expect(stringWidth(out[i] ?? '')).toBe(stringWidth(lines[i] ?? ''))
    }
    expect(out[4]).not.toContain('hunter2')
  })

  test('une chaîne inconnue de 40 caractères dans un champ affiché est remplacée', () => {
    const unknown = 'Zorglub Quintessence Hypervelocite Xy42!'
    expect(unknown).toHaveLength(40)
    const s = anonymize(scenario([call('Agent', 'toolu_1', { description: unknown, prompt: 'p' }, 'ok')]), newDict())
    const description = inputOf(s, 0).description
    expect(description).not.toBe(unknown)
    expect(stringWidth(description)).toBe(40)
    expect(() => assertKnownForms(s)).not.toThrow()
  })

  test('description d’Agent : Task n, final review et code-reviewer.md gardés', () => {
    const s = anonymize(
      scenario([
        call(
          'Agent',
          'toolu_1',
          { description: 'Implement Task 3: secret feature', prompt: 'lis code-reviewer.md puis X' },
          'ok',
        ),
        call('Agent', 'toolu_2', { description: 'final code review du projet', prompt: 'p' }, 'ok'),
      ]),
      newDict(),
    )
    const [a, b] = calls(s)
    expect(fields(a).description).toContain('Task 3')
    expect(fields(a).prompt).toContain('code-reviewer.md')
    expect(fields(b).description).toContain('final code review')
  })

  test('commande Bash : structure bridge gardée, contenu remplacé', () => {
    const command = `cd /home/quelquun/projet && RUST_LOG=debug ./target/debug/bridge-mcp --json tool ssh_exec host=${M1} command="cat /etc/secret" | head -5`
    const s = anonymize(scenario([call('Bash', 'toolu_1', { command }, 'ok')]), newDict())
    const out = inputOf(s, 0).command
    expect(out).toContain(' && ')
    expect(out).toContain('./target/debug/bridge-mcp --json tool ssh_exec host=host-a command="')
    expect(out).toContain(' | ')
    expect(out).toContain('/home/user/')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('projet')
  })

  test('bash -c : la commande citée est anonymisée comme une commande', () => {
    const s = anonymize(
      scenario([
        call('Bash', 'toolu_1', { command: `bash -c 'bridge-mcp tool ssh_ls host=${M1} path=/srv/privé'` }, 'ok'),
      ]),
      newDict(),
    )
    const out = inputOf(s, 0).command
    expect(out).toContain("bash -c 'bridge-mcp tool ssh_ls host=host-a path=")
    expect(out).not.toContain('priv')
  })

  test('variable $H gardée comme valeur d’hôte (machine non affirmée)', () => {
    const s = anonymize(
      scenario([call('Bash', 'toolu_1', { command: 'bridge-mcp tool ssh_ls host=$H' }, 'ok')]),
      newDict(),
    )
    expect(inputOf(s, 0).command).toMatch(/host=\$[a-z]$/)
  })

  test('plan : titres de tâches, suffixe Implementation Plan et blocs clôturés gardés, texte remplacé', () => {
    const content = [
      '# Projet Secret Implementation Plan',
      '',
      '### Task 1: écrire le module privé',
      '```bash',
      '### Task 9 dans un bloc',
      '```',
      '### Task 2: autre chose',
      'corps confidentiel',
    ].join('\n')
    const s = anonymize(
      scenario([
        call('Write', 'toolu_1', { file_path: '/home/quelquun/p/docs/superpowers/plans/2026-plan.md', content }, 'ok'),
      ]),
      newDict(),
    )
    const input = calls(s)[0]?.input as { file_path: string; content: string }
    expect(input.file_path).toMatch(/^\/home\/user\/[a-z]\/docs\/superpowers\/plans\/[^/]+\.md$/)
    const out = input.content.split('\n')
    expect(out[0]).toMatch(/^# \S.* Implementation Plan$/)
    expect(out[0]).not.toContain('Secret')
    expect(out[2]?.startsWith('### Task 1')).toBe(true)
    expect(out[3]?.startsWith('```')).toBe(true)
    expect(out[4]?.startsWith('### Task 9')).toBe(false)
    expect(out[5]).toBe('```')
    expect(out[6]?.startsWith('### Task 2')).toBe(true)
    expect(input.content).not.toContain('confidentiel')
  })

  test('workflow : bloc meta reconstruit, phases du journal cohérentes avec celles du script', () => {
    const script =
      "export const meta = { name: 'audit-privé', phases: [{ title: 'Collecte' }, { title: 'Rapport' }] }\nconst secret = 1\n"
    const journal = [
      JSON.stringify({ type: 'started', agentId: 'ag1', label: 'lecteur privé', phase: 'Collecte', prompt: 'secret' }),
      JSON.stringify({ type: 'failed', agentId: 'ag1' }),
      '',
    ].join('\n')
    const s = anonymize(
      scenario(
        [
          call('Workflow', 'toolu_1', { script }, 'ok', {
            result: {
              status: 'async_launched',
              transcriptDir: '/home/quelquun/.claude/projects/p/wf',
              scriptPath: '/home/quelquun/w.js',
            },
          }),
        ],
        { '/home/quelquun/.claude/projects/p/wf/journal.jsonl': journal, '/home/quelquun/w.js': script },
      ),
      newDict(),
    )
    const input = calls(s)[0]?.input as { script: string }
    expect(input.script).toMatch(/^export const meta = \{/)
    expect(input.script).not.toContain('secret')
    const titles = Array.from(input.script.matchAll(/title: '([^']*)'/g), (m) => m[1])
    expect(titles).toHaveLength(2)
    const r = calls(s)[0]?.result.result as { transcriptDir: string; scriptPath: string }
    const rows = (s.files[`${r.transcriptDir}/journal.jsonl`] ?? '').split('\n').filter((l) => l !== '')
    expect(rows).toHaveLength(2)
    const first = JSON.parse(rows[0] ?? '{}')
    expect(first.type).toBe('started')
    expect(first.phase).toBe(titles[0])
    expect(first.prompt).toBeUndefined()
    expect(JSON.parse(rows[1] ?? '{}')).toEqual({ type: 'failed', agentId: first.agentId })
    expect(s.files[r.scriptPath]).toBe(input.script)
  })

  test('refus du moteur : texte enregistré gardé', () => {
    const refusal =
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
    const s = anonymize(
      scenario([call('mcp__ssh-bridge__ssh_ls', 'toolu_1', { host: M1 }, refusal, { isError: true })]),
      newDict(),
    )
    expect(textOf(calls(s)[0] as Call)).toBe(refusal)
  })

  test('lorem : largeur gardée, aucun chiffre ni @', () => {
    const out = lorem('a@b.example 192.168.1.1 漢字')
    expect(stringWidth(out)).toBe(stringWidth('a@b.example 192.168.1.1 漢字'))
    expect(out).not.toMatch(/[0-9@]/)
  })
})

describe('assertClean', () => {
  test('lève sur une entrée de la liste noire, quelle que soit la casse', () => {
    expect(() => assertClean('rien à signaler sur Machine-Reelle-1', DENY)).toThrow()
  })
  test('lève sur /home/<autre que user>', () => {
    expect(() => assertClean('voir /home/autre/x', [])).toThrow()
    expect(() => assertClean('voir /home/user/x', [])).not.toThrow()
  })
  // Jetons écrits en deux morceaux : le grep d'hygiène et gitleaks ne doivent pas les voir dans le dépôt.
  for (const [name, text] of [
    ['adresse e-mail', 'écrire à prenom.nom@exemple.fr'],
    ['adresse IPv4', 'connexion 10.20.30.40 ok'],
    ['jeton sk-', `clé ${'sk'}-abcdefghijklmnop1234`],
    ['jeton ghp_', `${'gh'}p_abcdefghijklmnopqrstuvwxyz0123`],
    ['jeton xox', `${'xo'}xb-1234567890-abcdefghij`],
    ['clé AKIA', `${'AK'}IAABCDEFGHIJKLMNOP`],
    ['suite hexadécimale longue', 'd41d8cd98f00b204e9800998ecf8427ed41d8cd9'],
    ['suite base64 longue', `${'QmFzZTY0U2Vjcm'}V0VmFsdWVXaXRoTnVtYmVyczEyMzQ1Njc4OQ==`],
  ] as const)
    test(`lève sur ${name}`, () => {
      expect(() => assertClean(text, [])).toThrow()
    })
  test('le message d’erreur ne recopie pas la chaîne trouvée', () => {
    expect(() => assertClean('x machine-reelle-1 y', DENY)).toThrow(/liste noire/)
    try {
      assertClean('x machine-reelle-1 y', DENY)
    } catch (e) {
      expect(String(e)).not.toContain('machine-reelle-1')
    }
  })
  test('un texte anonymisé passe', () => {
    expect(() =>
      assertClean('host-a toolu_r0001 /home/user/x 00000000-0000-4000-8000-000000000001', DENY),
    ).not.toThrow()
  })
})

describe('assertKnownForms', () => {
  test('lève sur une chaîne inconnue dans un champ affiché, sans la recopier', () => {
    const raw: Scenario = {
      id: 'essai-0001',
      source: 'replay',
      files: {},
      events: [
        {
          t: 0,
          kind: 'tool.call',
          tool: 'Agent',
          toolUseId: 'toolu_r0001',
          input: { description: 'Zorglub Quintessence Hypervelocite' },
          result: { result: 'ok', text: 'ok' },
          afterMs: 0,
        },
      ],
    }
    expect(() => assertKnownForms(raw)).toThrow(/forme inconnue/)
    try {
      assertKnownForms(raw)
    } catch (e) {
      expect(String(e)).not.toContain('Zorglub')
    }
  })
  test('lève sur une clé inconnue', () => {
    const raw: Scenario = { id: 'essai-0002', source: 'replay', files: { '/home/user/Zorglub.md': '' }, events: [] }
    expect(() => assertKnownForms(raw)).toThrow(/forme inconnue/)
  })
})

describe('isBridgeCommand et classifyLine', () => {
  for (const [command, expected] of [
    ['bridge-mcp tool ssh_ls host=a', true],
    ['./target/debug/bridge-mcp exec a ls', true],
    ['timeout 60 bridge-mcp t ssh_ls host=a', true],
    ["bash -c 'bridge-mcp tool ssh_ls host=a'", true],
    ['cd ~/bridge-mcp && cargo test', false],
    ['echo bridge-mcp', false],
  ] as const)
    test(`${command} → ${expected}`, () => {
      expect(isBridgeCommand(command)).toBe(expected)
    })
  test('classe de la ligne : motif connu ou autre, sans contenu', () => {
    expect(classifyLine('Unknown host: x')).toBe('unknown-host')
    expect(classifyLine('Error: SSH connection failed to x: Connection refused (os error 111)')).toBe('conn-refused')
    expect(classifyLine('tout autre texte')).toBe('other')
  })
})

describe('assertKnownForms : formes gardées', () => {
  test('niveau du journal, numéro de tâche collé, couleurs CSI et clés du journal acceptés', () => {
    const s: Scenario = {
      id: 'essai-0003',
      source: 'replay',
      files: {
        '/home/user/wf/journal.jsonl': '{"type":"started","agentId":"id_r0001","label":"lorem","phase":"ipsum"}',
      },
      events: [
        {
          t: 0,
          kind: 'tool.call',
          tool: 'Agent',
          toolUseId: 'toolu_r0001',
          input: { description: 'T13 lorem', prompt: 'TT1 ipsum' },
          result: { result: 'ok', text: '2000-01-01T00:00:00.000Z \u001b[2mWARN\u001b[0m lorem' },
          afterMs: 0,
        },
      ],
    }
    expect(() => assertKnownForms(s)).not.toThrow()
  })
})

describe('durcissement (revue 1)', () => {
  test('lorem remplace toute lettre et tout chiffre, ASCII ou non, en gardant la largeur', () => {
    for (const text of ['Секретная фраза', '漢字と仮名', 'ｍａｃｈｉｎｅ', 'éèçà ŒÆ', '١٢٣']) {
      const out = lorem(text)
      expect(stringWidth(out)).toBe(stringWidth(text))
      expect(out).toMatch(/^[a-z ]*$/)
    }
  })

  test('une phrase entièrement cyrillique en sortie libre est remplacée', () => {
    const s = anonymize(
      scenario([call('mcp__ssh-bridge__ssh_ls', 'toolu_1', { host: M1 }, 'Секретная фраза здесь')]),
      newDict(),
    )
    expect(textOf(calls(s)[0] as Call)).toMatch(/^[a-z ]+$/)
  })

  test('assertKnownForms refuse un mot non ASCII et un mot court non ASCII', () => {
    const base = (description: string): Scenario => ({
      id: 'essai-0004',
      source: 'replay',
      files: {},
      events: [
        {
          t: 0,
          kind: 'tool.call',
          tool: 'Agent',
          toolUseId: 'toolu_r0001',
          input: { description },
          result: { result: 'ok', text: 'ok' },
          afterMs: 0,
        },
      ],
    })
    expect(() => assertKnownForms(base('Секретная'))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(base('lorem 漢字'))).toThrow(/forme inconnue/)
  })

  test('assertClean : écriture pleine chasse d’une entrée et IPv4 pleine chasse', () => {
    expect(() => assertClean('ｍａｃｈｉｎｅ－ｒｅｅｌｌｅ－１', DENY)).toThrow(/liste noire/)
    expect(() => assertClean('vers １０．２０．３０．４０ ok', [])).toThrow(/IPv4/)
  })

  test('assertClean : séparateurs ignorés de part et d’autre', () => {
    for (const text of [
      'machine_reelle_1',
      'machine.reelle.1',
      'machine reelle 1',
      'machinereelle1',
      'MACHINE-REELLE-1',
    ])
      expect(() => assertClean(`x ${text} y`, DENY)).toThrow(/liste noire/)
  })

  test('nom d’outil hors de la liste du bridge remplacé ; outil connu gardé', () => {
    const s = anonymize(
      scenario([
        call('Bash', 'toolu_1', { command: `bridge-mcp tool ssh_zorglub_secret host=${M1}` }, 'ok'),
        call('Bash', 'toolu_2', { command: `bridge-mcp tool ssh_disk_usage host=${M1}` }, 'ok'),
        call('mcp__autre-bridge-prive__ssh_ls', 'toolu_3', { host: M1 }, 'ok'),
        call('mcp__ssh-bridge__ssh_zorglub_secret', 'toolu_4', { host: M1 }, 'ok'),
      ]),
      newDict(),
    )
    const [a, b, c, d] = calls(s)
    expect(fields(a).command).not.toContain('zorglub')
    expect(fields(b).command).toContain('tool ssh_disk_usage host=host-a')
    expect(c?.tool).not.toContain('autre')
    expect(c?.tool).not.toContain('prive')
    expect(d?.tool.startsWith('mcp__ssh-bridge__')).toBe(true)
    expect(d?.tool).not.toContain('zorglub')
    expect(() => assertKnownForms(s)).not.toThrow()
  })

  test('assertKnownForms refuse un nom d’outil ou de serveur hors liste', () => {
    const one = (tool: string, input: unknown): Scenario => ({
      id: 'essai-0005',
      source: 'replay',
      files: {},
      events: [
        {
          t: 0,
          kind: 'tool.call',
          tool,
          toolUseId: 'toolu_r0001',
          input,
          result: { result: 'ok', text: 'ok' },
          afterMs: 0,
        },
      ],
    })
    expect(() => assertKnownForms(one('Bash', { command: 'bridge-mcp tool ssh_zorglub_secret' }))).toThrow(
      /forme inconnue/,
    )
    expect(() => assertKnownForms(one('mcp__prive-bridge__ssh_ls', {}))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(one('mcp__ssh-bridge__ssh_ls', {}))).not.toThrow()
  })
})

// --- Passe C (audit de confidentialité) ---------------------------------------------------------

/** Scénario déjà anonymisé d'un seul appel, pour interroger les barrières. */
const anonCall = (input: unknown, text: string, result: unknown = 'ok'): Scenario => ({
  id: 'essai-0100',
  source: 'replay',
  files: {},
  events: [
    { t: 0, kind: 'tool.call', tool: 'Bash', toolUseId: 'toolu_r0001', input, result: { result, text }, afterMs: 0 },
  ],
})

describe('passe C : horodatages synthétiques (M2)', () => {
  const tracing = (lines: string[]): Scenario =>
    anonymize(
      scenario([
        call('Bash', 'toolu_1', { command: 'bridge-mcp tool ssh_exec host=machine-reelle-1' }, lines.join('\n')),
      ]),
      newDict(),
    )

  test('un horodatage ISO réel ne sort pas d’anonymize : époque 2000-01-01, décalage relatif au scénario', () => {
    const s = tracing([
      '2026-10-21T10:00:00.123456Z  INFO lorem',
      '2026-10-21T10:00:01.623Z  WARN ipsum',
      '2026-10-21T11:00:00Z ERROR dolor',
    ])
    const out = textOf(calls(s)[0] as Call).split('\n')
    expect(json(s)).not.toContain('2026-')
    expect(out[0]?.startsWith('2000-01-01T00:00:00.000Z  INFO ')).toBe(true)
    expect(out[1]?.startsWith('2000-01-01T00:00:01.500Z  WARN ')).toBe(true)
    expect(out[2]?.startsWith('2000-01-01T00:59:59.877Z ERROR ')).toBe(true)
  })

  test('monotone : l’origine est le plus ancien horodatage du scénario, même vu après', () => {
    const s = tracing(['2026-10-21T10:00:05Z  INFO lorem', '2026-10-21T10:00:00Z  INFO ipsum'])
    const out = textOf(calls(s)[0] as Call).split('\n')
    expect(out[0]?.startsWith('2000-01-01T00:00:05.000Z')).toBe(true)
    expect(out[1]?.startsWith('2000-01-01T00:00:00.000Z')).toBe(true)
  })

  test('horodatage illisible (mois 13) : l’époque synthétique, jamais la valeur', () => {
    const s = tracing(['2026-13-45T99:99:99Z  INFO lorem'])
    expect(json(s)).not.toContain('2026-')
    expect(textOf(calls(s)[0] as Call).startsWith('2000-01-01T00:00:00.000Z  INFO ')).toBe(true)
  })

  test('assertKnownForms refuse un horodatage ISO hors de la plage synthétique', () => {
    expect(() => assertKnownForms(anonCall({}, '2026-10-21T10:00:00.123Z  INFO lorem'))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(anonCall({}, '2026-10-21T10:00:00Z  INFO lorem'))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(anonCall({}, '2000-01-01T00:00:01.500Z  INFO lorem'))).not.toThrow()
  })
})

describe('passe C : nombres (L1)', () => {
  test('nombres JSON : codes de sortie, timeout et entiers ≤ 3 chiffres gardés, le reste en 9 de même longueur', () => {
    const result = { exit_code: 1073741819, code: 612345678, small: 42, neg: -7, ratio: 1234.5, timeout: 600000 }
    const s = anonymize(
      scenario([call('Bash', 'toolu_1', { command: 'true', timeout: 600000 }, 'ok', { result })]),
      newDict(),
    )
    const c = calls(s)[0] as Call
    expect(c.input).toMatchObject({ timeout: 600000 })
    const values = Object.values(c.result.result as Record<string, number>)
    expect(values).toEqual([1073741819, 999999999, 42, -7, 9999.5, 600000])
    expect(json(s)).not.toContain('612345678')
  })

  test('mots Bash numériques et k=<chiffres> : ≤ 3 chiffres gardés, sinon des 9 ; timeout gardé', () => {
    const command = [
      'echo 0612345678 && sleep 3600 && timeout 30 ls',
      'bridge-mcp tool ssh_exec host=machine-reelle-1 offset=123456 limit=50 timeout=600000',
      'bridge-mcp --timeout 3600 -n 12345 exec machine-reelle-1 ls',
    ].join('\n')
    const s = anonymize(scenario([call('Bash', 'toolu_1', { command }, 'ok')]), newDict())
    const out = inputOf(s, 0).command?.split('\n') ?? []
    expect(out[0]).toBe('lore 9999999999 && lorem 9999 && timeout 30 lo')
    expect(out[1]).toBe('bridge-mcp tool ssh_exec host=host-a offset=999999 limit=50 timeout=600000')
    expect(out[2]).toBe('bridge-mcp --timeout 3600 -n 99999 exec host-a lo')
    expect(json(s)).not.toContain('0612345678')
    expect(json(s)).not.toContain('123456')
  })

  test('textes connus : code de sortie gardé, autres nombres longs en 9', () => {
    const lines = [
      'Exit code 1073741819',
      'SSH command timeout after 86400s',
      'Output too large (123456KB). Full output saved to: /tmp/x',
    ]
    const s = anonymize(scenario([call('Bash', 'toolu_1', { command: 'true' }, lines.join('\n'))]), newDict())
    expect(textOf(calls(s)[0] as Call).split('\n')).toEqual([
      'Exit code 1073741819',
      'SSH command timeout after 99999s',
      'Output too large (999999KB). Full output saved to: /tmp/l',
    ])
  })

  test('assertKnownForms refuse une suite de ≥ 6 chiffres hors clés blanchies (PIN, téléphone, compte)', () => {
    expect(() => assertKnownForms(anonCall({}, 'lorem 0612345678'))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(anonCall({}, 'ok', { lorem: 123456 }))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(anonCall({ command: 'lorem 1234567' }, 'ok'))).toThrow(/forme inconnue/)
    // Blanchis : timeout, codes de sortie, masques en 9, nombres courts, parties d'UUID synthétiques.
    expect(() =>
      assertKnownForms(
        anonCall(
          { command: 'bridge-mcp --timeout 600000 tool ssh_exec timeout=600000', timeout: 600000 },
          'Exit code 1073741819\n[exit:2] lorem 999999 12345\n00000000-0000-4000-8000-000000000001',
          { exit_code: 1073741819, lorem: 999999, timeout: 600000, ipsum: 12 },
        ),
      ),
    ).not.toThrow()
  })
})

describe('passe C : barrière, UUID, IPv6 compressée, MAC (L3)', () => {
  const REAL_UUID = 'deadbeef-cafe-4bad-9fed-0123456789ab'
  const SYNTH_UUID = '00000000-0000-4000-8000-000000000001'

  test('assertKnownForms : seul l’UUID synthétique est blanchi', () => {
    expect(() => assertKnownForms(anonCall({}, `lorem ${REAL_UUID}`))).toThrow(/forme inconnue/)
    expect(() => assertKnownForms(anonCall({}, `lorem ${SYNTH_UUID}`))).not.toThrow()
  })

  test('assertClean : UUID non synthétique, IPv6 compressée et MAC à tirets refusés, sans recopie', () => {
    for (const leak of [
      REAL_UUID,
      'fe80::1',
      '::1',
      '2001:db8::ff00:42:8329',
      'fe80::1ff:fe23:4567:890a',
      '00-1A-2B-3C-4D-5E',
    ]) {
      expect(() => assertClean(`lorem ${leak} ipsum`, DENY)).toThrow()
      try {
        assertClean(`lorem ${leak} ipsum`, DENY)
      } catch (e) {
        expect(String(e)).not.toContain(leak)
      }
    }
  })

  test('assertClean : formes voisines acceptées (UUID synthétique, chemin Rust, ::, heure)', () => {
    for (const ok of [SYNTH_UUID, 'loremi_psu::mdo: sit', 'a :: b', 'std::fs::read', '10:00:01', 'lo-re-mi-ps-um']) {
      expect(() => assertClean(`lorem ${ok} ipsum`, DENY)).not.toThrow()
    }
  })
})

describe('passe C : dossiers de projet et composants courts par le dictionnaire (L2)', () => {
  test('dossier de projet → -home-user-proj-a, -proj-b dans l’ordre d’apparition, stable dans le scénario', () => {
    const p1 = '/home/quelquun/.claude/projects/-home-quelquun-projet-tres-secret/x.jsonl'
    const p2 = '/tmp/claude-1000/-home-quelquun-autre-projet/tasks/y.output'
    const s = anonymize(
      scenario([
        call('Read', 'toolu_1', { file_path: p1 }, 'ok'),
        call('Read', 'toolu_2', { file_path: p2 }, 'ok'),
        call('Read', 'toolu_3', { file_path: p1 }, 'ok'),
      ]),
      newDict(),
    )
    const [a, b, c] = [0, 1, 2].map((i) => inputOf(s, i).file_path ?? '')
    expect(a.split('/')[5]).toBe('-home-user-proj-a')
    expect(b.split('/')[3]).toBe('-home-user-proj-b')
    expect(c).toBe(a)
    expect(json(s)).not.toContain('secret')
    expect(() => assertKnownForms(s)).not.toThrow()
  })

  test('dossier personnel seul (-home-<nom>) → -home-user', () => {
    const s = anonymize(
      scenario([
        call('Read', 'toolu_1', { file_path: '/home/quelquun/.claude/projects/-home-quelquun/z.jsonl' }, 'ok'),
      ]),
      newDict(),
    )
    expect(inputOf(s, 0).file_path?.split('/')[5]).toBe('-home-user')
  })

  test('composant de 1-2 caractères ASCII : plus gardé tel quel (dictionnaire du scénario)', () => {
    const s = anonymize(
      scenario([
        call('Read', 'toolu_1', { file_path: '/srv/Qz/x7.md' }, 'ok'),
        call('Read', 'toolu_2', { file_path: '/srv/Qz/y.md' }, 'ok'),
      ]),
      newDict(),
    )
    const [a, b] = [0, 1].map((i) => (inputOf(s, i).file_path ?? '').split('/'))
    expect(a?.[2]).not.toBe('Qz')
    expect(a?.[2]).toBe(b?.[2])
    expect(a?.[3]).not.toBe('x7.md')
    expect(a?.[3]?.endsWith('.md')).toBe(true)
    expect(json(s)).not.toContain('Qz')
  })
})

describe('passe C : refus relevés à la régénération', () => {
  test('« final review » gardé seulement en mot entier (pas « final reviewer »)', () => {
    const s = anonymize(
      scenario([
        call('Agent', 'toolu_1', { description: 'final reviewer', prompt: 'the final reviews; final review' }, 'ok'),
      ]),
      newDict(),
    )
    expect(inputOf(s, 0).description).not.toContain('review')
    expect(inputOf(s, 0).prompt?.endsWith('final review')).toBe(true)
    expect(() => assertKnownForms(s)).not.toThrow()
  })

  test('identifiant de modèle daté (resolvedModel) accepté ; 8 chiffres ailleurs refusés', () => {
    expect(() =>
      assertKnownForms(anonCall({}, 'ok', { resolvedModel: 'claude-sonnet-4-20250514', model: 'opus' })),
    ).not.toThrow()
    expect(() => assertKnownForms(anonCall({}, 'lorem 20250514'))).toThrow(/forme inconnue/)
  })
})
