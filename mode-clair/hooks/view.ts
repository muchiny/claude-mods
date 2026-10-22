// Ce que le mod dessine, en lignes de morceaux { text, tone } (spec §4, §5.4).
// Pur : aucun $, aucune horloge. register.tsx traduit les tons en couleurs ;
// c'est sa seule décision.
//
// Les lignes d'appel et la carte /clair passent par un même colorieur
// (toneLine), qui lit les tons dans le seul texte de la ligne : signe, état,
// machine. La carte est d'abord une suite de lignes de texte ; c'est ce qui
// permet à parseCard de la redessiner à l'identique depuis e.props.text.

import type {
  BridgeCall,
  CallState,
  ClairState,
  Line,
  Nature,
  Piece,
  Superpowers,
  Tone,
  Waiting,
  Workflow,
} from '../types'
import { steps, stripControls } from './bridge'
import { cellWidth } from './cells'
import { fr } from './fr'
import { hostIndex, machines, problems, STATE_TABLE, unknownMachine, unseenProblems } from './state'
import { active, currentPhase } from './workflow'

export type Ctx = { now: number; columns: number; isWorking: boolean; viewAgentId?: string }

/** Signe d'attente (spec §4.1) : ⚠ suivi du sélecteur texte U+FE0E, ou ▲, selon la sonde du terminal (spec §10). */
export const WAIT_SIGN: string = '\u26A0\uFE0E'

const SEP = ' · '
const NOTHING_RAN = fr("rien n'a tourné")
const SEE_CARD = fr('voir /clair')
const TRUNCATED = fr('tronqué')
const UNKNOWN_HOST = fr('machine inconnue')
const SEEN = fr('déjà vu')
const UNSEEN_MARK = fr('problème non vu')
const NONE_UNSEEN = fr('aucun problème non vu')
const REMOTE = fr('à distance')
const QUIET = fr('sans nouvelles')
const STALE = fr('abandonné')
const WAITS = fr('attend ton accord')
const NATURE: Readonly<Record<Nature, string>> = {
  lecture: 'lecture',
  'peut-modifier': 'peut modifier',
  inconnu: 'inconnu',
}
const MARK_SIGN = { ok: '✓', ko: '✗', off: '○' } as const
const SIGNS: readonly string[] = [WAIT_SIGN, '●', '✓', '✗', '○', '?']
const SIGN_TONE: Readonly<Record<string, Tone>> = {
  '●': 'accent',
  '✓': 'ok',
  '✗': 'erreur',
  '○': 'attenue',
  '?': 'attenue',
}
const WORD_TONE: ReadonlyMap<string, Tone> = new Map<string, Tone>([
  [NOTHING_RAN, 'attenue'],
  [SEE_CARD, 'attenue'],
  [TRUNCATED, 'attention'],
  [UNSEEN_MARK, 'erreur'],
  [NONE_UNSEEN, 'attenue'],
  [REMOTE, 'attenue'],
  [QUIET, 'attenue'],
  [STALE, 'attenue'],
  [fr(NATURE.lecture), 'attenue'],
  [fr(NATURE['peut-modifier']), 'attenue'],
  [fr(NATURE.inconnu), 'attenue'],
])
const CODE_WORD = /^code[ \u00A0](?:\d+|\?)$/
const UNSEEN_COUNT = /^\d+ problèmes? non vus?$/

type IndexOf = (name: string) => number
// Stryker disable next-line ArrowFunction: wordTone ne lit l'index que par « i >= 0 » : undefined >= 0 est faux comme -1 >= 0.
const NO_HOSTS: IndexOf = () => -1

/**
 * Identifiant affiché sur une seule ligne, sans caractère de contrôle (un ESC dessiné par la carte reconfigurerait le terminal)
 * ni d'usurpation d'affichage (stripControls). toneLine relit le texte rendu : un nom ne doit y fabriquer ni séparateur
 * (« · » devient « . ») ni signe de tête (« ✗ x » devient « - x »), de même largeur.
 */
function one(s: string): string {
  const name = stripControls(s.replace(/[\r\n\t]+/g, ' ')).replaceAll('·', '.')
  const sign = signAt(name)
  return sign === null ? name : `-${name.slice(sign.length)}`
}

/** Un ton se compare par sa clé : son nom, ou « machine:N » (deux objets de même machine sont le même ton). */
function toneKey(t: Tone): string {
  return typeof t === 'string' ? t : `machine:${t.machine}`
}

/** Morceaux vides retirés, voisins de même ton fusionnés : une seule écriture par ligne. */
function norm(line: readonly Piece[]): Line {
  const out: Piece[] = []
  for (const p of line) {
    if (p.text === '') continue
    const last = out[out.length - 1]
    if (last !== undefined && toneKey(last.tone) === toneKey(p.tone))
      out[out.length - 1] = { text: last.text + p.text, tone: last.tone }
    else out.push({ text: p.text, tone: p.tone })
  }
  return out
}

function textOf(line: Line): string {
  return line.map((p) => p.text).join('')
}

function label(state: CallState): string {
  return fr(STATE_TABLE[state].label)
}

function codeText(code: number | undefined): string {
  return fr(`code ${code === undefined ? '?' : String(code)}`)
}

function hostText(host: string | null): string {
  return host === null ? UNKNOWN_HOST : one(host)
}

/** Mots d'étape du pipeline qui ne sont pas le libellé de leur état (bridge.steps) : leur ligne de §5.4. */
const STEP_WORDS: ReadonlyMap<string, CallState> = new Map<string, CallState>([
  [fr('refusé par le bridge'), 'refuse'],
  [fr('limité par le bridge'), 'limite'],
  [fr('accord refusé'), 'decline'],
  // « host inconnue » : l'étape d'une machine nommée que le bridge dit inconnue (la machine nulle écrit « machine inconnue »).
  ['inconnue', 'machine-inconnue'],
])

/** La ligne de la table §5.4 dont le libellé (ou « code N ») est ce mot. */
function rowOf(word: string): (typeof STATE_TABLE)[CallState] | undefined {
  if (CODE_WORD.test(word)) return STATE_TABLE.code
  const step = STEP_WORDS.get(word)
  if (step !== undefined) return STATE_TABLE[step]
  for (const state of Object.keys(STATE_TABLE) as CallState[]) {
    if (label(state) === word) return STATE_TABLE[state]
  }
  return undefined
}

function signTone(sign: string, word: string): Tone {
  const row = rowOf(word)
  if (row !== undefined && row.sign === sign) return row.tone
  return SIGN_TONE[sign] ?? 'attention'
}

function wordTone(word: string, indexOf: IndexOf, hostSlot: boolean): Tone {
  const i = indexOf(word)
  if (i >= 0) return { machine: i }
  if (hostSlot && word === UNKNOWN_HOST) return 'attenue'
  const row = rowOf(word)
  if (row !== undefined) return row.tone
  return WORD_TONE.get(word) ?? (UNSEEN_COUNT.test(word) ? 'erreur' : 'texte')
}

function signAt(seg: string): string | null {
  for (const sign of SIGNS) if (seg.startsWith(`${sign} `)) return sign
  return null
}

/** Début du mot d'état en fin de `rest` (« host-a injoignable » → 7), -1 s'il n'y en a pas. */
function stateWordAt(rest: string, sign: string): number {
  // Une machine non prouvée seule après ✓ est la machine d'un appel fait, pas l'état « machine inconnue ».
  // Stryker disable next-line ConditionalExpression: seule une étape ✓ est exactement « machine inconnue » (bridge.steps) ; derrière ✓ rowOf est exclu plus bas, le résultat est le même.
  if (rest === UNKNOWN_HOST && sign !== '✗') return -1
  // Débuts de mot : 0 et chaque position qui suit une espace.
  const starts = [0]
  for (let i = rest.indexOf(' '); i >= 0; i = rest.indexOf(' ', i + 1)) starts.push(i + 1)
  // Les étapes ✓ du bridge sont « machine » ou « machine code N » (steps) : un mot d'état derrière ✓ (« ✓ inconnue ») est un nom de machine.
  // « code N » est un état derrière ✓ comme derrière ✗ ; ✗ et ○ portent tous les autres états.
  return (
    starts.find((at) => CODE_WORD.test(rest.slice(at)) || (sign !== '✓' && rowOf(rest.slice(at)) !== undefined)) ?? -1
  )
}

/**
 * Une étape de pipeline, « signe [machine ]état » (bridge.steps) : le signe prend le ton de l'état
 * (§5.4, D1), la machine sa couleur (§4.1, D2). Sans mot d'état reconnu (« accord », « host-a » seul
 * d'un appel fait), le reste est la machine ou un mot sans ton propre.
 */
function stepPieces(sign: string, rest: string, indexOf: IndexOf): Piece[] {
  const at = stateWordAt(rest, sign)
  if (at < 0) {
    // Ni état ni « code N » : un nom (« inconnue » derrière ✓ est une machine, pas l'état), jamais le ton d'un mot d'état.
    const i = indexOf(rest)
    const tone: Tone = i >= 0 ? { machine: i } : rest === UNKNOWN_HOST ? 'attenue' : 'texte'
    return norm([
      { text: sign, tone: signTone(sign, rest) },
      { text: ' ', tone: 'texte' },
      { text: rest, tone },
    ])
  }
  const word = rest.slice(at)
  const host = rest.slice(0, Math.max(at - 1, 0))
  const named: Piece[] =
    at === 0
      ? []
      : [
          { text: host, tone: wordTone(host, indexOf, true) },
          { text: ' ', tone: 'texte' },
        ]
  return norm([
    { text: sign, tone: signTone(sign, word) },
    { text: ' ', tone: 'texte' },
    ...named,
    { text: word, tone: wordTone(word, NO_HOSTS, false) },
  ])
}

/**
 * Tons d'une ligne « signe machine · état · détail », lus dans son seul texte.
 * Le signe prend le ton de l'état qui le suit (table §5.4) ; une ligne qui
 * finit par « déjà vu » est atténuée en entier.
 */
function toneLine(text: string, indexOf: IndexOf, isPipeline = false): Line {
  if (text.endsWith(SEP + SEEN)) return [{ text, tone: 'attenue' }]
  const segs = text.split(SEP)
  const out: Piece[] = []
  segs.forEach((seg, i) => {
    if (i > 0) out.push({ text: SEP, tone: 'attenue' })
    const sign = signAt(seg)
    if (sign === null) {
      // Premier segment : « machine inconnue · 1 appel · … » (D3) est atténué, comme sur la rangée.
      out.push({ text: seg, tone: wordTone(seg, indexOf, i === 0) })
      return
    }
    const rest = seg.slice(sign.length + 1)
    if (isPipeline) {
      out.push(...stepPieces(sign, rest, indexOf))
      return
    }
    // Stryker disable next-line StringLiteral: sans deuxième segment, « » et toute autre chaîne qui n'est pas un libellé donnent le même rowOf indéfini.
    const next = segs[1] ?? ''
    const key = i === 0 && rowOf(next) !== undefined ? next : rest
    out.push({ text: sign, tone: signTone(sign, key) })
    out.push({ text: ' ', tone: 'texte' })
    out.push({ text: rest, tone: wordTone(rest, indexOf, i === 0) })
  })
  return norm(out)
}

/** « signe machine · état · détails » (« voir /clair », qui n'a pas de sens dans la carte, est ajouté par callLine). */
function callText(c: BridgeCall): string {
  const row = STATE_TABLE[c.state]
  const parts: string[] = []
  if (c.state === 'en-cours' || c.state === 'fait') parts.push(one(c.tool))
  else if (c.state === 'code') parts.push(codeText(c.code))
  else parts.push(label(c.state))
  if (c.state === 'echec-machine' && c.code !== undefined) parts.push(codeText(c.code))
  // Nature : sur les états où l'appel a tourné ou a pu tourner (note sous la table §5.4).
  if (
    c.state === 'fait' ||
    c.state === 'code' ||
    c.state === 'echec-machine' ||
    c.state === 'delai-depasse' ||
    c.truncated
  ) {
    parts.push(fr(NATURE[c.nature]))
  }
  if (!row.isCall) parts.push(NOTHING_RAN)
  if (c.truncated) parts.push(TRUNCATED)
  return `${row.sign} ${hostText(c.host)}${SEP}${parts.join(SEP)}`
}

/**
 * fr() sur un texte qui contient des identifiants : seules les parties autour d'eux sont touchées.
 * Un identifiant retiré par split n'existe plus dans les parties : la récursion garde la liste entière.
 */
function frAround(s: string, ids: readonly string[]): string {
  const id = ids.find((x) => x !== '' && s.includes(x))
  if (id === undefined) return fr(s)
  return s
    .split(id)
    .map((part) => frAround(part, ids))
    .join(id)
}

/**
 * « ✓ accord · ✗ win2025 injoignable · rien n’a tourné » (spec §5.1). bridge.steps
 * finit lui-même tout appel qui n'a pas tourné par l'étape « rien n’a tourné » :
 * c'est la conclusion du pipeline, écrite sans signe. Le drapeau « tronqué »,
 * indépendant de l'état, suit en dernier, comme sur la ligne d'appel : c'est
 * souvent la seule raison pour laquelle l'appel est dans « à regarder ».
 */
function pipelineText(c: BridgeCall): string {
  // Stryker disable next-line StringLiteral: '' est écarté par la garde de frAround ; toute autre chaîne absente du libellé l'est aussi.
  const ids = [c.host ?? '', c.tool]
  const parts = steps(c).map((st) =>
    st.label === NOTHING_RAN ? NOTHING_RAN : `${MARK_SIGN[st.mark]} ${frAround(one(st.label), ids)}`,
  )
  if (c.truncated) parts.push(TRUNCATED)
  return parts.join(SEP)
}

function stateIndex(s: ClairState): IndexOf {
  return (name) => hostIndex(s, name)
}

/** Où est le nom de la machine dans une ligne, et jusqu'où l'état doit rester entier (indices de points de code). */
type NameSpan = { from: number; to: number; end: number }

const MACHINE_COUNT = /^\d+ appels?$/
/** « 2 machines » : tête du résumé de la carte, qui n'est pas une machine. */
const SUMMARY_HEAD = /^\d+ machines?$/
/** Début d'une ligne à signe qui n'a pas de machine : workflow, « N appels » en cours. */
const NO_NAME = /^(workflow|\d+ appels$)/

/**
 * Le nom de la machine d'une ligne du mod, selon sa forme : « signe machine · état » (rangée et
 * lignes d'appel), « machine · N appels · état » (carte), « signe [machine ]état · … » (pipeline) ;
 * null pour toute autre ligne (workflow, Superpowers, résumé).
 */
function nameSpan(chars: readonly Piece[], seps: readonly number[]): NameSpan | null {
  const starts = [0, ...seps.map((i) => i + SEP.length)]
  const ends = [...seps, chars.length]
  const segs = starts.map((start, i) => textOf(chars.slice(start, ends[i])))
  const first = segs[0] as string
  const sign0 = signAt(first)
  if (sign0 === null) {
    // `count` manque pour une ligne sans séparation : test(undefined) lit « undefined », jamais « N appels ».
    return !SUMMARY_HEAD.test(first) && MACHINE_COUNT.test(segs[1] as string)
      ? { from: 0, to: ends[0] as number, end: ends[2] ?? chars.length }
      : null
  }
  // Ni le workflow (« ● workflow x · phase »), ni la bande de plusieurs appels (« ● 3 appels · … ») n'ont de machine à couper.
  if (NO_NAME.test(first.slice(sign0.length + 1))) return null
  const next = segs[1]
  // Rangée et ligne d'appel : le deuxième segment est l'état, sans signe ; le pipeline en a un, ou conclut.
  if (next !== undefined && signAt(next) === null && next !== NOTHING_RAN && next !== TRUNCATED) {
    return { from: sign0.length + 1, to: ends[0] as number, end: ends[1] as number }
  }
  for (const [i, seg] of segs.entries()) {
    const sign = signAt(seg)
    if (sign === null) continue
    const rest = seg.slice(sign.length + 1)
    const from = (starts[i] as number) + sign.length + 1
    const at = stateWordAt(rest, sign)
    // Étape « machine état » : l'état suit le nom.
    // Stryker disable next-line EqualityOperator: à `at === 0` (état sans machine) l'étendue est vide, donc rien n'est coupé ; une étape plus loin ne porte une machine que dans une ligne fabriquée, que la boucle de têtes de fit a déjà rendue.
    if (at > 0) return { from, to: from + at - 1, end: ends[i] as number }
    // Étape sans état (un appel fait) suivie du drapeau « tronqué » : la machine se coupe, le drapeau reste.
    if (at < 0 && segs[i + 1] === TRUNCATED) return { from, to: ends[i] as number, end: ends[i + 1] as number }
  }
  return null
}

/**
 * La ligne dont seul le nom de la machine est coupé (D4) : tout ce qui précède, « … » et l'état
 * (de `to` à `end`) restent ; null si même un nom d'une cellule ne laisse pas la place.
 */
function cutMachine(chars: readonly Piece[], span: NameSpan, max: number): Line | null {
  const { from, to, end } = span
  const before = textOf(chars.slice(0, from))
  const after = `…${textOf(chars.slice(to, end))}`
  // Largeur de la ligne entière à chaque pas : un point qui change la largeur du précédent (U+FE0F, keycap)
  // est compté avec lui, jamais à part.
  const kept: Piece[] = []
  let name = ''
  for (const c of chars.slice(from, to)) {
    if (cellWidth(before + name + c.text + after) > max) break
    kept.push(c)
    name += c.text
  }
  if (kept.length === 0) return null
  return norm([...chars.slice(0, from), ...kept, { text: '…', tone: 'attenue' }, ...chars.slice(to, end)])
}

/**
 * De la dernière séparation à la deuxième (la première borne « signe machine », qui ne se coupe qu'en
 * dernier) : la plus longue tête qui tient, finie par « … » ; seules comptent les têtes d'au moins
 * `minEnd` points de code.
 */
function tryHeads(chars: readonly Piece[], seps: readonly number[], max: number, minEnd: number): Line | null {
  for (const at of seps.slice(1).reverse()) {
    if (at < minEnd) continue
    const head = chars.slice(0, at)
    const w = cellWidth(textOf([...head]))
    if (w + 2 <= max) return norm([...head, { text: ' …', tone: 'attenue' }])
    if (w <= max) return norm([...head, { text: w < max ? '…' : '', tone: 'attenue' }])
  }
  return null
}

/**
 * Coupe une ligne à `columns` cellules. Les détails partent d'abord, par
 * segments entiers depuis la fin (remplacés par « … ») ; la tête
 * « signe machine · état » n'est coupée que si elle ne tient pas seule. `cutName` (lignes d'appel) :
 * quand « signe machine · état » ne tient pas, c'est le nom de la machine qui est coupé, « … » à la
 * place, et l'état reste entier (D4, R93) ; si l'état seul ne tient pas, la coupe est celle du reste.
 */
export function fit(line: Line, columns: number, cutName = false): Line {
  const max = Number.isFinite(columns) ? Math.floor(columns) : 0
  if (max < 1) return []
  if (cellWidth(textOf(line)) <= max) return line
  const chars: Piece[] = []
  for (const p of line) for (const ch of p.text) chars.push({ text: ch, tone: p.tone })
  const seps: number[] = []
  chars.forEach((_, i) => {
    if (
      chars
        .slice(i, i + SEP.length)
        .map((c) => c.text)
        .join('') === SEP
    )
      seps.push(i)
  })
  // Avec cutName, un nom de machine se coupe avant que l'état ne parte : les têtes qui coupent avant la fin de l'état sont écartées.
  const span = cutName ? nameSpan(chars, seps) : null
  const whole = span === null ? null : tryHeads(chars, seps, max, span.end)
  if (whole !== null) return whole
  if (span !== null) {
    const named = cutMachine(chars, span, max)
    if (named !== null) return named
  }
  const heads = tryHeads(chars, seps, max, 0)
  if (heads !== null) return heads
  // Préfixe mesuré en entier à chaque pas (U+FE0F, keycap : la largeur dépend du point suivant).
  const kept: Piece[] = []
  let prefix = ''
  for (const c of chars) {
    if (cellWidth(prefix + c.text) > max - 1) break
    kept.push(c)
    prefix += c.text
  }
  return norm([...kept, { text: '…', tone: 'attenue' }])
}

/**
 * La ligne de l'appel que le formulaire de confirmation attend : « ⚠︎ machine · outil · attend ton
 * accord ». Le dialogue de Claude Code cache alors la bande et la ligne d'état ; seule cette ligne
 * reste visible. Trop étroite, c'est l'outil qui cède : coupé (« ssh… »), puis retiré ; la machine
 * et l'attente restent, coupées par fit seulement si elles ne tiennent pas seules.
 */
function waitingCallLine(c: BridgeCall, s: ClairState, columns: number): Line {
  const head: Piece[] = [
    { text: WAIT_SIGN, tone: 'attention' },
    { text: ' ', tone: 'texte' },
    { text: hostText(c.host), tone: hostTone(s, c.host) },
  ]
  const tail: Piece[] = [
    { text: SEP, tone: 'attenue' },
    { text: WAITS, tone: 'attention' },
  ]
  const tool = one(c.tool)
  const max = Number.isFinite(columns) ? Math.floor(columns) : 0
  const room = max - cellWidth(textOf([...head, ...tail])) - SEP.length
  if (cellWidth(tool) <= room)
    return norm([...head, { text: SEP, tone: 'attenue' }, { text: tool, tone: 'texte' }, ...tail])
  if (room >= 2) {
    // Coupé en cellules (un caractère large en vaut 2), « … » compris.
    let cut = ''
    for (const ch of tool) {
      if (cellWidth(cut + ch) > room - 1) break
      cut += ch
    }
    return norm([
      ...head,
      { text: SEP, tone: 'attenue' },
      { text: cut, tone: 'texte' },
      { text: '…', tone: 'attenue' },
      ...tail,
    ])
  }
  return fit(norm([...head, ...tail]), columns)
}

/** La ligne d'un appel bridge, sous son appel (spec §4.3) ou dans la bande ; l'appel attendu par le formulaire dit l'attente. */
export function callLine(c: BridgeCall, s: ClairState, columns: number): Line {
  if (s.waiting !== null && s.waiting.callId === c.id) return waitingCallLine(c, s, columns)
  const seeCard = c.state === 'echec' ? SEP + SEE_CARD : ''
  return fit(toneLine(callText(c) + seeCard, stateIndex(s)), columns, true)
}

/** Le pipeline réel d'un appel (spec §5.1), étapes de bridge.steps ; `s` donne la couleur de la machine (§4.1). */
export function pipeline(c: BridgeCall, s?: ClairState): Line {
  return toneLine(pipelineText(c), s === undefined ? NO_HOSTS : stateIndex(s), true)
}

/** Ligne d'état : seulement quand tu dois agir (spec §4.5). */
export function statusText(s: ClairState): string | undefined {
  const w = s.waiting
  if (w === null) return undefined
  return `${one(w.host ?? w.tool)}${fr(' attend ton accord')}`
}

/** Étiquette du pied de saisie (spec §4.6) : seulement s'il y a des problèmes non vus. */
export function modeLabel(s: ClairState): string | null {
  const n = unseenProblems(s)
  return n > 0 ? `clair ✗ ${n}` : null
}

function plural(n: number, singular: string, many: string): string {
  return `${n} ${n >= 2 ? many : singular}`
}

/** L'étape Superpowers en mots (spec §5.2) ; null = rien à dire. */
function spText(sp: Superpowers | null, forBand: boolean): string | null {
  if (sp === null || sp.stage === 'fin') return null
  if (forBand && sp.isStale) return null
  let t: string
  if (sp.stage === 'cadrage') t = fr('cadrage')
  else if (sp.stage === 'spec') t = fr('spécification')
  else if (sp.stage === 'relecture') t = fr('relecture finale')
  else {
    t = sp.planTitle === null ? fr('plan') : `${fr('plan « ')}${one(sp.planTitle)}${fr(' »')}`
    if (sp.stage === 'taches') {
      const current = sp.current ?? 0
      if (current > 0) {
        t += SEP + (sp.tasks > 0 ? fr(`tâche ${current} sur ${sp.tasks}`) : fr(`tâche ${current}`))
      } else if (sp.tasks > 0) {
        t += SEP + fr(plural(sp.tasks, 'tâche', 'tâches'))
      }
    }
  }
  if (!forBand && sp.isStale) t += SEP + STALE
  return t
}

function workflowText(w: Workflow): string {
  // Sans nom lisible (D12) : « workflow en cours » ; à distance ou sans nouvelles, le statut qui suit suffit.
  const shown = one(w.name)
  const name =
    shown === '' ? (w.status === 'en-cours' ? fr('workflow en cours') : 'workflow') : `${fr('workflow ')}${shown}`
  const parts = [`${w.status === 'sans-nouvelles' ? '○' : '●'} ${name}`]
  if (w.status === 'distant') parts.push(REMOTE)
  if (w.status === 'sans-nouvelles') parts.push(QUIET)
  const phase = currentPhase(w)
  if (phase !== null) parts.push(one(phase))
  const running = w.agents.filter((a) => a.state === 'en-cours').length
  if (running > 0) parts.push(fr(plural(running, 'agent', 'agents')))
  const failed = w.agents.filter((a) => a.state === 'echec').length
  if (failed > 0) parts.push(`✗ ${fr(`${failed} en échec`)}`)
  return parts.join(SEP)
}

function latest(list: readonly Workflow[]): Workflow | undefined {
  let best: Workflow | undefined
  for (const w of list) if (best === undefined || w.startedAt >= best.startedAt) best = w
  return best
}

function hostTone(s: ClairState, host: string | null): Tone {
  if (host === null) return 'attenue'
  const i = hostIndex(s, host)
  return i >= 0 ? { machine: i } : 'texte'
}

function waitingInView(s: ClairState, w: Waiting, viewAgentId: string | undefined): boolean {
  if (viewAgentId === undefined) return true
  const c = s.calls.find((x) => x.id === w.callId)
  return c !== undefined && c.agentId === viewAgentId
}

function waitLine(s: ClairState, w: Waiting): Line {
  return norm([
    { text: `${WAIT_SIGN}${fr(' à toi')}`, tone: 'attention' },
    { text: fr(' : réponds au formulaire ('), tone: 'texte' },
    w.host === null ? { text: one(w.tool), tone: 'texte' } : { text: one(w.host), tone: hostTone(s, w.host) },
    { text: ')', tone: 'texte' },
  ])
}

function runningLine(s: ClairState, run: readonly BridgeCall[]): Line {
  const names: (string | null)[] = []
  for (const c of run) if (!names.includes(c.host)) names.push(c.host)
  const out: Piece[] = [
    { text: '●', tone: 'accent' },
    { text: ` ${run.length} appels`, tone: 'texte' }, // au moins deux : un seul appel a sa propre ligne
    { text: SEP, tone: 'attenue' },
  ]
  names.slice(0, 3).forEach((h, i) => {
    if (i > 0) out.push({ text: ', ', tone: 'texte' })
    out.push({ text: hostText(h), tone: hostTone(s, h) })
  })
  if (names.length > 3) out.push({ text: ` +${names.length - 3}`, tone: 'attenue' })
  return norm(out)
}

/**
 * La bande au-dessus de la saisie (spec §4.2) ; [] = rendre next(e) seul.
 * Ligne 1 : « à toi » (seule), sinon appels en cours, sinon workflow, sinon
 * étape Superpowers. Ligne 2 : workflow ou Superpowers qui coexiste.
 */
export function bandLines(s: ClairState, ctx: Ctx): Line[] {
  const w = s.waiting
  if (w !== null && waitingInView(s, w, ctx.viewAgentId)) return [fit(waitLine(s, w), ctx.columns)]
  const lines: Line[] = []
  const run = s.calls.filter(
    (c) => c.state === 'en-cours' && (ctx.viewAgentId === undefined || c.agentId === ctx.viewAgentId),
  )
  const first = run[0]
  if (first !== undefined) lines.push(run.length === 1 ? toneLine(callText(first), stateIndex(s)) : runningLine(s, run))
  if (ctx.viewAgentId === undefined) {
    const wf = latest(active(s.workflows))
    if (wf !== undefined) lines.push(toneLine(workflowText(wf), NO_HOSTS))
    // Pendant que Claude travaille, ou qu'un agent lancé sous le plan tourne encore.
    const agentRuns = s.superpowers !== null && s.superpowers.runningAgents.length > 0
    const sp = ctx.isWorking || agentRuns ? spText(s.superpowers, true) : null
    if (sp !== null) lines.push(toneLine(sp, NO_HOSTS))
  }
  // Le nom d'une machine se coupe avant son état (D4) ; les autres lignes sont coupées par la fin.
  return lines.slice(0, 2).map((l) => fit(l, ctx.columns, true))
}

const EMPTY_CARD = fr('rien depuis le début de la session')
const LOOK = fr('à regarder :')
const VIEW_HEAD = fr('dernier appel sur ')
const VIEW_TAIL = fr(' :')
const VIEW_NONE = fr('aucun appel sur ')
const GONE = fr("plus d'appel en mémoire")
const VIEW_GONE = fr("plus d'appel en mémoire sur ")
const QUOTE_OPEN = fr('« ')
const QUOTE_CLOSE = fr(' »')
const SUMMARY = /^\d+ machines? · \d+ appels? · /
// Pas d'ancre : le début paresseux (.*?) part de toute façon du début de la ligne.
const MACHINE_LINE = /(.*?) · \d+ appels? · /

/** Dernier résultat d'une machine : « ✓ ssh_disk_usage », « ✓ code 2 », « ✗ injoignable ». */
function lastText(c: BridgeCall): string {
  const row = STATE_TABLE[c.state]
  if (c.state === 'en-cours' || c.state === 'fait') return `${row.sign} ${one(c.tool)}`
  if (c.state === 'code') return `${row.sign} ${codeText(c.code)}`
  return `${row.sign} ${label(c.state)}`
}

/** Le texte de la carte, une chaîne par ligne (spec §4.4). */
function cardTexts(s: ClairState, args: string): string[] {
  const ms = machines(s)
  const machineText = (m: Pick<(typeof ms)[number], 'host' | 'calls' | 'last' | 'hasUnseenProblem'>): string => {
    const last = lastText(m.last)
    const mark = m.hasUnseenProblem && !last.startsWith('✗') ? `${SEP}✗ ${UNSEEN_MARK}` : ''
    return `${one(m.host)}${SEP}${fr(plural(m.calls, 'appel', 'appels'))}${SEP}${last}${mark}`
  }
  // Les appels sans machine prouvée restent visibles (D3) : une ligne « machine inconnue », après les machines.
  const unknown = unknownMachine(s)
  const unknownLine = unknown === null ? [] : [machineText({ host: UNKNOWN_HOST, ...unknown })]
  // Une ligne par machine de hostOrder, à sa place : le rang d'une ligne est le
  // hostIndex de sa machine (spec §4.7), même quand le plafond de 200 appels a
  // évincé tous les siens (machines() la saute alors) ; elle reste, atténuée.
  const hostLines = s.hostOrder.map((host, index) => {
    const m = ms.find((x) => x.index === index)
    return m === undefined ? `${one(host)}${SEP}${GONE}` : machineText(m)
  })
  hostLines.push(...unknownLine)
  const quote = (reason: string): string => `${QUOTE_OPEN}${one(reason)}${QUOTE_CLOSE}`
  const name = args.trim().replace(/\s.*/s, '')
  if (name !== '') {
    const out = [...hostLines]
    const m = ms.find((x) => x.host === name)
    if (m === undefined) return [...out, `${s.hostOrder.includes(name) ? VIEW_GONE : VIEW_NONE}${one(name)}`]
    out.push(`${VIEW_HEAD}${one(m.host)}${VIEW_TAIL}`, callText(m.last), pipelineText(m.last))
    if (m.last.reason !== undefined) out.push(quote(m.last.reason))
    return out
  }
  const sp = spText(s.superpowers, false)
  const wfs = s.workflows.filter(
    (w) => w.status === 'en-cours' || w.status === 'distant' || w.status === 'sans-nouvelles',
  )
  if (s.calls.length === 0 && sp === null && wfs.length === 0) return [EMPTY_CARD]
  const out: string[] = []
  if (s.calls.length > 0) {
    const unseen = unseenProblems(s)
    const total = ms.reduce((n, m) => n + m.calls, 0) + (unknown?.calls ?? 0)
    const problemsText = unseen > 0 ? fr(plural(unseen, 'problème non vu', 'problèmes non vus')) : NONE_UNSEEN
    out.push(
      `${fr(plural(ms.length, 'machine', 'machines'))}${SEP}${fr(plural(total, 'appel', 'appels'))}${SEP}${problemsText}`,
    )
    out.push(...hostLines)
  }
  const look = problems(s).slice(0, 5)
  const newest = look[0]
  if (newest !== undefined) {
    const seen = (c: BridgeCall): boolean => (c.endedAt ?? c.startedAt) <= s.seenAt
    out.push(LOOK, pipelineText(newest) + (seen(newest) ? SEP + SEEN : ''))
    if (newest.reason !== undefined) out.push(quote(newest.reason))
    for (const c of look.slice(1)) out.push(callText(c) + (seen(c) ? SEP + SEEN : ''))
  }
  if (sp !== null) out.push(sp)
  for (const w of wfs) out.push(workflowText(w))
  return out
}

/**
 * Les tons d'une carte, lus dans son seul texte : la même fonction sert à
 * cardLines et à parseCard. La couleur d'une machine est son rang parmi les
 * lignes de machine en tête de carte, qui suivent hostOrder sans trou : ce
 * rang est son hostIndex, la couleur de la bande et des lignes d'appel.
 */
function toneCard(texts: readonly string[]): Line[] {
  const hosts: string[] = []
  const indexOf: IndexOf = (name) => hosts.indexOf(name)
  let head = true
  let dim = false
  // Rang de la ligne de pipeline : la suivante après « à regarder : », la deuxième après « dernier appel sur … : ».
  let pipelineAt: number | undefined
  return texts.map((t, rank): Line => {
    if (t === LOOK) {
      head = false
      pipelineAt = rank + 1
      return [{ text: t, tone: 'attenue' }]
    }
    if (t === EMPTY_CARD || t.startsWith(VIEW_NONE) || t.startsWith(VIEW_GONE)) {
      head = false
      return [{ text: t, tone: 'attenue' }]
    }
    if (head && t.endsWith(SEP + GONE)) {
      hosts.push(t.slice(0, t.length - SEP.length - GONE.length))
      return [{ text: t, tone: 'attenue' }]
    }
    if (t.startsWith(VIEW_HEAD) && t.endsWith(VIEW_TAIL)) {
      head = false
      pipelineAt = rank + 2
      const host = t.slice(VIEW_HEAD.length, t.length - VIEW_TAIL.length)
      return norm([
        { text: VIEW_HEAD, tone: 'attenue' },
        { text: host, tone: wordTone(host, indexOf, true) },
        { text: VIEW_TAIL, tone: 'attenue' },
      ])
    }
    if (t.length > QUOTE_OPEN.length + QUOTE_CLOSE.length && t.startsWith(QUOTE_OPEN) && t.endsWith(QUOTE_CLOSE)) {
      if (dim) return [{ text: t, tone: 'attenue' }]
      return norm([
        { text: QUOTE_OPEN, tone: 'attenue' },
        { text: t.slice(QUOTE_OPEN.length, t.length - QUOTE_CLOSE.length), tone: 'texte' },
        { text: QUOTE_CLOSE, tone: 'attenue' },
      ])
    }
    if (head && !SUMMARY.test(t)) {
      const m = MACHINE_LINE.exec(t)
      // « machine inconnue » (D3) n'a pas de couleur : elle ne prend aucun rang.
      // Stryker disable next-line StringLiteral: le groupe 1 de MACHINE_LINE participe toujours au succès, `?? ''` n'est jamais pris.
      if (m !== null && m[1] !== UNKNOWN_HOST) hosts.push(m[1] ?? '')
    }
    dim = t.endsWith(SEP + SEEN)
    return toneLine(t, indexOf, rank === pipelineAt)
  })
}

/** La carte /clair (spec §4.4), calculée au moment de la commande. */
export function cardLines(s: ClairState, args: string, _now: number): Line[] {
  return toneCard(cardTexts(s, args))
}

/** Le texte stable de la carte, lu par le modèle : une ligne de texte par ligne, rien d'autre. */
export function cardText(lines: Line[]): string {
  return lines.map(textOf).join('\n')
}

// Spec §10 : CommandOutput reçoit le texte de la commande précédé du nom du plugin et de « : »
// (relevé par la sonde du terminal) ; ce préfixe n'est pas une ligne de la carte.
const ENGINE_PREFIX = 'mode-clair: '

/** Relit une carte depuis son seul texte (CommandOutput, session reprise) : parseCard(cardText(L)) == L. */
export function parseCard(text: string): Line[] {
  const own = text.startsWith(ENGINE_PREFIX) ? text.slice(ENGINE_PREFIX.length) : text
  return toneCard(own.split(/\r?\n/).filter((l) => l !== ''))
}
