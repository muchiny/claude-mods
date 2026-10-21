// Réglages communs des tests de propriétés (fast-check 4).
//
// - NUM_RUNS : 200 par défaut (assez court pour `bun test ./tests` en CI), `PROPS_RUNS` pour la passe
//   hebdomadaire de mutation.yml (10 000).
// - SEED : `PROPS_SEED` si défini, 42 en CI (`CI` défini : exécution reproductible), sinon aléatoire et
//   affiché, pour rejouer un contre-exemple avec `PROPS_SEED=<graine> npm run props`.
import { test } from 'claude-code/testing'
import * as fc from 'fast-check'
// @ts-expect-error module .mjs sans déclaration de types
import { env, log } from './env.mjs'

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return raw !== undefined && Number.isInteger(n) && n > 0 ? n : fallback
}

export const NUM_RUNS: number = positiveInt(env('PROPS_RUNS'), 200)

function seedOf(): number {
  const given = env('PROPS_SEED')
  if (given !== undefined && Number.isInteger(Number(given))) return Number(given)
  if (env('CI') !== undefined && env('CI') !== '') return 42
  const random = Math.floor(Math.random() * 2 ** 31)
  log(`props : graine aléatoire ${random} (PROPS_SEED=${random} pour rejouer)`)
  return random
}

export const SEED: number = seedOf()

/** `fc.assert` avec le nombre d'exécutions et la graine du dépôt. */
export function check<T>(property: fc.IPropertyWithHooks<T> | fc.IProperty<T>): void {
  fc.assert(property, { numRuns: NUM_RUNS, seed: SEED })
}

type TodoTest = (name: string, body: () => void) => void

/**
 * `test.todo` de bun:test (sous `bun test`, 'claude-code/testing' est bun:test, dev/bun-claude-code-testing.ts) :
 * le corps n'est exécuté que par `bun test --todo`, où il doit alors échouer (contre-exemple documenté dans
 * le commentaire du test). Quand la tâche 5 corrige le défaut, on repasse en `test`.
 */
export const todo: TodoTest = (test as unknown as { todo: TodoTest }).todo
