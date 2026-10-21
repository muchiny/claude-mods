import { describe, expect, test } from 'claude-code/testing'
// @ts-expect-error module .mjs sans déclaration de types
import { apply, diffOf, draw, mutants, readEquivalents, readGlue } from '../../dev/mutate-glue.mjs'

type Mutant = { id: string; line: number; from: string; to: string; offset: number }

const all = (src: string): Mutant[] => mutants(src)
const pairs = (src: string) => all(src).map((m) => `${m.from}→${m.to}`)
const applied = (src: string) => all(src).map((m) => apply(src, m))

const EXEMPLE = "on('tool.call', { tool: 'Bash' }, ($, e, next) => { if (a === b) return next(e) })"

describe('mutants', () => {
  test("l'exemple du plan : === inversé et if (true), sans toucher l'événement ni le filtre", () => {
    const out = applied(EXEMPLE)
    expect(out).toContain("on('tool.call', { tool: 'Bash' }, ($, e, next) => { if (a !== b) return next(e) })")
    expect(out).toContain("on('tool.call', { tool: 'Bash' }, ($, e, next) => { if (true) return next(e) })")
    for (const s of out) expect(s.startsWith("on('tool.call', { tool: 'Bash' }, ")).toBe(true)
  })

  test('=== ↔ !==', () => {
    expect(pairs('x = a === b')).toEqual(['===→!=='])
    expect(pairs('x = a !== b')).toEqual(['!==→==='])
  })

  test('&& ↔ ||, sans toucher ??', () => {
    expect(pairs('x = a && b')).toEqual(['&&→||'])
    expect(pairs('x = a || b')).toEqual(['||→&&'])
    expect(pairs('x = a ?? b')).toEqual([])
  })

  test('return next(e) : l’appel est supprimé, l’événement rendu tel quel', () => {
    expect(applied('function f() { return next(e) }')).toEqual(['function f() { return { ...e } }'])
    // next(e) hors d'un return, ou next d'autre chose : pas cette famille.
    expect(pairs('const ran = await next(e)')).toEqual([])
    expect(pairs('return next({ ...e, a: 1 })')).toEqual(['1→2', '1→0'])
  })

  test('if (cond) → if (true) et if (false), parenthèses imbriquées et multi-lignes', () => {
    const src = 'if (f(a, (b)) && c)\n  g()'
    const out = applied(src)
    expect(out).toContain('if (true)\n  g()')
    expect(out).toContain('if (false)\n  g()')
    expect(out).toContain('if (f(a, (b)) || c)\n  g()')
    expect(out).toHaveLength(3)
  })

  test('littéraux numériques ±1, séparateurs et zéro compris', () => {
    expect(pairs('x(3_000)')).toEqual(['3_000→3001', '3_000→2999'])
    expect(pairs('x(0)')).toEqual(['0→1', '0→-1'])
    expect(pairs('x(80)')).toEqual(['80→81', '80→79'])
    // Chiffres d'un identifiant : pas un littéral.
    expect(pairs('x(b0, v8x)')).toEqual([])
  })

  test('rien dans les chaînes, les commentaires, les regex ni les gabarits', () => {
    const src = [
      "const a = 'x === 1 && y'",
      'const b = "if (z) return next(e)"',
      '// if (a === b) 42',
      '/* a && b || 7 */',
      'const r = /a||b{2}/',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: c'est un gabarit écrit dans une source à analyser
      'const t = `${a === b ? 1 : 2} && 3`',
    ].join('\n')
    expect(all(src)).toEqual([])
  })

  test('rien dans le texte JSX ; les expressions JSX restent du code', () => {
    const src = 'return (\n  <Box a="1 && 2" w={n ?? 80}>\n    if (a === b) 12 && x\n    <Text>{k}</Text>\n  </Box>\n)'
    expect(pairs(src)).toEqual(['80→81', '80→79'])
  })

  test('génériques et comparaisons ne sont pas pris pour du JSX', () => {
    expect(pairs('const m = new Map<string, number>(); if (a < b) f(1)')).toEqual([
      'a < b→true',
      'a < b→false',
      '1→2',
      '1→0',
    ])
  })

  test("aucun argument d'un on( avant le gestionnaire : filtres à nombre ou à booléen compris", () => {
    const src = "on('x', { n: 1, b: a && c }, async ($, e, next) => next(e)).catch(($, e, next) => next(e))"
    expect(all(src)).toEqual([])
  })

  test('identifiants stables, ligne 1-indexée, triés par position', () => {
    const src = 'f()\nif (a === b) g(2)'
    const ms = all(src)
    expect(ms.map((m) => m.line)).toEqual([2, 2, 2, 2, 2])
    expect(new Set(ms.map((m) => m.id)).size).toBe(ms.length)
    expect(ms[0]?.id).toBe('L2C5-if-true')
    expect(mutants(src)).toEqual(ms)
  })

  test('register.tsx : chaque mutant change la source, aucun ne touche une ligne on(…) avant le gestionnaire', () => {
    const src: string = readGlue()
    const ms = all(src)
    expect(ms.length).toBeGreaterThan(50)
    for (const m of ms) {
      const out = apply(src, m)
      expect(out).not.toBe(src)
      // Les en-têtes on('…', {…}, sont intacts.
      const heads = (s: string) => s.match(/on\('[^']+'(, \{[^\n]*\})?,/g)
      expect(heads(out)).toEqual(heads(src))
    }
  })
})

describe('readEquivalents', () => {
  test('chaque équivalent relu existe dans register.tsx et porte sa raison', () => {
    const ids = new Set(all(readGlue()).map((m) => m.id))
    const list: Record<string, string> = readEquivalents()
    for (const [id, reason] of Object.entries(list)) {
      expect(ids.has(id)).toBe(true)
      expect(reason.length).toBeGreaterThan(20)
    }
  })
})

describe('diffOf', () => {
  test('la ligne avant et après', () => {
    const src = 'a\nif (x === y) b\nc'
    const m = all(src).find((x) => x.to === '!==') as Mutant
    expect(diffOf(src, m)).toBe('- if (x === y) b\n+ if (x !== y) b')
  })
})

describe('draw', () => {
  test('tirage reproductible à graine fixe, sans doublon, borné par la population', () => {
    const items = Array.from({ length: 100 }, (_, i) => i)
    const a = draw(items, 30, 42)
    expect(a).toEqual(draw(items, 30, 42))
    expect(new Set(a).size).toBe(30)
    expect(draw(items, 30, 7)).not.toEqual(a)
    expect(draw([1, 2], 30, 1)).toHaveLength(2)
  })
})
