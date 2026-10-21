import { describe, expect, test } from 'claude-code/testing'
import { callLine, cardLines, pipeline } from '../../hooks/view'
import type { BridgeCall, ClairState, Line } from '../../types'

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
const text = (line: Line) => line.map((p) => p.text).join('')
const _CTX = { now: 10_000, columns: 200, isWorking: true }

describe('toneLine relit le texte rendu : les noms ne le faussent pas (M2)', () => {
  test('un hôte contenant « · ✗ injoignable » ne devient ni séparateur ni état', () => {
    const c = call({ host: 'h · ✗ injoignable' })
    const s = stateOf([c])
    const row = callLine(c, s, 200)
    expect(text(row)).not.toContain('h · ')
    expect(row.some((p) => p.text.includes('injoignable') && p.tone === 'erreur')).toBe(false)
    expect(row.find((p) => p.text === '✗')).toBeUndefined()
    const pipe = pipeline(c, s)
    expect(pipe.find((p) => p.text === '✗')).toBeUndefined()
    expect(pipe.some((p) => p.tone === 'erreur')).toBe(false)
    const card = cardLines(s, '', 20_000)
    expect(card.flat().some((p) => p.tone === 'erreur')).toBe(false)
  })

  test('un outil nommé « ✗ x » ou « ● x » n’est pas pris pour un signe', () => {
    const c = call({ tool: '✗ boom', state: 'en-cours', endedAt: undefined })
    const row = callLine(c, stateOf([c]), 200)
    expect(row.filter((p) => p.tone === 'erreur')).toStrictEqual([])
  })

  test('un hôte nommé « inconnue » sur une étape ✓ ne reçoit pas le ton d’état', () => {
    const c = call({ host: 'inconnue', state: 'fait' })
    const line = pipeline(c)
    expect(text(line)).toBe('✓ inconnue')
    expect(line.find((p) => p.text.includes('inconnue'))?.tone).toBe('texte')
  })

  test('un hôte nommé « inconnue » sur une étape ✗ injoignable garde sa couleur de machine', () => {
    const c = call({ host: 'inconnue', state: 'injoignable' })
    const line = pipeline(c, stateOf([c]))
    expect(line.find((p) => p.text === 'inconnue')?.tone).toStrictEqual({ machine: 0 })
    expect(line.find((p) => p.text === 'injoignable')?.tone).toBe('erreur')
  })

  test('un nom de machine légitime (points, tirets) garde sa couleur', () => {
    const c = call({ host: 'web-02.prod' })
    expect(callLine(c, stateOf([c]), 200).find((p) => p.text === 'web-02.prod')?.tone).toStrictEqual({ machine: 0 })
  })
})
