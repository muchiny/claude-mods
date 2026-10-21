// Le modèle des propriétés : applique une suite d'événements `Ev` avec les réducteurs de hooks/state.ts,
// l'horloge étant l'indice de l'événement (croissante, donc `endedAt >= startedAt` si le code est juste).
import {
  dropCalls,
  EMPTY,
  finishCalls,
  interruptOpen,
  recordAccord,
  refuseByClaude,
  setWaiting,
  startCalls,
} from '../../mode-clair/hooks/state'
import type { ClairState } from '../../mode-clair/types'
import type { Ev } from './arbitraries'

export function apply(s: ClairState, ev: Ev, now: number): ClairState {
  switch (ev.kind) {
    case 'start':
      return startCalls(s, ev.toolUseId, ev.agentId, ev.parsed, now)
    case 'finish':
      return finishCalls(s, ev.toolUseId, ev.outcomes, now)
    case 'refuse':
      return refuseByClaude(s, ev.toolUseId, now)
    case 'turnEnd':
      return interruptOpen(s, ev.agentId, now)
    case 'wait':
      return setWaiting(s, ev.clear ? null : { tool: ev.tool, host: ev.host, callId: ev.callId, since: now })
    case 'accord':
      return recordAccord(s, ev.callId, ev.granted)
    case 'drop':
      return dropCalls(s, ev.toolUseId)
  }
}

/** Les états successifs : `trace[0]` = départ, `trace[i + 1]` = état après `evs[i]`. */
export function trace(evs: readonly Ev[], from: ClairState = EMPTY): ClairState[] {
  const states = [from]
  evs.forEach((ev, i) => {
    states.push(apply(states.at(-1) as ClairState, ev, i + 1))
  })
  return states
}

export const final = (evs: readonly Ev[]): ClairState => trace(evs).at(-1) as ClairState

/** L'événement vise-t-il cet appel (celui qui a le droit de le fermer ou de le retirer) ? */
export function targets(ev: Ev, c: { toolUseId: string; agentId?: string }): boolean {
  switch (ev.kind) {
    case 'finish':
    case 'refuse':
    case 'drop':
      return ev.toolUseId === c.toolUseId
    case 'turnEnd':
      return ev.agentId === c.agentId
    default:
      return false
  }
}
