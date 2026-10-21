# mode-clair

Ce qui se passe pendant que Claude travaille, dit en une ligne : sur quelle
machine, avec quel résultat, si tu dois agir. Le plugin suit les appels à
**bridge-mcp** (par MCP et par la CLI dans Bash), les workflows **ultracode**
et les étapes **Superpowers**.

Il ne fait qu'observer. Il ne bloque, ne réécrit et ne lance rien. Il n'ouvre
aucune connexion réseau et n'appelle pas le modèle. Il ne peint aucun fond et
ne dessine aucun cadre : le fond de ton terminal reste visible.

## Installation

Dans une session Claude Code, dans un terminal :

```text
/plugin marketplace add muchiny/claude-mods
/plugin install mode-clair@muchini-mods
```

Choisis la portée à l'installation : **utilisateur** pour l'avoir dans tous
tes projets, **projet** pour le limiter au dépôt courant. Il faut Claude Code
2.1.296 ou plus récent : les mods sont encore en accès anticipé.

Sans bridge-mcp, le plugin montre quand même les workflows et les étapes
Superpowers.

Pour l'essayer depuis ce dépôt sans l'installer :

```text
claude --plugin-dir ./mode-clair
```

## La règle : inconnu = `?`

Quand le plugin ne sait pas, il le dit. Il n'affiche un `✓`, un `✗`, « fait »,
un nom de machine ou une nature (lecture, peut modifier) que si l'événement le
prouve. Sinon :

- résultat qu'il ne peut pas attribuer (par exemple un appel qui n'est pas la
  dernière commande d'une ligne Bash, un appel dans une boucle, ou un code de
  sortie que bridge-mcp n'écrit pas, comme 124 quand `timeout` l'a tué) :
  `? incertain` ;
- machine qu'il ne peut pas lire (variable du shell `host=$H`, session ssh
  dont il n'a pas vu l'ouverture) : `machine inconnue` ;
- outil absent de sa table : nature `inconnu` ;
- code distant illisible : `code ?`.

## Ce que tu vois

### La bande au-dessus de la saisie

Au repos, rien : le plugin n'ajoute aucune ligne. Quand il se passe quelque chose,
une ligne, deux au plus, sous ce que le moteur ou un autre plugin y dessine :

```text
⚠ à toi : réponds au formulaire (host-a)
● host-a · ssh_disk_usage
● 2 appels · host-a, host-b
● workflow audit-disques · Review · 3 agents
plan « Ajouter l'export CSV » · tâche 3 sur 7
```

Ordre : « à toi » d'abord (seul), puis les appels en cours, puis le workflow
le plus récent, puis l'étape Superpowers. Un appel en cours n'est jamais
masqué par un workflow ou un plan. L'étape Superpowers n'apparaît que pendant
que Claude travaille, ou qu'un agent lancé en arrière-plan sous le plan tourne
encore. Dans la vue d'un sous-agent, seuls ses appels et son « à toi »
comptent.

### Une ligne sous chaque appel au bridge

Sous l'appel, au-dessus de la sortie habituelle, qui reste là. Aussi dans un
groupe replié « Ran N shell commands », une ligne par appel au bridge du
groupe ; les autres groupes ne sont pas touchés.

```text
✓ host-a · ssh_disk_usage · lecture
✓ host-a · code 1 · peut modifier
✗ host-b · injoignable · rien n’a tourné
✗ host-a · échec · voir /clair
○ host-a · refusé par Claude Code · rien n’a tourné
```

Le résultat vient d'abord : `machine · état`, puis la nature ou la raison.
À une largeur étroite, ce sont les détails qui partent les premiers. Si le nom
de la machine est lui-même plus long que la ligne, c'est le nom qui est coupé
(`✗ machine-xxxxx… · injoignable`) : l'état reste entier tant qu'il tient. La
carte `/clair` suit la même règle : rangée de machine, lignes d'appel et
pipeline.

### La carte `/clair`

Tape `/clair`. La carte s'écrit dans la conversation, comme la réponse d'une
commande ; aucun panneau ne s'ouvre et aucun raccourci clavier n'est à
retenir. C'est aussi ce texte que lit le modèle.

```text
2 machines · 3 appels · 1 problème non vu
host-a · 3 appels · ✓ ssh_disk_usage
host-b · 0 appel · ✗ injoignable
à regarder :
✓ accord · ✗ host-b injoignable · rien n’a tourné
plan « Ajouter l'export CSV » · tâche 3 sur 7
● workflow audit-disques · Review · 3 agents
```

- une ligne par machine touchée, dans sa couleur : nombre d'appels qui ont
  tourné (ou tournent), dernier résultat, et `✗ problème non vu` si un
  problème récent existe sur elle même quand son dernier appel a réussi ;
- un appel dont la machine n'a pas pu être établie n'est pas caché : il
  apparaît sur une ligne `machine inconnue · 1 appel · ? incertain` (compte et
  dernier résultat), après les machines, et compte dans le résumé ;
- « à regarder » : les cinq problèmes les plus récents. Le premier montre ce
  qui s'est réellement passé (les seules étapes qui ont eu lieu, aucune après
  un `✗`) et, s'il n'est pas traduit, la phrase brute du bridge entre
  guillemets. Ceux que tu as déjà vus par un `/clair` précédent finissent par
  `déjà vu`, atténués ;
- le plan Superpowers et les workflows en cours, une ligne chacun ;
- rien dans la session : `rien depuis le début de la session`.

`/clair host-a` montre le dernier appel de cette machine et ce qui s'est
passé. Une ancienne carte reste telle qu'elle était quand tu l'as demandée,
même après une reprise de session.

### La ligne d'état et le pied de saisie

La ligne d'état ne sert que quand tu dois agir : `host-a attend ton accord`.
Claude Code l'écrit `⚠ mode-clair: …`, en couleur d'avertissement. Le reste du
temps, elle est vide.

À droite du pied de saisie, une étiquette atténuée `clair ✗ 2` compte les
problèmes arrivés depuis ton dernier `/clair` ; elle disparaît après
`/clair`.

## Les signes

| Signe | Ton | États |
| --- | --- | --- |
| `●` | accent | en cours |
| `✓` | vert | fait |
| `✓` | texte | `code N` : une commande libre (`ssh_exec`…) a rendu un code non nul ; ce n'est pas un échec du bridge |
| `✗` | rouge | injoignable, machine inconnue, refusé (liste noire), confirmation impossible, accès refusé, échec sur la machine, échec |
| `✗` | jaune | limité, confirmation manquante (`--yes`), erreur d'usage, erreur de config, délai dépassé |
| `○` | atténué | refusé par Claude Code, décliné (formulaire), interrompu |
| `?` | atténué | incertain |
| `⚠` | jaune | à toi : ta réponse est attendue |

Le plugin distingue aussi `accès refusé` (authentification SSH, clé d'hôte ;
rien n'a tourné) et `délai dépassé` (commande trop longue ; la commande a pu
tourner) de `échec` : le texte du bridge en est la preuve (`tests/replay/REFERENCE.md`, D5).

`tronqué` s'ajoute en jaune à la fin d'une ligne quand la sortie a été coupée,
par le bridge ou par Claude Code.

Les couleurs d'état viennent du thème de Claude Code. Chaque machine a sa
couleur, tirée d'une palette de huit dans l'ordre d'apparition des machines
dans la session : pas de doublon jusqu'à huit machines. La palette reste
distincte pour les personnes deutéranopes et en 256 couleurs, et le nom de la
machine est toujours écrit.

## D'où viennent les informations

| Ce qui est montré | Source |
| --- | --- |
| appels au bridge | les outils MCP du serveur `ssh-bridge`, `bridge-mcp` ou `mcp-ssh-bridge` (nom exact, jamais une sous-chaîne), y compris par `mcp_call_tool` ; les commandes `bridge-mcp tool …`, `exec`, `upload`, `download` lancées dans Bash |
| machine | l'argument `host` (ou chaque élément de `hosts`) ; pour `ssh_session_exec`, la session ouverte par `ssh_session_create` |
| lecture ou modification | l'annotation `readOnlyHint` de l'outil dans la table générée depuis bridge-mcp |
| résultat | le code de sortie de la CLI et la première ligne utile de la réponse du bridge (`Unknown host`, `Command denied`, `SSH connection failed`, `[exit:N]`…) ; un message d'erreur cité plus bas dans la sortie ne décide rien |
| refus de Claude Code | le refus de permission, et le texte de refus du dialogue ou du classifieur |
| « à toi » | le formulaire de confirmation que le bridge ouvre (hook `Elicitation`) et ta réponse |
| étape Superpowers | les skills d'étape (`brainstorming`, `writing-plans`, `subagent-driven-development`, `executing-plans`, `requesting-code-review`, `finishing-a-development-branch`), les fichiers écrits sous `docs/superpowers/` et la description des appels `Agent` |
| tâches du plan | les titres `### Task N`, `### Tâche N`, `### TN` ou `### TTN` du fichier de plan |
| workflows | le bloc `meta` du script, le journal du run, la notification de fin |

## Limites connues

- **`bash -c '…'`** n'est pas analysé : un appel au bridge caché dedans n'a
  pas de ligne.
- **Appels en arrière-plan** (`run_in_background`) : ignorés, ni ligne ni
  compte.
- **Le formulaire ne dit pas de quel appel il s'agit.** Le plugin le rattache
  à l'appel MCP du bridge en cours qui a le même outil et la même machine,
  sinon au plus récent. Avec plusieurs appels destructifs en même temps, il
  peut se tromper d'appel.
- **Workflows.** Le journal n'est pas documenté par Claude Code : un format
  inconnu laisse le workflow « en cours » sans phases, sans rien inventer.
  Sans croissance du journal pendant 30 minutes, il passe « sans nouvelles »
  et sort de la bande ; il reste dans `/clair`.
- **Superpowers est reconnu à ses noms.** Sans numéro de tâche dans la
  description des agents, la bande dit `plan « X » · N tâches`. Sans
  événement pendant 30 minutes, l'étape sort de la bande et reste dans
  `/clair`, marquée `abandonné`.
- **Couleur par ordre d'apparition**, pas par configuration : le plugin ne lit
  pas ta configuration du bridge.

La table de référence de l'affichage, situation par situation, et les arbitrages
qui l'ont fixée sont dans `tests/replay/REFERENCE.md`. Un cas n'y est pas
tranché : pour un outil à plusieurs machines, quand le code de sortie de la CLI
est hors de 0 à 6 et que l'entrée de la machine dans `results` dit autre chose,
l'entrée de la machine l'emporte. Le rejeu de sessions réelles ne contrôle que
l'issue (réussi, échec, refus, interrompu, attente, inconnu) et la machine de chaque
appel : les états fins (`code N`, `délai dépassé`, nature, `tronqué`) reposent sur
les tests purs et les goldens.

## Développement

Depuis la racine du dépôt :

```text
npm run lint && npm run typecheck && npm test && npm run coverage
```

La logique est dans les modules purs de `hooks/` (`bridge.ts`, `state.ts`,
`view.ts`, `workflow.ts`, `superpowers.ts`, `colors.ts`, `fr.ts`), sans `$` ni
horloge, testés dans `tests/pure`. `hooks/register.tsx` ne fait que brancher
les événements du moteur sur ces modules ; il est testé par `tests/engine`. Le
contrat d'état est dans `types/index.d.ts`.
