import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { grepFinds, hygienePattern, tagCheck, workflow } from './workflows.mjs'

const finds = (text: string): boolean => grepFinds(hygienePattern(), text)

describe('ci.yml : grep d’hygiène des fixtures de rejeu (motif exécuté)', () => {
  test('UUID non synthétique et horodatage ISO réel détectés', () => {
    expect(finds("toolUseId: 'deadbeef-cafe-4bad-9fed-0123456789ab'")).toBe(true)
    expect(finds("text: '2026-10-21T10:00:00.123Z  INFO lorem'")).toBe(true)
    expect(finds("text: '1999-12-31T23:59:59Z'")).toBe(true)
  })
  test('formes synthétiques acceptées', () => {
    expect(finds("id: '00000000-0000-4000-8000-000000000001'")).toBe(false)
    expect(finds("text: '2000-01-01T00:00:01.500Z  INFO lorem'")).toBe(false)
    expect(finds("path: '/home/user/-home-user-proj-a/x'")).toBe(false)
  })
  test('formes déjà couvertes toujours détectées', () => {
    expect(finds('/home/quelquun/x')).toBe(true)
    expect(finds('toolu_01ABCdef')).toBe(true)
    expect(finds('10.0.0.1')).toBe(true)
  })
})

/** Le pas `name:` (ou `uses:` d'une action) de `wf` et son corps, jusqu'au pas suivant. */
function step(wf: string, marker: string): string {
  const at = wf.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  const next = wf.indexOf('\n      - ', at + marker.length)
  return wf.slice(at, next < 0 ? undefined : next)
}

describe('paint.yml : rien du terminal brut n’est publié (L5)', () => {
  const wf = workflow('paint.yml') as string
  test('artefact : seulement les .grid.txt et .ecarts.txt, jamais les octets (.bin, .full.bin)', () => {
    const upload = step(wf, 'actions/upload-artifact@')
    expect(upload).toContain('paint-out/*.grid.txt')
    expect(upload).toContain('paint-out/*.ecarts.txt')
    expect(upload).not.toMatch(/\.bin|paint-out\s*$/m)
  })
  test('issue : les lignes de bannière (compte, organisation) sont masquées avant publication', () => {
    const issue = step(wf, '- name: Issue')
    expect(issue).not.toMatch(/cat "\$f"/)
    expect(issue).toContain("sed -E '/@|[Oo]rgani[sz]ation|")
    expect(issue).toContain('[ligne de bannière masquée]')
    expect(issue).not.toContain('.full.bin')
  })
})

describe('release.yml : le tag distant est encore le commit vérifié avant gh release create (L6)', () => {
  test('le pas précède gh release create dans le job publish', () => {
    const wf = workflow('release.yml') as string
    const check = wf.indexOf('- name: Tag distant égal au commit vérifié')
    expect(check).toBeGreaterThan(wf.indexOf('  publish:'))
    expect(check).toBeLessThan(wf.indexOf('gh release create'))
  })
  for (const annotated of [true, false])
    test(`tag ${annotated ? 'annoté' : 'léger'} : inchangé, le pas passe ; déplacé, il échoue`, () => {
      expect(tagCheck({ annotated, moved: false })).toBe(0)
      expect(tagCheck({ annotated, moved: true })).toBe(1)
    })
})
