import { describe, expect, test } from 'claude-code/testing'

import type { ToolInfo } from '../../hooks/tools.generated'
import { BRIDGE_VERSION, GENERATED_AT, TOOLS } from '../../hooks/tools.generated'

/** Noms des outils qui vérifient `pick`, triés. */
function names(pick: (t: ToolInfo) => boolean): string[] {
  return Object.entries(TOOLS)
    .filter(([, t]) => pick(t))
    .map(([n]) => n)
    .sort()
}

describe('la table des outils, générée depuis bridge-mcp list-tools', () => {
  test('476 outils : les 77 groupes activés (refs/bridge-facts.md §7)', () => {
    expect(Object.keys(TOOLS)).toHaveLength(476)
  })

  test('en-tête : version de bridge-mcp et jour de génération', () => {
    expect(BRIDGE_VERSION).toMatch(/^3\.0\.0 \(rev [0-9a-f]{12}(-dirty)?\)$/)
    expect(GENERATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('ssh_status et les outils locaux au bridge : sans machine (§8)', () => {
    expect(TOOLS['ssh_status']).toEqual({
      hostless: true,
      multi: false,
      session: false,
      nature: 'lecture',
      codeWithoutError: false,
    })
    expect(TOOLS['ssh_output_fetch']?.hostless).toBe(true)
    expect(TOOLS['ssh_session_close']?.hostless).toBe(true)
  })

  test('ssh_history : son host filtre l’historique local, l’outil reste sans machine (exception, §8)', () => {
    expect(TOOLS['ssh_history']).toEqual({
      hostless: true,
      multi: false,
      session: false,
      nature: 'lecture',
      codeWithoutError: false,
    })
  })

  test('ssh_awx_job_relaunch : son hosts vaut all ou failed, ce n’est pas une liste de machines (§7)', () => {
    expect(TOOLS['ssh_awx_job_relaunch']).toEqual({
      hostless: true,
      multi: false,
      session: false,
      nature: 'peut-modifier',
      codeWithoutError: false,
    })
  })

  test('ssh_canary_exec : son hosts est un mémo, la machine est host (§7)', () => {
    expect(TOOLS['ssh_canary_exec']).toEqual({
      hostless: false,
      multi: false,
      session: false,
      nature: 'peut-modifier',
      codeWithoutError: false,
    })
  })

  test('ssh_disk_usage : une machine, en lecture', () => {
    expect(TOOLS['ssh_disk_usage']).toEqual({
      hostless: false,
      multi: false,
      session: false,
      nature: 'lecture',
      codeWithoutError: false,
    })
  })

  test('ssh_exec : peut modifier, rend un code distant sans erreur (§6.1)', () => {
    expect(TOOLS['ssh_exec']).toEqual({
      hostless: false,
      multi: false,
      session: false,
      nature: 'peut-modifier',
      codeWithoutError: true,
    })
  })

  test('multi : seulement les deux outils dont hosts est un tableau de machines (§7)', () => {
    expect(names((t) => t.multi)).toEqual(['ssh_exec_multi', 'ssh_metrics_multi'])
    expect(TOOLS['ssh_exec_multi']).toEqual({
      hostless: false,
      multi: true,
      session: false,
      nature: 'peut-modifier',
      codeWithoutError: true,
    })
    expect(TOOLS['ssh_metrics_multi']).toEqual({
      hostless: false,
      multi: true,
      session: false,
      nature: 'lecture',
      codeWithoutError: false,
    })
  })

  test('session : seulement ssh_session_exec, dont la machine vient de la session (§6.1)', () => {
    expect(names((t) => t.session)).toEqual(['ssh_session_exec'])
    expect(TOOLS['ssh_session_exec']).toEqual({
      hostless: false,
      multi: false,
      session: true,
      nature: 'peut-modifier',
      codeWithoutError: true,
    })
  })

  test('code sans erreur : exactement ssh_exec, ssh_exec_multi et ssh_session_exec (amendement A7)', () => {
    expect(names((t) => t.codeWithoutError)).toEqual(['ssh_exec', 'ssh_exec_multi', 'ssh_session_exec'])
  })

  test('nature tirée de readOnlyHint : 306 lectures, 170 qui peuvent modifier (§6.5)', () => {
    expect(names((t) => t.nature === 'lecture')).toHaveLength(306)
    expect(names((t) => t.nature === 'peut-modifier')).toHaveLength(170)
  })

  test('59 outils sans machine : les 58 de §8, moins ssh_session_exec, plus ssh_history et ssh_awx_job_relaunch', () => {
    expect(names((t) => t.hostless)).toHaveLength(59)
    expect(names((t) => t.hostless)).not.toContain('ssh_session_exec')
  })

  test('les méta-outils MCP ne sont pas des outils du bridge (§6.4)', () => {
    for (const meta of ['mcp_list_tool_groups', 'mcp_search_tools', 'mcp_describe_tool', 'mcp_call_tool']) {
      expect(TOOLS[meta]).toBeUndefined()
    }
  })
})
