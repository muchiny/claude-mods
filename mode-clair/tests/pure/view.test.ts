import { describe, expect, test } from 'claude-code/testing'
import { steps } from '../../hooks/bridge'
import { cellWidth } from '../../hooks/cells'
import { colorOf } from '../../hooks/colors'
import { fr } from '../../hooks/fr'
import { STATE_TABLE, setWaiting } from '../../hooks/state'
import type { Ctx } from '../../hooks/view'
import {
  bandLines,
  callLine,
  cardLines,
  cardText,
  fit,
  modeLabel,
  parseCard,
  pipeline,
  statusText,
  WAIT_SIGN,
} from '../../hooks/view'
import type { BridgeCall, CallState, ClairState, Line, Superpowers, Tone, Workflow } from '../../types'

const NBSP = '\u00A0'
const RIEN = 'rien n’a tourné'
// Texte réel d'un échec non traduit : refs/bridge-facts.md §1.4 (VERIFIED : ssh_output_fetch par la CLI, sortie 1).
const OUTPUT_CACHE = 'Output cache is not available. This tool is only supported in MCP server mode.'
// Les 7 machines réelles de l'utilisateur (instructions du serveur ssh-bridge), plus deux noms inhabituels.
const HOSTS = [
  'raspberry',
  'win2012',
  'win2012ps',
  'win2025',
  'win2025ntlm',
  'win2025ps',
  'win2025tls',
  'Pi.K3s-01',
  'web-02.prod',
]
const ALL_STATES = Object.keys(STATE_TABLE) as CallState[]

const call = (patch: Partial<BridgeCall> = {}): BridgeCall => ({
  id: 'toolu_a#0',
  toolUseId: 'toolu_a',
  via: 'mcp',
  tool: 'ssh_disk_usage',
  host: 'raspberry',
  nature: 'lecture',
  state: 'fait',
  truncated: false,
  accord: 'aucun',
  startedAt: 1_000,
  endedAt: 1_400,
  ...patch,
})

const stateOf = (calls: BridgeCall[], patch: Partial<ClairState> = {}): ClairState => {
  const hostOrder: string[] = []
  for (const c of calls) if (c.host !== null && !hostOrder.includes(c.host)) hostOrder.push(c.host)
  return { calls, hostOrder, seenAt: 0, waiting: null, superpowers: null, workflows: [], sessions: {}, ...patch }
}

// Titre réel de ce plan (ligne 1 de docs/superpowers/plans/2026-10-15-mode-clair-0.2.md), apostrophe droite comprise.
const plan = (patch: Partial<Superpowers> = {}): Superpowers => ({
  stage: 'taches',
  planTitle: "mode-clair 0.2.0 — plan d'implémentation",
  planPath: 'docs/superpowers/plans/2026-10-15-mode-clair-0.2.md',
  tasks: 17,
  current: 3,
  lastEventAt: 5_000,
  isStale: false,
  runningAgents: [],
  ...patch,
})

const workflow = (patch: Partial<Workflow> = {}): Workflow => ({
  key: 'wf_1',
  toolUseId: 'toolu_wf',
  name: 'mode-clair-understand',
  phases: ['Audit'],
  journalPath: '/var/tmp/wf_1.jsonl',
  consumed: 0,
  // agentId réels du journal wf_2f1d0568-7cc (fixtures de la tâche 8).
  agents: [
    { id: 'af7d9e0fa88200f5e', label: 'ui', phase: 'Audit', state: 'en-cours' },
    { id: 'ab6c88883bf7c997a', label: 'logic', phase: 'Audit', state: 'en-cours' },
    { id: 'a8d2e8fe38b37af93', label: 'api', phase: 'Audit', state: 'en-cours' },
  ],
  status: 'en-cours',
  lastGrowthAt: 5_000,
  startedAt: 4_000,
  ...patch,
})

const text = (line: Line) => line.map((p) => p.text).join('')
const width = (s: string) => [...s].filter((ch) => !/[\uFE00-\uFE0F]/.test(ch)).length
const label = (st: CallState) => fr(STATE_TABLE[st].label)
const CTX: Ctx = { now: 10_000, columns: 120, isWorking: true }
const M = (i: number): Tone => ({ machine: i })

describe('callLine : une ligne par appel (spec §4.3, table §5.4)', () => {
  // §5.4 : fait
  test('fait : ✓ machine · outil · nature, la machine en couleur', () => {
    const s = stateOf([call()])
    expect(callLine(call(), s, 120)).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' ', tone: 'texte' },
      { text: 'raspberry', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh_disk_usage', tone: 'texte' },
      { text: ' · lecture', tone: 'attenue' },
    ])
  })

  // §5.4 : injoignable
  test('injoignable : rien n’a tourné, ni outil ni nature', () => {
    const c = call({ host: 'win2025', tool: 'ssh_win_disk_usage', state: 'injoignable' })
    const s = stateOf([call(), c])
    expect(callLine(c, s, 120)).toStrictEqual([
      { text: '✗', tone: 'erreur' },
      { text: ' ', tone: 'texte' },
      { text: 'win2025', tone: M(1) },
      { text: ' · ', tone: 'attenue' },
      { text: 'injoignable', tone: 'erreur' },
      { text: ` · ${RIEN}`, tone: 'attenue' },
    ])
  })

  // §5.4 : code N, échec sur la machine
  test('code N : ✓ neutre ; échec sur la machine : code et nature ; code inconnu : « code ? »', () => {
    const coded = call({ tool: 'ssh_exec', nature: 'peut-modifier', state: 'code', code: 2 })
    const s = stateOf([coded])
    expect(text(callLine(coded, s, 120))).toBe('✓ raspberry · code 2 · peut modifier')
    expect(callLine(coded, s, 120)[0]).toStrictEqual({ text: '✓ ', tone: 'texte' })
    const failed = call({ state: 'echec-machine', code: 1 })
    expect(text(callLine(failed, s, 120))).toBe(`✗ raspberry · ${label('echec-machine')} · code 1 · lecture`)
    const unknown = call({ tool: 'ssh_exec', nature: 'peut-modifier', state: 'code' })
    expect(text(callLine(unknown, s, 120))).toBe(`✓ raspberry · code${NBSP}? · peut modifier`)
  })

  // §5.4 : échec (texte inconnu)
  test('échec non traduit : « échec · voir /clair », jamais la phrase du bridge', () => {
    const c = call({ via: 'cli', tool: 'ssh_output_fetch', state: 'echec', reason: OUTPUT_CACHE })
    const line = text(callLine(c, stateOf([c]), 120))
    expect(line).toBe(`✗ raspberry · ${label('echec')} · voir /clair`)
    expect(line).not.toContain('Output cache')
  })

  // §5.4 : drapeau tronqué, fait
  test('tronqué : suffixe en ton attention, avec la nature', () => {
    const c = call({ tool: 'ssh_journal_query', truncated: true })
    const line = callLine(c, stateOf([c]), 120)
    expect(text(line)).toBe('✓ raspberry · ssh_journal_query · lecture · tronqué')
    expect(line[line.length - 1]).toStrictEqual({ text: 'tronqué', tone: 'attention' })
  })

  // §5.4 : délai dépassé (note sous la table : la nature suit les états où l'appel a pu tourner)
  test('délai dépassé : la nature en suffixe, comme fait, code N et échec sur la machine, aussi dans la carte', () => {
    const c = call({ host: 'win2025', tool: 'ssh_file_write', nature: 'peut-modifier', state: 'delai-depasse' })
    expect(callLine(c, stateOf([c]), 120)).toStrictEqual([
      { text: '✗', tone: 'attention' },
      { text: ' ', tone: 'texte' },
      { text: 'win2025', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: label('delai-depasse'), tone: 'attention' },
      { text: ' · peut modifier', tone: 'attenue' },
    ])
    const later = call({
      id: 'toolu_z#0',
      toolUseId: 'toolu_z',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 2_000,
      endedAt: 2_100,
    })
    const card = cardLines(stateOf([c, later]), '', 10_000).map(text)
    expect(card[card.length - 1]).toBe(`✗ win2025 · ${label('delai-depasse')} · peut modifier`)
  })

  // §5.4 : incertain, décliné, interrompu
  test('machine inconnue (hôte nul), décliné et interrompu sont atténués ; interrompu a tourné', () => {
    const s = stateOf([])
    const nul = call({ host: null, state: 'incertain' })
    expect(callLine(nul, s, 120)).toStrictEqual([
      { text: '?', tone: 'attenue' },
      { text: ' ', tone: 'texte' },
      { text: `machine inconnue · ${label('incertain')}`, tone: 'attenue' },
    ])
    expect(text(callLine(call({ state: 'decline' }), s, 120))).toBe(`○ raspberry · ${label('decline')} · ${RIEN}`)
    expect(text(callLine(call({ state: 'interrompu' }), s, 120))).toBe(`○ raspberry · ${label('interrompu')}`)
  })

  // §5.4 : toutes les lignes
  test('chaque état de la table §5.4 : son signe, son ton, « rien n’a tourné » si l’appel n’a pas tourné', () => {
    const s = stateOf([call({ host: 'win2025' })])
    for (const st of ALL_STATES) {
      const row = STATE_TABLE[st]
      const line = callLine(call({ host: 'win2025', state: st, code: 1 }), s, 200)
      expect(text(line).startsWith(`${row.sign} win2025 · `)).toBe(true)
      expect(line[0]?.tone).toStrictEqual(row.tone)
      expect(text(line).includes(RIEN)).toBe(!row.isCall)
    }
  })
})

// Captures etat-a-toi (tâche 14) : pendant le formulaire du bridge, le dialogue de Claude Code
// remplace la zone de saisie ; ni la bande ni la ligne d'état ne se voient, seule la ligne de
// l'appel reste (`● raspberry · ssh_file_write`). Elle dit alors l'attente.
describe('callLine pendant le formulaire de confirmation (« à toi » sur la ligne de l’appel)', () => {
  const asking = call({
    id: 'toolu_w#0',
    toolUseId: 'toolu_w',
    tool: 'ssh_file_write',
    nature: 'peut-modifier',
    state: 'en-cours',
    endedAt: undefined,
  })
  const waiting = { tool: 'ssh_file_write', host: 'raspberry', callId: 'toolu_w#0', since: 2_000 }

  // §5.4 : attente « à toi », en cours
  test('l’appel attendu : signe d’attente, machine · outil · attend ton accord ; sa ligne revient quand l’attente s’efface', () => {
    const s = stateOf([call(), asking], { waiting })
    expect(callLine(asking, s, 120)).toStrictEqual([
      { text: WAIT_SIGN, tone: 'attention' },
      { text: ' ', tone: 'texte' },
      { text: 'raspberry', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh_file_write', tone: 'texte' },
      { text: ' · ', tone: 'attenue' },
      { text: 'attend ton accord', tone: 'attention' },
    ])
    const after = setWaiting(s, null)
    expect(text(callLine(asking, after, 120))).toBe('● raspberry · ssh_file_write')
    expect(callLine(asking, after, 120)).toStrictEqual(callLine(asking, stateOf([call(), asking]), 120))
  })

  // §5.4 : attente « à toi », fait, en cours
  test('les autres appels, et l’attente sans appel connu (repli, callId null), gardent leur ligne', () => {
    const other = call()
    const plain = stateOf([other, asking])
    expect(callLine(other, stateOf([other, asking], { waiting }), 120)).toStrictEqual(callLine(other, plain, 120))
    const fallback = stateOf([other, asking], { waiting: { ...waiting, callId: null } })
    expect(callLine(asking, fallback, 120)).toStrictEqual(callLine(asking, plain, 120))
    const unknownHost = call({
      id: 'toolu_n#0',
      toolUseId: 'toolu_n',
      host: null,
      tool: 'ssh_exec',
      state: 'en-cours',
      endedAt: undefined,
    })
    const s = stateOf([unknownHost], { waiting: { tool: 'ssh_exec', host: null, callId: 'toolu_n#0', since: 2_000 } })
    expect(text(callLine(unknownHost, s, 120))).toBe(`${WAIT_SIGN} machine inconnue · ssh_exec · attend ton accord`)
    expect(callLine(unknownHost, s, 120)[1]).toStrictEqual({ text: ' ', tone: 'texte' })
    expect(callLine(unknownHost, s, 120)[2]).toStrictEqual({ text: 'machine inconnue · ', tone: 'attenue' })
  })

  // §5.4 : attente « à toi » ; critère 13 (terminal étroit)
  test('40 colonnes : la machine et « attend ton accord » passent avant l’outil, coupé ; 20 colonnes : sans exception', () => {
    const long = call({
      id: 'toolu_l#0',
      toolUseId: 'toolu_l',
      host: 'win2025ntlm',
      tool: 'ssh_win_disk_usage',
      state: 'en-cours',
      endedAt: undefined,
    })
    const s = stateOf([long], {
      waiting: { tool: 'ssh_win_disk_usage', host: 'win2025ntlm', callId: 'toolu_l#0', since: 2_000 },
    })
    expect(text(callLine(long, s, 120))).toBe(`${WAIT_SIGN} win2025ntlm · ssh_win_disk_usage · attend ton accord`)
    const cut = callLine(long, s, 40)
    expect(text(cut)).toBe(`${WAIT_SIGN} win2025ntlm · ssh… · attend ton accord`)
    expect(width(text(cut))).toBe(40)
    expect(cut[2]).toStrictEqual({ text: 'win2025ntlm', tone: M(0) })
    expect(cut[cut.length - 1]).toStrictEqual({ text: 'attend ton accord', tone: 'attention' })
    // Un caractère de l'outil et « … » tiennent encore ; un de moins, l'outil part, la machine et l'attente restent.
    expect(text(callLine(long, s, 38))).toBe(`${WAIT_SIGN} win2025ntlm · s… · attend ton accord`)
    expect(text(callLine(long, s, 37))).toBe(`${WAIT_SIGN} win2025ntlm · attend ton accord`)
    const narrow = callLine(long, s, 20)
    expect(text(narrow)).toBe(`${WAIT_SIGN} win2025ntlm · att…`)
    expect(narrow[0]).toStrictEqual({ text: WAIT_SIGN, tone: 'attention' })
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(callLine(long, s, bad)).toStrictEqual([])
  })

  // §5.4 : attente « à toi »
  test('l’outil entier tant qu’il tient tout juste, coupé dès la colonne d’avant', () => {
    const s = stateOf([call(), asking], { waiting })
    expect(text(callLine(asking, s, 48))).toBe(`${WAIT_SIGN} raspberry · ssh_file_write · attend ton accord`)
    expect(text(callLine(asking, s, 47))).toBe(`${WAIT_SIGN} raspberry · ssh_file_wri… · attend ton accord`)
    expect(callLine(asking, s, 47).find((p) => p.text.startsWith('…'))?.tone).toBe('attenue')
  })
})

describe('callLine en attente : outil large', () => {
  const wide = call({
    id: 'toolu_c#0',
    toolUseId: 'toolu_c',
    tool: '\u5de5\u5177\u5de5\u5177\u5de5\u5177',
    state: 'en-cours',
    endedAt: undefined,
  })
  const s = stateOf([wide], { waiting: { tool: wide.tool, host: 'raspberry', callId: 'toolu_c#0', since: 2_000 } })

  test('l’outil se coupe en cellules, jamais au-delà des colonnes', () => {
    for (let columns = 25; columns <= 60; columns += 1)
      expect(cellWidth(text(callLine(wide, s, columns)))).toBeLessThanOrEqual(columns)
    const full = text(callLine(wide, s, 80))
    expect(full).toBe(`${WAIT_SIGN} raspberry \u00b7 \u5de5\u5177\u5de5\u5177\u5de5\u5177 \u00b7 attend ton accord`)
    // 12 cellules d'outil : 11 colonnes de moins, un caractère de moins (« 工具工具工 » = 10 cellules + « … »).
    expect(text(callLine(wide, s, cellWidth(full) - 1))).toBe(
      `${WAIT_SIGN} raspberry \u00b7 \u5de5\u5177\u5de5\u5177\u5de5\u2026 \u00b7 attend ton accord`,
    )
  })
})

describe('pipeline : le pipeline réel (spec §5.1)', () => {
  // §5.4 : injoignable, décliné, fait, refusé par Claude Code
  test('les étapes de bridge.steps, ✓ ok, ✗ erreur, ○ atténué, dans leur ordre ; la conclusion sans signe', () => {
    for (const c of [
      call({ host: 'win2025', state: 'injoignable', accord: 'formulaire-oui' }),
      call({ tool: 'ssh_file_write', nature: 'peut-modifier', state: 'decline', accord: 'formulaire-non' }),
      call({ state: 'fait', accord: 'option' }),
      call({ state: 'refuse-claude', accord: 'option' }),
    ]) {
      // bridge.steps finit les appels qui n'ont pas tourné par l'étape { label: RIEN, mark: 'off' } :
      // c'est la conclusion du pipeline, écrite sans signe (exemple de spec §5.1).
      const st = steps(c)
      const done = st.filter((x) => x.label !== RIEN)
      const line = pipeline(c)
      const expected = st
        .map((x) => (x.label === RIEN ? RIEN : `${x.mark === 'ok' ? '✓' : x.mark === 'ko' ? '✗' : '○'} ${x.label}`))
        .join(' · ')
      expect(text(line)).toBe(expected)
      const signs = line.filter((p) => p.text === '✓' || p.text === '✗' || p.text === '○')
      expect(signs.map((p) => p.tone)).toStrictEqual(
        done.map((x) => (x.mark === 'ok' ? 'ok' : x.mark === 'ko' ? 'erreur' : 'attenue')),
      )
    }
    expect(text(pipeline(call({ host: 'win2025', state: 'injoignable', accord: 'formulaire-oui' })))).toBe(
      `✓ accord · ✗ win2025 injoignable · ${RIEN}`,
    )
  })

  // §5.4 : toutes les lignes (colonne « Compté comme appel de la machine »)
  test('un appel qui n’a pas tourné finit par « rien n’a tourné », une seule fois ; les autres jamais', () => {
    const c = call({ host: 'win2025', state: 'injoignable', accord: 'formulaire-oui' })
    const t = text(pipeline(c))
    expect(t.endsWith(` · ${RIEN}`)).toBe(true)
    expect(t.indexOf(RIEN)).toBe(t.lastIndexOf(RIEN))
    for (const st of ALL_STATES) {
      const all = text(pipeline(call({ state: st, code: 1 })))
      expect(all.endsWith(RIEN)).toBe(!STATE_TABLE[st].isCall)
      expect(all.indexOf(RIEN)).toBe(all.lastIndexOf(RIEN))
      expect(all).not.toContain(`○ ${RIEN}`)
    }
  })

  // §5.4 : drapeau tronqué (toutes les lignes) ; spec §5.1 : « affiché en suffixe (· tronqué) »
  test('drapeau tronqué : le pipeline finit par « · tronqué » en ton attention, quel que soit l’état, comme la ligne d’appel', () => {
    const cut = call({ tool: 'ssh_journal_query', truncated: true })
    const line = pipeline(cut)
    expect(text(line)).toBe('✓ raspberry · tronqué')
    expect(line[line.length - 1]).toStrictEqual({ text: 'tronqué', tone: 'attention' })
    const s = stateOf([cut])
    for (const st of ALL_STATES) {
      const c = call({ state: st, code: 1, truncated: true })
      const p = text(pipeline(c))
      expect(p.endsWith(' · tronqué')).toBe(true)
      expect(p.indexOf('tronqué')).toBe(p.lastIndexOf('tronqué'))
      const l = text(callLine(c, s, 200))
      expect(l.includes(' · tronqué')).toBe(true)
      expect(l.indexOf('tronqué')).toBe(l.lastIndexOf('tronqué'))
      expect(text(pipeline(call({ state: st, code: 1 })))).not.toContain('tronqué')
    }
  })
})

describe('fit : priorité machine · état (spec §4.1, critère 13)', () => {
  // §5.4 : fait
  test('une ligne qui tient revient telle quelle', () => {
    const line = callLine(call(), stateOf([call()]), 200)
    expect(fit(line, 200)).toBe(line)
  })

  // §5.4 : toutes les lignes, drapeau tronqué
  test('40 colonnes : machine · état entiers pour chaque état, avec le nom réel le plus long', () => {
    const s = stateOf([call({ host: 'win2025ntlm' })])
    for (const st of ALL_STATES) {
      const c = call({ host: 'win2025ntlm', tool: 'ssh_win_disk_usage', state: st, code: 1, truncated: true })
      const head = st === 'en-cours' || st === 'fait' ? 'ssh_win_disk_usage' : st === 'code' ? 'code 1' : label(st)
      const t = text(callLine(c, s, 40))
      expect(cellWidth(t)).toBeLessThanOrEqual(40)
      expect(t.startsWith(`${STATE_TABLE[st].sign} win2025ntlm · ${head}`)).toBe(true)
    }
  })

  // §5.4 : injoignable
  test('40 et 60 colonnes : la raison part d’abord, par segment entier', () => {
    const c = call({ host: 'win2025', state: 'injoignable' })
    const s = stateOf([c])
    expect(text(callLine(c, s, 60))).toBe(`✗ win2025 · injoignable · ${RIEN}`)
    const cut = callLine(c, s, 40)
    expect(text(cut)).toBe('✗ win2025 · injoignable …')
    expect(cut[cut.length - 1]).toStrictEqual({ text: ' …', tone: 'attenue' })
  })

  // §5.4 : injoignable
  test('une tête qui tient tout juste garde son état entier, sans place pour « … »', () => {
    const line: Line = [{ text: '✗ win2025 · injoignable · détail', tone: 'texte' }]
    expect(text(fit(line, 23))).toBe('✗ win2025 · injoignable')
    expect(text(fit(line, 24))).toBe('✗ win2025 · injoignable…')
  })

  // §5.4 : toutes les lignes
  test('20 colonnes : aucune exception, le nom de la machine (D4) ou la fin de la ligne se coupe, la machine reste, les tons aussi', () => {
    const s = stateOf([call({ host: 'win2025ntlm' })])
    for (const st of ALL_STATES) {
      const line = callLine(call({ host: 'win2025ntlm', state: st, code: 1 }), s, 20)
      const t = text(line)
      expect(width(t)).toBeLessThanOrEqual(20)
      expect(t.startsWith(`${STATE_TABLE[st].sign} w`)).toBe(true)
      // L'état (premier détail) reste entier quand un nom d'au moins un caractère lui laisse la place ; sinon la fin se coupe par « … ».
      const state = text(callLine(call({ host: 'win2025ntlm', state: st, code: 1 }), s, 200)).split(' · ')[1] as string
      const room = 20 - cellWidth(`${STATE_TABLE[st].sign} w… · ${state}`)
      expect(room >= 0 ? t.endsWith(` · ${state}`) : t.endsWith('…')).toBe(true)
      expect(line[0]?.tone).toStrictEqual(STATE_TABLE[st].tone)
      expect(line.some((p) => typeof p.tone === 'object' && p.tone.machine === 0)).toBe(true)
    }
  })

  // §5.4 : fait
  test('largeur nulle, négative ou invalide : une ligne vide ; une colonne : « … »', () => {
    const line = callLine(call(), stateOf([call()]), 200)
    expect(fit(line, 0)).toStrictEqual([])
    expect(fit(line, -5)).toStrictEqual([])
    expect(fit(line, Number.NaN)).toStrictEqual([])
    expect(fit(line, 1)).toStrictEqual([{ text: '…', tone: 'attenue' }])
  })

  // §5.4 : attente « à toi »
  test('le sélecteur de variante U+FE0E ne compte pas dans la largeur', () => {
    const line: Line = [{ text: '\u26A0\uFE0E abc', tone: 'attention' }]
    expect(fit(line, 5)).toBe(line)
  })
})

describe('statusText et modeLabel (spec §4.5, §4.6)', () => {
  // §5.4 : attente « à toi », en cours, injoignable
  test('ligne d’état : seulement en attente', () => {
    const running = call({ host: 'win2025', state: 'en-cours', endedAt: undefined })
    expect(statusText(stateOf([running, call({ state: 'injoignable' })]))).toBeUndefined()
    expect(
      statusText(stateOf([], { waiting: { tool: 'ssh_file_write', host: 'win2025', callId: null, since: 1 } })),
    ).toBe('win2025 attend ton accord')
    expect(statusText(stateOf([], { waiting: { tool: 'ssh_file_write', host: null, callId: null, since: 1 } }))).toBe(
      'ssh_file_write attend ton accord',
    )
  })

  // §5.4 : colonne « Compté dans clair ✗ n » : injoignable, échec sur la machine, erreur d’usage
  test('étiquette : « clair ✗ n » pour les problèmes comptés plus récents que le dernier /clair', () => {
    const a = call({ id: 'toolu_x#0', toolUseId: 'toolu_x', state: 'injoignable', endedAt: 1_400 })
    const b = call({ id: 'toolu_y#0', toolUseId: 'toolu_y', state: 'echec-machine', code: 1, endedAt: 1_600 })
    expect(modeLabel(stateOf([call()]))).toBeNull()
    expect(modeLabel(stateOf([a, b]))).toBe('clair ✗ 2')
    expect(modeLabel(stateOf([a, b], { seenAt: 1_500 }))).toBe('clair ✗ 1')
    expect(modeLabel(stateOf([a, b], { seenAt: 1_600 }))).toBeNull()
    expect(modeLabel(stateOf([call({ state: 'erreur-usage' })]))).toBeNull()
  })
})

describe('signe d’attente (spec §4.1)', () => {
  // §5.4 : attente « à toi », drapeau tronqué
  test('WAIT_SIGN est l’un des deux choix de §4.1 et tient en une cellule', () => {
    expect(['\u26A0\uFE0E', '\u25B2']).toContain(WAIT_SIGN)
    expect(width(WAIT_SIGN)).toBe(1)
  })
})

describe('bandLines : la bande au-dessus de la saisie (spec §4.2)', () => {
  // §5.4 : fait, injoignable
  test('au repos, aucune ligne : ni appel en cours ni attente (critère 1)', () => {
    expect(bandLines(stateOf([]), CTX)).toStrictEqual([])
    const done = stateOf([
      call(),
      call({ id: 'toolu_b#0', toolUseId: 'toolu_b', host: 'win2025', state: 'injoignable' }),
    ])
    expect(bandLines(done, CTX)).toStrictEqual([])
    expect(bandLines(stateOf([], { superpowers: plan() }), { ...CTX, isWorking: false })).toStrictEqual([])
    expect(bandLines(stateOf([], { superpowers: plan({ stage: 'fin' }) }), CTX)).toStrictEqual([])
    expect(
      bandLines(
        stateOf([], { workflows: [workflow({ status: 'fini' }), workflow({ key: 'wf_2', status: 'sans-nouvelles' })] }),
        CTX,
      ),
    ).toStrictEqual([])
  })

  // §5.4 : en cours
  test('un appel en cours : ● machine · outil', () => {
    const c = call({ host: 'win2025', tool: 'ssh_win_disk_usage', state: 'en-cours', endedAt: undefined })
    const lines = bandLines(stateOf([c]), CTX)
    expect(lines.map(text)).toStrictEqual(['● win2025 · ssh_win_disk_usage'])
    expect(lines[0]?.[0]).toStrictEqual({ text: '●', tone: 'accent' })
    expect(lines[0]?.[2]).toStrictEqual({ text: 'win2025', tone: M(0) })
  })

  // §5.4 : en cours
  test('plusieurs appels : un compte puis les machines, sans répétition', () => {
    const calls = [
      call({ id: 'toolu_1#0', toolUseId: 'toolu_1', host: 'win2025', state: 'en-cours', endedAt: undefined }),
      call({ id: 'toolu_2#0', toolUseId: 'toolu_2', host: 'raspberry', state: 'en-cours', endedAt: undefined }),
      call({ id: 'toolu_3#0', toolUseId: 'toolu_3', host: 'win2025', state: 'en-cours', endedAt: undefined }),
    ]
    const lines = bandLines(stateOf(calls), CTX)
    expect(lines.map(text)).toStrictEqual(['● 3 appels · win2025, raspberry'])
    expect(lines[0]?.find((p) => p.text === 'raspberry')?.tone).toStrictEqual(M(1))
  })

  // §5.4 : en cours
  test('rafale de plus de 10 appels d’agents de workflow : une ligne, un compte, trois machines puis +n', () => {
    const calls = Array.from({ length: 12 }, (_, i) =>
      call({
        id: `toolu_r${i}#0`,
        toolUseId: `toolu_r${i}`,
        agentId: `agent-${i % 4}`,
        host: HOSTS[i % 5] ?? null,
        state: 'en-cours',
        endedAt: undefined,
      }),
    )
    const lines = bandLines(stateOf(calls), CTX)
    expect(lines.map(text)).toStrictEqual(['● 12 appels · raspberry, win2012, win2012ps +2'])
    const narrow = bandLines(stateOf(calls), { ...CTX, columns: 20 })
    expect(width(text(narrow[0] ?? []))).toBeLessThanOrEqual(20)
  })

  // §5.4 : attente « à toi », en cours
  test('« à toi » passe avant tout et reste seul', () => {
    const running = call({
      id: 'toolu_w#0',
      toolUseId: 'toolu_w',
      host: 'win2025',
      tool: 'ssh_file_write',
      state: 'en-cours',
      endedAt: undefined,
    })
    const s = stateOf([call(), running], {
      waiting: { tool: 'ssh_file_write', host: 'win2025', callId: 'toolu_w#0', since: 2_000 },
      workflows: [workflow()],
      superpowers: plan(),
    })
    const lines = bandLines(s, CTX)
    expect(lines.map(text)).toStrictEqual([`${WAIT_SIGN} à toi${NBSP}: réponds au formulaire (win2025)`])
    expect(lines[0]?.[0]).toStrictEqual({ text: `${WAIT_SIGN} à toi`, tone: 'attention' })
    expect(lines[0]?.find((p) => p.text === 'win2025')?.tone).toStrictEqual(M(1))
    const noHost = stateOf([], { waiting: { tool: 'ssh_file_write', host: null, callId: null, since: 2_000 } })
    expect(bandLines(noHost, CTX).map(text)).toStrictEqual([
      `${WAIT_SIGN} à toi${NBSP}: réponds au formulaire (ssh_file_write)`,
    ])
  })

  // §5.4 : en cours
  test('ligne 2 : workflow, sinon étape Superpowers ; un appel en cours n’est jamais masqué', () => {
    const running = call({ host: 'win2025', tool: 'ssh_win_disk_usage', state: 'en-cours', endedAt: undefined })
    const both = bandLines(stateOf([running], { workflows: [workflow()], superpowers: plan() }), CTX).map(text)
    expect(both).toStrictEqual([
      '● win2025 · ssh_win_disk_usage',
      '● workflow mode-clair-understand · Audit · 3 agents',
    ])
    const withPlan = bandLines(stateOf([running], { superpowers: plan() }), CTX).map(text)
    expect(withPlan).toStrictEqual([
      '● win2025 · ssh_win_disk_usage',
      `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}» · tâche 3 sur 17`,
    ])
    const noCall = bandLines(stateOf([], { workflows: [workflow()], superpowers: plan() }), CTX).map(text)
    expect(noCall).toStrictEqual([
      '● workflow mode-clair-understand · Audit · 3 agents',
      `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}» · tâche 3 sur 17`,
    ])
  })

  // §5.4 : aucune (ligne Superpowers, spec §5.2)
  test('étape Superpowers : seulement pendant que Claude travaille, jamais « tâche 0 » (spec §5.2)', () => {
    const band = (sp: Superpowers) => bandLines(stateOf([], { superpowers: sp }), CTX).map(text)
    const title = `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}»`
    expect(band(plan({ current: null }))).toStrictEqual([`${title} · 17 tâches`])
    expect(band(plan({ current: 0 }))).toStrictEqual([`${title} · 17 tâches`])
    expect(band(plan({ current: null, tasks: 1 }))).toStrictEqual([`${title} · 1 tâche`])
    expect(band(plan({ current: null, tasks: 0 }))).toStrictEqual([title])
    expect(band(plan({ current: 4, tasks: 0 }))).toStrictEqual([`${title} · tâche 4`])
    expect(band(plan({ stage: 'plan' }))).toStrictEqual([title])
    expect(band(plan({ stage: 'plan', planTitle: null }))).toStrictEqual(['plan'])
    expect(band(plan({ stage: 'cadrage' }))).toStrictEqual(['cadrage'])
    expect(band(plan({ stage: 'spec' }))).toStrictEqual(['spécification'])
    expect(band(plan({ stage: 'relecture' }))).toStrictEqual(['relecture finale'])
    expect(band(plan({ isStale: true }))).toStrictEqual([])
  })

  // §5.4 : aucune (ligne Superpowers, spec §5.2). Captures etat-superpowers (tâche 14) : l'agent T2,
  // lancé en arrière-plan, tournait encore quand le tour principal a fini.
  test('étape Superpowers aussi quand Claude ne travaille plus mais qu’un agent lancé sous le plan tourne encore', () => {
    const idle = { ...CTX, isWorking: false }
    const title = `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}»`
    const running = plan({ current: 2, runningAgents: ['af6f3b628322fc241'] })
    expect(bandLines(stateOf([], { superpowers: running }), idle).map(text)).toStrictEqual([
      `${title} · tâche 2 sur 17`,
    ])
    expect(bandLines(stateOf([], { superpowers: plan({ current: 2 }) }), idle)).toStrictEqual([])
    expect(
      bandLines(stateOf([], { superpowers: running }), { ...idle, viewAgentId: 'af6f3b628322fc241' }),
    ).toStrictEqual([])
    expect(bandLines(stateOf([], { superpowers: { ...running, isStale: true } }), idle)).toStrictEqual([])
    expect(bandLines(stateOf([], { superpowers: { ...running, stage: 'fin' } }), idle)).toStrictEqual([])
  })

  // §5.4 : en cours, échec (agent ✗)
  test('workflow : le plus récent, sa phase, ses agents, ✗ pour un agent en échec (critère 11)', () => {
    const failing = workflow({
      key: 'wf_2',
      startedAt: 6_000,
      agents: [
        { id: 'af7d9e0fa88200f5e', label: 'ui', phase: 'Audit', state: 'en-cours' },
        { id: 'a8d2e8fe38b37af93', label: 'api', phase: 'Audit', state: 'echec' },
      ],
    })
    const lines = bandLines(stateOf([], { workflows: [workflow(), failing] }), CTX)
    expect(lines.map(text)).toStrictEqual(['● workflow mode-clair-understand · Audit · 1 agent · ✗ 1 en échec'])
    expect(lines[0]?.find((p) => p.text === '✗')?.tone).toBe('erreur')
    const remote = workflow({ journalPath: null, status: 'distant', agents: [] })
    expect(bandLines(stateOf([], { workflows: [remote] }), CTX).map(text)).toStrictEqual([
      '● workflow mode-clair-understand · à distance',
    ])
  })

  // §5.4 : en cours, attente « à toi »
  test('vue d’un sous-agent : seuls ses appels et son « à toi », ni workflow ni Superpowers', () => {
    const mine = call({
      id: 'toolu_m#0',
      toolUseId: 'toolu_m',
      agentId: 'a1',
      host: 'win2025',
      state: 'en-cours',
      endedAt: undefined,
    })
    const main = call({
      id: 'toolu_p#0',
      toolUseId: 'toolu_p',
      host: 'raspberry',
      state: 'en-cours',
      endedAt: undefined,
    })
    const s = stateOf([main, mine], { workflows: [workflow()], superpowers: plan() })
    expect(bandLines(s, { ...CTX, viewAgentId: 'a1' }).map(text)).toStrictEqual(['● win2025 · ssh_disk_usage'])
    expect(bandLines(s, { ...CTX, viewAgentId: 'a2' })).toStrictEqual([])
    const waitMain = { ...s, waiting: { tool: 'ssh_exec', host: 'raspberry', callId: 'toolu_p#0', since: 2_000 } }
    expect(bandLines(waitMain, { ...CTX, viewAgentId: 'a1' }).map(text)).toStrictEqual(['● win2025 · ssh_disk_usage'])
    const waitMine = { ...s, waiting: { tool: 'ssh_exec', host: 'win2025', callId: 'toolu_m#0', since: 2_000 } }
    expect(bandLines(waitMine, { ...CTX, viewAgentId: 'a1' }).map(text)).toStrictEqual([
      `${WAIT_SIGN} à toi${NBSP}: réponds au formulaire (win2025)`,
    ])
  })

  // §5.4 : en cours
  test('20 et 40 colonnes : chaque ligne de la bande est coupée, sans exception', () => {
    const running = call({ host: 'win2025ntlm', tool: 'ssh_win_disk_usage', state: 'en-cours', endedAt: undefined })
    const s = stateOf([running], { workflows: [workflow()], superpowers: plan() })
    for (const columns of [20, 40]) {
      const lines = bandLines(s, { ...CTX, columns })
      expect(lines).toHaveLength(2)
      for (const l of lines) expect(width(text(l))).toBeLessThanOrEqual(columns)
    }
  })
})

describe('carte /clair (spec §4.4)', () => {
  const pi = call({ id: 'toolu_1#0', toolUseId: 'toolu_1', startedAt: 1_000, endedAt: 1_100 })
  const winDown = call({
    id: 'toolu_2#0',
    toolUseId: 'toolu_2',
    host: 'win2025',
    tool: 'ssh_win_disk_usage',
    state: 'injoignable',
    startedAt: 1_200,
    endedAt: 1_300,
  })
  const pi2 = call({
    id: 'toolu_3#0',
    toolUseId: 'toolu_3',
    tool: 'ssh_service_status',
    startedAt: 1_400,
    endedAt: 1_500,
  })

  // §5.4 : aucune (carte vide)
  test('rien dans la session : une seule ligne atténuée', () => {
    expect(cardLines(stateOf([]), '', 10_000)).toStrictEqual([
      [{ text: 'rien depuis le début de la session', tone: 'attenue' }],
    ])
  })

  // §5.4 : fait, injoignable (colonnes « Compté dans clair ✗ n » et « Compté comme appel de la machine »)
  test('un résumé, puis une ligne par machine dans l’ordre d’apparition, couleur = rang', () => {
    const lines = cardLines(stateOf([pi, winDown, pi2]), '', 10_000)
    expect(lines.slice(0, 3).map(text)).toStrictEqual([
      '2 machines · 2 appels · 1 problème non vu',
      'raspberry · 2 appels · ✓ ssh_service_status',
      'win2025 · 0 appel · ✗ injoignable',
    ])
    expect(lines[0]?.find((p) => p.text === '1 problème non vu')?.tone).toBe('erreur')
    expect(lines[1]?.[0]).toStrictEqual({ text: 'raspberry', tone: M(0) })
    expect(lines[2]?.[0]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(lines[2]?.find((p) => p.text === 'injoignable')?.tone).toBe('erreur')
  })

  // §5.4 : injoignable, fait
  test('✗ sur une machine dont un problème n’est pas vu, même si son dernier appel a réussi', () => {
    const down = call({ id: 'toolu_0#0', toolUseId: 'toolu_0', state: 'injoignable', startedAt: 900, endedAt: 950 })
    const unseen = cardLines(stateOf([down, pi]), '', 10_000)
    expect(text(unseen[1] ?? [])).toBe('raspberry · 1 appel · ✓ ssh_disk_usage · ✗ problème non vu')
    const seen = cardLines(stateOf([down, pi], { seenAt: 1_000 }), '', 10_000)
    expect(text(seen[0] ?? [])).toBe('1 machine · 1 appel · aucun problème non vu')
    expect(text(seen[1] ?? [])).toBe('raspberry · 1 appel · ✓ ssh_disk_usage')
  })

  // §5.4 : injoignable (colonne « Dans à regarder »)
  test('« à regarder » : 5 au plus, le plus récent en pipeline une seule fois, ceux d’avant le dernier /clair atténués', () => {
    const fails = Array.from({ length: 7 }, (_, i) =>
      call({
        id: `toolu_f${i}#0`,
        toolUseId: `toolu_f${i}`,
        host: i % 2 === 0 ? 'win2025' : 'raspberry',
        state: 'injoignable',
        startedAt: 2_000 + i * 100,
        endedAt: 2_050 + i * 100,
      }),
    )
    const s = stateOf(fails, { seenAt: 2_400 })
    const lines = cardLines(s, '', 10_000).map(text)
    const at = lines.indexOf(`à regarder${NBSP}:`)
    expect(at).toBe(3)
    const newest = fails[6] as BridgeCall
    expect(lines[at + 1]).toBe(text(pipeline(newest)))
    const entries = lines.slice(at + 2)
    expect(entries).toStrictEqual([
      `✗ raspberry · injoignable · ${RIEN}`,
      `✗ win2025 · injoignable · ${RIEN}`,
      `✗ raspberry · injoignable · ${RIEN} · déjà vu`,
      `✗ win2025 · injoignable · ${RIEN} · déjà vu`,
    ])
    const card = cardLines(s, '', 10_000)
    expect(card[at + 5]).toStrictEqual([{ text: `✗ win2025 · injoignable · ${RIEN} · déjà vu`, tone: 'attenue' }])
  })

  // §5.4 : échec (texte inconnu)
  test('la phrase brute du bridge, non traduite, entre guillemets sous le pipeline, telle quelle', () => {
    const failed = call({
      id: 'toolu_9#0',
      toolUseId: 'toolu_9',
      via: 'cli',
      tool: 'ssh_output_fetch',
      state: 'echec',
      reason: OUTPUT_CACHE,
      startedAt: 3_000,
      endedAt: 3_100,
    })
    const lines = cardLines(stateOf([pi, failed]), '', 10_000)
    const at = lines.map(text).indexOf(`à regarder${NBSP}:`)
    expect(lines[at + 1]).toStrictEqual(pipeline(failed))
    expect(lines[at + 2]).toStrictEqual([
      { text: `«${NBSP}`, tone: 'attenue' },
      { text: OUTPUT_CACHE, tone: 'texte' },
      { text: `${NBSP}»`, tone: 'attenue' },
    ])
    expect(lines.map(text).filter((l) => l.includes(OUTPUT_CACHE))).toHaveLength(1)
  })

  // §5.4 : drapeau tronqué, fait (colonne « Dans à regarder »)
  test('un appel réussi mais tronqué, plus récent problème : « à regarder » dit « tronqué », et la relecture le garde', () => {
    const cut = call({
      id: 'toolu_c#0',
      toolUseId: 'toolu_c',
      tool: 'ssh_journal_query',
      truncated: true,
      startedAt: 2_000,
      endedAt: 2_100,
    })
    const lines = cardLines(stateOf([pi, cut]), '', 10_000)
    const at = lines.map(text).indexOf(`à regarder${NBSP}:`)
    expect(at).toBe(2)
    const look = lines[at + 1] ?? []
    expect(text(look)).toBe('✓ raspberry · tronqué')
    expect(look[look.length - 1]).toStrictEqual({ text: 'tronqué', tone: 'attention' })
    expect(parseCard(cardText(lines))).toStrictEqual(lines)
    const seen = cardLines(stateOf([pi, cut], { seenAt: 2_100 }), '', 10_000)
    expect(seen[at + 1]).toStrictEqual([{ text: '✓ raspberry · tronqué · déjà vu', tone: 'attenue' }])
    expect(parseCard(cardText(seen))).toStrictEqual(seen)
    const down = call({
      id: 'toolu_d#0',
      toolUseId: 'toolu_d',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 2_200,
      endedAt: 2_300,
    })
    const older = cardLines(stateOf([pi, cut, down]), '', 10_000).map(text)
    expect(older.slice(-1)).toStrictEqual(['✓ raspberry · ssh_journal_query · lecture · tronqué'])
  })

  // §5.4 : en cours
  test('plan Superpowers et workflows en cours, une ligne chacun ; un plan abandonné y reste', () => {
    const s = stateOf([pi], {
      superpowers: plan({ isStale: true }),
      workflows: [
        workflow(),
        workflow({ key: 'wf_2', name: 'audit-disques', status: 'sans-nouvelles' }),
        workflow({ key: 'wf_3', name: 'fini', status: 'fini' }),
      ],
    })
    expect(cardLines(s, '', 10_000).slice(2).map(text)).toStrictEqual([
      `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}» · tâche 3 sur 17 · abandonné`,
      '● workflow mode-clair-understand · Audit · 3 agents',
      '○ workflow audit-disques · sans nouvelles · Audit · 3 agents',
    ])
    const onlyPlan = cardLines(stateOf([], { superpowers: plan() }), '', 10_000).map(text)
    expect(onlyPlan).toStrictEqual([`plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}» · tâche 3 sur 17`])
  })

  // §5.4 : injoignable, fait
  test('/clair <machine> : les machines, puis le dernier appel de celle-ci et son pipeline', () => {
    const s = stateOf([pi, winDown, pi2])
    const lines = cardLines(s, ' win2025 ', 10_000)
    expect(lines.map(text)).toStrictEqual([
      'raspberry · 2 appels · ✓ ssh_service_status',
      'win2025 · 0 appel · ✗ injoignable',
      `dernier appel sur win2025${NBSP}:`,
      `✗ win2025 · injoignable · ${RIEN}`,
      text(pipeline(winDown)),
    ])
    expect(lines[2]?.[1]).toStrictEqual({ text: 'win2025', tone: M(1) })
    const unknown = cardLines(s, 'nohost', 10_000)
    expect(unknown[unknown.length - 1]).toStrictEqual([{ text: 'aucun appel sur nohost', tone: 'attenue' }])
  })

  // §5.4 : injoignable, fait, en cours ; spec §4.7 : l'index de couleur est rangé dans l'état (hostOrder)
  test('machine dont tous les appels sont sortis de la mémoire : sa ligne reste, atténuée, et chaque couleur = hostIndex, carte et bande', () => {
    // raspberry est apparue la première ; le plafond de 200 (state.ts, capped) a évincé tous ses appels.
    const p1 = call({
      id: 'toolu_p1#0',
      toolUseId: 'toolu_p1',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 900,
      endedAt: 950,
    })
    const p2 = call({
      id: 'toolu_p2#0',
      toolUseId: 'toolu_p2',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 960,
      endedAt: 990,
    })
    const done = call({ id: 'toolu_w#0', toolUseId: 'toolu_w', host: 'win2025', tool: 'ssh_win_disk_usage' })
    const running = call({
      id: 'toolu_r#0',
      toolUseId: 'toolu_r',
      host: 'win2025',
      tool: 'ssh_win_disk_usage',
      state: 'en-cours',
      startedAt: 1_500,
      endedAt: undefined,
    })
    const s = stateOf([p1, p2, done, running], { hostOrder: ['raspberry', 'win2025'] })
    const lines = cardLines(s, '', 10_000)
    expect(lines.map(text)).toStrictEqual([
      '1 machine · 2 appels · 2 problèmes non vus',
      'raspberry · plus d’appel en mémoire',
      'win2025 · 2 appels · ● ssh_win_disk_usage · ✗ problème non vu',
      `à regarder${NBSP}:`,
      `✗ win2025 injoignable · ${RIEN}`,
      `✗ win2025 · injoignable · ${RIEN}`,
    ])
    expect(lines[1]).toStrictEqual([{ text: 'raspberry · plus d’appel en mémoire', tone: 'attenue' }])
    expect(lines[2]?.[0]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(lines[5]?.[2]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(parseCard(cardText(lines))).toStrictEqual(lines)
    expect(bandLines(s, CTX)[0]?.[2]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(callLine(done, s, 120)[2]).toStrictEqual({ text: 'win2025', tone: M(1) })
    const gone = cardLines(s, 'raspberry', 10_000)
    expect(gone.map(text)).toStrictEqual([
      'raspberry · plus d’appel en mémoire',
      'win2025 · 2 appels · ● ssh_win_disk_usage · ✗ problème non vu',
      'plus d’appel en mémoire sur raspberry',
    ])
    expect(gone[2]).toStrictEqual([{ text: 'plus d’appel en mémoire sur raspberry', tone: 'attenue' }])
    expect(parseCard(cardText(gone))).toStrictEqual(gone)
    const view = cardLines(s, 'win2025', 10_000)
    expect(view[2]?.[1]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(parseCard(cardText(view))).toStrictEqual(view)
  })

  // §5.4 : fait
  test('neuf machines aux noms inhabituels : la 9e a l’index 8, que colorOf ramène à la couleur 0', () => {
    const calls = HOSTS.map((host, i) => call({ id: `toolu_h${i}#0`, toolUseId: `toolu_h${i}`, host }))
    const s = stateOf(calls)
    const lines = cardLines(s, '', 10_000)
    expect(lines).toHaveLength(10)
    for (const [i, host] of HOSTS.entries()) expect(lines[i + 1]?.[0]).toStrictEqual({ text: host, tone: M(i) })
    expect(callLine(calls[8] as BridgeCall, s, 120)[2]).toStrictEqual({ text: 'web-02.prod', tone: M(8) })
    expect(colorOf(8)).toBe(colorOf(0))
  })
})

describe('cardText et parseCard : la carte relue depuis son seul texte', () => {
  const failed = call({
    id: 'toolu_9#0',
    toolUseId: 'toolu_9',
    via: 'cli',
    tool: 'ssh_output_fetch',
    state: 'echec',
    reason: OUTPUT_CACHE,
    startedAt: 3_000,
    endedAt: 3_100,
  })
  const cases: [string, ClairState, string][] = [
    ['vide', stateOf([]), ''],
    ['plan seul', stateOf([], { superpowers: plan() }), ''],
    [
      'tous les états, hôte nul, tronqué, raison, déjà vu, plan, workflows',
      stateOf(
        [
          ...ALL_STATES.map((st, i) =>
            call({
              id: `toolu_s${i}#0`,
              toolUseId: `toolu_s${i}`,
              host: HOSTS[i % 4] ?? null,
              state: st,
              code: i,
              startedAt: 1_000 + i * 10,
              endedAt: 1_005 + i * 10,
            }),
          ),
          call({
            id: 'toolu_n#0',
            toolUseId: 'toolu_n',
            host: null,
            state: 'machine-inconnue',
            startedAt: 2_000,
            endedAt: 2_010,
          }),
          call({
            id: 'toolu_t#0',
            toolUseId: 'toolu_t',
            tool: 'ssh_journal_query',
            truncated: true,
            startedAt: 2_100,
            endedAt: 2_110,
          }),
          failed,
        ],
        {
          seenAt: 1_100,
          superpowers: plan({ isStale: true }),
          workflows: [workflow(), workflow({ key: 'wf_r', status: 'distant', agents: [] })],
        },
      ),
      '',
    ],
    [
      'neuf machines',
      stateOf(
        HOSTS.map((host, i) =>
          call({ id: `toolu_h${i}#0`, toolUseId: `toolu_h${i}`, host, state: i % 3 === 0 ? 'injoignable' : 'fait' }),
        ),
      ),
      '',
    ],
    ['vue d’une machine', stateOf([call(), failed]), 'raspberry'],
    ['machine absente', stateOf([call()]), 'nohost'],
  ]

  for (const [name, s, args] of cases) {
    // §5.4 : toutes les lignes
    test(`relecture identique : ${name}`, () => {
      const lines = cardLines(s, args, 10_000)
      expect(parseCard(cardText(lines))).toStrictEqual(lines)
    })
  }

  // §5.4 : fait, échec (texte inconnu)
  test('cardText : une ligne de texte par ligne de carte, sans ligne vide', () => {
    const lines = cardLines(stateOf([call(), failed]), '', 10_000)
    const t = cardText(lines)
    expect(t.split('\n')).toStrictEqual(lines.map(text))
    expect(t.split('\n').includes('')).toBe(false)
  })

  // §5.4 : injoignable, fait
  test('les couleurs des machines se retrouvent dans « à regarder » depuis l’ordre des lignes de machine', () => {
    const down = call({
      id: 'toolu_d#0',
      toolUseId: 'toolu_d',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 1_500,
      endedAt: 1_600,
    })
    const later = call({
      id: 'toolu_e#0',
      toolUseId: 'toolu_e',
      state: 'injoignable',
      startedAt: 1_700,
      endedAt: 1_800,
    })
    const lines = parseCard(cardText(cardLines(stateOf([call(), down, later]), '', 10_000)))
    expect(lines[2]?.[0]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(text(lines[5] ?? [])).toBe(`✗ win2025 · injoignable · ${RIEN}`)
    expect(lines[5]?.[2]).toStrictEqual({ text: 'win2025', tone: M(1) })
  })

  // §5.4 : fait
  test('fins de ligne Windows et lignes vides sont tolérées', () => {
    const lines = cardLines(stateOf([call()]), '', 10_000)
    expect(parseCard(cardText(lines).split('\n').join('\r\n\r\n'))).toStrictEqual(lines)
  })

  // §5.4 : fait, injoignable. Spec §10 : la rangée CommandOutput reçoit le texte précédé du nom du plugin et
  // de « : » (relevé par la sonde de la tâche 2 : `mode-clair-sonde: SONDE-TEXTE-BRUT ligne 1\n…` dans props.text).
  test('le nom du plugin que le moteur met devant le texte est retiré : mêmes lignes, mêmes couleurs', () => {
    const down = call({
      id: 'toolu_d#0',
      toolUseId: 'toolu_d',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 1_500,
      endedAt: 1_600,
    })
    for (const s of [stateOf([call(), down]), stateOf([])]) {
      const lines = cardLines(s, '', 10_000)
      expect(parseCard(`mode-clair: ${cardText(lines)}`)).toStrictEqual(lines)
    }
  })
})

describe('typographie du texte du mod (spec §4.1, critère 14)', () => {
  // §5.4 : toutes les lignes
  test('aucun texte du mod sans insécable devant : ; ! ni dans « », apostrophe typographique (critère 14)', () => {
    const calls = ALL_STATES.map((st, i) =>
      call({
        id: `toolu_s${i}#0`,
        toolUseId: `toolu_s${i}`,
        host: HOSTS[i % 3] ?? null,
        state: st,
        code: i,
        truncated: i % 2 === 0,
        endedAt: 1_000 + i,
      }),
    )
    const s = stateOf(calls, { superpowers: plan({ planTitle: 'export' }), workflows: [workflow()] })
    const all = [
      ...calls.map((c) => callLine(c, s, 200)),
      ...calls.map((c) => pipeline(c, s)),
      ...cardLines(s, '', 10_000),
      ...cardLines(s, 'raspberry', 10_000),
      ...bandLines(
        stateOf([], {
          superpowers: plan({ planTitle: 'export' }),
          waiting: { tool: 'ssh_exec', host: 'raspberry', callId: null, since: 1 },
        }),
        CTX,
      ),
    ].map(text)
    for (const t of all) {
      expect(t).not.toMatch(/ [:;!]/)
      expect(t).not.toMatch(/« | »/)
      expect(t).not.toMatch(/\p{L}'\p{L}/u)
    }
    expect(all.some((t) => t.includes('\u2019'))).toBe(true)
    expect(all.some((t) => t.includes(`${NBSP}:`))).toBe(true)
  })
})

// Les tons et les formes que les tests ci-dessus laissaient libres : chaque morceau est vérifié avec son ton exact.
describe('tons exacts des morceaux d’une ligne d’appel (table §5.4)', () => {
  test('nature inconnue : « inconnu » est atténué comme « lecture » et « peut modifier »', () => {
    const c = call({ nature: 'inconnu' })
    expect(callLine(c, stateOf([c]), 120)).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' ', tone: 'texte' },
      { text: 'raspberry', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh_disk_usage', tone: 'texte' },
      { text: ' · inconnu', tone: 'attenue' },
    ])
  })

  test('échec : « voir /clair » est atténué', () => {
    const c = call({ state: 'echec', reason: OUTPUT_CACHE })
    expect(callLine(c, stateOf([c]), 120)).toStrictEqual([
      { text: '✗', tone: 'erreur' },
      { text: ' ', tone: 'texte' },
      { text: 'raspberry', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: label('echec'), tone: 'erreur' },
      { text: ' · voir /clair', tone: 'attenue' },
    ])
  })

  test('une machine absente de l’état garde le ton texte', () => {
    expect(callLine(call(), stateOf([]), 120)).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' raspberry', tone: 'texte' },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh_disk_usage', tone: 'texte' },
      { text: ' · lecture', tone: 'attenue' },
    ])
  })

  test('machine inconnue : le nom de la machine est atténué, l’état « machine inconnue » est en erreur', () => {
    const named = call({ host: 'win2025', state: 'machine-inconnue' })
    expect(callLine(named, stateOf([named]), 120)).toStrictEqual([
      { text: '✗', tone: 'erreur' },
      { text: ' ', tone: 'texte' },
      { text: 'win2025', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'machine inconnue', tone: 'erreur' },
      { text: ` · ${RIEN}`, tone: 'attenue' },
    ])
    const nul = call({ host: null, state: 'machine-inconnue' })
    expect(callLine(nul, stateOf([]), 120)).toStrictEqual([
      { text: '✗', tone: 'erreur' },
      { text: ' ', tone: 'texte' },
      { text: 'machine inconnue · ', tone: 'attenue' },
      { text: 'machine inconnue', tone: 'erreur' },
      { text: ` · ${RIEN}`, tone: 'attenue' },
    ])
  })

  test('code N à deux chiffres : le signe garde le ton du code, pas celui de « fait »', () => {
    const c = call({ tool: 'ssh_exec', state: 'code', code: 12 })
    const line = callLine(c, stateOf([c]), 120)
    expect(text(line)).toBe('✓ raspberry · code 12 · lecture')
    expect(line[0]).toStrictEqual({ text: '✓ ', tone: 'texte' })
  })

  test('code N sans code distant : « échec sur la machine » n’ajoute pas « code ? »', () => {
    const c = call({ state: 'echec-machine' })
    expect(text(callLine(c, stateOf([c]), 120))).toBe(`✗ raspberry · ${label('echec-machine')} · lecture`)
  })

  test('un identifiant sur plusieurs lignes ou avec tabulation tient sur une ligne, une seule espace par coupure', () => {
    const c = call({ host: 'a\r\n\tb', tool: 'x\ty' })
    expect(text(callLine(c, stateOf([c]), 120))).toBe('✓ a b · x y · lecture')
  })
})

describe('tons exacts relus dans le seul texte (parseCard)', () => {
  test('signes : ●, ○, ? et le signe d’attente gardent leur ton quand le mot qui suit n’est pas le leur', () => {
    expect(parseCard('● injoignable')).toStrictEqual([
      [
        { text: '●', tone: 'accent' },
        { text: ' ', tone: 'texte' },
        { text: 'injoignable', tone: 'erreur' },
      ],
    ])
    expect(parseCard('○ quelque chose')).toStrictEqual([
      [
        { text: '○', tone: 'attenue' },
        { text: ' quelque chose', tone: 'texte' },
      ],
    ])
    expect(parseCard('? quelque chose')).toStrictEqual([
      [
        { text: '?', tone: 'attenue' },
        { text: ' quelque chose', tone: 'texte' },
      ],
    ])
    expect(parseCard(`${WAIT_SIGN} quelque chose`)).toStrictEqual([
      [
        { text: WAIT_SIGN, tone: 'attention' },
        { text: ' quelque chose', tone: 'texte' },
      ],
    ])
  })

  test('« code N » est reconnu en entier : ancré aux deux bouts, plusieurs chiffres', () => {
    expect(parseCard(`✓ xcode${NBSP}2`)).toStrictEqual([
      [
        { text: '✓', tone: 'ok' },
        { text: ` xcode${NBSP}2`, tone: 'texte' },
      ],
    ])
    expect(parseCard(`✓ code${NBSP}2 x`)).toStrictEqual([
      [
        { text: '✓', tone: 'ok' },
        { text: ` code${NBSP}2 x`, tone: 'texte' },
      ],
    ])
    expect(parseCard(`✓ code${NBSP}12`)).toStrictEqual([[{ text: `✓ code${NBSP}12`, tone: 'texte' }]])
  })

  test('« N problèmes non vus » : en erreur seulement en entier, avec plusieurs chiffres', () => {
    expect(parseCard('a · 12 problèmes non vus · x1 problème non vu · 1 problème non vu x')).toStrictEqual([
      [
        { text: 'a', tone: 'texte' },
        { text: ' · ', tone: 'attenue' },
        { text: '12 problèmes non vus', tone: 'erreur' },
        { text: ' · ', tone: 'attenue' },
        { text: 'x1 problème non vu', tone: 'texte' },
        { text: ' · ', tone: 'attenue' },
        { text: '1 problème non vu x', tone: 'texte' },
      ],
    ])
  })

  test('le mot d’état qui suit la machine donne son ton au signe, sans que les autres segments s’en mêlent', () => {
    expect(parseCard('✗ limité · foo')[0]?.[0]).toStrictEqual({ text: '✗', tone: 'attention' })
    // Un mot d’état au deuxième segment ne décide pas du signe d’un segment plus loin.
    expect(parseCard('a · injoignable · ✗ limité')[0]).toStrictEqual([
      { text: 'a', tone: 'texte' },
      { text: ' · ', tone: 'attenue' },
      { text: 'injoignable', tone: 'erreur' },
      { text: ' · ', tone: 'attenue' },
      { text: '✗', tone: 'attention' },
      { text: ' ', tone: 'texte' },
      { text: 'limité', tone: 'attention' },
    ])
  })

  test('une ligne de machine sans appel donne à la machine son nom comme couleur, pas la ligne entière', () => {
    const lines = parseCard('raspberry · plus d’appel en mémoire\n✓ raspberry · ssh_disk_usage')
    expect(lines[0]).toStrictEqual([{ text: 'raspberry · plus d’appel en mémoire', tone: 'attenue' }])
    expect(lines[1]).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' ', tone: 'texte' },
      { text: 'raspberry', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh_disk_usage', tone: 'texte' },
    ])
  })

  test('« à regarder » termine l’en-tête : ses lignes ne définissent plus de machine', () => {
    const lines = parseCard(`à regarder${NBSP}:\nfoo · 1 appel · ✓ x\n✓ foo · y`)
    expect(lines[0]).toStrictEqual([{ text: `à regarder${NBSP}:`, tone: 'attenue' }])
    expect(lines[2]).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' foo', tone: 'texte' },
      { text: ' · ', tone: 'attenue' },
      { text: 'y', tone: 'texte' },
    ])
  })

  test('« dernier appel sur » termine l’en-tête ; la machine y est colorée, en atténué si elle est « machine inconnue »', () => {
    const lines = parseCard(`dernier appel sur foo${NBSP}:\nbar · 1 appel · ✗ x\n✓ bar · y`)
    expect(lines[0]).toStrictEqual([
      { text: 'dernier appel sur ', tone: 'attenue' },
      { text: 'foo', tone: 'texte' },
      { text: `${NBSP}:`, tone: 'attenue' },
    ])
    expect(lines[2]?.[1]).toStrictEqual({ text: ' bar', tone: 'texte' })
    const unknown = parseCard(`dernier appel sur machine inconnue${NBSP}:`)
    expect(unknown).toStrictEqual([[{ text: `dernier appel sur machine inconnue${NBSP}:`, tone: 'attenue' }]])
  })

  test('« dernier appel sur » demande le début et la fin ensemble', () => {
    expect(parseCard('dernier appel sur foo')).toStrictEqual([[{ text: 'dernier appel sur foo', tone: 'texte' }]])
    expect(parseCard(`foo${NBSP}:`)).toStrictEqual([[{ text: `foo${NBSP}:`, tone: 'texte' }]])
  })

  test('une raison entre guillemets : atténuée aux guillemets, texte au milieu ; seul un vrai « ... » en est une', () => {
    expect(parseCard(`«${NBSP}raison${NBSP}»`)).toStrictEqual([
      [
        { text: `«${NBSP}`, tone: 'attenue' },
        { text: 'raison', tone: 'texte' },
        { text: `${NBSP}»`, tone: 'attenue' },
      ],
    ])
    // Trop courtes pour contenir une raison, ou qui n’ont qu’un des deux guillemets : des lignes ordinaires.
    for (const t of [`«${NBSP}${NBSP}»`, `«${NBSP}»`, `foo${NBSP}»`, `«${NBSP}foo`]) {
      expect(parseCard(t)).toStrictEqual([[{ text: t, tone: 'texte' }]])
    }
  })
})

describe('tons exacts de la carte /clair', () => {
  const pi = call({ id: 'toolu_1#0', toolUseId: 'toolu_1', startedAt: 1_000, endedAt: 1_100 })
  const down = call({
    id: 'toolu_0#0',
    toolUseId: 'toolu_0',
    state: 'injoignable',
    startedAt: 900,
    endedAt: 950,
  })
  const failed = call({
    id: 'toolu_9#0',
    toolUseId: 'toolu_9',
    via: 'cli',
    tool: 'ssh_output_fetch',
    state: 'echec',
    reason: OUTPUT_CACHE,
    startedAt: 3_000,
    endedAt: 3_100,
  })

  test('« aucun problème non vu » est atténué, « problème non vu » d’une machine est en erreur', () => {
    const seen = cardLines(stateOf([down, pi], { seenAt: 1_000 }), '', 10_000)
    expect(seen[0]).toStrictEqual([
      { text: '1 machine', tone: 'texte' },
      { text: ' · ', tone: 'attenue' },
      { text: '1 appel', tone: 'texte' },
      { text: ' · aucun problème non vu', tone: 'attenue' },
    ])
    const unseen = cardLines(stateOf([down, pi]), '', 10_000)
    expect(unseen[1]?.at(-1)).toStrictEqual({ text: 'problème non vu', tone: 'erreur' })
  })

  test('plan abandonné, workflow à distance et workflow sans nouvelles : atténués', () => {
    const remote = workflow({ journalPath: null, status: 'distant', agents: [] })
    const quiet = workflow({ key: 'wf_2', name: 'audit-disques', status: 'sans-nouvelles' })
    const lines = cardLines(stateOf([pi], { superpowers: plan({ isStale: true }), workflows: [remote, quiet] }), '', 1)
    expect(lines.map(text).slice(2)).toStrictEqual([
      `plan «${NBSP}mode-clair 0.2.0 — plan d'implémentation${NBSP}» · tâche 3 sur 17 · abandonné`,
      '● workflow mode-clair-understand · à distance',
      '○ workflow audit-disques · sans nouvelles · Audit · 3 agents',
    ])
    expect(lines[2]?.at(-1)).toStrictEqual({ text: ' · abandonné', tone: 'attenue' })
    expect(lines[3]?.at(-1)).toStrictEqual({ text: ' · à distance', tone: 'attenue' })
    expect(lines[4]?.find((p) => p.text.includes('sans nouvelles'))?.tone).toBe('attenue')
  })

  test('un workflow à distance est seul dans la carte quand rien d’autre n’existe', () => {
    const remote = workflow({ journalPath: null, status: 'distant', agents: [] })
    expect(cardLines(stateOf([], { workflows: [remote] }), '', 1).map(text)).toStrictEqual([
      '● workflow mode-clair-understand · à distance',
    ])
  })

  test('machine dont le dernier appel est un code : « ✓ code N », « code ? » sans code', () => {
    const coded = call({ tool: 'ssh_exec', state: 'code', code: 2 })
    const unknown = call({ id: 'toolu_u#0', toolUseId: 'toolu_u', host: 'win2025', state: 'code', startedAt: 1_500 })
    const lines = cardLines(stateOf([coded, unknown]), '', 10_000).map(text)
    expect(lines.slice(1)).toStrictEqual(['raspberry · 1 appel · ✓ code 2', `win2025 · 1 appel · ✓ code${NBSP}?`])
  })

  test('machine dont l’état est « machine inconnue » : l’état est en erreur', () => {
    const c = call({ host: 'win2025', state: 'machine-inconnue' })
    const lines = cardLines(stateOf([c]), '', 10_000)
    expect(text(lines[1] ?? [])).toBe('win2025 · 0 appel · ✗ machine inconnue')
    expect(lines[1]?.find((p) => p.text === 'machine inconnue')?.tone).toBe('erreur')
  })

  test('« à regarder : » est atténué', () => {
    const lines = cardLines(stateOf([down]), '', 10_000)
    expect(lines[2]).toStrictEqual([{ text: `à regarder${NBSP}:`, tone: 'attenue' }])
  })

  test('/clair <machine> : la ligne « dernier appel sur » et la raison sous le pipeline', () => {
    const lines = cardLines(stateOf([pi, failed]), 'raspberry', 10_000)
    expect(lines.at(-4)).toStrictEqual([
      { text: 'dernier appel sur ', tone: 'attenue' },
      { text: 'raspberry', tone: M(0) },
      { text: `${NBSP}:`, tone: 'attenue' },
    ])
    expect(lines.at(-1)).toStrictEqual([
      { text: `«${NBSP}`, tone: 'attenue' },
      { text: OUTPUT_CACHE, tone: 'texte' },
      { text: `${NBSP}»`, tone: 'attenue' },
    ])
    expect(lines.map(text).filter((l) => l.includes(OUTPUT_CACHE))).toHaveLength(1)
  })

  test('/clair <machine> : seul le premier mot compte, quelle que soit l’espace autour', () => {
    const s = stateOf([pi, failed])
    expect(cardLines(s, '  raspberry \t extra mots \n suite ', 10_000)).toStrictEqual(cardLines(s, 'raspberry', 10_000))
    expect(cardLines(s, '   ', 10_000)).toStrictEqual(cardLines(s, '', 10_000))
  })

  test('la raison d’un problème déjà vu est atténuée en entier', () => {
    const lines = cardLines(stateOf([pi, failed], { seenAt: 3_100 }), '', 10_000)
    expect(lines.at(-1)).toStrictEqual([{ text: `«${NBSP}${OUTPUT_CACHE}${NBSP}»`, tone: 'attenue' }])
    const fresh = cardLines(stateOf([pi, failed], { seenAt: 3_000 }), '', 10_000)
    expect(fresh.at(-1)?.[1]).toStrictEqual({ text: OUTPUT_CACHE, tone: 'texte' })
  })

  test('dix machines : « 10 machines » est le résumé, pas une machine ; les couleurs suivent hostOrder', () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      call({ id: `toolu_m${i}#0`, toolUseId: `toolu_m${i}`, host: `node-${i}` }),
    )
    const lines = cardLines(stateOf(calls), '', 10_000)
    expect(text(lines[0] ?? [])).toBe('10 machines · 10 appels · aucun problème non vu')
    for (let i = 0; i < 10; i++) expect(lines[i + 1]?.[0]).toStrictEqual({ text: `node-${i}`, tone: M(i) })
  })

  test('onze appels sur une machine : « N appels » à deux chiffres ne change pas les couleurs', () => {
    const many = Array.from({ length: 11 }, (_, i) =>
      call({ id: `toolu_k${i}#0`, toolUseId: `toolu_k${i}`, startedAt: 1_000 + i, endedAt: 1_000 + i }),
    )
    const win = call({
      id: 'toolu_w#0',
      toolUseId: 'toolu_w',
      host: 'win2025',
      state: 'injoignable',
      startedAt: 2_000,
      endedAt: 2_100,
    })
    const older = { ...win, id: 'toolu_x#0', toolUseId: 'toolu_x', startedAt: 1_900, endedAt: 1_950 }
    const lines = cardLines(stateOf([...many, older, win]), '', 10_000)
    expect(lines.slice(0, 3).map(text)).toStrictEqual([
      '2 machines · 11 appels · 2 problèmes non vus',
      'raspberry · 11 appels · ✓ ssh_disk_usage',
      'win2025 · 0 appel · ✗ injoignable',
    ])
    expect(lines[2]?.[0]).toStrictEqual({ text: 'win2025', tone: M(1) })
    expect(lines[5]?.[2]).toStrictEqual({ text: 'win2025', tone: M(1) })
  })

  test('une machine dont le nom contient « 1 machine · 1 appel · » n’est pas prise pour le résumé', () => {
    const c = call({ host: 'a 1 machine' })
    const lines = cardLines(stateOf([c]), '', 10_000)
    expect(text(lines[1] ?? [])).toBe('a 1 machine · 1 appel · ✓ ssh_disk_usage')
    expect(lines[1]?.[0]).toStrictEqual({ text: 'a 1 machine', tone: M(0) })
  })
})

describe('pipeline : le texte autour des identifiants', () => {
  test('la typographie ne touche pas à l’identifiant de la machine, même avec une apostrophe', () => {
    const c = call({ host: "l'hôte", state: 'injoignable', accord: 'formulaire-oui' })
    expect(text(pipeline(c))).toBe(`✓ accord · ✗ l'hôte injoignable · ${RIEN}`)
  })

  test('une machine inconnue (hôte nul) s’écrit « machine inconnue » (D10) ; un hôte vide ne casse pas la typographie', () => {
    expect(text(pipeline(call({ host: null, state: 'injoignable' })))).toBe(`✗ machine inconnue injoignable · ${RIEN}`)
    expect(text(pipeline(call({ host: '', state: 'injoignable', accord: 'formulaire-oui' })))).toBe(
      `✓ accord · ✗  injoignable · ${RIEN}`,
    )
  })
})

describe('fit : morceaux et tons conservés', () => {
  test('une tête qui tient tout juste, avec ou sans place pour « … » ou « … » précédé d’un espace', () => {
    const line: Line = [{ text: '✗ win2025 · injoignable · détail', tone: 'texte' }]
    expect(fit(line, 23)).toStrictEqual([{ text: '✗ win2025 · injoignable', tone: 'texte' }])
    expect(fit(line, 24)).toStrictEqual([
      { text: '✗ win2025 · injoignable', tone: 'texte' },
      { text: '…', tone: 'attenue' },
    ])
    expect(fit(line, 25)).toStrictEqual([
      { text: '✗ win2025 · injoignable', tone: 'texte' },
      { text: ' …', tone: 'attenue' },
    ])
  })

  test('coupée au caractère : les voisins de même ton fusionnent, jamais deux machines ni deux tons différents', () => {
    const line: Line = [
      { text: 'ab', tone: M(0) },
      { text: 'cd', tone: M(0) },
      { text: 'ef', tone: M(1) },
      { text: 'gh', tone: 'texte' },
      { text: 'ij', tone: 'texte' },
      { text: 'kl', tone: 'attenue' },
      { text: 'mn', tone: 'texte' },
    ]
    expect(fit(line, 13)).toStrictEqual([
      { text: 'abcd', tone: M(0) },
      { text: 'ef', tone: M(1) },
      { text: 'ghij', tone: 'texte' },
      { text: 'kl…', tone: 'attenue' },
    ])
  })

  test('40 colonnes sur l’appel attendu : chaque morceau garde son ton, l’outil coupé aussi', () => {
    const long = call({
      id: 'toolu_l#0',
      toolUseId: 'toolu_l',
      host: 'win2025ntlm',
      tool: 'ssh_win_disk_usage',
      state: 'en-cours',
      endedAt: undefined,
    })
    const s = stateOf([long], {
      waiting: { tool: 'ssh_win_disk_usage', host: 'win2025ntlm', callId: 'toolu_l#0', since: 2_000 },
    })
    expect(callLine(long, s, 40)).toStrictEqual([
      { text: WAIT_SIGN, tone: 'attention' },
      { text: ' ', tone: 'texte' },
      { text: 'win2025ntlm', tone: M(0) },
      { text: ' · ', tone: 'attenue' },
      { text: 'ssh', tone: 'texte' },
      { text: '… · ', tone: 'attenue' },
      { text: 'attend ton accord', tone: 'attention' },
    ])
  })
})

describe('bandLines : tons exacts et cas limites', () => {
  const running = (i: number, host: string) =>
    call({ id: `toolu_b${i}#0`, toolUseId: `toolu_b${i}`, host, state: 'en-cours', endedAt: undefined })

  test('plusieurs appels : chaque morceau garde son ton, « +n » seulement au-delà de trois machines', () => {
    const three = bandLines(stateOf([running(1, 'raspberry'), running(2, 'win2025'), running(3, 'win2012')]), CTX)
    expect(three).toStrictEqual([
      [
        { text: '●', tone: 'accent' },
        { text: ' 3 appels', tone: 'texte' },
        { text: ' · ', tone: 'attenue' },
        { text: 'raspberry', tone: M(0) },
        { text: ', ', tone: 'texte' },
        { text: 'win2025', tone: M(1) },
        { text: ', ', tone: 'texte' },
        { text: 'win2012', tone: M(2) },
      ],
    ])
    const four = bandLines(
      stateOf([running(1, 'raspberry'), running(2, 'win2025'), running(3, 'win2012'), running(4, 'win2012ps')]),
      CTX,
    )
    expect(four[0]?.at(-1)).toStrictEqual({ text: ' +1', tone: 'attenue' })
    expect(text(four[0] ?? [])).toBe('● 4 appels · raspberry, win2025, win2012 +1')
  })

  test('« à toi » : morceaux et tons exacts, machine inconnue de l’état en texte', () => {
    const w = (host: string | null) => ({ tool: 'ssh_file_write', host, callId: null, since: 2_000 })
    const known = stateOf([call({ host: 'win2025' })], { waiting: w('win2025') })
    expect(bandLines(known, CTX)).toStrictEqual([
      [
        { text: `${WAIT_SIGN} à toi`, tone: 'attention' },
        { text: `${NBSP}: réponds au formulaire (`, tone: 'texte' },
        { text: 'win2025', tone: M(0) },
        { text: ')', tone: 'texte' },
      ],
    ])
    const ghost = stateOf([], { waiting: w('ghost') })
    expect(bandLines(ghost, CTX)).toStrictEqual([
      [
        { text: `${WAIT_SIGN} à toi`, tone: 'attention' },
        { text: `${NBSP}: réponds au formulaire (ghost)`, tone: 'texte' },
      ],
    ])
    const noHost = stateOf([], { waiting: w(null) })
    expect(bandLines(noHost, CTX)).toStrictEqual([
      [
        { text: `${WAIT_SIGN} à toi`, tone: 'attention' },
        { text: `${NBSP}: réponds au formulaire (ssh_file_write)`, tone: 'texte' },
      ],
    ])
  })

  test('l’appel attendu : une machine hors de l’état garde le ton texte', () => {
    const asking = call({ id: 'toolu_w#0', toolUseId: 'toolu_w', state: 'en-cours', endedAt: undefined })
    const s = stateOf([], {
      waiting: { tool: 'ssh_disk_usage', host: 'raspberry', callId: 'toolu_w#0', since: 1 },
    })
    expect(callLine(asking, s, 120)[1]).toStrictEqual({ text: ' raspberry', tone: 'texte' })
  })

  test('vue d’un sous-agent : une attente dont l’appel est inconnu ou sans identifiant n’est pas la sienne', () => {
    const mine = call({
      id: 'toolu_m#0',
      toolUseId: 'toolu_m',
      agentId: 'a1',
      host: 'win2025',
      state: 'en-cours',
      endedAt: undefined,
    })
    const ctx = { ...CTX, viewAgentId: 'a1' }
    for (const callId of ['toolu_absent#0', null]) {
      const s = stateOf([mine], { waiting: { tool: 'ssh_exec', host: 'win2025', callId, since: 2_000 } })
      expect(bandLines(s, ctx).map(text)).toStrictEqual(['● win2025 · ssh_disk_usage'])
    }
  })

  test('plusieurs workflows : le plus récent, et le dernier de la liste à égalité', () => {
    const newer = workflow({ key: 'wf_a', name: 'recent', startedAt: 6_000 })
    const older = workflow({ key: 'wf_b', name: 'ancien', startedAt: 4_000 })
    expect(bandLines(stateOf([], { workflows: [newer, older] }), CTX).map(text)).toStrictEqual([
      '● workflow recent · Audit · 3 agents',
    ])
    const first = workflow({ key: 'wf_c', name: 'premier', startedAt: 5_000 })
    const second = workflow({ key: 'wf_d', name: 'second', startedAt: 5_000 })
    expect(bandLines(stateOf([], { workflows: [first, second] }), CTX).map(text)).toStrictEqual([
      '● workflow second · Audit · 3 agents',
    ])
  })
})

// Arbitrages de l'utilisateur du 2026-10-21 (REFERENCE.md, D1 à D4, D9, D10, D12).
describe('pipeline : le ton de l’état et la couleur de la machine (D1, D2)', () => {
  const late = call({ id: 'toolu_l#0', toolUseId: 'toolu_l', host: 'win2025', state: 'delai-depasse' })
  const s = stateOf([call(), late])

  test('D1 : « délai dépassé » est en attention dans le pipeline, comme sur la rangée et dans la carte', () => {
    expect(pipeline(late, s)).toStrictEqual([
      { text: '✗', tone: 'attention' },
      { text: ' ', tone: 'texte' },
      { text: 'win2025', tone: M(1) },
      { text: ' ', tone: 'texte' },
      { text: 'délai dépassé', tone: 'attention' },
    ])
    // La rangée du même appel : même signe, même ton d'état.
    const row = callLine(late, s, 200)
    expect(row.find((p) => p.text === '✗')?.tone).toBe('attention')
  })

  test('D1 : le signe ✗ de chaque état prend le ton de §5.4, et le mot d’état aussi', () => {
    for (const st of ALL_STATES) {
      const row = STATE_TABLE[st]
      if (row.sign !== '✗') continue
      const line = pipeline(call({ host: 'win2025', state: st, code: 1 }), s)
      expect(line.find((p) => p.text === '✗')?.tone).toBe(row.tone)
    }
    const limited = pipeline(call({ state: 'limite', host: 'raspberry' }), s)
    expect(limited.find((p) => p.text === 'limité par le bridge')?.tone).toBe('attention')
    const usage = pipeline(call({ state: 'erreur-usage' }), s)
    expect(usage.find((p) => p.text === 'erreur d’usage')?.tone).toBe('attention')
    expect(usage.find((p) => p.text === '✗')?.tone).toBe('attention')
    const refused = pipeline(call({ state: 'refuse' }), s)
    expect(refused.find((p) => p.text === '✗')?.tone).toBe('erreur')
    expect(refused.find((p) => p.text === 'refusé par le bridge')?.tone).toBe('erreur')
    const down = pipeline(call({ host: 'win2025', state: 'injoignable' }), s)
    expect(down.find((p) => p.text === 'injoignable')?.tone).toBe('erreur')
  })

  test('D2 : la machine garde sa couleur dans le pipeline, avec ou sans étape d’accord, y compris pour « code N »', () => {
    const down = call({ host: 'win2025', state: 'injoignable', accord: 'formulaire-oui' })
    const line = pipeline(down, s)
    expect(line.find((p) => p.text === 'win2025')?.tone).toStrictEqual(M(1))
    expect(line.find((p) => p.text.includes('accord'))?.tone).toBe('texte')
    expect(line.find((p) => p.text === '✓')?.tone).toBe('ok')
    const coded = pipeline(call({ state: 'code', code: 2 }), s)
    expect(coded.map((p) => [p.text, p.tone])).toStrictEqual([
      ['✓ ', 'texte'], // « code N » : signe en ton texte (§5.4)
      ['raspberry', M(0)],
      [' code 2', 'texte'],
    ])
    const failed = pipeline(call({ host: 'win2025', state: 'echec-machine', code: 3 }), s)
    expect(failed.find((p) => p.text === 'win2025')?.tone).toStrictEqual(M(1))
    expect(failed.find((p) => p.text === '✗')?.tone).toBe('erreur')
  })

  test('une machine non prouvée sur une étape « fait » (✓) reste la machine, atténuée : ce n’est pas l’état « machine inconnue »', () => {
    const done = call({ host: null, state: 'fait' })
    const line = pipeline(done, stateOf([done]))
    expect(text(line)).toBe('✓ machine inconnue')
    expect(line).toStrictEqual([
      { text: '✓', tone: 'ok' },
      { text: ' ', tone: 'texte' },
      { text: 'machine inconnue', tone: 'attenue' },
    ])
    // Sans état fourni : même chose.
    expect(pipeline(done)).toStrictEqual(line)
  })

  test('un hôte vide : le mot d’état garde son ton, le texte ne bouge pas', () => {
    const empty = call({ host: '', state: 'injoignable' })
    const line = pipeline(empty, stateOf([empty]))
    expect(text(line)).toBe(`✗  injoignable · ${RIEN}`)
    expect(line.find((p) => p.text === 'injoignable')?.tone).toBe('erreur')
    expect(line[0]).toStrictEqual({ text: '✗', tone: 'erreur' })
  })

  test('D2 : sans état fourni, la machine garde le ton texte (aucun index de couleur connu)', () => {
    expect(pipeline(late).find((p) => p.text.includes('win2025'))?.tone).toBe('texte')
  })

  test('D1 et D2 dans la carte : « à regarder » colore le pipeline du plus récent problème, et il se relit à l’identique', () => {
    const t = cardLines(s, '', 10_000)
    const at = t.map(text).indexOf(`à regarder${NBSP}:`)
    expect(t[at + 1]).toStrictEqual(pipeline(late, s))
    expect(parseCard(cardText(t))).toStrictEqual(t)
  })

  test('D1 et D2 dans la carte d’une machine : la ligne de pipeline est colorée comme celle de « à regarder »', () => {
    const t = cardLines(s, ' win2025 ', 10_000)
    expect(t[t.length - 1]).toStrictEqual(pipeline(late, s))
    expect(parseCard(cardText(t))).toStrictEqual(t)
  })

  test('une ligne de pipeline « déjà vu » reste atténuée en entier', () => {
    const seen = stateOf([call(), late], { seenAt: 9_000 })
    const t = cardLines(seen, '', 10_000)
    const at = t.map(text).indexOf(`à regarder${NBSP}:`)
    expect(t[at + 1]).toStrictEqual([{ text: '✗ win2025 délai dépassé · déjà vu', tone: 'attenue' }])
  })
})

describe('pipeline : accord refusé et machine non prouvée (D9, D10)', () => {
  const s = stateOf([call()])

  test('D9 : un appel décliné écrit « ○ accord refusé · rien n’a tourné », signe ○, tout atténué', () => {
    const declined = call({ tool: 'ssh_file_write', state: 'decline', accord: 'formulaire-non' })
    const line = pipeline(declined, s)
    expect(text(line)).toBe(`○ accord refusé · ${RIEN}`)
    expect(line.filter((p) => p.tone !== 'attenue' && p.text !== ' ')).toStrictEqual([])
    expect(line[0]).toStrictEqual({ text: '○', tone: 'attenue' })
    expect(text(pipeline(call({ state: 'decline' }), s))).toBe(`○ accord refusé · ${RIEN}`)
  })

  test('D10 : une machine non prouvée s’écrit « machine inconnue » dans le pipeline, atténuée comme sur la rangée', () => {
    const none = call({ host: null, state: 'injoignable' })
    const line = pipeline(none, stateOf([none]))
    expect(text(line)).toBe(`✗ machine inconnue injoignable · ${RIEN}`)
    expect(line.find((p) => p.text.startsWith('machine inconnue'))?.tone).toBe('attenue')
    expect(line.find((p) => p.text === 'injoignable')?.tone).toBe('erreur')
    const coded = call({ host: null, state: 'code', code: 2 })
    expect(text(pipeline(coded, stateOf([coded])))).toBe('✓ machine inconnue code 2')
    const unknown = call({ host: null, state: 'machine-inconnue' })
    expect(text(pipeline(unknown, stateOf([unknown])))).toBe(`✗ machine inconnue · ${RIEN}`)
    expect(pipeline(unknown, stateOf([unknown])).find((p) => p.text === 'machine inconnue')?.tone).toBe('erreur')
  })
})

describe('carte : un appel sans machine prouvée reste visible (D3)', () => {
  const none = call({ id: 'toolu_n#0', toolUseId: 'toolu_n', host: null, state: 'incertain', startedAt: 2_000 })

  test('seul : « machine inconnue » avec son compte et son dernier résultat, compté dans le résumé', () => {
    const lines = cardLines(stateOf([none]), '', 10_000)
    expect(lines.map(text)).toStrictEqual([
      '0 machine · 1 appel · aucun problème non vu',
      'machine inconnue · 1 appel · ? incertain',
    ])
    const row = lines[1] ?? []
    expect(row[0]).toStrictEqual({ text: 'machine inconnue · ', tone: 'attenue' })
    expect(row.find((p) => p.text === 'incertain')?.tone).toBe('attenue')
    expect(row.find((p) => p.text === '1 appel')?.tone).toBe('texte')
    expect(parseCard(cardText(lines))).toStrictEqual(lines)
  })

  test('avec des machines : la ligne vient après elles, sans décaler leurs couleurs, et le résumé additionne les appels', () => {
    const win = call({ id: 'toolu_w#0', toolUseId: 'toolu_w', host: 'win2025', startedAt: 1_500 })
    const lines = cardLines(stateOf([call(), win, none]), '', 10_000)
    expect(lines.map(text)).toStrictEqual([
      '2 machines · 3 appels · aucun problème non vu',
      'raspberry · 1 appel · ✓ ssh_disk_usage',
      'win2025 · 1 appel · ✓ ssh_disk_usage',
      'machine inconnue · 1 appel · ? incertain',
    ])
    expect(lines[1]?.[0]?.tone).toStrictEqual(M(0))
    expect(lines[2]?.[0]?.tone).toStrictEqual(M(1))
    expect(lines[3]?.[0]?.tone).toBe('attenue')
    expect(parseCard(cardText(lines))).toStrictEqual(lines)
  })

  test('un état « machine inconnue » : 0 appel, le problème est compté et « à regarder » le montre', () => {
    const bad = call({ id: 'toolu_b#0', toolUseId: 'toolu_b', host: null, state: 'machine-inconnue', startedAt: 2_000 })
    const lines = cardLines(stateOf([bad]), '', 10_000).map(text)
    expect(lines.slice(0, 3)).toStrictEqual([
      '0 machine · 0 appel · 1 problème non vu',
      'machine inconnue · 0 appel · ✗ machine inconnue',
      `à regarder${NBSP}:`,
    ])
  })

  test('un problème non vu plus ancien sur ces appels reste signalé même si le dernier est incertain', () => {
    const bad = call({
      id: 'toolu_b#0',
      toolUseId: 'toolu_b',
      host: null,
      state: 'machine-inconnue',
      startedAt: 1_000,
      endedAt: 1_100,
    })
    const lines = cardLines(stateOf([bad, none]), '', 10_000).map(text)
    expect(lines[1]).toBe('machine inconnue · 1 appel · ? incertain · ✗ problème non vu')
  })

  test('plusieurs appels sans machine : un seul compte, le dernier résultat est celui du dernier appel commencé', () => {
    const two = call({ id: 'toolu_m#0', toolUseId: 'toolu_m', host: null, state: 'fait', startedAt: 3_000 })
    const lines = cardLines(stateOf([call(), none, two]), '', 10_000).map(text)
    expect(lines).toStrictEqual([
      '1 machine · 3 appels · aucun problème non vu',
      'raspberry · 1 appel · ✓ ssh_disk_usage',
      'machine inconnue · 2 appels · ✓ ssh_disk_usage',
    ])
  })

  test('/clair <machine> garde la ligne « machine inconnue » parmi les machines', () => {
    const lines = cardLines(stateOf([call(), none]), ' raspberry ', 10_000).map(text)
    expect(lines.slice(0, 2)).toStrictEqual([
      'raspberry · 1 appel · ✓ ssh_disk_usage',
      'machine inconnue · 1 appel · ? incertain',
    ])
  })
})

describe('bande : workflow sans nom lisible (D12)', () => {
  test('« workflow en cours », jamais « workflow » seul', () => {
    const anon = workflow({ name: '', phases: [], agents: [] })
    expect(bandLines(stateOf([], { workflows: [anon] }), CTX).map(text)).toStrictEqual(['● workflow en cours'])
    const phased = workflow({ name: '' })
    expect(bandLines(stateOf([], { workflows: [phased] }), CTX).map(text)).toStrictEqual([
      '● workflow en cours · Audit · 3 agents',
    ])
  })

  test('sans nom : à distance et sans nouvelles restent dits, sans « en cours » contradictoire', () => {
    const remote = workflow({ name: '', status: 'distant', agents: [], journalPath: null })
    expect(bandLines(stateOf([], { workflows: [remote] }), CTX).map(text)).toStrictEqual(['● workflow · à distance'])
    const quiet = workflow({ name: '', status: 'sans-nouvelles', agents: [] })
    expect(cardLines(stateOf([], { workflows: [quiet] }), '', 10_000).map(text)).toStrictEqual([
      '○ workflow · sans nouvelles',
    ])
  })
})

describe('fit : un nom de machine plus long que la ligne est coupé, l’état reste entier (D4, R93)', () => {
  const LONG = `machine-${'x'.repeat(52)}`
  const down = call({ host: LONG, state: 'injoignable' })
  const s = stateOf([down])

  test('40 colonnes : « machine-xx… · injoignable », nom en couleur, « … » atténué, détails retirés', () => {
    const line = callLine(down, s, 40)
    expect(text(line)).toBe(`✗ machine-${'x'.repeat(15)}… · injoignable`)
    expect(cellWidth(text(line))).toBeLessThanOrEqual(40)
    expect(line).toStrictEqual([
      { text: '✗', tone: 'erreur' },
      { text: ' ', tone: 'texte' },
      { text: `machine-${'x'.repeat(15)}`, tone: M(0) },
      { text: '… · ', tone: 'attenue' },
      { text: 'injoignable', tone: 'erreur' },
    ])
  })

  test('l’état d’un appel en cours (l’outil) reste entier dans la bande à 40 colonnes', () => {
    const run = call({ host: LONG, state: 'en-cours', endedAt: undefined })
    const lines = bandLines(stateOf([run]), { ...CTX, columns: 40 })
    expect(lines.map(text)).toStrictEqual([`● machine-${'x'.repeat(12)}… · ssh_disk_usage`])
  })

  test('largeur en cellules, pas en points de code : un nom en caractères larges se coupe en cellules', () => {
    const wide = call({ host: '工'.repeat(30), state: 'injoignable' })
    for (let columns = 24; columns <= 60; columns += 1) {
      const line = callLine(wide, stateOf([wide]), columns)
      expect(cellWidth(text(line))).toBeLessThanOrEqual(columns)
      expect(text(line)).toContain(' · injoignable')
    }
    const at40 = callLine(wide, stateOf([wide]), 40)
    expect(text(at40)).toBe(`✗ ${'工'.repeat(11)}… · injoignable`)
  })

  test('un nom qui tient, ou un état trop long pour la ligne, garde l’ancien comportement', () => {
    expect(text(callLine(call(), stateOf([call()]), 200))).toBe('✓ raspberry · ssh_disk_usage · lecture')
    const tight = callLine(down, s, 12)
    expect(cellWidth(text(tight))).toBeLessThanOrEqual(12)
    expect(text(tight).endsWith('…')).toBe(true)
  })

  test('à chaque largeur, de la plus étroite à 80 colonnes, rien ne dépasse', () => {
    for (let columns = 1; columns <= 80; columns += 1) {
      expect(cellWidth(text(callLine(down, s, columns)))).toBeLessThanOrEqual(columns)
    }
  })

  test('fit sans l’option garde la coupe par caractères (autres lignes du mod)', () => {
    const line: Line = [{ text: '✗ win2025-long · injoignable', tone: 'texte' }]
    expect(text(fit(line, 24))).toBe('✗ win2025-long · injoig…')
    expect(text(fit(line, 24, true))).toBe('✗ win2025… · injoignable')
  })

  test('avec l’option : une ligne sans séparation se coupe par la fin, une ligne de résumé reste intacte', () => {
    const alone: Line = [{ text: '✗ machine-très-longue', tone: 'texte' }]
    expect(text(fit(alone, 10, true))).toBe('✗ machine…')
    // Un pipeline sans machine (accord, échec sans nom) n'a rien à couper : coupe par la fin.
    const noHost: Line = [{ text: '✓ accord · ✗ échec · rien n’a tourné', tone: 'texte' }]
    expect(text(fit(noHost, 14, true))).toBe(text(fit(noHost, 14)))
    const unsigned: Line = [{ text: 'machine · injoignable · détail', tone: 'texte' }]
    expect(text(fit(unsigned, 12, true))).toBe(text(fit(unsigned, 12)))
    const bare: Line = [{ text: 'win2025-long · injoignable', tone: 'texte' }]
    expect(text(fit(bare, 20, true))).toBe(text(fit(bare, 20)))
  })
})

describe('pipeline : machine nommée et état « machine inconnue » (D2)', () => {
  test('« ✗ host inconnue » : la machine garde sa couleur, « inconnue » le ton d’erreur', () => {
    const c = call({ host: 'win2025', state: 'machine-inconnue' })
    const s = stateOf([call(), c])
    const line = pipeline(c, s)
    expect(text(line)).toBe(`✗ win2025 inconnue · ${RIEN}`)
    expect(line.find((p) => p.text === 'win2025')?.tone).toStrictEqual(M(1))
    expect(line.find((p) => p.text === 'inconnue')?.tone).toBe('erreur')
    expect(line[0]).toStrictEqual({ text: '✗', tone: 'erreur' })
  })
})

describe('carte : un nom de machine plus long que la ligne est coupé sur chaque ligne, l’état reste entier (D4, R93)', () => {
  const LONG = `machine-${'x'.repeat(52)}`
  const run = call({ id: 'toolu_r#0', toolUseId: 'toolu_r', host: LONG, state: 'en-cours', endedAt: undefined })
  const down = call({
    id: 'toolu_d#0',
    toolUseId: 'toolu_d',
    host: LONG,
    state: 'injoignable',
    startedAt: 2_000,
    endedAt: 2_100,
  })
  const late = call({
    id: 'toolu_e#0',
    toolUseId: 'toolu_e',
    host: LONG,
    state: 'delai-depasse',
    startedAt: 3_000,
    endedAt: 3_100,
  })
  const s = stateOf([run, down, late])
  const drawn = (args: string, columns: number) => cardLines(s, args, 10_000).map((l) => text(fit(l, columns, true)))

  test('rangée de machine : « nom… · N appels · état »', () => {
    const row = drawn('', 60)[1] as string
    expect(cellWidth(row)).toBeLessThanOrEqual(60)
    expect(row).toMatch(/^machine-x+… · 2 appels · ✗ délai dépassé$/)
    const narrow = drawn('', 40)[1] as string
    expect(cellWidth(narrow)).toBeLessThanOrEqual(40)
    expect(narrow).toMatch(/^machine-x+… · 2 appels · ✗ délai dépassé$/)
    expect(narrow.length).toBeGreaterThan(30)
  })

  test('ligne d’appel de « à regarder » : « ✗ nom… · état »', () => {
    const rows = drawn('', 40)
    const at = rows.indexOf(`à regarder${NBSP}:`)
    const entries = rows.slice(at + 2) // après le pipeline du plus récent : les autres appels
    expect(entries.length).toBeGreaterThan(0)
    for (const e of entries) {
      expect(cellWidth(e)).toBeLessThanOrEqual(40)
      expect(e).toMatch(/^✗ machine-x+… · (injoignable|délai dépassé)$/)
    }
  })

  test('ligne de pipeline : « ✗ nom… état »', () => {
    const rows = drawn('', 40)
    const at = rows.indexOf(`à regarder${NBSP}:`)
    const pipe = rows[at + 1] as string
    expect(cellWidth(pipe)).toBeLessThanOrEqual(40)
    expect(pipe).toMatch(/^✗ machine-x+… délai dépassé$/)
  })

  test('pipeline à plusieurs étapes : l’accord reste, le nom est coupé, l’état reste', () => {
    const asked = call({
      id: 'toolu_a#0',
      toolUseId: 'toolu_a',
      host: LONG,
      state: 'injoignable',
      accord: 'formulaire-oui',
      startedAt: 4_000,
      endedAt: 4_100,
    })
    const rows = cardLines(stateOf([asked]), '', 10_000).map((l) => text(fit(l, 40, true)))
    const at = rows.indexOf(`à regarder${NBSP}:`)
    expect(cellWidth(rows[at + 1] as string)).toBeLessThanOrEqual(40)
    expect(rows[at + 1]).toMatch(/^✓ accord · ✗ machine-x+… injoignable$/)
  })

  test('/clair <machine> : la ligne d’appel et le pipeline de la machine', () => {
    const rows = drawn(LONG, 40)
    const at = rows.findIndex((r) => r.startsWith('dernier appel sur'))
    expect(rows[at + 1]).toMatch(/^✗ machine-x+… · délai dépassé$/)
    expect(rows[at + 2]).toMatch(/^✗ machine-x+… délai dépassé$/)
    for (const r of rows.slice(at + 1)) expect(cellWidth(r)).toBeLessThanOrEqual(40)
  })

  test('largeur étroite (24) : l’état reste entier tant qu’il tient avec un nom d’un caractère', () => {
    for (const r of drawn('', 24).slice(1, 2)) expect(cellWidth(r)).toBeLessThanOrEqual(24)
    const rows = drawn('', 24)
    const at = rows.indexOf(`à regarder${NBSP}:`)
    expect(rows[at + 1]).toMatch(/^✗ machine[-x]*… délai dépassé$/)
  })

  test('les lignes qui n’ont pas de nom de machine, ou un nom qui tient, restent coupées comme avant', () => {
    const wf = workflow({ name: 'une-tres-longue-enquete-de-workflow-sur-plusieurs-lignes' })
    const line = cardLines(stateOf([], { workflows: [wf] }), '', 10_000)[0] as Line
    expect(text(fit(line, 40, true))).toBe(text(fit(line, 40)))
    const small = stateOf([call()])
    for (const l of cardLines(small, '', 10_000)) expect(text(fit(l, 200, true))).toBe(text(l))
  })
})

describe('fit avec cutName : formes de ligne reconnues (D4)', () => {
  const L = (t: string): Line => [{ text: t, tone: 'texte' }]
  const cut = (t: string, columns: number) => text(fit(L(t), columns, true))
  const plain = (t: string, columns: number) => text(fit(L(t), columns))
  const NAME = 'machine-xxxxxxxxxxxxxxxxxxxxxxxx'

  test('rangée de machine : « N appel(s) » en second segment, rien d’autre', () => {
    for (const n of ['1 appel', '3 appels', '12 appels']) {
      const t = `${NAME} · ${n} · ✓ ssh_disk_usage`
      expect(cut(t, 40)).toMatch(new RegExp(`^machine-x*… · ${n} · ✓ ssh_disk_usage$`))
    }
    for (const n of ['x2 appels', '2 appels de plus', '2 appelsx', 'appels']) {
      const t = `${NAME} · ${n} · ✓ ssh_disk_usage`
      expect(cut(t, 40)).toBe(plain(t, 40))
    }
  })

  test('la bande de plusieurs appels et le workflow sont coupés par la fin, comme avant', () => {
    for (const t of [
      '● 2 appels · host-a, host-b',
      '● 12 appels · host-a, host-b',
      '● workflow audit-disques-de-toute-la-flotte · Audit',
      '○ workflowx · sans nouvelles · Audit-tres-long',
    ]) {
      expect(cut(t, 24)).toBe(plain(t, 24))
    }
    // Une machine dont le nom ressemble ne les imite pas : elle est coupée.
    expect(cut(`✗ ci-workflow-${NAME} · injoignable`, 40)).toMatch(/^✗ ci-workflow-[a-z-]*… · injoignable$/)
    expect(cut(`✗ 2 appelsfoo-${NAME} · injoignable`, 40)).toMatch(/^✗ 2 appelsfoo-[a-z-]*… · injoignable$/)
  })

  test('pipeline : une seule étape suivie de « rien n’a tourné », ou de « tronqué »', () => {
    expect(cut(`✗ ${NAME} injoignable · rien n’a tourné`, 40)).toMatch(/^✗ machine-x*… injoignable$/)
    expect(cut(`✓ ${NAME} · tronqué`, 24)).toMatch(/^✓ machine-x*… · tronqué$/)
    expect(cut(`✓ ${NAME}`, 24)).toMatch(/^✓ machine-x*…$/)
  })

  test('pipeline : l’étape sans état (un appel fait) garde son drapeau « tronqué » ; le reste de la ligne tombe', () => {
    expect(cut(`✓ accord · ✓ ${NAME} · tronqué`, 34)).toMatch(/^✓ accord · ✓ machi[a-z-]*… · tronqué$/)
    expect(cut(`✓ accord · ✓ ${NAME} · autre`, 24)).toMatch(/^✓ accord · ✓ machi[a-z-]*…$/)
  })

  test('pipeline : « machine état » suivi de « tronqué » garde l’état, le drapeau tombe avec les détails', () => {
    expect(cut(`✗ ${NAME} délai dépassé · tronqué`, 40)).toMatch(/^✗ machin[a-z-]*… délai dépassé$/)
  })

  test('pipeline : un état sans machine n’est jamais pris pour un nom, même suivi de « tronqué »', () => {
    const t = '✗ échec · tronqué'
    expect(cut(t, 14)).toBe(plain(t, 14))
  })

  test('pipeline sans machine : coupé par la fin, l’état n’est jamais pris pour un nom', () => {
    const t = '✓ accord · ✗ échec · rien n’a tourné'
    expect(cut(t, 20)).toBe(plain(t, 20))
    const u = '✗ erreur d’usage · rien n’a tourné'
    expect(cut(u, 14)).toBe(plain(u, 14))
  })
})
