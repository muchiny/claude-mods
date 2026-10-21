import { expect, test } from 'claude-code/testing'

import { rulesOf } from '../../mode-clair/tests/replay/oracle'
import { SCENARIOS } from '../../mode-clair/tests/replay/scenarios.generated'
import { RULINGS, SYNTHETIC } from '../../mode-clair/tests/replay/synthetic'
// @ts-expect-error module .mjs sans déclaration de types
import { readRepo, writeReport } from './replay-files.mjs'

// Tableau de couverture de REFERENCE.md (plan, tâche 8, étape 5) : pour chaque ligne Rxx, le nombre de
// scénarios réels et synthétiques où elle a décidé dans l'oracle (rulesOf), puis les autres suites qui la
// vérifient. Écrit dans reports/replay-coverage.md (dossier ignoré par git) ; aucune ligne sans couverture.

/**
 * Lignes dont l'effet n'est pas visible dans le vocabulaire `Truth` (machine, ✓/✗/○/?, workflows, étape) :
 * le rejeu les traverse sans les vérifier, il n'en reçoit donc aucun crédit ; une autre suite doit les
 * porter (`CLAIMS`). R20, R21 : « en cours » est transitoire ; R24 : le résultat arrivé ensuite décide ;
 * R40 et R87 : même outcome que R25 et R86 ; R47, R51 : rien ne change ; R19 : le texte lu ne change pas
 * l'outcome d'une sortie 0 ; R54, R56 : « à toi » et l'accord ; R59 : accord par option ; R09, R10 : nature.
 */
const NOT_OBSERVABLE = new Set([
  'R09',
  'R10',
  'R19',
  'R20',
  'R21',
  'R24',
  'R40',
  'R47',
  'R51',
  'R54',
  'R56',
  'R59',
  'R87',
])

type Suite = 'golden' | 'props' | 'peinture' | 'moteur' | 'unitaire'

/**
 * Lignes vérifiées hors du rejeu : [ligne, suite, fichier, texte qui doit s'y trouver (nom du cas ou
 * du test)]. Le texte est cherché dans le fichier : un cas renommé ou supprimé fait échouer ce test.
 * Le lien entre le cas et la ligne reste relevé à la main.
 */
const CLAIMS: readonly [string, Suite, string, string][] = [
  ['R13', 'golden', 'tests/golden/cases.ts', "'multi-hotes'"],
  ['R15', 'golden', 'tests/golden/cases.ts', "'session-ssh'"],
  ['R21', 'golden', 'tests/golden/cases.ts', "'appel-en-cours'"],
  ['R22', 'golden', 'tests/golden/cases.ts', "'refuse-claude'"],
  ['R23', 'golden', 'tests/golden/cases.ts', "'interrompu'"],
  ['R25', 'golden', 'tests/golden/cases.ts', "'fait-lecture'"],
  ['R30', 'golden', 'tests/golden/cases.ts', "'injoignable'"],
  ['R31', 'golden', 'tests/golden/cases.ts', "'refuse'"],
  ['R33', 'golden', 'tests/golden/cases.ts', "'code-2'"],
  ['R40', 'golden', 'tests/golden/cases.ts', "'code-2'"],
  ['R44', 'golden', 'tests/golden/cases.ts', "'decline'"],
  ['R51', 'golden', 'tests/golden/cases.ts', "'tronque'"],
  ['R52', 'golden', 'tests/golden/cases.ts', "'incertain'"],
  ['R53', 'golden', 'tests/golden/cases.ts', "'carte-echec-raison'"],
  ['R54', 'golden', 'tests/golden/cases.ts', "'attente-accord'"],
  ['R57', 'golden', 'tests/golden/cases.ts', "'decline'"],
  ['R60', 'golden', 'tests/golden/cases.ts', "'repos'"],
  ['R67', 'golden', 'tests/golden/cases.ts', "'carte-vide'"],
  ['R68', 'golden', 'tests/golden/cases.ts', "'carte-pleine'"],
  ['R69', 'golden', 'tests/golden/cases.ts', "'incertain-machine-inconnue'"],
  ['R70', 'golden', 'tests/golden/cases.ts', "'carte-probleme-masque'"],
  ['R71', 'golden', 'tests/golden/cases.ts', "'carte-pleine-machine'"],
  ['R74', 'golden', 'tests/golden/cases.ts', "'workflow-3-phases'"],
  ['R86', 'golden', 'tests/golden/cases.ts', "'superpowers-taches'"],
  ['R92', 'golden', 'tests/golden/cases.ts', "'superpowers-perime'"],
  ['R93', 'golden', 'tests/golden/cases.ts', "'nom-60-caracteres'"],
  ['R20', 'props', 'tests/props/lifecycle.test.ts', 'aucun appel n’est fait sans résultat'],
  ['R24', 'props', 'tests/props/lifecycle.test.ts', 'fin de tour'],
  ['R52', 'props', 'tests/props/lifecycle.test.ts', 'sortie illisible'],
  ['R60', 'props', 'tests/props/render.test.ts', 'repos vide'],
  ['R72', 'props', 'tests/props/render.test.ts', 'carte aller-retour'],
  ['R93', 'props', 'tests/props/render.test.ts', 'largeur'],
  ['R26', 'peinture', 'dev/paint/scenarios.ts', "'exec-ok'"],
  ['R27', 'peinture', 'dev/paint/scenarios.ts', "'exit-2'"],
  ['R29', 'peinture', 'dev/paint/scenarios.ts', "'hote-inconnu'"],
  ['R60', 'peinture', 'dev/paint/scenarios.ts', "'repos'"],
  ['R64', 'peinture', 'dev/paint/scenarios.ts', "'exec-ok'"],
  ['R67', 'peinture', 'dev/paint/scenarios.ts', "'clair-vide'"],
  ['R01', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'en cours dès le début du tool.call'],
  ['R02', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'contient seulement « bridge »'],
  ['R03', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'mode progressif'],
  ['R08', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'run_in_background'],
  ['R15', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'ssh_session_create puis ssh_session_exec'],
  ['R20', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'en cours dès le début du tool.call'],
  ['R21', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'un appel en cours tient la bande'],
  ['R22', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'PermissionDenied : refusé par Claude Code'],
  ['R23', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'le cœur échoue'],
  ['R24', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'deviennent interrompus'],
  ['R54', 'moteur', 'mode-clair/tests/engine/render.test.tsx', '« à toi » prend la première ligne'],
  ['R55', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'sans hôte lisible dans le message'],
  ['R56', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'accepté avec confirm = true'],
  ['R57', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'Échap sur le formulaire'],
  ['R58', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'la réponse n’arrive jamais'],
  ['R60', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'rien n’a eu lieu'],
  ['R61', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'un appel en cours tient la bande'],
  ['R62', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'un appel bridge pendant une tâche Superpowers'],
  ['R63', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'vue d’un sous-agent'],
  ['R64', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'un appel seul'],
  ['R65', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'groupe replié'],
  ['R66', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'groupe déplié'],
  ['R67', 'moteur', 'mode-clair/tests/engine/card.test.tsx', 'rien dans la session'],
  ['R71', 'moteur', 'mode-clair/tests/engine/card.test.tsx', '/clair raspberry'],
  ['R72', 'moteur', 'mode-clair/tests/engine/card.test.tsx', 'une ancienne carte reste telle'],
  ['R73', 'moteur', 'mode-clair/tests/engine/render.test.tsx', 'l’étiquette clair ✗ 1'],
  ['R74', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'suivi par son identifiant'],
  ['R75', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'un résultat Workflow en erreur'],
  ['R76', 'moteur', 'mode-clair/tests/engine/colle.test.tsx', 'un workflow local sans transcriptDir'],
  ['R77', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'le minuteur du journal lit le journal'],
  ['R78', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'la notification de fin'],
  ['R79', 'moteur', 'mode-clair/tests/engine/colle.test.tsx', 'sans nouvelles'],
  ['R80', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'un workflow à distance'],
  ['R81', 'moteur', 'mode-clair/tests/engine/colle.test.tsx', 'journal absent'],
  ['R82', 'moteur', 'mode-clair/tests/engine/colle.test.tsx', 'deux workflows'],
  ['R86', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'une session Superpowers'],
  ['R90', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'un skill qui n’est pas une étape'],
  ['R91', 'moteur', 'mode-clair/tests/engine/events.test.tsx', 'Edit d’un plan'],
  ['R92', 'moteur', 'mode-clair/tests/engine/events.test.tsx', '30 minutes sans événement'],
  ['R93', 'moteur', 'mode-clair/tests/engine/card.test.tsx', 'à 40 colonnes'],
  ['R09', 'unitaire', 'mode-clair/tests/pure/bridge-parse.test.ts', 'outil absent de la table : nature inconnue'],
  ['R10', 'unitaire', 'mode-clair/tests/pure/bridge-parse.test.ts', 'la nature vient de la table'],
  ['R19', 'unitaire', 'mode-clair/tests/pure/bridge-classify.test.ts', '--json : le texte est lu dans content[].text'],
  ['R40', 'unitaire', 'mode-clair/tests/pure/bridge-classify.test.ts', '0 : [exit:N] sans erreur → code N'],
  [
    'R47',
    'unitaire',
    'mode-clair/tests/pure/bridge-classify.test.ts',
    'le corps n’est pas lu comme un texte du bridge',
  ],
  ['R51', 'unitaire', 'mode-clair/tests/pure/view.test.ts', 'tronqué : suffixe en ton attention'],
  ['R59', 'unitaire', 'mode-clair/tests/pure/bridge-parse.test.ts', '--yes avant le premier argument'],
  ['R87', 'unitaire', 'mode-clair/tests/pure/view.test.ts', 'jamais « tâche 0 »'],
]

const SUITES: readonly Suite[] = ['golden', 'props', 'peinture', 'moteur', 'unitaire']

test('chaque cas cité par le tableau existe dans sa suite', () => {
  for (const [rule, , file, needle] of CLAIMS)
    expect([rule, file, readRepo(file).includes(needle)]).toEqual([rule, file, true])
})

test('chaque ligne de REFERENCE.md est couverte ; tableau écrit dans reports/replay-coverage.md', () => {
  const reference: string = readRepo('mode-clair/tests/replay/REFERENCE.md')
  const rows = [...reference.matchAll(/^\| (R\d\d) \|/gm)].map((m) => m[1] as string)
  const count = (list: readonly { events: unknown[] }[], rule: string) =>
    list.filter((s) => rulesOf(s as never).has(rule)).length
  const synthetic = [...SYNTHETIC, ...RULINGS]
  const lines = [
    '# Couverture de REFERENCE.md par le rejeu',
    '',
    `Scénarios : ${SCENARIOS.length} réels, ${synthetic.length} synthétiques. Une ligne marquée « non » dans`,
    '« visible » n’est pas vérifiée par le rejeu (son effet n’est pas dans `Truth`) : ses comptes sont entre',
    'parenthèses et ne valent pas couverture.',
    '',
    '| ligne | visible | rejeu | synthétique | golden | props | peinture | moteur | unitaire |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  const uncovered: string[] = []
  for (const r of rows) {
    const visible = !NOT_OBSERVABLE.has(r)
    const real = count(SCENARIOS, r)
    const synth = count(synthetic, r)
    const shown = (n: number) => (n === 0 ? '' : visible ? String(n) : `(${n})`)
    const other = SUITES.map((suite) => (CLAIMS.some(([rule, s]) => rule === r && s === suite) ? 'oui' : ''))
    const credited = (visible && real + synth > 0) || other.some((o) => o !== '')
    if (!credited) uncovered.push(r)
    lines.push(`| ${r} | ${visible ? 'oui' : 'non'} | ${shown(real)} | ${shown(synth)} | ${other.join(' | ')} |`)
  }
  writeReport('reports/replay-coverage.md', `${lines.join('\n')}\n`)
  expect(rows.length).toBeGreaterThan(90)
  expect(uncovered).toEqual([])
})
