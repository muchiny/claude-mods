# Protection de la branche `main`

Réglages à activer par le propriétaire du dépôt (Settings, Rules, Rulesets, ou Branches), sur `main`.
Ils ne peuvent pas être posés depuis un workflow.

- **Pull request obligatoire** avant fusion (aucun push direct).
- **Historique linéaire** (squash ou rebase, pas de commit de fusion).
- **Pas de force-push** et **pas de suppression** de la branche.
- **Branche à jour** avant fusion.
- **Checks obligatoires** (noms exacts des jobs) :

| Workflow | Job requis |
| --- | --- |
| CI | `static` |
| CI | `coverage` |
| CI | `mutation-pr` |
| CI | `props-golden` |
| CI | `actions-lint` |
| CI | `mod (2.1.296, node 22)` |
| CI | `mod (latest, node 24)` |
| CI | `hygiene` |
| CodeQL | `analyze (javascript-typescript)` |

Scorecard n'est pas un check de fusion : il ne tourne que sur `main` et sur planning.

## CodeQL

`codeql.yml` est la configuration avancée. Le « default setup » de CodeQL (Settings, Code security)
doit rester désactivé, sinon GitHub refuse les résultats des deux.

## Release

Ruleset de tags à créer (Settings, Rules, Rulesets, cible **Tag**, motif `v*`) : restreindre la
création, la mise à jour et la suppression des tags `v*` aux mainteneurs. `release.yml` refuse en
plus un tag dont le commit n'est pas sur `main`.

Un tag `vX.Y.Z` déclenche `release.yml`. Il échoue si `mode-clair/.claude-plugin/plugin.json`
n'a pas la version `X.Y.Z`. L'archive `mode-clair-X.Y.Z.tar.gz` est attestée (provenance SLSA) ;
vérification : `gh attestation verify mode-clair-X.Y.Z.tar.gz --repo muchiny/claude-mods`.
