// Le monde sous le plugin, pour les tests moteur de mode-clair. Ce fichier n'est
// pas un test : les *.test.tsx de ce dossier l'importent.
//
// - une horloge en mémoire (mock.clock) ;
// - $.ui.status, $.command.register, $.fs.read, $.fs.stat répondus et notés ;
// - les écritures du mod dans $.state notées au passage (le $ d'un test n'a pas
//   de `state`) : la dernière valeur de `'mode-clair'.state` et de chaque membre
//   de `'mode-clair'.rows` ;
// - le cœur qui répond aux appels d'outils par tool_use_id, tout de suite ou
//   après un délai d'horloge ;
// - le dessin du moteur réduit à un Text « (rendu du moteur) » (pour SessionMode :
//   ses `modes` joints par « & » ; pour PromptHint : `hint` puis `tail`), pour
//   distinguer ce que le mod dessine de ce qu'il laisse au moteur ; pour les
//   composants de `engineNodes`, le vrai nœud du moteur `{ type: 'engine', ref: 0 }`
//   (D:10086-10091), que le moteur réel refuse sous certaines Box (tâche 14).

import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On, ToolCallResult } from 'claude-code'

import type { BridgeCall, ClairState } from '../../types'

export const PLUGIN = 'mode-clair'
export const SURFACES = ['terminal', 'desktop'] as const
export const ENGINE_ROW = '(rendu du moteur)'

/** Ce que le cœur répond à un appel : son résultat, après `afterMs` d'horloge, ou une exception. */
export type Answer = { result: ToolCallResult; afterMs?: number; throws?: boolean }

export type World = {
  clock: MockClock
  /** Chaque appel de $.ui.status, dans l'ordre. */
  status: (string | undefined)[]
  /** Les noms passés à $.command.register. */
  commands: string[]
  /** Fichiers vus par $.fs.read et $.fs.stat : texte et date de modification. */
  files: Map<string, { text: string; mtimeMs: number }>
  /** Chaque chemin passé à $.fs.read. */
  reads: string[]
  /** Chaque chemin passé à $.fs.stat. */
  stats: string[]
  /** Réponse du cœur, par tool_use_id ; absente : un résultat vide. */
  answers: Map<string, Answer>
  /** `composant:requestId` de chaque dessin que le mod a laissé au moteur. */
  drawn: string[]
  /** Dernière écriture de `'mode-clair'.state` : `{ shape: 'clair/0.2', value }`. */
  state: { shape: string; value: ClairState } | undefined
  /** Dernière écriture de chaque membre de `'mode-clair'.rows`. */
  rows: Map<string, BridgeCall[]>
  /** Composants dont le dessin du moteur est le vrai nœud `{ type: 'engine', ref: 0 }` ; vide par défaut. */
  engineNodes: Set<string>
}

export function world(on: On): World {
  const clock = mock.clock(on, { now: 1_000 })
  const w: World = {
    clock,
    status: [],
    commands: [],
    files: new Map(),
    reads: [],
    stats: [],
    answers: new Map(),
    drawn: [],
    state: undefined,
    rows: new Map(),
    engineNodes: new Set(),
  }
  on('state.set', { plugin: PLUGIN, key: 'rows' }, ($, e, next) => {
    w.rows.set(e.id, e.value)
    return next(e)
  })
  on('state.set', { plugin: PLUGIN, key: 'state' }, ($, e, next) => {
    w.state = e.value
    return next(e)
  })
  on('ui.status', ($, e) => {
    w.status.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('fs.read', ($, e) => {
    w.reads.push(e.path)
    const file = w.files.get(e.path)
    return file === undefined ? { deny: `ENOENT: ${e.path}` } : { value: file.text }
  })
  on('fs.stat', ($, e) => {
    w.stats.push(e.path)
    const file = w.files.get(e.path)
    return file === undefined
      ? { deny: `ENOENT: ${e.path}` }
      : { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('classic.PermissionDenied', () => ({}))
  on('classic.Elicitation', () => ({}))
  on('classic.ElicitationResult', () => ({}))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', async ($, e) => {
    const answer = w.answers.get(e.tool_use_id)
    if (answer === undefined) return { result: {}, text: '' }
    if (answer.afterMs !== undefined) await clock.sleep(answer.afterMs)
    if (answer.throws === true) throw new Error('le cœur a échoué')
    return answer.result
  })
  on('ui.render', ($, e) => {
    w.drawn.push(`${e.component}:${e.requestId}`)
    if (w.engineNodes.has(e.component)) return { type: 'engine', ref: 0 } as never
    const text =
      e.component === 'SessionMode'
        ? e.props.modes.join(' & ')
        : e.component === 'PromptHint'
          ? `${e.props.hint} ${e.props.tail ?? ''}`
          : ENGINE_ROW
    return { type: 'Text', props: {}, children: [text] } as never
  })
  return w
}

/** Le dernier ClairState écrit par le mod, ou undefined s'il n'a rien écrit. */
export function lastState(w: World): ClairState | undefined {
  return w.state?.value
}

/** Écrit un fichier en mémoire, daté de l'heure de l'horloge. */
export function writeFile(w: World, path: string, text: string): void {
  w.files.set(path, { text, mtimeMs: w.clock.now() })
}
