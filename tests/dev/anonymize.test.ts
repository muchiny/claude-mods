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
  test('/home/<nom>/x devient /home/user/x', () => {
    const s = anonymize(
      scenario([call('Write', 'toolu_1', { file_path: '/home/quelquun/x', content: 'a' }, 'ok')]),
      newDict(),
    )
    expect(inputOf(s, 0).file_path).toBe('/home/user/x')
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
    expect(pa).toBe('/var/tmp/00000000-0000-4000-8000-000000000001/a.txt')
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
    expect(out[1]?.startsWith('2026-10-21T10:00:00.123456Z  INFO ')).toBe(true)
    expect(out[1]).not.toContain('machine-reelle')
    expect(out[2]).toBe('Error: Unknown host: host-a')
    expect(out[3]).toBe('[exit:2]')
    for (const i of [1, 4, 5]) {
      expect(out[i]).not.toBe(lines[i])
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
          result: { result: 'ok', text: '2026-10-21T10:00:00Z \u001b[2mWARN\u001b[0m lorem' },
          afterMs: 0,
        },
      ],
    }
    expect(() => assertKnownForms(s)).not.toThrow()
  })
})
