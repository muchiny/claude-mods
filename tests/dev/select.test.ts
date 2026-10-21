import { describe, expect, test } from 'claude-code/testing'
import type { RawEvent } from '../../dev/replay/anonymize'
import { interesting, signature, TranscriptScan, windows } from '../../dev/replay/select'

// Lignes de transcript fabriquées (forme réelle, contenu fictif).
const ts = (s: number) => new Date(Date.UTC(2026, 9, 21, 10, 0, s)).toISOString()
const use = (s: number, id: string, name: string, input: unknown, agentId?: string) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts(s),
    ...(agentId === undefined ? {} : { agentId }),
    message: { content: [{ type: 'tool_use', id, name, input }] },
  })
const result = (s: number, id: string, text: string, extra: { isError?: boolean; toolUseResult?: unknown } = {}) =>
  JSON.stringify({
    type: 'user',
    timestamp: ts(s),
    toolUseResult: extra.toolUseResult,
    message: { content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: extra.isError }] },
  })
const turn = (s: number) => JSON.stringify({ type: 'system', subtype: 'turn_duration', timestamp: ts(s) })
const notice = (s: number, body: string) =>
  JSON.stringify({
    type: 'user',
    timestamp: ts(s),
    message: { content: `<task-notification>\n${body}\n</task-notification>` },
  })

const scan = (lines: string[]): RawEvent[] => {
  const t = new TranscriptScan()
  for (const line of lines) t.line(line)
  return t.finish()
}

describe('interesting', () => {
  test('bridge CLI et MCP, Workflow, Agent, skill Superpowers, écriture sous docs/superpowers', () => {
    expect(interesting('Bash', { command: 'bridge-mcp tool ssh_ls host=a' })).toBe(true)
    expect(interesting('Bash', { command: 'ls -la' })).toBe(false)
    expect(interesting('mcp__ssh-bridge__ssh_ls', { host: 'a' })).toBe(true)
    expect(interesting('mcp__autre__outil', {})).toBe(false)
    expect(interesting('Skill', { skill: 'superpowers:writing-plans' })).toBe(true)
    expect(interesting('Skill', { skill: 'autre' })).toBe(false)
    expect(interesting('Write', { file_path: '/p/docs/superpowers/plans/a.md' })).toBe(true)
    expect(interesting('Write', { file_path: '/p/src/a.ts' })).toBe(false)
    expect(interesting('Workflow', {})).toBe(true)
    expect(interesting('Agent', {})).toBe(true)
  })
})

describe('TranscriptScan', () => {
  test('appel apparié à son résultat ; appel sans résultat et outil non suivi écartés', () => {
    const events = scan([
      use(0, 'toolu_1', 'Bash', { command: 'bridge-mcp tool ssh_ls host=a' }),
      use(1, 'toolu_2', 'Read', { file_path: '/x' }),
      result(2, 'toolu_1', 'Exit code 3\nUnknown host: a', { isError: true, toolUseResult: 'Error: Exit code 3' }),
      use(3, 'toolu_3', 'Agent', { description: 'd' }),
      'ligne illisible',
      turn(4),
    ])
    expect(events.map((e) => e.kind)).toEqual(['tool.call', 'turn.complete'])
    expect(events[0]).toMatchObject({
      tool: 'Bash',
      toolUseId: 'toolu_1',
      doneAt: Date.parse(ts(2)),
      result: { isError: true, result: 'Error: Exit code 3', text: 'Exit code 3\nUnknown host: a' },
    })
  })

  test('agentId d’un sous-agent porté par l’appel ; notification de tâche retenue', () => {
    const events = scan([
      use(0, 'toolu_1', 'mcp__ssh-bridge__ssh_ls', { host: 'a' }, 'ag1'),
      result(1, 'toolu_1', 'ok'),
      notice(2, '<task-id>t1</task-id>\n<status>completed</status>'),
    ])
    expect(events[0]).toMatchObject({ agentId: 'ag1', result: { result: 'ok', text: 'ok' } })
    expect(events[1]).toMatchObject({ kind: 'session.append' })
  })
})

describe('windows', () => {
  test('appels bridge d’un tour jusqu’à sa fin ; workflow avec sa notification', () => {
    const events = scan([
      use(0, 'toolu_1', 'Bash', { command: 'bridge-mcp tool ssh_ls host=a' }),
      result(1, 'toolu_1', 'ok'),
      use(2, 'toolu_2', 'mcp__ssh-bridge__ssh_ls', { host: 'b' }),
      result(3, 'toolu_2', 'ok'),
      turn(4),
      use(5, 'toolu_3', 'Workflow', { name: 'w' }),
      result(6, 'toolu_3', 'lancé', { toolUseResult: { status: 'async_launched', taskId: 't9' } }),
      notice(9, '<task-id>t9</task-id>\n<status>completed</status>'),
    ])
    const found = windows(events)
    expect(found.map((c) => [c.type, c.events.length])).toEqual([
      ['bridge-cli', 3],
      ['workflow', 2],
    ])
    expect(found[0]?.signature).toBe('bridge-cli|cli:tool/ssh_ls:ok:other mcp:ssh_ls:ok:other turn')
    expect(found[0]?.id).toMatch(/^bridge-cli-[0-9a-f]{8}$/)
  })

  test('suite Superpowers : skills, plan, agents ; répétitions écrites une fois', () => {
    const events = scan([
      use(0, 'toolu_1', 'Skill', { skill: 'superpowers:writing-plans' }),
      result(1, 'toolu_1', 'ok'),
      use(2, 'toolu_2', 'Edit', { file_path: '/p/docs/superpowers/plans/a.md' }),
      result(3, 'toolu_2', 'ok'),
      use(4, 'toolu_3', 'Agent', { description: 'Task 1' }),
      result(5, 'toolu_3', 'ok', { toolUseResult: { status: 'completed' } }),
      use(6, 'toolu_4', 'Agent', { description: 'Task 2' }),
      result(7, 'toolu_4', 'ok', { toolUseResult: { status: 'completed' } }),
    ])
    const [run] = windows(events)
    expect(run?.type).toBe('superpowers')
    expect(run?.filePaths).toEqual(['/p/docs/superpowers/plans/a.md'])
    expect(run?.signature).toBe('superpowers|skill:superpowers:writing-plans edit:plans:ok agent:task:completed+')
  })

  test('même signature, même id ; agent hors suite seul', () => {
    const one = scan([use(0, 'toolu_1', 'Agent', { description: 'x' }), result(1, 'toolu_1', 'ok')])
    const two = scan([use(5, 'toolu_9', 'Agent', { description: 'y' }), result(9, 'toolu_9', 'ok')])
    const [a] = windows(one)
    const [b] = windows(two)
    expect(a?.type).toBe('agent')
    expect(a?.id).toBe(b?.id as string)
    expect(signature('agent', one)).toBe('agent|agent:plain:?')
  })
})
