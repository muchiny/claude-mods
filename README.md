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

Ensuite, tape `/clair` pour ouvrir le panneau de `mode-clair`. Le détail des
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

Node 22 ou plus récent, puis `npm ci`.

```bash
npm run lint        # Biome : lint, format, tri des imports (biome ci)
npm run typecheck   # tsc --noEmit, types de l'API des mods dans dev/claude-code.d.ts
npm run validate    # claude plugin validate (marketplace et mod)
npm test            # claude plugin test mode-clair
npm run format      # applique le format Biome
npm run coverage    # couverture des modules purs sous bun:test (seuil : 100 % des lignes et fonctions)
npm run test:dev    # tests des outils de développement (dev/*.mjs)
npm run mutate:pure # mutation de tous les modules purs sous Bun (rapide, seuil break = 100)
```

### Couverture

`bun test` rejoue les tests purs (`mode-clair/tests/pure`) avec `bun:test` à la place de
`claude-code/testing` (`dev/bun-claude-code-testing.ts`) et mesure les lignes et les fonctions des
modules de `mode-clair/hooks`. `register.tsx` n'est exercé que par les tests moteur, que seul
`claude plugin test` sait lancer : il n'est pas compté. Bun ne mesure pas les branches ; le mutation
testing ci-dessous les couvre, en plus exigeant.

### Mutation testing

[Stryker](https://stryker-mutator.io) mesure si les tests voient vraiment un changement de comportement :

```bash
npx stryker run --mutate "mode-clair/hooks/colors.ts" --concurrency 4
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

`npm run mutate:pure` (`stryker.pure.json`) rejoue `mode-clair/tests/pure` sous `bun test` : le
processus lit lui-même `__STRYKER_ACTIVE_MUTANT__`, plus besoin de copie jetable. Le rapport est dans
`reports/mutation-pure/`. Lance-le avec `TMPDIR=/var/tmp` et un peu de mémoire libre.

- **Porte de PR** : `node dev/mutation-gate.mjs --base origin/main` ne mute que les lignes de
  `mode-clair/hooks` ajoutées ou modifiées depuis l'ancêtre commun avec la base (`register.tsx` et `tools.generated.ts`
  exclus) ; un mutant survivant fait échouer le job `mutation-pr` de la CI.
- **Planchers** : `dev/mutation-floors.json` donne le score minimal de chaque module. Le job `floors`
  de `mutation.yml` lance `npm run mutate:pure` puis `node dev/mutation-floors.mjs
  reports/mutation-pure/mutation.json` : code 1 sous un plancher ; `--write` relève les planchers
  qu'un module dépasse.
- **Délai d'un mutant** : `timeoutMS` vaut 3000 ms. Des mutants de la boucle du découpeur shell de
  `bridge.ts` tournent à l'infini ; à 30 s chacun, la mutation complète dépasserait 8 h (12 min à
  3 s). Stryker compte un timeout comme un mutant tué : les planchers sont donc légèrement indulgents.
- **Survivants connus** (déjà présents sur la base) : `bridge.ts` lignes 71, 233, 359 et 754 ;
  `superpowers.ts` 22 ; `view.ts` 259 et 555 ; `workflow.ts` 31 et 43. Une PR qui touche l'une de ces
  lignes doit ajouter le test qui tue le mutant, sinon la porte échoue.
- **Branches** : Bun ne mesure pas les branches (seuils `lines` et `functions` seulement, `statements`
  accepté mais non appliqué, doc Bun 1.4). La mutation en tient lieu.

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

### CI

`.github/workflows/ci.yml`, à chaque push et pull request :

| Job | Contrôle |
| --- | --- |
| `static` | Biome (`--error-on-warnings`), `tsc`, `npm audit` (échec à partir de « high ») |
| `coverage` | 100 % des lignes et des fonctions des modules purs (`bun test --coverage`) |
| `props-golden` | `bun test ./tests` (propriétés à graine fixe, goldens, outils de dev) et forme de `tools.generated.ts` |
| `mod (2.1.296, node 22)` | `claude plugin validate` (marketplace et mod), `claude plugin test` sur la version minimale annoncée |
| `mod (latest, node 24)` | les mêmes contrôles sur la dernière version de Claude Code |
| `mutation-pr` | mutation des lignes de hooks modifiées par la PR, aucun survivant toléré |
| `hygiene` | aucun chemin personnel ni secret, fixtures anonymes, gitleaks sur l'historique |
| `actions-lint` | `actionlint` (binaire épinglé, somme SHA-256 vérifiée) et `zizmor` (`--min-severity medium`) sur les workflows |

Les workflows n'ont aucune permission par défaut (`permissions: {}`, puis `contents: read` par job),
`actions/checkout` ne garde pas le jeton, `step-security/harden-runner` tourne en mode audit en
premier pas de chaque job, et chaque action est épinglée par son SHA complet (version en commentaire).
Renovate (`renovate.json`) propose les mises à jour, groupées (`dev-tooling`, `github-actions`), après
14 jours de mûrissement ; l'application Renovate doit être installée sur le dépôt. Les noms de jobs
ci-dessus sont ceux à exiger dans la protection de la branche `main`.

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
