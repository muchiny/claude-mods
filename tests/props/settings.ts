// Réglages communs des tests de propriétés (fast-check 4).
//
// - NUM_RUNS : 200 par défaut (assez court pour `bun test ./tests` en CI), `PROPS_RUNS` pour la passe
//   hebdomadaire de mutation.yml (10 000).
// - SEED : `PROPS_SEED` si défini et non vide (la passe hebdomadaire de mutation.yml en tire une, affichée),
//   42 en CI (`CI` défini : exécution reproductible, celle des PR), sinon aléatoire et affiché, pour rejouer un contre-exemple avec `PROPS_SEED=<graine> npm run props`.
import * as fc from 'fast-check'
// @ts-expect-error module .mjs sans déclaration de types
import { env, log } from './env.mjs'

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return raw !== undefined && Number.isInteger(n) && n > 0 ? n : fallback
}

export const NUM_RUNS: number = positiveInt(env('PROPS_RUNS'), 200)

/**
 * La graine : `PROPS_SEED` entière si définie et non vide (affichée, pour rejouer) ; `PROPS_SEED` vide vaut non
 * définie (jamais 0 en silence) ; une valeur non entière est une erreur. Sinon 42 en CI, aléatoire ailleurs.
 */
export function seedFrom(
  get: (name: string) => string | undefined,
  random: () => number,
  print: (message: string) => void,
): number {
  const given = get('PROPS_SEED')?.trim()
  if (given !== undefined && given !== '') {
    if (!/^-?\d+$/.test(given)) throw new Error(`PROPS_SEED invalide (« ${given} ») : entier attendu`)
    print(`props : graine ${given} (PROPS_SEED=${given} pour rejouer)`)
    return Number(given)
  }
  if (get('CI') !== undefined && get('CI') !== '') return 42
  const drawn = Math.floor(random() * 2 ** 31)
  print(`props : graine aléatoire ${drawn} (PROPS_SEED=${drawn} pour rejouer)`)
  return drawn
}

export const SEED: number = seedFrom(env, Math.random, log)

/** `fc.assert` avec le nombre d'exécutions et la graine du dépôt. */
export function check<T>(property: fc.IPropertyWithHooks<T> | fc.IProperty<T>): void {
  fc.assert(property, { numRuns: NUM_RUNS, seed: SEED })
}
