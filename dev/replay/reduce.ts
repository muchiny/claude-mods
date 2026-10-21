// Réduction des scénarios de rejeu sous une taille maximale (Biome refuse les fichiers de plus de
// 1 MiB). Module pur : reduce-run.ts lit et écrit les fichiers. Ne retient que des scénarios
// entiers (jamais tronqués), diversifiés : au moins un scénario par type et par trait de
// signature, puis un tour par type en préférant les plus courts.

import type { Scenario } from '../../mode-clair/tests/replay/scenarios.generated'

/** Types de scénario, dans l'ordre des tours de remplissage (préfixe de l'identifiant). */
export const TYPES = [
  'bridge-cli',
  'bridge-mcp',
  'workflow',
  'superpowers',
  'agent',
  'plan-write',
  'notification',
] as const

const TRUNCATION = /output_id=\\?"|\[truncated: |\[output stopped at the|<persisted-output>|Output too large/
const CHAIN = /&&|\|\||;|\||\bfor\b|\bwhile\b/

export function typeOf(s: Scenario): string {
  return TYPES.find((t) => s.id.startsWith(`${t}-`)) ?? 'autre'
}

/** Taille d'un scénario dans le fichier de sortie, à quelques octets d'indentation près. */
export function sizeOf(s: Scenario): number {
  return JSON.stringify(s, null, 2).length + 4
}

/**
 * Le type du scénario et ses traits de signature : `multi` (outil à plusieurs hôtes), `erreur`
 * (un résultat en erreur), `tronque` (marque de sortie coupée), `incertain` (ligne bridge à
 * plusieurs segments ou en boucle).
 */
export function traitsOf(s: Scenario): string[] {
  const traits = [typeOf(s)]
  let multi = false
  let error = false
  let cut = false
  let uncertain = false
  for (const e of s.events) {
    if (e.kind !== 'tool.call') continue
    const input = JSON.stringify(e.input)
    const result = JSON.stringify(e.result)
    if (e.tool.includes('_multi') || input.includes('_multi')) multi = true
    if (e.result.isError === true) error = true
    if (TRUNCATION.test(result)) cut = true
    const command = (e.input as { command?: unknown } | null)?.command
    if (e.tool === 'Bash' && typeof command === 'string' && command.includes('bridge-mcp') && CHAIN.test(command))
      uncertain = true
  }
  if (multi) traits.push('multi')
  if (error) traits.push('erreur')
  if (cut) traits.push('tronque')
  if (uncertain) traits.push('incertain')
  return traits
}

/**
 * Un sous-ensemble de `all` dont la taille estimée ne dépasse pas `maxBytes`, trié par identifiant :
 * d'abord, pour chaque trait présent dans `all`, le plus court scénario qui l'a (les traits les
 * plus rares en premier) ; puis des tours par type, le plus court qui tient dans le reste.
 * Lève une erreur si les scénarios obligatoires ne tiennent pas.
 */
export function reduceScenarios(all: readonly Scenario[], maxBytes: number): Scenario[] {
  const size = new Map(all.map((s) => [s, sizeOf(s)]))
  const byTrait = new Map<string, Scenario[]>()
  for (const s of all) for (const t of traitsOf(s)) byTrait.set(t, [...(byTrait.get(t) ?? []), s])
  const chosen = new Set<Scenario>()
  let used = 0
  const take = (s: Scenario): void => {
    chosen.add(s)
    used += size.get(s) as number
  }
  const shortest = (list: readonly Scenario[]): Scenario | undefined =>
    [...list].sort((a, b) => (size.get(a) as number) - (size.get(b) as number) || (a.id < b.id ? -1 : 1))[0]
  for (const [, list] of [...byTrait].sort((a, b) => a[1].length - b[1].length || (a[0] < b[0] ? -1 : 1))) {
    if (list.some((s) => chosen.has(s))) continue
    const pick = shortest(list)
    if (pick !== undefined) take(pick)
  }
  if (used > maxBytes) throw new Error(`les scénarios obligatoires (${used} octets) dépassent ${maxBytes}`)
  const types = [...new Set(all.map(typeOf))].sort((a, b) => TYPES.indexOf(a as never) - TYPES.indexOf(b as never))
  for (let added = true; added; ) {
    added = false
    for (const t of types) {
      const room = all.filter((s) => typeOf(s) === t && !chosen.has(s) && used + (size.get(s) as number) <= maxBytes)
      const pick = shortest(room)
      if (pick !== undefined) {
        take(pick)
        added = true
      }
    }
  }
  return [...chosen].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
