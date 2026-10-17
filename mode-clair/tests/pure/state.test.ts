import { describe, expect, test } from 'claude-code/testing'
import type { Outcome, ParsedCall } from '../../hooks/bridge'
import * as S from '../../hooks/state'
import type { CallState, ClairState, Superpowers, Waiting, Workflow } from '../../types'

describe('la table des états (spec §5.4)', () => {
  test('les dix-sept lignes de la spec, signe, ton et colonnes tels quels', () => {
    const row = (
      sign: S.StateRow['sign'],
      tone: S.StateRow['tone'],
      inLook: boolean,
      counted: boolean,
      isCall: boolean,
      label: string,
    ): S.StateRow => ({ sign, tone, inLook, counted, isCall, label })
    expect(S.STATE_TABLE['en-cours']).toStrictEqual(row('●', 'accent', false, false, true, 'en cours'))
    expect(S.STATE_TABLE.fait).toStrictEqual(row('✓', 'ok', false, false, true, 'fait'))
    expect(S.STATE_TABLE.code).toStrictEqual(row('✓', 'texte', false, false, true, 'code'))
    expect(S.STATE_TABLE.injoignable).toStrictEqual(row('✗', 'erreur', true, true, false, 'injoignable'))
    expect(S.STATE_TABLE['machine-inconnue']).toStrictEqual(row('✗', 'erreur', true, true, false, 'machine inconnue'))
    expect(S.STATE_TABLE.refuse).toStrictEqual(row('✗', 'erreur', true, true, false, 'refusé'))
    expect(S.STATE_TABLE.limite).toStrictEqual(row('✗', 'attention', true, true, false, 'limité'))
    expect(S.STATE_TABLE['confirmation-impossible']).toStrictEqual(
      row('✗', 'erreur', true, true, false, 'confirmation impossible'),
    )
    expect(S.STATE_TABLE['confirmation-manquante']).toStrictEqual(
      row('✗', 'attention', true, true, false, 'confirmation manquante'),
    )
    expect(S.STATE_TABLE['echec-machine']).toStrictEqual(row('✗', 'erreur', true, true, true, 'échec sur la machine'))
    expect(S.STATE_TABLE.echec).toStrictEqual(row('✗', 'erreur', true, true, true, 'échec'))
    expect(S.STATE_TABLE['erreur-usage']).toStrictEqual(row('✗', 'attention', true, false, false, 'erreur d’usage'))
    expect(S.STATE_TABLE['erreur-config']).toStrictEqual(row('✗', 'attention', true, false, false, 'erreur de config'))
    expect(S.STATE_TABLE['refuse-claude']).toStrictEqual(
      row('○', 'attenue', false, false, false, 'refusé par Claude Code'),
    )
    expect(S.STATE_TABLE.decline).toStrictEqual(row('○', 'attenue', false, false, false, 'décliné'))
    expect(S.STATE_TABLE.interrompu).toStrictEqual(row('○', 'attenue', false, false, true, 'interrompu'))
    expect(S.STATE_TABLE.incertain).toStrictEqual(row('?', 'attenue', false, false, true, 'incertain'))
  })

  test('accès refusé et délai dépassé, ajoutés par l’amendement A8', () => {
    expect(S.STATE_TABLE['acces-refuse']).toStrictEqual({
      sign: '✗',
      tone: 'erreur',
      inLook: true,
      counted: true,
      isCall: false,
      label: 'accès refusé',
    })
    expect(S.STATE_TABLE['delai-depasse']).toStrictEqual({
      sign: '✗',
      tone: 'attention',
      inLook: true,
      counted: true,
      isCall: true,
      label: 'délai dépassé',
    })
  })

  test('exactement les dix-neuf états du contrat, et un état vide', () => {
    const states: CallState[] = [
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
    expect(Object.keys(S.STATE_TABLE).sort()).toStrictEqual([...states].sort())
    expect(S.MAX_CALLS).toBe(200)
    expect(S.EMPTY).toStrictEqual({
      calls: [],
      hostOrder: [],
      seenAt: 0,
      waiting: null,
      superpowers: null,
      workflows: [],
      sessions: {},
    })
  })
})

/** Un appel MCP direct (outils et machines réels : spec §4.2-4.3, configuration bridge de l'utilisateur). */
function mcp(tool: string, host: string | null, nature: ParsedCall['nature'] = 'lecture'): ParsedCall {
  return { via: 'mcp', tool, host, nature, accordByOption: false, ownsExit: true, inLoop: false }
}

/** Un segment `bridge-mcp …` d'une ligne Bash. */
function cli(tool: string, host: string | null, accordByOption: boolean): ParsedCall {
  return { via: 'cli', tool, host, nature: 'peut-modifier', accordByOption, ownsExit: true, inLoop: false }
}

describe('startCalls', () => {
  test('un appel MCP devient en cours, identifiant toolUseId#0', () => {
    const s = S.startCalls(S.EMPTY, 'toolu_a', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1_000)
    expect(s.calls).toStrictEqual([
      {
        id: 'toolu_a#0',
        toolUseId: 'toolu_a',
        via: 'mcp',
        tool: 'ssh_disk_usage',
        host: 'raspberry',
        nature: 'lecture',
        state: 'en-cours',
        truncated: false,
        accord: 'aucun',
        startedAt: 1_000,
      },
    ])
    expect(s.hostOrder).toStrictEqual(['raspberry'])
  })

  test('une ligne CLI à deux segments donne #0 et #1 ; --yes note l’accord par option', () => {
    const s = S.startCalls(
      S.EMPTY,
      'toolu_b',
      undefined,
      [cli('exec', 'raspberry', false), cli('ssh_exec', 'win2025', true)],
      2_000,
    )
    expect(s.calls.map((c) => [c.id, c.via, c.tool, c.host, c.accord])).toStrictEqual([
      ['toolu_b#0', 'cli', 'exec', 'raspberry', 'aucun'],
      ['toolu_b#1', 'cli', 'ssh_exec', 'win2025', 'option'],
    ])
  })

  test('agentId noté seulement quand il est donné', () => {
    const main = S.startCalls(S.EMPTY, 'toolu_c', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    const agent = S.startCalls(S.EMPTY, 'toolu_c', 'agent-7', [mcp('ssh_disk_usage', 'raspberry')], 1)
    expect('agentId' in (main.calls[0] ?? {})).toBe(false)
    expect(agent.calls[0]?.agentId).toBe('agent-7')
  })

  test('ordre des machines : à la première apparition seulement, jamais pour une machine inconnue', () => {
    let s = S.startCalls(
      S.EMPTY,
      'toolu_1',
      undefined,
      [mcp('ssh_disk_usage', 'raspberry'), mcp('ssh_disk_usage', null), mcp('ssh_disk_usage', 'raspberry')],
      1,
    )
    s = S.startCalls(s, 'toolu_2', undefined, [mcp('ssh_win_disk_usage', 'win2025')], 2)
    s = S.startCalls(s, 'toolu_3', undefined, [mcp('ssh_disk_usage', 'raspberry')], 3)
    expect(s.hostOrder).toStrictEqual(['raspberry', 'win2025'])
    expect(S.hostIndex(s, 'raspberry')).toBe(0)
    expect(S.hostIndex(s, 'win2025')).toBe(1)
    expect(S.hostIndex(s, 'win2012')).toBe(-1)
  })

  test('ssh_session_exec : l’hôte vient de la session retenue, sinon machine inconnue', () => {
    const exec: ParsedCall = { ...mcp('ssh_session_exec', null, 'peut-modifier'), sessionId: 'sess-1' }
    const known = S.startCalls(S.rememberSession(S.EMPTY, 'sess-1', 'raspberry'), 'toolu_s', undefined, [exec], 1)
    expect(known.calls[0]?.host).toBe('raspberry')
    expect(known.hostOrder).toStrictEqual(['raspberry'])
    const unknown = S.startCalls(S.rememberSession(S.EMPTY, 'sess-2', 'raspberry'), 'toolu_s', undefined, [exec], 1)
    expect(unknown.calls[0]?.host).toBeNull()
    expect(unknown.hostOrder).toStrictEqual([])
  })

  test('rien à suivre, ou appels déjà commencés pour ce toolUseId : même référence', () => {
    expect(S.startCalls(S.EMPTY, 'toolu_d', undefined, [], 1)).toBe(S.EMPTY)
    const s = S.startCalls(S.EMPTY, 'toolu_d', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    expect(S.startCalls(s, 'toolu_d', undefined, [mcp('ssh_disk_usage', 'raspberry')], 2)).toBe(s)
  })
})

describe('rememberSession et callsOf', () => {
  test('rememberSession retient l’hôte ; même couple : même référence', () => {
    const s = S.rememberSession(S.EMPTY, 'sess-1', 'raspberry')
    expect(s.sessions).toStrictEqual({ 'sess-1': 'raspberry' })
    expect(S.rememberSession(s, 'sess-1', 'raspberry')).toBe(s)
    expect(S.rememberSession(s, 'sess-1', 'win2025').sessions).toStrictEqual({ 'sess-1': 'win2025' })
    expect(S.rememberSession(s, 'sess-2', 'win2025').sessions).toStrictEqual({
      'sess-1': 'raspberry',
      'sess-2': 'win2025',
    })
  })

  test('callsOf : les appels d’un tool_use_id, dans l’ordre des rangs', () => {
    let s = S.startCalls(
      S.EMPTY,
      'toolu_m',
      undefined,
      [mcp('ssh_exec_multi', 'raspberry', 'peut-modifier'), mcp('ssh_exec_multi', 'win2025', 'peut-modifier')],
      1,
    )
    s = S.startCalls(s, 'toolu_n', undefined, [mcp('ssh_disk_usage', 'raspberry')], 2)
    expect(S.callsOf(s, 'toolu_m').map((c) => c.id)).toStrictEqual(['toolu_m#0', 'toolu_m#1'])
    expect(S.callsOf(s, 'toolu_x')).toStrictEqual([])
  })
})

describe('le plafond de 200 appels, appels en cours', () => {
  test('tout est en cours : rien n’est évincé, au-delà du plafond', () => {
    let s = S.EMPTY
    for (let i = 0; i < 201; i++) s = S.startCalls(s, `toolu_r${i}`, undefined, [mcp('ssh_disk_usage', 'raspberry')], i)
    expect(s.calls).toHaveLength(201)
    expect(s.calls[0]?.id).toBe('toolu_r0#0')
  })
})

const FAIT: Outcome = { state: 'fait', truncated: false }

describe('finishCalls', () => {
  test('chaque appel reçoit l’issue de son rang, code et raison compris', () => {
    let s = S.startCalls(
      S.EMPTY,
      'toolu_f',
      undefined,
      [mcp('ssh_disk_usage', 'raspberry'), mcp('ssh_service_status', 'win2025')],
      1_000,
    )
    // [exit:1] d'un outil à code distant avec isError (bridge-facts §6.3) ; texte de §3.7, non traduit.
    s = S.finishCalls(
      s,
      'toolu_f',
      [
        { state: 'echec-machine', code: 1, truncated: false },
        {
          state: 'echec',
          truncated: false,
          reason: "Tool 'ssh_service_status' is not available on Windows hosts. Use Windows-specific tools instead.",
        },
      ],
      1_400,
    )
    expect(s.calls).toStrictEqual([
      {
        id: 'toolu_f#0',
        toolUseId: 'toolu_f',
        via: 'mcp',
        tool: 'ssh_disk_usage',
        host: 'raspberry',
        nature: 'lecture',
        state: 'echec-machine',
        code: 1,
        truncated: false,
        accord: 'aucun',
        startedAt: 1_000,
        endedAt: 1_400,
      },
      {
        id: 'toolu_f#1',
        toolUseId: 'toolu_f',
        via: 'mcp',
        tool: 'ssh_service_status',
        host: 'win2025',
        nature: 'lecture',
        state: 'echec',
        truncated: false,
        reason: "Tool 'ssh_service_status' is not available on Windows hosts. Use Windows-specific tools instead.",
        accord: 'aucun',
        startedAt: 1_000,
        endedAt: 1_400,
      },
    ])
  })

  test('une nouvelle issue remplace l’ancienne sans laisser de code ni de raison', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_g', 'agent-2', [mcp('ssh_service_status', 'raspberry')], 10)
    // ssh_service_status rend [exit:3] sans erreur : `code 3` (amendement A7) ; texte de bridge-facts §3.9.
    s = S.finishCalls(
      s,
      'toolu_g',
      [{ state: 'code', code: 3, truncated: false, reason: 'Unit foo.service could not be found.' }],
      20,
    )
    s = S.finishCalls(s, 'toolu_g', [{ state: 'fait', truncated: true }], 30)
    expect(s.calls).toStrictEqual([
      {
        id: 'toolu_g#0',
        toolUseId: 'toolu_g',
        agentId: 'agent-2',
        via: 'mcp',
        tool: 'ssh_service_status',
        host: 'raspberry',
        nature: 'lecture',
        state: 'fait',
        truncated: true,
        accord: 'aucun',
        startedAt: 10,
        endedAt: 30,
      },
    ])
  })

  test('issue manquante : incertain ; appel d’un autre tool_use_id intact', () => {
    let s = S.startCalls(
      S.EMPTY,
      'toolu_h',
      undefined,
      [cli('exec', 'raspberry', false), cli('ssh_exec', 'raspberry', false)],
      1,
    )
    s = S.startCalls(s, 'toolu_i', undefined, [mcp('ssh_disk_usage', 'win2025')], 2)
    const other = s.calls[2]
    s = S.finishCalls(s, 'toolu_h', [FAIT], 3)
    expect(s.calls.map((c) => [c.state, c.truncated])).toStrictEqual([
      ['fait', false],
      ['incertain', false],
      ['en-cours', false],
    ])
    expect(s.calls[2]).toBe(other)
  })

  test('même issue une seconde fois, ou tool_use_id inconnu : même référence', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_j', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.finishCalls(s, 'toolu_j', [{ state: 'echec-machine', code: 1, truncated: false }], 2)
    expect(S.finishCalls(s, 'toolu_j', [{ state: 'echec-machine', code: 1, truncated: false }], 9)).toBe(s)
    expect(S.finishCalls(s, 'toolu_inconnu', [FAIT], 9)).toBe(s)
    expect(S.finishCalls(s, 'toolu_j', [{ state: 'echec-machine', code: 2, truncated: false }], 9)).not.toBe(s)
    expect(S.finishCalls(s, 'toolu_j', [{ state: 'echec-machine', code: 1, truncated: true }], 9)).not.toBe(s)
    expect(
      S.finishCalls(
        s,
        'toolu_j',
        [{ state: 'echec-machine', code: 1, truncated: false, reason: 'Unit foo.service could not be found.' }],
        9,
      ),
    ).not.toBe(s)
    expect(S.finishCalls(s, 'toolu_j', [{ state: 'echec', code: 1, truncated: false }], 9)).not.toBe(s)
  })

  test('un refus de Claude Code reste un refus, quel que soit l’ordre', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_k', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1)
    s = S.refuseByClaude(s, 'toolu_k', 2)
    expect(S.finishCalls(s, 'toolu_k', [{ state: 'echec', truncated: false }], 3)).toBe(s)
  })

  test('interrompu par le filet du turn.complete, puis vraie fin : la vraie issue gagne', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_l', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.interruptOpen(s, undefined, 2)
    s = S.finishCalls(s, 'toolu_l', [FAIT], 3)
    expect(s.calls[0]?.state).toBe('fait')
    expect(s.calls[0]?.endedAt).toBe(3)
  })

  test('l’attente « à toi » s’efface quand l’appel attendu se termine, pas avant', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_e', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1)
    s = S.startCalls(s, 'toolu_o', undefined, [mcp('ssh_disk_usage', 'win2025')], 1)
    s = S.setWaiting(s, { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_e#0', since: 2 })
    expect(S.finishCalls(s, 'toolu_o', [FAIT], 3).waiting).toStrictEqual({
      tool: 'ssh_exec',
      host: 'raspberry',
      callId: 'toolu_e#0',
      since: 2,
    })
    expect(S.finishCalls(s, 'toolu_e', [{ state: 'decline', truncated: false }], 3).waiting).toBeNull()
    const lost = S.setWaiting(s, { tool: 'ssh_exec', host: null, callId: null, since: 2 })
    expect(S.finishCalls(lost, 'toolu_e', [FAIT], 3).waiting).toStrictEqual({
      tool: 'ssh_exec',
      host: null,
      callId: null,
      since: 2,
    })
  })

  test('appel déjà terminé dont l’attente pointe encore dessus : seule l’attente change', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_p', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1)
    s = S.finishCalls(s, 'toolu_p', [FAIT], 2)
    s = S.setWaiting(s, { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_p#0', since: 3 })
    const after = S.finishCalls(s, 'toolu_p', [FAIT], 4)
    expect(after).not.toBe(s)
    expect(after.waiting).toBeNull()
    expect(after.calls[0]).toBe(s.calls[0])
  })
})

describe('refuseByClaude et interruptOpen', () => {
  test('refus : tous les appels du tool_use_id, terminés ou non, sans code ni raison', () => {
    let s = S.startCalls(
      S.EMPTY,
      'toolu_q',
      undefined,
      [cli('ssh_exec', 'raspberry', true), cli('exec', 'win2025', false)],
      1,
    )
    s = S.finishCalls(
      s,
      'toolu_q',
      [{ state: 'echec-machine', code: 1, truncated: true, reason: 'Unit foo.service could not be found.' }],
      2,
    )
    s = S.setWaiting(s, { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_q#0', since: 1 })
    const r = S.refuseByClaude(s, 'toolu_q', 5)
    expect(r.calls).toStrictEqual([
      {
        id: 'toolu_q#0',
        toolUseId: 'toolu_q',
        via: 'cli',
        tool: 'ssh_exec',
        host: 'raspberry',
        nature: 'peut-modifier',
        state: 'refuse-claude',
        truncated: false,
        accord: 'option',
        startedAt: 1,
        endedAt: 5,
      },
      {
        id: 'toolu_q#1',
        toolUseId: 'toolu_q',
        via: 'cli',
        tool: 'exec',
        host: 'win2025',
        nature: 'peut-modifier',
        state: 'refuse-claude',
        truncated: false,
        accord: 'aucun',
        startedAt: 1,
        endedAt: 5,
      },
    ])
    expect(r.waiting).toBeNull()
  })

  test('refus sans appel, ou déjà refusé : même référence', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_r', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1)
    expect(S.refuseByClaude(s, 'toolu_autre', 2)).toBe(s)
    s = S.refuseByClaude(s, 'toolu_r', 2)
    expect(S.refuseByClaude(s, 'toolu_r', 3)).toBe(s)
  })

  test('filet de la boucle principale : seuls ses appels en cours deviennent interrompu', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_1', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.startCalls(s, 'toolu_2', 'agent-1', [mcp('ssh_win_disk_usage', 'win2025')], 1)
    s = S.startCalls(s, 'toolu_3', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.finishCalls(s, 'toolu_3', [FAIT], 2)
    s = S.setWaiting(s, { tool: 'ssh_disk_usage', host: 'raspberry', callId: 'toolu_1#0', since: 1 })
    const r = S.interruptOpen(s, undefined, 9)
    expect(r.calls.map((c) => [c.id, c.state, c.truncated, c.endedAt])).toStrictEqual([
      ['toolu_1#0', 'interrompu', false, 9],
      ['toolu_2#0', 'en-cours', false, undefined],
      ['toolu_3#0', 'fait', false, 2],
    ])
    expect(r.waiting).toBeNull()
  })

  test('filet d’un agent : seuls les appels de cet agent', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_1', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.startCalls(s, 'toolu_2', 'agent-1', [mcp('ssh_win_disk_usage', 'win2025')], 1)
    s = S.setWaiting(s, { tool: 'ssh_disk_usage', host: 'raspberry', callId: 'toolu_1#0', since: 1 })
    const r = S.interruptOpen(s, 'agent-1', 9)
    expect(r.calls.map((c) => c.state)).toStrictEqual(['en-cours', 'interrompu'])
    expect(r.waiting).toBe(s.waiting)
  })

  test('filet sans appel en cours dans cette boucle : même référence', () => {
    const s = S.startCalls(S.EMPTY, 'toolu_2', 'agent-1', [mcp('ssh_win_disk_usage', 'win2025')], 1)
    expect(S.interruptOpen(s, undefined, 9)).toBe(s)
    expect(S.interruptOpen(S.EMPTY, 'agent-1', 9)).toBe(S.EMPTY)
  })
})

describe('setWaiting', () => {
  const w: Waiting = { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_e#0', since: 5 }

  test('pose puis efface l’attente ; null sur null : même référence', () => {
    const on = S.setWaiting(S.EMPTY, w)
    expect(on.waiting).toStrictEqual(w)
    expect(S.setWaiting(on, null).waiting).toBeNull()
    expect(S.setWaiting(S.EMPTY, null)).toBe(S.EMPTY)
  })

  test('mêmes valeurs : même référence ; un seul champ différent : nouvel état', () => {
    const on = S.setWaiting(S.EMPTY, w)
    expect(S.setWaiting(on, { ...w })).toBe(on)
    expect(S.setWaiting(on, { ...w, tool: 'ssh_file_write' })).not.toBe(on)
    expect(S.setWaiting(on, { ...w, host: null })).not.toBe(on)
    expect(S.setWaiting(on, { ...w, callId: null })).not.toBe(on)
    expect(S.setWaiting(on, { ...w, since: 6 })).not.toBe(on)
  })
})

describe('running et le plafond de 200 appels', () => {
  /** n appels terminés (fait) sur raspberry, toolu_f0 … toolu_f{n-1}, commencés à partir de t. */
  function finished(s: ClairState, n: number, t: number): ClairState {
    let out = s
    for (let i = 0; i < n; i++) {
      out = S.startCalls(out, `toolu_f${i}`, undefined, [mcp('ssh_disk_usage', 'raspberry')], t + i)
      out = S.finishCalls(out, `toolu_f${i}`, [FAIT], t + i)
    }
    return out
  }

  test('running : tous les appels en cours, ou ceux d’un seul agent', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_1', undefined, [mcp('ssh_disk_usage', 'raspberry')], 1)
    s = S.startCalls(s, 'toolu_2', 'agent-1', [mcp('ssh_win_disk_usage', 'win2025')], 2)
    s = S.startCalls(s, 'toolu_3', undefined, [mcp('ssh_disk_usage', 'raspberry')], 3)
    s = S.finishCalls(s, 'toolu_3', [FAIT], 4)
    expect(S.running(s).map((c) => c.id)).toStrictEqual(['toolu_1#0', 'toolu_2#0'])
    expect(S.running(s, 'agent-1').map((c) => c.id)).toStrictEqual(['toolu_2#0'])
    expect(S.running(s, 'agent-9')).toStrictEqual([])
  })

  test('200 appels : aucun ne part ; le 201e fait partir le plus ancien terminé', () => {
    const full = finished(S.EMPTY, 200, 0)
    expect(full.calls).toHaveLength(200)
    expect(full.calls[0]?.id).toBe('toolu_f0#0')
    const more = S.startCalls(full, 'toolu_new', undefined, [mcp('ssh_disk_usage', 'raspberry')], 500)
    expect(more.calls).toHaveLength(200)
    expect(more.calls[0]?.id).toBe('toolu_f1#0')
    expect(more.calls[199]?.id).toBe('toolu_new#0')
  })

  test('rafale de 12 appels en cours (agents de workflow) puis 200 terminés : les 12 restent', () => {
    let s = S.EMPTY
    for (let i = 1; i <= 12; i++)
      s = S.startCalls(s, `toolu_w${i}`, `agent-${i}`, [mcp('ssh_disk_usage', 'raspberry')], i)
    s = finished(s, 200, 100)
    expect(s.calls).toHaveLength(200)
    expect(S.running(s)).toHaveLength(12)
    expect(S.running(s).map((c) => c.toolUseId)).toContain('toolu_w1')
    expect(s.calls[12]?.id).toBe('toolu_f12#0')
    expect(S.running(s, 'agent-3').map((c) => c.id)).toStrictEqual(['toolu_w3#0'])
  })
})

describe('recordAccord et markSeen', () => {
  test('formulaire-oui seulement quand l’accord est donné, formulaire-non sinon', () => {
    const s = S.startCalls(
      S.EMPTY,
      'toolu_e',
      undefined,
      [mcp('ssh_exec', 'raspberry', 'peut-modifier'), mcp('ssh_exec', 'win2025', 'peut-modifier')],
      1,
    )
    const yes = S.recordAccord(s, 'toolu_e#1', true)
    expect(yes.calls.map((c) => c.accord)).toStrictEqual(['aucun', 'formulaire-oui'])
    expect(yes.calls[0]).toBe(s.calls[0])
    expect(S.recordAccord(s, 'toolu_e#0', false).calls.map((c) => c.accord)).toStrictEqual(['formulaire-non', 'aucun'])
  })

  test('callId null ou inconnu, ou accord déjà noté : même référence', () => {
    const s = S.recordAccord(
      S.startCalls(S.EMPTY, 'toolu_e', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1),
      'toolu_e#0',
      true,
    )
    expect(S.recordAccord(s, null, true)).toBe(s)
    expect(S.recordAccord(s, 'toolu_z#0', false)).toBe(s)
    expect(S.recordAccord(s, 'toolu_e#0', true)).toBe(s)
  })

  test('markSeen pose seenAt ; même heure : même référence', () => {
    const s = S.markSeen(S.EMPTY, 5_000)
    expect(s.seenAt).toBe(5_000)
    expect(S.markSeen(s, 5_000)).toBe(s)
  })
})

describe('withSuperpowers et withWorkflows', () => {
  // Titre et chemin du plan réel de cette version (docs/superpowers/plans).
  const sp: Superpowers = {
    stage: 'plan',
    planTitle: "mode-clair 0.2.0 — plan d'implémentation",
    planPath: 'docs/superpowers/plans/2026-10-15-mode-clair-0.2.md',
    tasks: 0,
    current: null,
    lastEventAt: 1_000,
    isStale: false,
    runningAgents: [],
  }
  const wf: Workflow = {
    key: 'wf_1',
    toolUseId: 'toolu_wf',
    name: 'mode-clair-understand',
    phases: ['Audit'],
    journalPath: null,
    consumed: 0,
    agents: [],
    status: 'en-cours',
    lastGrowthAt: 1_000,
    startedAt: 1_000,
  }

  test('withSuperpowers : f rend la même valeur → même référence, sinon la nouvelle valeur', () => {
    expect(S.withSuperpowers(S.EMPTY, (x) => x)).toBe(S.EMPTY)
    const s = S.withSuperpowers(S.EMPTY, () => sp)
    expect(s.superpowers).toBe(sp)
    expect(S.withSuperpowers(s, () => null).superpowers).toBeNull()
  })

  test('withWorkflows : f rend la même liste → même référence, sinon la nouvelle liste', () => {
    expect(S.withWorkflows(S.EMPTY, (list) => list)).toBe(S.EMPTY)
    const s = S.withWorkflows(S.EMPTY, (list) => [...list, wf])
    expect(s.workflows).toStrictEqual([wf])
  })
})

describe('problems, unseenProblems, machines', () => {
  /** Un appel commencé à `t0`, terminé à `t1` avec l'issue `o`. */
  function ran(s: ClairState, id: string, p: ParsedCall, o: Outcome, t0: number, t1: number): ClairState {
    return S.finishCalls(S.startCalls(s, id, undefined, [p], t0), id, [o], t1)
  }

  test('problems : états « à regarder » et appels tronqués, le plus récemment terminé d’abord', () => {
    let s = ran(
      S.EMPTY,
      'toolu_1',
      mcp('ssh_win_disk_usage', 'win2025'),
      { state: 'injoignable', truncated: false },
      1,
      50,
    )
    s = ran(s, 'toolu_2', mcp('ssh_disk_usage', 'raspberry'), FAIT, 2, 3)
    s = ran(s, 'toolu_3', mcp('ssh_disk_usage', 'raspberry'), { state: 'fait', truncated: true }, 4, 10)
    s = ran(s, 'toolu_4', mcp('ssh_exec', 'raspberry', 'peut-modifier'), { state: 'decline', truncated: false }, 5, 6)
    s = ran(s, 'toolu_5', cli('ssh_exec', 'raspberry', false), { state: 'erreur-usage', truncated: false }, 7, 10)
    s = ran(s, 'toolu_6', mcp('ssh_service_status', 'raspberry'), { state: 'code', code: 3, truncated: false }, 8, 9)
    s = S.startCalls(s, 'toolu_7', undefined, [mcp('ssh_disk_usage', 'raspberry')], 11)
    expect(S.problems(s).map((c) => c.toolUseId)).toStrictEqual(['toolu_1', 'toolu_5', 'toolu_3'])
    expect(S.problems(S.EMPTY)).toStrictEqual([])
  })

  test('unseenProblems : seulement les états comptés, terminés après le dernier /clair', () => {
    let s = ran(
      S.EMPTY,
      'toolu_1',
      mcp('ssh_win_disk_usage', 'win2025'),
      { state: 'injoignable', truncated: false },
      1,
      10,
    )
    s = ran(s, 'toolu_2', cli('ssh_exec', 'raspberry', false), { state: 'erreur-usage', truncated: false }, 1, 11)
    s = ran(s, 'toolu_3', mcp('ssh_disk_usage', 'raspberry'), { state: 'fait', truncated: true }, 1, 12)
    s = ran(s, 'toolu_4', mcp('ssh_disk_usage', 'raspberry'), { state: 'delai-depasse', truncated: false }, 1, 20)
    expect(S.unseenProblems(s)).toBe(2)
    expect(S.unseenProblems(S.markSeen(s, 10))).toBe(1)
    expect(S.unseenProblems(S.markSeen(s, 20))).toBe(0)
  })

  test('machines : ordre d’apparition, appels au sens de §5.4, dernier appel, problème non vu', () => {
    let s = ran(
      S.EMPTY,
      'toolu_1',
      mcp('ssh_disk_usage', 'raspberry'),
      { state: 'echec-machine', code: 1, truncated: false },
      1,
      2,
    )
    s = ran(s, 'toolu_2', mcp('ssh_win_disk_usage', 'win2025'), { state: 'injoignable', truncated: false }, 3, 4)
    s = ran(s, 'toolu_3', mcp('ssh_disk_usage', 'raspberry'), FAIT, 5, 6)
    s = ran(s, 'toolu_4', mcp('ssh_disk_usage', 'raspberry'), { state: 'refuse-claude', truncated: false }, 7, 8)
    s = ran(s, 'toolu_5', mcp('ssh_disk_usage', null), FAIT, 9, 10)
    const m = S.machines(s)
    expect(m.map((x) => [x.host, x.index, x.calls, x.last.toolUseId, x.hasUnseenProblem])).toStrictEqual([
      ['raspberry', 0, 2, 'toolu_4', true],
      ['win2025', 1, 0, 'toolu_2', true],
    ])
    expect(S.machines(S.markSeen(s, 2)).map((x) => x.hasUnseenProblem)).toStrictEqual([false, true])
    expect(S.machines(S.EMPTY)).toStrictEqual([])
  })

  test('machines : une machine dont tous les appels ont été évincés disparaît, les index restent', () => {
    let s = ran(S.EMPTY, 'toolu_old', mcp('ssh_win_disk_usage', 'win2025'), FAIT, 0, 0)
    for (let i = 1; i <= 200; i++) s = ran(s, `toolu_${i}`, mcp('ssh_disk_usage', 'raspberry'), FAIT, i, i)
    expect(s.hostOrder).toStrictEqual(['win2025', 'raspberry'])
    expect(S.machines(s).map((x) => [x.host, x.index, x.calls])).toStrictEqual([['raspberry', 1, 200]])
  })
})

describe('pureté', () => {
  test('aucun réducteur ne modifie l’état qu’il reçoit', () => {
    let s = S.startCalls(S.EMPTY, 'toolu_a', undefined, [mcp('ssh_exec', 'raspberry', 'peut-modifier')], 1)
    s = S.setWaiting(s, { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_a#0', since: 1 })
    const before = JSON.stringify(s)
    S.startCalls(s, 'toolu_b', 'agent-1', [mcp('ssh_disk_usage', 'win2025')], 2)
    S.finishCalls(s, 'toolu_a', [FAIT], 3)
    S.refuseByClaude(s, 'toolu_a', 3)
    S.interruptOpen(s, undefined, 3)
    S.setWaiting(s, null)
    S.recordAccord(s, 'toolu_a#0', true)
    S.markSeen(s, 3)
    S.rememberSession(s, 'sess-1', 'raspberry')
    S.withSuperpowers(s, () => null)
    S.withWorkflows(s, () => [])
    expect(JSON.stringify(s)).toBe(before)
    expect(JSON.stringify(S.EMPTY)).toBe(
      '{"calls":[],"hostOrder":[],"seenAt":0,"waiting":null,"superpowers":null,"workflows":[],"sessions":{}}',
    )
  })
})
