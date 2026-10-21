# claude-mods

[![CI](https://github.com/muchiny/claude-mods/actions/workflows/ci.yml/badge.svg)](https://github.com/muchiny/claude-mods/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/muchiny/claude-mods/badge)](https://scorecard.dev/viewer/?uri=github.com/muchiny/claude-mods)

Mods pour [Claude Code](https://code.claude.com) : des plugins qui changent
l'interface de Claude Code lui-même (bande au-dessus de la saisie, panneau,
ligne d'état), sans toucher à ton code.

| Mod | Ce qu'il fait |
| --- | --- |
| [`mode-clair`](mode-clair/README.md) | Un seul endroit où voir ce que Claude fait : étapes **Superpowers**, workflows **ultracode** et, si tu l'utilises, appels à **bridge-mcp**, en pipeline coloré. Observe seulement. |

## Prérequis

- Claude Code **2.1.296 ou plus récent** (`claude --version`). Les mods sont
  encore en accès anticipé.
- Aucune autre dépendance. Les mods ne font aucun appel réseau.

## Installation

Dans une session Claude Code :

```text
/plugin marketplace add muchiny/claude-mods
/plugin install mode-clair@muchini-mods
```

Choisis la portée à l'installation :

- **utilisateur** : le mod est actif dans tous tes projets ;
- **projet** : actif seulement dans le dépôt courant.

Ensuite, tape `/clair` : la carte de `mode-clair` s'écrit dans la conversation. Le détail des
signes, des sources et des limites est dans le
[README du mod](mode-clair/README.md).

## Mettre à jour ou retirer

```text
/plugin marketplace update muchini-mods
/plugin uninstall mode-clair
```

## Essayer sans installer

```bash
git clone https://github.com/muchiny/claude-mods.git
claude --plugin-dir ./claude-mods/mode-clair
```

## Développement

Node 22 ou plus récent, puis `npm ci`. N'appelle jamais un outil par son nom avant `npm ci` (un lanceur de paquets
télécharge sinon un homonyme) : tout passe par `npm run …` ou `node_modules/.bin/…`.

```bash
npm run lint           # Biome : lint, format, tri des imports (biome ci)
npm run format         # applique le format Biome
npm run typecheck      # tsc --noEmit, types de l'API des mods dans dev/claude-code.d.ts
npm run validate       # claude plugin validate (marketplace et mod)
npm test               # claude plugin test mode-clair : tests purs, moteur, rejeu sur sessions réelles
npm run coverage       # couverture des modules purs sous bun:test (seuil : 100 % des lignes et fonctions)
npm run test:dev       # bun test ./tests : propriétés (graine 42), goldens, largeur, outils de dev
npm run props          # seulement les propriétés (PROPS_RUNS, PROPS_SEED), délai de 10 min
npm run test:golden    # seulement les goldens de rendu
npm run golden:update  # réécrit les goldens (diff à relire dans la PR)
npm run mutate:pure    # mutation de tous les modules purs sous Bun (environ 40 min, voir plus bas)
npm run mutate:module -- view.ts  # mutation d'un seul module, avec les seuls tests qui l'atteignent
npm run mutate:gate    # porte de PR : mutation des lignes de hooks modifiées (--base origin/main)
npm run mutate         # Stryker historique (dev/stryker-test.sh, copie jetable du mod)
npm run replay:extract # régénère la fixture de rejeu depuis ~/.claude/projects (local, voir ci-dessous)
npm run replay:reduce  # réduit la fixture générée à la taille committée (local)
npm run paint          # peinture du vrai terminal (dev/paint/), Claude Code réel dans un pty
```

La preuve de fin de tâche est `npm run lint && npm run typecheck && npm test && npm run coverage`,
plus `npm run test:dev`. `bun` vient du paquet npm (`node_modules/.bin/bun`), pas du `PATH`.

### Couches de tests

| Couche | Où | Sous quoi | Ce qu'elle attrape |
| --- | --- | --- | --- |
| Unitaires purs | `mode-clair/tests/pure` | `claude plugin test` et `bun test` | la logique des modules `hooks/*.ts` (analyse de commande, classement, état, rendu) |
| Moteur | `mode-clair/tests/engine` | `claude plugin test` seulement | le branchement de `register.tsx` sur les événements du vrai moteur de mods |
| Golden | `tests/golden` | `bun test` | le texte et les tons du rendu (bande, rangées, carte) à 40, 80, 120 et 200 colonnes, comparés à des fichiers |
| Propriétés | `tests/props` | `bun test` (fast-check) | des invariants sur des séquences d'événements tirées au hasard : jamais « fait » sans résultat, tout appel finit dans un seul état, aucune ligne au-delà de `columns`, aller-retour de la carte, pas d'usurpation par caractère de contrôle |
| Largeur | `tests/width` | `bun test` | la largeur en cellules de chaque point de code, contre la table de `@xterm/addon-unicode11` |
| Rejeu et oracle | `mode-clair/tests/replay` | `claude plugin test` | des sessions réelles anonymisées (scénarios réels) et écrites à la main (synthétiques), injectées dans le vrai `register.tsx` ; l'état final est comparé à un oracle indépendant |
| Peinture | `dev/paint`, `.github/workflows/paint.yml` | Claude Code réel dans un pty | ce qui arrive vraiment à l'écran : textes, couleurs, fonds, largeur des signes |
| Mutation pure | `stryker.pure.json`, `dev/mutate-module.mjs`, `dev/mutation-gate.mjs` | `bun test` sous Stryker | les tests voient-ils un changement de comportement des modules purs ? |
| Mutation de la colle | `dev/mutate-glue.mjs` | `claude plugin test` sur copie | idem pour `register.tsx`, que Stryker ne sait pas muter |
| Outils de dev | `tests/dev` | `bun test` | l'anonymiseur, les gardes de confidentialité, la porte de mutation, le banc de peinture, les workflows |

L'oracle (`mode-clair/tests/replay/oracle.ts`) lit la table `mode-clair/tests/replay/REFERENCE.md` et
jamais `hooks/*` (un test de dev refuse tout import de `hooks/`). Sa limite : il ne compare que
`succes`, `echec`, `refus`, `interrompu`, `attente`, `inconnu` et l'hôte de chaque appel, les
workflows terminés ou non et l'étape Superpowers. Les états fins (`code N`, `délai dépassé`,
`limité`, nature, drapeau `tronqué`, texte exact des rangées) ne sont donc pas vérifiés par le rejeu :
ils reposent sur les tests purs, les goldens et les propriétés.

Les scénarios réels viennent de sessions de l'auteur, anonymisées de façon déterministe par
`dev/replay/anonymize.ts` (machines, chemins, identifiants, horodatages, nombres, texte libre en
lorem de même longueur) puis refusées par une barrière si une forme inconnue reste. Le texte libre
garde la longueur et la ponctuation des libellés : un dictionnaire de longueurs reste théoriquement
possible (voir l'en-tête de `anonymize.ts`). La fixture committée est
`mode-clair/tests/replay/scenarios.generated.ts` (environ 900 Ko). Le tarball de release est
fait de `git archive … HEAD mode-clair` : il **embarque donc `mode-clair/tests/`**, fixtures
anonymisées comprises. Régénérer la fixture (`replay:extract` puis `replay:reduce`) se fait en local,
sur une machine qui a les transcripts ; la CI ne le fait jamais.

### Couverture

`bun test` rejoue les tests purs (`mode-clair/tests/pure`) avec `bun:test` à la place de
`claude-code/testing` (`dev/bun-claude-code-testing.ts`) et mesure les lignes et les fonctions des
modules de `mode-clair/hooks`. `register.tsx` n'est exercé que par les tests moteur, que seul
`claude plugin test` sait lancer : il n'est pas compté. Bun ne mesure pas les branches ; le mutation
testing ci-dessous les couvre, en plus exigeant.

### Mutation testing

[Stryker](https://stryker-mutator.io) mesure si les tests voient vraiment un changement de comportement :

```bash
node_modules/.bin/stryker run --mutate "mode-clair/hooks/colors.ts" --concurrency 1
```

`claude plugin test` n'expose pas l'environnement aux modules, donc Stryker ne peut pas activer ses
mutants lui-même. `dev/stryker-test.sh` travaille sur une copie jetable du mod dans `/var/tmp` en y
inscrivant le mutant actif. Compte environ 4,5 s par mutant ; le module `bridge.ts` seul en a 1 656.
`register.tsx` (le branchement des événements) est exclu : le moteur lit les noms d'événements de
`on()` dans la source, et Stryker les enveloppe dans un ternaire, ce qui empêche le module de se charger
(voir plus bas, mutation de la colle).
La CI le lance chaque lundi et à la demande (`.github/workflows/mutation.yml`), un job par module,
et publie le rapport HTML en artefact.

#### Mutation rapide sous Bun

`npm run mutate:pure` (`stryker.pure.json`) rejoue `mode-clair/tests/pure`, `tests/golden`, `tests/props` et `tests/width` sous `bun test` (pas `tests/dev` : ces tests lisent des fichiers du dépôt que Stryker décale dans son bac à sable, par exemple `register.tsx` coiffé de `// @ts-nocheck`) : le
processus lit lui-même `__STRYKER_ACTIVE_MUTANT__`, plus besoin de copie jetable. Le rapport est dans
`reports/mutation-pure/`. Lance-le avec `TMPDIR=/var/tmp` et un peu de mémoire libre.

- **Porte de PR** : `node dev/mutation-gate.mjs --base origin/main` ne mute que les lignes de
  `mode-clair/hooks` ajoutées ou modifiées depuis l'ancêtre commun avec la base (`register.tsx` et `tools.generated.ts`
  exclus) ; un mutant survivant fait échouer le job `mutation-pr` de la CI.
- **Planchers** : `dev/mutation-floors.json` donne le score minimal de chaque module. `node dev/mutate-module.mjs
  <module>.ts` (`npm run mutate:module -- <module>.ts`) mute un seul module avec les seuls tests qui l'atteignent (par
  leurs imports, `--list` les affiche) et `PROPS_RUNS=30`, graine 42 : l'instrumentation de Stryker ralentit les tests
  de propriétés d'environ 15 fois (tout le dépôt : 2 s nus, 27 s instrumentés), et c'est cela qui rendait la mutation
  complète d'une seule traite impraticable (4 233 mutants, une quinzaine d'heures). Le rapport va dans
  `reports/mutation-pure/<module>.ts.json`. Dans `mutation.yml`, un job `floors-module` par module (timeout 90 min)
  puis un job `floors` qui rassemble les rapports : `node dev/mutation-floors.mjs reports/floors/*.json` (code 1 sous un
  plancher, pour un module sans rapport ou sans plancher ; `--write` relève les planchers qu'un module dépasse).
- **Durées mesurées** (WSL, concurrence 2, un module à la fois) : fr, superpowers 5 s ; workflow 1 min ; colors 15 s ;
  state 9 min ; view 7 min ; cells 9 min (le test exhaustif de largeur ne tourne que là) ; bridge 14 min. Tous les
  modules tiennent donc largement dans un job hebdomadaire ; `npm run mutate:pure` (tous les modules d'un coup, mêmes
  réglages) reste possible mais prend environ 40 min. Les planchers ci-dessous ont tous été remesurés dans cette branche.
- **Survivants** : il n'y a pas de liste à tenir à la main. Les mutants que les tests ne tuent pas sont dans
  le rapport de chaque module (`reports/mutation-pure/<module>.ts.json`, artefact `mutation-floor-<module>`
  de `mutation.yml`), avec leur ligne ; le plancher de `dev/mutation-floors.json` est le score mesuré,
  et une baisse fait échouer le job `floors`. La porte de PR ne tolère aucun survivant sur les lignes
  qu'elle modifie : une PR qui touche une ligne dont le mutant survit doit ajouter le test qui le tue,
  ou annoter un équivalent relu (`// Stryker disable next-line <mutateur>: <raison>`).
- **Branches** : Bun ne mesure pas les branches (seuils `lines` et `functions` seulement, `statements`
  accepté mais non appliqué, doc Bun 1.4). La mutation en tient lieu.
- **Délai d'un mutant** : `timeoutMS` vaut 3000 ms. Des mutants de la boucle du découpeur shell de
  `bridge.ts` tournent à l'infini ; à 30 s chacun, la mutation complète dépasserait 8 h (12 min à
  3 s). Stryker compte un timeout comme un mutant tué : les planchers sont donc légèrement indulgents.

#### Mutation de la colle `register.tsx`

Stryker ne peut pas muter `register.tsx` ; `dev/mutate-glue.mjs` le fait par des mutations textuelles
ciblées (`===`↔`!==`, `&&`↔`||`, `return next(e)` sans l'appel, `if (cond)` → `true`/`false`,
littéraux numériques ±1), jamais dans les chaînes, commentaires, regex, gabarits, texte JSX, ni dans
l'événement et le filtre d'un `on(`. Chaque mutant tourne sur une copie du mod dans `/var/tmp`, sous
`timeout 180 claude plugin test` et un garde-fou qui tue le groupe de processus au-delà de 1,5 Go ;
le lancement exige 8 Go de mémoire disponible (`GLUE_MIN_AVAILABLE_MB` ajuste ce seuil sur un runner
de CI). Une copie non mutée doit d'abord passer. Rapport : `reports/mutation-glue/result.json` :
`killed` (des tests ont échoué), `survived` (ligne et diff), `error` (délai, mémoire, lancement
impossible, plantage avant le bilan des tests : verdict inconnu). Un survivant ou une erreur fait
sortir en code 1.

```bash
node dev/mutate-glue.mjs --list                 # les mutants, sans rien lancer
node dev/mutate-glue.mjs --sample 30 --seed 1   # un tirage reproductible, concurrence 1
node dev/mutate-glue.mjs --only L87C12-next     # un mutant précis
```

Les mutants équivalents relus sont dans `dev/mutate-glue-equivalents.json`, chacun avec sa raison et
une empreinte (from, to et texte des lignes touchées) : une ligne déplacée ou réécrite rend l'entrée
périmée et le runner refuse de tourner tant que la liste n'est pas relue. Les équivalents qui
reposent sur le `.catch` des hooks sont épinglés par `mode-clair/tests/engine/catch.test.tsx`. Le job `glue` de `mutation.yml` lance la mutation complète
chaque lundi (environ 4 s par mutant) ; un survivant le fait échouer.

### CI : ce que chaque workflow prouve, et ce qu'il ne prouve pas

`.github/workflows/ci.yml`, à chaque push et pull request. Les noms de jobs sont ceux à exiger dans la
protection de la branche `main` (`docs/BRANCH-PROTECTION.md`).

| Job | Prouve | Ne prouve pas |
| --- | --- | --- |
| `static` | Biome (`--error-on-warnings`), `tsc`, `npm audit` (échec à partir de « high ») | le comportement |
| `coverage` | 100 % des lignes et des fonctions des modules purs (`bun test --coverage`) | que les tests voient un changement (c'est la mutation) ; les branches (Bun ne les mesure pas) ; `register.tsx` (non compté) |
| `props-golden` | `npm run test:dev` : propriétés à graine fixe 42 et 200 exécutions, goldens, largeur, outils de dev ; forme de `tools.generated.ts` | des séquences rares (la passe hebdomadaire en tire 10 000, graine variable) ; le contenu de `tools.generated.ts` |
| `mod (2.1.296, node 22)` | `claude plugin validate` (marketplace et mod) et `claude plugin test` (tests purs, moteur, rejeu sur les scénarios réels et synthétiques) sur la version minimale annoncée | le rendu dans un vrai terminal ; la fidélité de l'oracle sur les états fins |
| `mod (latest, node 24)` | les mêmes contrôles sur la dernière version de Claude Code | idem |
| `mutation-pr` | aucun mutant survivant sur les lignes de `mode-clair/hooks` modifiées par la PR (`register.tsx` exclu) | la qualité des lignes non touchées (planchers hebdomadaires) ; la colle |
| `hygiene` | aucun chemin personnel ni secret, fixtures de rejeu aux formes synthétiques, gitleaks sur l'historique | qu'une chaîne anonymisée ne révèle rien par sa longueur (voir plus haut) |
| `actions-lint` | `actionlint` (binaire épinglé, somme SHA-256 vérifiée) et `zizmor` (`--min-severity medium`) sur les workflows | que les workflows planifiés aboutissent en vrai |

Le job `props-golden` est le seul à lancer `test:dev` ; `coverage` ne lance que la couverture.

Autres workflows :

| Workflow | Quand | Prouve | Ne prouve pas |
| --- | --- | --- | --- |
| `mutation.yml` | lundi 3 h UTC et à la demande | par module (`mutate`, Stryker historique sous `claude plugin test`), puis les planchers sous Bun (`floors-module` par module, `floors` qui rassemble) ; la mutation de `register.tsx` (`glue`) ; les propriétés à 10 000 exécutions et graine variable (`props`) | rien tant qu'il n'a pas tourné sur GitHub : la première exécution planifiée reste à voir ; il n'a pas été lancé en entier, ses morceaux l'ont été en local |
| `paint.yml` | lundi 4 h UTC, à la demande, et sur les PR qui touchent le banc ou `mode-clair/hooks` | les scénarios sans modèle (`/clair` vide, étiquette `SessionMode`, bande au repos) dans un vrai terminal, sur 2.1.296 et `latest` : textes, couleurs, fonds, largeur | les scénarios avec modèle (Bash simple, faux bridge-mcp, refus) : ils exigent `ANTHROPIC_API_KEY`, jamais fournie sur une PR, et n'ont jamais tourné. Un écart hebdomadaire ouvre une issue |
| `codeql.yml` | push sur `main`, PR, lundi 4 h UTC | analyse statique JavaScript et TypeScript | la logique du mod |
| `scorecard.yml` | `main` et mardi 5 h UTC | OpenSSF Scorecard, score publié pour le badge | rien avant le premier passage sur `main` ; ce n'est pas un check de fusion |
| `release.yml` | tag `vX.Y.Z` poussé par le mainteneur | le tag est sur `main`, sa version égale celle de `plugin.json`, lint, types et `npm test` sur 2.1.296 passent, le tag distant n'a pas bougé ; archive attestée (provenance) | que la release s'installe : l'archive `git archive … mode-clair` embarque `mode-clair/tests/` (fixtures anonymisées comprises) |

Les workflows n'ont aucune permission par défaut (`permissions: {}`, puis `contents: read` par job),
`actions/checkout` ne garde pas le jeton, `step-security/harden-runner` tourne en mode audit en
premier pas de chaque job, et chaque action est épinglée par son SHA complet (version en commentaire).
Renovate (`renovate.json`) propose les mises à jour, groupées (`dev-tooling`, `github-actions`), après
14 jours de mûrissement ; l'application Renovate doit être installée sur le dépôt.

#### Régénérer `tools.generated.ts`

`mode-clair/hooks/tools.generated.ts` (nature, hôte, session de chaque outil de bridge-mcp) n'a pas de
générateur dans ce dépôt : il est produit à partir de la sortie de `bridge-mcp --json list-tools`
(tous les groupes activés), puis recopié ici avec `BRIDGE_VERSION` et `GENERATED_AT`. Après
régénération, `node dev/check-tools.mjs` vérifie sa forme (chaque entrée : `hostless`, `multi`,
`session`, `codeWithoutError` booléens, `nature` ∈ `lecture` ou `peut-modifier`) ; la CI le lance.

Pour écrire un autre mod, ajoute un dossier à la racine avec son
`.claude-plugin/plugin.json`, puis déclare-le dans
`.claude-plugin/marketplace.json`.

## Contribuer

Issues et pull requests bienvenues. Avant de proposer un changement, lance
`npm run lint`, `npm run typecheck`, `npm run validate` et `npm test` : elles doivent passer. Les fixtures de test doivent
rester anonymes (`/home/user`, hôtes fictifs).

## Licence

[MIT](LICENSE)
