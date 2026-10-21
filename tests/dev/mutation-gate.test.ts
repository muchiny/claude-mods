import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { baseDiff, changedRanges } from '../../dev/mutation-gate.mjs'
// @ts-expect-error module .mjs sans déclaration de types
import { divergedRepo } from './git-fixture.mjs'

const diff = [
  'diff --git a/mode-clair/hooks/bridge.ts b/mode-clair/hooks/bridge.ts',
  'index 1111111..2222222 100644',
  '--- a/mode-clair/hooks/bridge.ts',
  '+++ b/mode-clair/hooks/bridge.ts',
  '@@ -10,0 +12,3 @@ export function a() {',
  '+x',
  '+y',
  '+z',
  '@@ -30,2 +40 @@ export function b() {',
  '-old1',
  '-old2',
  '+new',
  '@@ -50,2 +60,0 @@ export function c() {',
  '-gone1',
  '-gone2',
  'diff --git a/mode-clair/hooks/register.tsx b/mode-clair/hooks/register.tsx',
  '--- a/mode-clair/hooks/register.tsx',
  '+++ b/mode-clair/hooks/register.tsx',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  'diff --git a/mode-clair/hooks/tools.generated.ts b/mode-clair/hooks/tools.generated.ts',
  '--- a/mode-clair/hooks/tools.generated.ts',
  '+++ b/mode-clair/hooks/tools.generated.ts',
  '@@ -1 +1 @@',
  '-a',
  '+b',
].join('\n')

describe('changedRanges', () => {
  test('lignes ajoutées ou modifiées de bridge.ts, hunk de pure suppression ignoré', () => {
    const ranges = changedRanges(diff)
    expect(ranges.get('mode-clair/hooks/bridge.ts')).toEqual([
      [12, 14],
      [40, 40],
    ])
  })

  test('register.tsx et tools.generated.ts sont absents', () => {
    const ranges = changedRanges(diff)
    expect([...ranges.keys()]).toEqual(['mode-clair/hooks/bridge.ts'])
  })

  test('un diff vide donne une map vide', () => {
    expect(changedRanges('').size).toBe(0)
  })
})

describe('baseDiff', () => {
  test('ignore les lignes changées seulement sur la base après le point de départ', () => {
    expect(changedRanges(baseDiff('main', divergedRepo())).get('mode-clair/hooks/a.ts')).toEqual([[4, 4]])
  })
})
