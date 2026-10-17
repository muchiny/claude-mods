import { describe, expect, test } from 'claude-code/testing'
import { steps } from '../../hooks/bridge'
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
      expect(width(t)).toBeLessThanOrEqual(40)
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
  test('20 colonnes : aucune exception, coupée par la fin, la machine reste, les tons aussi', () => {
    const s = stateOf([call({ host: 'win2025ntlm' })])
    for (const st of ALL_STATES) {
      const line = callLine(call({ host: 'win2025ntlm', state: st, code: 1 }), s, 20)
      const t = text(line)
      expect(width(t)).toBeLessThanOrEqual(20)
      expect(t.startsWith(`${STATE_TABLE[st].sign} win2025ntlm`)).toBe(true)
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
      ...calls.map(pipeline),
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
