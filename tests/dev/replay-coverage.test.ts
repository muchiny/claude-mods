import { expect, test } from 'claude-code/testing'

import { rulesOf } from '../../mode-clair/tests/replay/oracle'
import { SCENARIOS } from '../../mode-clair/tests/replay/scenarios.generated'
import { QUESTIONS, SYNTHETIC } from '../../mode-clair/tests/replay/synthetic'
// @ts-expect-error module .mjs sans déclaration de types
import { readRepo, writeReport } from './replay-files.mjs'

// Tableau de couverture de REFERENCE.md (plan, tâche 8, étape 5) : pour chaque ligne Rxx, le nombre de
// scénarios réels et synthétiques où elle a décidé dans l'oracle (rulesOf), puis les autres suites qui la
// vérifient. Écrit dans reports/replay-coverage.md (dossier ignoré par git) ; aucune ligne sans couverture.

/**
 * Lignes vérifiées hors du rejeu, relevées à la main dans chaque suite (nom du cas ou du test entre
 * parenthèses dans le commentaire) : golden = tests/golden/cases.ts ; props = tests/props ;
 * peinture = dev/paint/scenarios.ts ; moteur = mode-clair/tests/engine ; unitaire = mode-clair/tests/pure
 * (seulement pour la nature, que le vocabulaire de l'oracle ne compare pas).
 */
const GOLDEN = [
  'R13', // multi-hotes
  'R15', // session-ssh
  'R21', // appel-en-cours
  'R22', // refuse-claude
  'R23', // interrompu
  'R25', // fait-lecture
  'R30', // injoignable
  'R31', // refuse
  'R33', // code-2
  'R40', // code-2
  'R44', // decline
  'R51', // tronque
  'R52', // incertain
  'R53', // carte-echec-raison, carte-echec-deja-vu
  'R54', // attente-accord
  'R57', // decline
  'R60', // repos
  'R67', // carte-vide
  'R68', // carte-pleine
  'R69', // incertain-machine-inconnue
  'R70', // carte-probleme-masque, carte-echec-deja-vu
  'R71', // carte-pleine-machine
  'R74', // workflow-3-phases
  'R86', // superpowers-taches
  'R92', // superpowers-perime
  'R93', // nom-60-caracteres, nom-60-caracteres-carte, nom-60-caracteres-carte-machine
]
const PROPS = [
  'R20', // lifecycle « aucun appel n'est fait sans résultat »
  'R24', // lifecycle « fin de tour »
  'R52', // lifecycle « sortie illisible »
  'R60', // render « repos vide »
  'R72', // render « carte aller-retour »
  'R93', // render « largeur »
]
const PAINT = [
  'R26', // exec-ok
  'R27', // exit-2
  'R29', // hote-inconnu
  'R60', // repos
  'R64', // exec-ok (rangée au-dessus du résultat du moteur)
  'R67', // clair-vide
]
const ENGINE = [
  'R01', // events « en cours dès le début du tool.call »
  'R02', // events « un serveur dont le nom contient seulement bridge »
  'R03', // events « mode progressif »
  'R08', // events « run_in_background », render « un appel en arrière-plan »
  'R15', // events « ssh_session_create puis ssh_session_exec »
  'R20', // events « en cours dès le début »
  'R22', // events « PermissionDenied »
  'R23', // events « le cœur échoue »
  'R24', // events « turn.complete »
  'R54', // events, render « à toi prend la première ligne »
  'R55', // events « sans hôte lisible dans le message »
  'R56', // events « accepté avec confirm = true »
  'R57', // events « décliné », « Échap »
  'R58', // events « la réponse n'arrive jamais »
  'R60', // render « rien n'a eu lieu »
  'R61', // render « un appel en cours tient la bande »
  'R62', // render « un appel bridge pendant une tâche Superpowers »
  'R63', // render « vue d'un sous-agent »
  'R64', // render « un appel seul »
  'R65', // render « groupe replié »
  'R66', // render « groupe déplié »
  'R67', // card « rien dans la session »
  'R71', // card « /clair raspberry »
  'R72', // card « une ancienne carte reste telle qu'elle était »
  'R73', // render « l'étiquette clair ✗ 1 »
  'R74', // events « suivi par son identifiant »
  'R75', // events « un résultat Workflow en erreur »
  'R76', // colle « un workflow local sans transcriptDir »
  'R77', // events « le minuteur du journal lit le journal »
  'R78', // events « la notification de fin »
  'R79', // colle « sans nouvelles »
  'R80', // events « un workflow à distance »
  'R81', // colle « journal absent »
  'R82', // colle « deux workflows »
  'R86', // events « une session Superpowers »
  'R90', // events « un skill qui n'est pas une étape »
  'R91', // events « Edit d'un plan »
  'R92', // events « 30 minutes sans événement »
  'R93', // card « à 40 colonnes »
]

const UNIT = [
  'R09', // tests/pure/bridge-parse.test.ts : outil absent de la table → nature inconnu
  'R10', // tests/pure/bridge-parse.test.ts : nature lecture / peut modifier
]

test('chaque ligne de REFERENCE.md est couverte ; tableau écrit dans reports/replay-coverage.md', () => {
  const reference: string = readRepo('mode-clair/tests/replay/REFERENCE.md')
  const rows = [...reference.matchAll(/^\| (R\d\d) \|/gm)].map((m) => m[1] as string)
  const count = (list: readonly { events: unknown[] }[], rule: string) =>
    list.filter((s) => rulesOf(s as never).has(rule)).length
  const synthetic = [...SYNTHETIC, ...QUESTIONS.map((q) => q.scenario)]
  const lines = [
    '# Couverture de REFERENCE.md par le rejeu',
    '',
    `Scénarios : ${SCENARIOS.length} réels, ${synthetic.length} synthétiques (dont ${QUESTIONS.length} questions ouvertes).`,
    '',
    '| ligne | rejeu | synthétique | golden | props | peinture | moteur | unitaire |',
    '|---|---|---|---|---|---|---|---|',
  ]
  const uncovered: string[] = []
  for (const r of rows) {
    const real = count(SCENARIOS, r)
    const synth = count(synthetic, r)
    const other = [GOLDEN, PROPS, PAINT, ENGINE, UNIT].map((l) => (l.includes(r) ? 'oui' : ''))
    if (real + synth === 0 && other.every((o) => o === '')) uncovered.push(r)
    lines.push(`| ${r} | ${real || ''} | ${synth || ''} | ${other.join(' | ')} |`)
  }
  writeReport('reports/replay-coverage.md', `${lines.join('\n')}\n`)
  expect(rows.length).toBeGreaterThan(90)
  expect(uncovered).toEqual([])
})
