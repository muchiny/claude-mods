import { describe, expect, test } from 'claude-code/testing'
import { check, parseExpected } from '../../dev/paint/check'
import { gridOf, gridText } from '../../dev/paint/replay'
import { isLoginScreen, SCENARIOS } from '../../dev/paint/scenarios'

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s)

describe('gridOf : octets rejoués dans xterm headless', () => {
  test('texte simple, une ligne par rangée, blancs de fin retirés', async () => {
    const g = await gridOf(bytes('abc\r\ndef   \r\n'), 20, 5)
    expect(g.cols).toBe(20)
    expect(g.rows[0]?.text).toBe('abc')
    expect(g.rows[1]?.text).toBe('def')
    expect(gridText(g).split('\n').slice(0, 2)).toEqual(['abc', 'def'])
  })

  test('couleurs CSI : palette, vraie couleur, atténué, défaut', async () => {
    const g = await gridOf(bytes('\x1b[31ma\x1b[38;2;0;127;255mb\x1b[0m\x1b[2mc\x1b[0md'), 20, 5)
    const r = g.rows[0]
    expect(r?.fg.slice(0, 4)).toEqual(['p1', '#007fff', 'default/dim', 'default'])
    expect(r?.bg.slice(0, 4)).toEqual([null, null, null, null])
  })

  test('fond : palette, vraie couleur, vidéo inverse', async () => {
    const g = await gridOf(bytes('\x1b[48;5;236ma\x1b[48;2;55;55;55mb\x1b[0m\x1b[7mc\x1b[0m'), 20, 5)
    expect(g.rows[0]?.bg.slice(0, 4)).toEqual(['p236', '#373737', 'inverse', null])
    expect(g.rows[0]?.fg[2]).toBe('default/inverse')
  })

  test('caractère large (Unicode 11) : deux cellules, la seconde vide', async () => {
    const g = await gridOf(bytes('a机b🚀c'), 20, 5)
    const r = g.rows[0]
    expect(r?.cells.slice(0, 7)).toEqual(['a', '机', '', 'b', '🚀', '', 'c'])
    expect(r?.text).toBe('a机b🚀c')
  })

  test('passage à la ligne du terminal : la rangée suivante est marquée wrapped', async () => {
    const g = await gridOf(bytes('0123456789ab\r\nz'), 10, 5)
    expect(g.rows.map((r) => [r.text, r.wrapped]).slice(0, 3)).toEqual([
      ['0123456789', false],
      ['ab', true],
      ['z', false],
    ])
  })

  test('historique compris : les rangées sorties de l’écran restent dans la grille', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\r\n')
    const g = await gridOf(bytes(lines), 10, 4)
    expect(g.rows.map((r) => r.text).slice(0, 12)).toEqual(Array.from({ length: 12 }, (_, i) => `l${i}`))
  })
})

const EXP = `# carte vide
repere: ❯ /clair
+2: rien depuis le début de la session⟨attenue⟩
absent: clair ✗
signe: ✓
`

describe('parseExpected', () => {
  test('repère, lignes, absents, signes ; commentaires et lignes vides ignorés', () => {
    expect(parseExpected(EXP)).toEqual({
      anchor: '❯ /clair',
      lines: [{ from: 2, to: 2, text: 'rien depuis le début de la session', dim: true }],
      absent: ['clair ✗'],
      signs: ['✓'],
    })
  })
  test('plage de lignes +1..+3', () => {
    expect(parseExpected('repere: x\n+1..+3: y').lines).toEqual([{ from: 1, to: 3, text: 'y', dim: false }])
  })
  test('ligne inconnue : erreur', () => {
    expect(() => parseExpected('repere: x\nquoi: y')).toThrow()
  })
  test('sans repère : erreur', () => {
    expect(() => parseExpected('+1: y')).toThrow()
  })
})

const card = (body: string) => `❯ /clair\r\n\r\n${body}\r\n\r\n❯ \r\n`

describe('check : écarts entre la grille et l’attendu', () => {
  test('carte vide atténuée sans fond : aucun écart', async () => {
    const g = await gridOf(bytes(card('\x1b[2mrien depuis le début de la session\x1b[22m')), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual([])
  })

  test('ton atténué rendu par la couleur dimColor du thème sombre (#999999) : aucun écart', async () => {
    const g = await gridOf(bytes(card('\x1b[38;2;153;153;153mrien depuis le début de la session\x1b[39m')), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual([])
  })

  test('repère absent : un écart', async () => {
    const g = await gridOf(bytes('rien\r\n'), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual(['repère « ❯ /clair » introuvable'])
  })

  test('texte à la mauvaise ligne : écart qui montre la ligne lue', async () => {
    const g = await gridOf(bytes('❯ /clair\r\n\x1b[2mrien depuis le début de la session\x1b[22m\r\n'), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual([
      'ligne +2 : « rien depuis le début de la session » absent (lu : «  »)',
    ])
  })

  test('fond posé sur une cellule du mod : écart', async () => {
    const g = await gridOf(
      bytes(card('\x1b[2mrien depuis le \x1b[48;5;236mdébut\x1b[49m de la session\x1b[22m')),
      100,
      10,
    )
    expect(check(g, parseExpected(EXP))).toEqual([
      'ligne +2 : fond posé sur « rien depuis le début de la session » (colonne 15 : p236)',
    ])
  })

  test('ton atténué attendu mais absent : écart', async () => {
    const g = await gridOf(bytes(card('rien depuis le début de la session')), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual([
      'ligne +2 : « rien depuis le début de la session » n’est pas atténué (colonne 0 : default)',
    ])
  })

  test('chaîne absente présente : écart', async () => {
    const g = await gridOf(bytes(`${card('\x1b[2mrien depuis le début de la session\x1b[22m')}clair ✗ 1\r\n`), 100, 10)
    expect(check(g, parseExpected(EXP))).toEqual(['« clair ✗ » présent ligne 5 alors qu’il ne doit pas paraître'])
  })

  test('ligne du mod qui déborde (passage à la ligne du terminal) : écart', async () => {
    const exp = parseExpected('repere: ❯ /clair\n+1: 0123456789')
    const g = await gridOf(bytes('❯ /clair\r\n0123456789xy\r\n'), 10, 5)
    expect(check(g, exp)).toEqual(['ligne +1 : « 0123456789 » déborde (la rangée suivante continue la ligne)'])
  })

  test('caractère large : largeur de la grille égale à cellWidth, signe large compté 2', async () => {
    const exp = parseExpected('repere: ❯ /clair\n+1: 机器 ✓ ok\nsigne: ✓')
    const g = await gridOf(bytes('❯ /clair\r\n机器 ✓ ok\r\n'), 40, 5)
    expect(check(g, exp)).toEqual([])
  })

  test('largeur de la grille différente de cellWidth : écart (xterm Unicode 11 ≠ table du mod)', async () => {
    // U+2630 (TRIGRAMME DU CIEL) : étroit pour addon-unicode11 (Unicode 11), large pour string-width et cellWidth.
    const exp = parseExpected('repere: ❯ /clair\n+1: a\u{2630}b')
    const g = await gridOf(bytes('❯ /clair\r\na\u{2630}b\r\n'), 40, 5)
    expect(check(g, exp)).toEqual([
      'ligne +1 : « a\u{2630}b » occupe 3 cellules dans le terminal, cellWidth en compte 4',
    ])
  })

  test('signe dont la largeur dans le terminal diffère de cellWidth : écart', async () => {
    const exp = parseExpected('repere: ❯ /clair\n+1: x\u{2630}\nsigne: \u{2630}')
    const g = await gridOf(bytes('❯ /clair\r\nx\u{2630}\r\n'), 40, 5)
    expect(check(g, exp)).toEqual([
      'ligne +1 : « x\u{2630} » occupe 2 cellules dans le terminal, cellWidth en compte 3',
      'ligne +1 : signe « \u{2630} » sur 1 cellules, cellWidth en compte 2',
    ])
  })

  test('plage de lignes : la première rangée de la plage qui contient le texte', async () => {
    const exp = parseExpected('repere: ❯ /clair\n+1..+3: b')
    const g = await gridOf(bytes('❯ /clair\r\na\r\n\r\nb\r\n'), 40, 6)
    expect(check(g, exp)).toEqual([])
    const g2 = await gridOf(bytes('❯ /clair\r\na\r\n\r\n\r\nb\r\n'), 40, 6)
    expect(check(g2, exp)).toEqual(['lignes +1..+3 : « b » absent'])
  })

  test('le repère est la dernière rangée qui le contient', async () => {
    const exp = parseExpected('repere: ❯ /clair\n+1: deux')
    const g = await gridOf(bytes('❯ /clair\r\nun\r\n❯ /clair\r\ndeux\r\n'), 40, 6)
    expect(check(g, exp)).toEqual([])
  })
})

describe('scénarios de la peinture', () => {
  test('noms de scénario et de capture uniques, une capture au moins par scénario', () => {
    expect(new Set(SCENARIOS.map((s) => s.name)).size).toBe(SCENARIOS.length)
    const captures = SCENARIOS.flatMap((s) => s.steps.flatMap((st) => ('capture' in st ? [st.capture] : [])))
    expect(new Set(captures).size).toBe(captures.length)
    for (const s of SCENARIOS) expect(s.steps.some((st) => 'capture' in st)).toBe(true)
  })
  test('un motif attendu après une saisie n’est pas dans ce qui a été tapé (l’écho le montrerait)', () => {
    for (const s of SCENARIOS) {
      let typed = ''
      for (const st of s.steps) {
        if ('send' in st) typed += st.send
        if ('waitFor' in st && typed !== '') expect(typed.includes(st.waitFor)).toBe(false)
      }
    }
  })
  test('les scénarios sans modèle ne demandent ni modèle ni outil', () => {
    for (const s of SCENARIOS.filter((x) => !x.model)) expect(s.args).toEqual([])
  })
})

describe('isLoginScreen : écran qui bloque la session', () => {
  test('choix de la méthode de connexion, avec le curseur ❯ (texte réel, blancs retirés par Ink)', () => {
    const t =
      'Claude Code can be used with your Claude subscription Select login method: ❯1. Claude account with ' +
      'subscription 2. AnthropicConsoleaccount·API usage billing'
    expect(isLoginScreen(t)).toBe(true)
    expect(isLoginScreen('Selectloginmethod:❯1.Claudeaccount')).toBe(true)
  })
  test('collage du code OAuth et navigateur non ouvert', () => {
    expect(isLoginScreen("Browser didn't open? Use the url below Pastecodehereifprompted>")).toBe(true)
  })
  test('choix du thème (accueil), avec ❯', () => {
    expect(isLoginScreen("Let'sgetstarted. Choosethetextstylethatlooksbestwithyourterminal ❯✔Darkmode")).toBe(true)
  })
  test('session ouverte sans identifiant : le pied « Not logged in · Run /login » ne bloque pas', () => {
    expect(isLoginScreen('❯ ⏵⏵ auto mode on · ← for agents Not logged in · Run /login ◐ medium · /effort')).toBe(false)
    expect(isLoginScreen('❯ /clair rien depuis le début de la session')).toBe(false)
  })
})
