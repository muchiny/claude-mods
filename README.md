# claude-mods

[![CI](https://github.com/muchiny/claude-mods/actions/workflows/ci.yml/badge.svg)](https://github.com/muchiny/claude-mods/actions/workflows/ci.yml)

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

Raccourci équivalent :

```text
/plugin install mode-clair --marketplace muchiny/claude-mods
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

```bash
claude plugin validate .            # la marketplace
claude plugin validate mode-clair   # le mod
claude plugin test mode-clair       # les tests (aucune connexion requise)
```

La CI (`.github/workflows/ci.yml`) rejoue ces trois commandes sur chaque push
et chaque pull request, et vérifie qu'aucun chemin personnel ni secret n'entre
dans ce dépôt public.

Pour écrire un autre mod, ajoute un dossier à la racine avec son
`.claude-plugin/plugin.json`, puis déclare-le dans
`.claude-plugin/marketplace.json`.

## Contribuer

Issues et pull requests bienvenues. Avant de proposer un changement, lance les
trois commandes ci-dessus : elles doivent passer. Les fixtures de test doivent
rester anonymes (`/home/user`, hôtes fictifs).

## Licence

[MIT](LICENSE)
