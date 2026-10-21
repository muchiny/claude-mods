// format replay/1
// Scénarios de rejeu anonymisés, écrits par dev/replay/extract.ts (npm run replay:extract) : ne pas éditer.
// Seuls des événements attestés par les transcripts (spec vérif. D9).
import type { ToolCallResult } from 'claude-code'

export type ReplayEvent =
  | {
      t: number
      kind: 'tool.call'
      tool: string
      toolUseId: string
      agentId?: string
      input: unknown
      result: ToolCallResult
      afterMs: number
    }
  | { t: number; kind: 'turn.complete'; agentId?: string }
  | { t: number; kind: 'session.append'; text: string }

export type Scenario = {
  id: string
  source: 'replay' | 'synthetic'
  events: ReplayEvent[]
  files: Record<string, string>
  oracleNote?: string
}

export const SCENARIOS: readonly Scenario[] = []
