# Table de référence de l'affichage

Ce que la bande, les rangées d'appels et la carte `/clair` **doivent** montrer, situation par
situation. L'oracle du rejeu (`tests/replay/oracle.ts`) implémente cette table ligne à ligne et
rien d'autre ; il n'importe jamais `hooks/*`.

Rédigée sans ouvrir `mode-clair/hooks/*`, puis arbitrée par l'utilisateur le 2026-10-21 (D1 à D13,
section « Désaccords relevés » : chaque ligne porte désormais le comportement tranché), depuis :

- **spec** : la spec 0.2 validée (`2026-10-15-mode-clair-propre-design.md`, md5
  `ee36261e5a16142f313245cffaf53441` avant arbitrage, hors git), citée `§n` ; amendée le 2026-10-21
  par D5, D6, D7, D8 et D13 (états `accès refusé` et `délai dépassé`, étape `spec`, `en cours` dès
  `tool.call`, ligne Superpowers sous un agent d'arrière-plan, drapeau `tronqué` sans signe) ;
- **bridge** : les sources de bridge-mcp (commit `70147fe`), citées `bridge-mcp/src/…:ligne` ;
- **faits** : les textes du bridge recopiés dans les fixtures de `tests/`, qui citent
  `refs/bridge-facts.md §…` (document perdu ; seule la citation et le texte cité font foi) ;
- **moteur** : les textes de Claude Code relevés sur la vraie session (`tests/pure/engine-texts.ts`) ;
- **A13** : amendement confirmé par l'utilisateur le 2026-10-15 (la rangée du mod se dessine
  **au-dessus** du bloc de résultat du moteur sous un appel seul) ;
- **règle** : la règle confirmée le 2026-10-21, « quand le mod ne sait pas, il le dit »
  (`incertain`, signe `?`) ; un ✓/✗, « fait », une machine ou une nature affichés sans preuve dans
  l'événement sont un défaut.

## Conventions

- Machines : `host-a`, `host-b`… Outils : noms réels de bridge-mcp.
- Rangée : `signe machine · état · nature`, nature seulement quand l'appel a tourné (`fait`,
  `code N`, `échec sur la machine`, `délai dépassé`, `tronqué`, §5.4 note). « rien n'a tourné » suit
  les états où rien n'a tourné (§4.3).
- Signe, ton et comptes d'un état : uniquement ceux de §5.4, recopiés ici :

| État | Signe | Ton | « à regarder » | `clair ✗ n` | appel de la machine |
|---|---|---|---|---|---|
| en cours | `●` | accent | non | non | oui |
| fait | `✓` | ok | non | non | oui |
| code N | `✓` | texte | non | non | oui |
| injoignable, machine inconnue, refusé, confirmation impossible, accès refusé | `✗` | erreur | oui | oui | non |
| limité, confirmation manquante | `✗` | attention | oui | oui | non |
| échec sur la machine, échec | `✗` | erreur | oui | oui | oui |
| délai dépassé | `✗` | attention | oui | oui | oui |
| erreur d'usage, erreur de config | `✗` | attention | oui | non | non |
| refusé par Claude Code, décliné | `○` | atténué | non | non | non |
| interrompu | `○` | atténué | non | non | oui |
| incertain | `?` | atténué | non | non | oui |
| drapeau tronqué (suffixe) | aucun : le signe de tête reste celui de l'état | attention | oui | non | — |
| attente « à toi » | `⚠` | attention | — | — | — |

- Machine : son nom en couleur (`machine(index)`, ordre d'apparition, §4.1, §4.7), sans signe.
  Une machine **non prouvée** par l'événement n'est jamais écrite : la place dit `machine inconnue`
  (atténué), dans le pipeline comme sur la rangée (D10), et l'appel reste visible (règle).

## Appels bridge : reconnaissance

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R01 | `mcp__ssh-bridge__ssh_disk_usage` avec `input.host = host-a` | appel suivi, machine `host-a`, outil `ssh_disk_usage` | §5.1 Reconnaissance MCP |
| R02 | serveur MCP dont le nom ne fait que **contenir** « bridge » (`cc-plugin-bridge-health`) | rien : aucune rangée, aucun compte | §5.1 Reconnaissance MCP |
| R03 | mode progressif : `mcp_call_tool` avec `arguments.name = ssh_service_status`, `arguments.arguments.host = host-a` | machine `host-a` et outil `ssh_service_status` (jamais `mcp_call_tool`) | §5.1, §3 critère 5 |
| R04 | méta-outils `mcp_list_tool_groups`, `mcp_search_tools`, `mcp_describe_tool` ; sous-commandes CLI `list-tools`, `describe-tool`, `validate`, `status`, `config-diff` | rien : non comptés | §5.1 Table des outils |
| R05 | Bash `bridge-mcp tool ssh_disk_usage host=host-a` (aussi `./target/debug/bridge-mcp`, `t` pour `tool`, préfixes `VAR=val`, `timeout`, `env`, `sudo`, `nice`) ; `exec`, `upload`, `download` | appel suivi sur `host-a` | §5.1 Reconnaissance CLI |
| R06 | `bridge-mcp … --dry-run` | rien : rien n'a tourné, appel non compté | §5.1 ; bridge-mcp/src/main.rs:127 (`[dry-run] Would execute on host …`) |
| R07 | `bash -c '… bridge-mcp …'` | rien (limite écrite dans le README) | §5.1 Reconnaissance CLI |
| R08 | appel lancé en arrière-plan (`run_in_background`, `backgroundTaskId`) | rien : aucune rangée, aucun compte, jamais dans la bande | §5.1 |
| R09 | outil absent de la table générée | nature `inconnu` (jamais devinée) ; l'état suit les règles ci-dessous | §5.1 Table des outils ; règle |
| R10 | outil de la table avec `readOnlyHint` / sans | nature `lecture` / `peut modifier` | §5.1 Table des outils |
| R11 | valeur d'hôte qui commence par `$` (`host=$H`) | machine non affirmée : `machine inconnue`, l'appel reste affiché | §5.1 Reconnaissance CLI ; règle |
| R12 | outil sans `host` ni `hosts` (`hostless`, `ssh_history` compris : son `host` filtre l'historique local) | rien : aucune rangée, aucun compte (`ssh_status` n'est pas compté) | §5.1 Table des outils ; §3 critère 4 |
| R13 | `ssh_exec_multi` / `ssh_metrics_multi` avec `hosts = [host-a, host-b]` | une rangée par hôte, chacune classée sur son propre élément de `results` (`success`, `exit_code`, `error`) ; un hôte sans élément lisible (sortie coupée, persistée, illisible) : `? incertain`, jamais `✓ fait` ni `✓ code ?` hérité du résultat global (tranché D11). Non spécifié par l'utilisateur (cas laissé tel quel) : un code de sortie CLI hors de 0 à 6 (R52) quand l'hôte a son propre élément dans `results` ; l'élément de l'hôte l'emporte | §5.1 `multi` ; faits §6.1 (JSON `total_hosts`, `results[]`) |
| R14 | `ssh_exec_multi` rejeté avec `MCP invalid request: Unknown hosts: a, b` | `✗ machine inconnue` pour l'appel | bridge-mcp/src/mcp/tool_handlers/ssh_exec_multi.rs:217 ; faits §3.2 |
| R15 | `ssh_session_create` réussi (SessionInfo `{"id":…,"host":"host-a",…}`) puis `ssh_session_exec` avec ce `session_id` | rangée de `ssh_session_exec` sur `host-a` | §5.1 `session` ; bridge-mcp/src/ssh/session.rs:72-78 ; faits §6.1 |
| R16 | `ssh_session_exec` dont la session n'a pas été vue créée | `machine inconnue` (jamais devinée) | §5.1 `session` ; règle |
| R17 | ligne Bash à plusieurs segments bridge (`A && B`, `A; B`, `A \| B`) | seul le segment qui est la **dernière commande simple** reçoit code de sortie et texte ; tout autre segment bridge `? incertain` (sa machine reste celle de ses arguments) | §5.1 Reconnaissance CLI |
| R18 | segment bridge dans une boucle `for` / `while` | `? incertain`, `machine inconnue` | §5.1 Reconnaissance CLI |
| R19 | `bridge-mcp --json tool …` | texte lu dans `content[].text` du JSON avant classement | §5.1 ; bridge-mcp/src/cli/runner.rs:304-318 |

## Appels bridge : cycle de vie et classement

Le texte Bash d'une commande sortie avec un code non nul commence par `Exit code N`, suivi des
lignes de journal de la CLI (stderr, horodatées) puis de la sortie (faits §0, §0.1, §2.4) ; la CLI
écrit son erreur `Error: <Display>` (bridge-mcp/src/main.rs:194). Les motifs d'erreur ne sont lus
que sur la **première ligne utile** (après `Exit code N`, journal sauté, avec ou sans `Error: `),
jamais dans le corps (§5.1 Classement).

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R20 | `tool.call` levé, dialogue de permission pas encore passé | l'appel est `en cours` dès le début du `tool.call` (le moteur lève `tool.call` avant le dialogue, `dev/claude-code.d.ts:4044-4046` ; amendement A1) ; refusé au dialogue : R22 (tranché D7) | `dev/claude-code.d.ts:4044-4046` ; A1 ; D7 |
| R21 | `tool.call` en cours, pas de résultat | bande `● host-a · ssh_disk_usage` ; `● en cours`, ton accent | §5.1 Cycle de vie ; §4.2 |
| R22 | refus de Claude Code : `classic.PermissionDenied` sur le `tool_use_id`, refus au dialogue (« The user doesn't want to proceed with this tool use… »), refus du classifieur (« Permission for this action was denied by the Claude Code auto mode classifier… »), `deny` d'un hook | `○ host-a · refusé par Claude Code · rien n'a tourné`, atténué, non compté | §5.1 règle 0 ; moteur (`engine-texts.ts:13-16`) |
| R23 | `next.signal.aborted` après `next(e)`, `isInterrupted` au rendu, ou résultat Bash `interrupted: true` (le champ du résultat du moteur, `dev/claude-code.d.ts:21147-21148`) | `○ host-a · interrompu`, atténué ; la machine n'est pas mise en cause ; compté comme appel | §5.1 règle 1 ; `dev/claude-code.d.ts:21147-21148` (arbitrage tâche 8) |
| R24 | `turn.complete` d'une boucle (même `agentId`) avec un appel de cette boucle encore en cours | cet appel devient `○ interrompu` ; les appels d'une autre boucle ne bougent pas ; filet seulement : un résultat arrivé ensuite décide (le hook ferme l'appel dans un `finally`) | §5.1 Cycle de vie (spec l. 246) ; arbitrage tâche 8 |
| R25 | MCP, pas d'`isError`, texte sans motif | `✓ host-a · ssh_disk_usage · lecture`, ton ok | §5.1 règle 5 ; §4.3 |
| R26 | CLI sortie 0 (texte Bash sans `Exit code`) | `✓ host-a · <outil> · <nature>` | §5.1 règle 5 ; bridge-mcp/src/cli/runner.rs:111-116 |
| R27 | CLI `Exit code 2` (outil inconnu, argument invalide, erreur clap `error: unexpected argument …`) | `✗ host-a · erreur d'usage · rien n'a tourné`, attention ; non compté dans `clair ✗ n` ni comme appel | §5.1 règle 2 ; bridge-mcp/src/cli/runner.rs:58-76 ; faits §1.2, §3.4 |
| R28 | CLI `Exit code 5` (`Failed to load config from …`, `Configuration error: …`) | `✗ erreur de config · rien n'a tourné`, attention | §5.1 règle 2 ; bridge-mcp/src/cli/runner.rs:53, :76-80 ; bridge-mcp/src/main.rs:59 ; faits §2.2 |
| R29 | CLI `Exit code 3` + `Error: Unknown host: host-z` | `✗ machine inconnue · rien n'a tourné`, erreur | §5.1 règle 2 ; bridge-mcp/src/error.rs:104 ; bridge-mcp/src/cli/runner.rs:75 ; faits §3.2 |
| R30 | CLI `Exit code 3` sans `Unknown host` (`SSH connection failed to host-a: Connection refused (os error 111)`, `… Connection timeout after 10s`) | `✗ host-a · injoignable · rien n'a tourné`, erreur | §5.1 règle 2 ; bridge-mcp/src/error.rs:34 ; faits §3.5 |
| R31 | CLI `Exit code 4` + `Command denied: Command matches blacklist pattern: …` ou `… not in whitelist …` | `✗ host-a · refusé · rien n'a tourné`, erreur ; le pipeline montre la liste noire qui a refusé | §5.1 règle 2, Pipeline ; bridge-mcp/src/security/validator.rs:167 ; faits §3.1 |
| R32 | CLI `Exit code 4` + texte qui demande `--yes` (`… stdin is not a terminal, so there is nobody to confirm with. Pass --yes …`) | `✗ host-a · confirmation manquante · rien n'a tourné`, attention | §5.1 règle 2 ; bridge-mcp/src/cli/runner.rs:2180-2186, :2276-2278 ; faits §3.1 |
| R33 | CLI `Exit code 6`, outil `freeCommand` (`tool ssh_exec`) dont la sortie commence par `[exit:N]` | `✓ host-a · ssh_exec · code N · peut modifier`, ton texte (neutre) | §5.1 règle 2 ; bridge-mcp/src/cli/runner.rs:50, :111-116 ; bridge-mcp/src/domain/use_cases/execute_command.rs:106-109 |
| R34 | CLI `Exit code 6`, outil qui n'est pas `freeCommand` | `✗ host-a · échec sur la machine · <nature>`, erreur, compté comme appel | §5.1 règle 2 ; bridge-mcp/src/cli/runner.rs:41-50 |
| R35 | CLI `Exit code 1` + première ligne de la table des textes (ex. `SSH command execution failed: WinRM HTTP error: error sending request for url …`) | l'état de la table (ici `✗ host-a · injoignable · rien n'a tourné`) | §5.1 règle 2 et table ; §9 (WinRM sort en 1) ; faits §2.3 |
| R36 | CLI `Exit code 1` + `Rate limit exceeded for host 'host-a'…` | `✗ host-a · limité · rien n'a tourné`, attention | §5.1 table ; bridge-mcp/src/error.rs:128 ; faits §3.3 |
| R37 | CLI `Exit code 1`, première ligne hors table (`Output cache is not available. …`) | rangée `✗ host-a · échec · voir /clair` ; la phrase brute n'apparaît que dans la carte, entre guillemets | §4.1 Langue ; §5.1 règle 2 ; faits §1.4 |
| R38 | `bridge-mcp exec host-a <cmd>` : le processus sort 0 seulement par le chemin `Ok` avec un code distant 0, et 1 pour **tout** code distant non nul (`process::exit(1)`, bridge-mcp/src/cli/runner.rs:904-924) ; une erreur sort avec son code de la table ; la sortie d'une commande qui a tourné commence par le bloc `Host: …` / `Command: …` / `Exit code: N` | bloc `Exit code: N` lu : `code N` (0 : `fait`) ; sortie 0 sans bloc : `fait` ; sortie non nulle sans bloc, rien n'a tourné : table des textes sur la première ligne utile, sinon `échec` | bridge-mcp/src/cli/runner.rs:904-924 ; bridge-mcp/src/domain/use_cases/execute_command.rs:647-651 ; faits §3.10 ; arbitrage tâche 8 (Q3) |
| R39 | MCP `isError`, première ligne `[exit:N]` | `✗ host-a · échec sur la machine · <nature>` (la commande a tourné), avant tout autre motif | §5.1 règle 3 ; bridge-mcp/src/domain/use_cases/execute_command.rs:106-109 |
| R40 | MCP sans `isError`, outil `freeCommand` (ou outil à code distant, ex. `ssh_service_status`) avec `[exit:N]`, N ≠ 0 | `✓ host-a · code N · <nature>`, neutre | §5.1 règle 4 et `freeCommand` ; bridge-mcp/src/mcp/tool_handlers/ssh_exec.rs:334 ; faits §3.9 |
| R41 | MCP `isError` + `Unknown host: host-z` (Display sans `Error: `) | `✗ machine inconnue · rien n'a tourné` | §5.1 table ; faits §3.2 |
| R42 | MCP `isError` + `Command denied: …` | `✗ host-a · refusé · rien n'a tourné` | §5.1 table ; bridge-mcp/src/error.rs:66 |
| R43 | MCP `isError` + `Unknown argument …`, `unknown field …`, `missing field …`, `MCP missing parameter: …`, `Unknown tool: …`, `… is registered but its group … is not enabled`, outil d'un autre système | `✗ host-a · erreur d'usage · rien n'a tourné`, attention | §5.1 table (`Unknown argument`) ; bridge-mcp/src/domain/arg_validation.rs:94 ; bridge-mcp/src/mcp/registry.rs:87-91 ; faits §3.4, §3.7 |
| R44 | MCP `isError` + `User declined execution …` / `User cancelled confirmation …` | `○ host-a · décliné · rien n'a tourné`, atténué | §5.1 table ; bridge-mcp/src/mcp/server.rs:1030-1033 ; faits §3.8 |
| R45 | MCP `isError` + `… was not granted; …`, `… cannot be confirmed.`, ``… did not declare the `elicitation` capability …``, `Could not build a confirmation prompt …` | `✗ host-a · confirmation impossible · rien n'a tourné`, erreur | §5.1 table ; bridge-mcp/src/mcp/server.rs:1036, :1049, :1062, :1096 ; faits §3.8 |
| R46 | MCP `isError`, première ligne hors table | `✗ host-a · échec · voir /clair` ; texte brut dans la carte | §5.1 règle 3 ; §4.1 |
| R47 | un motif de la table présent **seulement dans le corps**, pas en première ligne utile | il ne décide rien (appel en échec → `échec` ; appel réussi → `fait`) | §5.1 Classement (logic/LOGIC-4) |
| R48 | `SSH authentication failed for u@host-a`, `SSH host key mismatch for host-a: …`, `SSH host key unknown for host-a …` | `✗ host-a · accès refusé · rien n'a tourné`, erreur, compté dans `clair ✗ n`, pas comme appel (tranché D5) | §5.1 table, amendée D5 ; bridge-mcp/src/error.rs:37, :44, :47 ; faits §3.5 |
| R49 | `SSH command timeout after 60s` | `✗ host-a · délai dépassé · <nature>`, attention, compté dans `clair ✗ n` et comme appel (la commande a pu tourner) (tranché D5) | §5.1 table, amendée D5 ; bridge-mcp/src/error.rs:59 ; faits §3.6 |
| R50 | `Request cancelled by client` | `○ interrompu`, atténué, compté comme appel : par le signal (R23) ou par le texte seul (tranché D5) | bridge-mcp/src/error.rs:161 ; faits §3.6 |
| R51 | drapeau tronqué : `output_id="`, `--- [truncated: `, `[output stopped at the`, marque de sortie persistée (`<persisted-output>` / `Output too large (…)`) ; que l'appel réussisse ou non | suffixe `· tronqué` (ton attention) sur l'état principal, inchangé ; nature affichée ; dans « à regarder » ; le drapeau n'a pas de signe : le signe de tête reste celui de l'état (tranché D13) | §5.1 drapeau ; bridge-mcp/src/domain/output_truncator.rs:41, :92, :99 ; bridge-mcp/src/ssh/client.rs:990 ; moteur (`engine-texts.ts:22`) |
| R52 | résultat illisible ou sans preuve : segment qui ne possède pas le code de sortie, code de sortie CLI hors de 0 à 6 (124 de `timeout`, 127, 130, 137, 101… : bridge-mcp ne sort qu'avec 0 à 6, bridge-mcp/src/main.rs:59, :195, :204 ; src/cli/runner.rs:111-116), forme inconnue, résultat sans appel correspondant ; un texte vide seulement quand ni `isError` ni un code de sortie ne parlent (MCP réussi au texte vide : `fait`, execute_command.rs:95-99 rend la sortie brute pour un code 0 ; MCP `isError` au texte vide : `échec`, R46) | `? incertain` (atténué), jamais ✓/✗ ; la machine seulement si elle est prouvée | règle ; spec vérif. §1 ; arbitrage tâche 8 (Q1, Q2) |

## Pipeline et accord

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R53 | pipeline d'un appel (carte) | seules les étapes qui ont eu lieu ou qui ont décidé ; aucune étape après un `✗` ; étapes toujours réussies et supposées (permission, validation, liste noire passée) absentes. Ex. `✓ accord · ✗ host-a injoignable · rien n'a tourné`. Chaque signe et chaque mot d'état prennent le ton de leur état dans §5.4 (tranché D1) ; la machine garde sa couleur (§4.1, tranché D2) ; machine non prouvée : `machine inconnue` (tranché D10) ; appel décliné : `○ accord refusé · rien n'a tourné`, atténué (tranché D9) | §5.1 Pipeline ; §4.1 ; §4.4 ; §5.4 |
| R54 | formulaire de confirmation reçu pendant un appel MCP (`Confirm destructive operation: \`ssh_exec\`` … `"host":"host-a"` …) | bande ligne 1 `⚠ à toi : réponds au formulaire (host-a)`, attention ; ligne d'état `host-a attend ton accord` | §4.2, §4.5, §5.1 « À toi » ; bridge-mcp/src/mcp/elicitation.rs:173 ; faits §5.2 |
| R55 | formulaire dont l'hôte n'est pas lisible (`(no arguments)`, résumé coupé à 300 caractères, nom d'outil en bloc clôturé) | repli sur l'appel MCP bridge en cours le plus récent ; sans lui, aucune machine affirmée | §5.1 « À toi » ; bridge-mcp/src/mcp/server.rs:1069 ; faits §5.1, §5.3 |
| R56 | réponse `action = accept` **et** `content.confirm = true` | étape `✓ accord` au pipeline ; l'état suit le résultat | §5.1 « À toi » ; bridge-mcp/src/mcp/elicitation.rs:209-217 |
| R57 | réponse `decline`, `cancel`, ou `accept` sans `confirm = true` | `○ décliné`, rien n'a tourné ; pipeline `○ accord refusé · rien n'a tourné`, atténué (tranché D9) | §5.1 « À toi » ; bridge-mcp/src/mcp/server.rs:1025-1040 ; faits §3.8, §5.5 |
| R58 | le `tool.call` de l'appel se termine (réponse au formulaire vue ou non) | « à toi » et l'entrée de ligne d'état s'effacent | §5.1 « À toi » ; §4.5 |
| R59 | CLI avec `--yes` | accord donné par option (noté) ; pas de « à toi » | §5.1 Reconnaissance CLI ; bridge-mcp/src/cli/runner.rs:2170-2176 |

## Surfaces

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R60 | repos : rien en cours, rien en attente | bande : zéro ligne (le hook rend `next(e)` tel quel) ; ligne d'état vide ; pas d'étiquette | §3 critère 1 ; §4.2 ; §4.5 |
| R61 | deux appels en cours | bande `● 2 appels · host-a, host-b` | §4.2 |
| R62 | « à toi », appels, workflow, étape Superpowers en même temps | ligne 1 = premier cas vrai dans l'ordre à toi → appels → workflow → Superpowers ; ligne 2 au plus = workflow ou Superpowers, seulement si la ligne 1 n'est pas « à toi » ; un appel en cours n'est jamais masqué | §4.2 |
| R63 | vue d'un sous-agent (`e.props.view`) | seuls les appels et le « à toi » de cet agent ; ni workflow ni Superpowers | §4.2 |
| R64 | appel seul terminé | une rangée, **au-dessus** du bloc de résultat du moteur | §4.3 ; A13 |
| R65 | groupe replié « Ran N shell commands » contenant au moins un appel suivi (par `tool_use_id`) | `next(e)` puis une rangée par appel bridge suivi ; groupe sans appel suivi intact ; appel absent de l'état n'ajoute rien | §4.3 |
| R66 | groupe déplié (`isExpanded`, ctrl+o, `--verbose`) | `next(e)` ; la même rangée sous chaque appel bridge (hook `ToolUse`) | §4.3 |
| R67 | `/clair`, rien dans la session | carte : une ligne atténuée `rien depuis le début de la session` | §4.4 |
| R68 | `/clair` après des appels | une ligne par machine : nom en couleur, nombre d'appels (colonne « appel de la machine »), dernier résultat ; `✗` si un problème non vu existe sur la machine même si son dernier appel a réussi | §4.4 ; §5.4 |
| R69 | `/clair` avec un appel sans machine prouvée (R11, R16, R18, R41) | l'appel n'est pas caché : il apparaît sous une ligne `machine inconnue · N appel · <dernier résultat>`, compté dans le résumé, et dans « à regarder » si son état y va (tranché D3) | règle ; §4.4 |
| R70 | `/clair` avec problèmes | « à regarder » : 5 problèmes les plus récents au plus, ceux d'avant le dernier `/clair` atténués ; le dernier problème une seule fois, par sa ligne de pipeline ; phrase brute non traduite entre guillemets | §4.4 |
| R71 | `/clair host-a` | le dernier appel de `host-a` avec son pipeline | §4.4 |
| R72 | ancienne carte, relue plus tard ou après reprise de session | inchangée : relue depuis `e.props.text`, jamais depuis l'état vivant | §4.4 |
| R73 | problème (colonne `clair ✗ n`) plus récent que le dernier `/clair` | étiquette atténuée `clair ✗ n` au pied de saisie ; disparaît après `/clair` | §4.6 |
| R93 | toute ligne du mod, à 40 colonnes utiles | `machine · état` reste lisible en entier, la raison peut être coupée ; aucune ligne ne dépasse la largeur ; un nom de machine plus long que la ligne est coupé (`machine-xx… · injoignable`), l'état reste entier tant qu'il tient avec un nom d'au moins un caractère, largeur en cellules ; vaut pour la rangée, la ligne d'appel de la bande, et les lignes de la carte `/clair` : rangée de machine (`nom… · N appels · état`), appel de « à regarder » et de `/clair <machine>`, pipeline (`✗ nom… état`). Ne sont pas coupés ainsi : résumé, workflow, Superpowers, en-tête « dernier appel sur » (coupe par la fin) (tranché D4) | §4.1 ; §3 critère 13 |

R93, ajoutée à l'étape 2, est rangée avec les surfaces ; les numéros ne sont pas réordonnés pour
garder stables les renvois des désaccords.

## Workflows

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R74 | appel `Workflow` réussi, bloc `meta` lisible (`name`, `phases`) | bande `● workflow <nom> · <phase> · N agents` | §4.2 ; §5.3 |
| R75 | résultat de l'appel `Workflow` en erreur | aucun workflow | §5.3 |
| R76 | phases illisibles (pas de `meta`, fichier illisible, workflow intégré sans fichier) | `workflow en cours` sans phases, rien d'inventé | §5.3 |
| R77 | journal : ligne `failed` d'un agent | cet agent `✗` | §5.3 ; §3 critère 11 |
| R78 | journal : statut terminal `completed`, `failed`, `killed`, `stopped` | workflow fini ; il sort de la bande (bande vide s'il n'y a rien d'autre) | §5.3 ; §3 critère 11 |
| R79 | journal sans croissance depuis 30 minutes (`mtimeMs`) | `sans nouvelles` ; sort de la bande ; reste dans `/clair` | §5.3 |
| R80 | workflow sans journal (lancé à distance) | `workflow à distance` sans phases ; fini par sa notification ; jamais `sans nouvelles` | §5.3 |
| R81 | journal absent, de plus de 4 Mio ou de format inconnu | `workflow en cours` sans phases, sans planter | §5.3 |
| R82 | plusieurs workflows | bande : le plus récent ; `/clair` : tous, une ligne chacun | §5.3 ; §4.4 |

## Superpowers

Une ligne Superpowers ne paraît dans la bande que **pendant que Claude travaille** (`isWorking`)
**ou qu'un agent lancé en arrière-plan sous le plan tourne encore** (tranché D8), et n'y masque
jamais un appel en cours (§4.2).

| id | situation (événements) | ce qui doit s'afficher | source |
|---|---|---|---|
| R83 | skill `brainstorming` | étape cadrage, état neuf ; bande `cadrage` | §5.2 |
| R84 | `Write` / `Edit` sous `docs/superpowers/specs/` pendant le cadrage | étape `spec`, bande `spécification` (tranché D6) | `types/index.d.ts:55` ; §5.2 |
| R85 | skill `writing-plans`, plan écrit sous `docs/superpowers/` | bande `plan « X »` | §5.2 |
| R86 | `subagent-driven-development` ou `executing-plans`, `Agent` dont la description porte `Task n` / `Tâche n` / `T n` / `TT n`, plan à N titres `### …` | bande `plan « X » · tâche n sur N` | §5.2 ; §3 critère 10 |
| R87 | même étape sans tâche courante connue (exécution en ligne) | `plan « X » · N tâches`, jamais `tâche 0` | §5.2 |
| R88 | `requesting-code-review`, ou description `final review` / `final code review`, ou prompt d'`Agent` qui cite `code-reviewer.md` | bande `relecture finale` | §5.2 |
| R89 | `finishing-a-development-branch` | rien | §5.2 |
| R90 | autre skill (`using-superpowers`, `systematic-debugging`, `test-driven-development`, `verification-before-completion`…) | rien ne change, aucune ligne | §5.2 ; §3 critère 10 |
| R91 | `Write` / `Edit` sous `docs/superpowers/` sans état existant | aucun état créé ; avec un état : le complète (relecture du plan après `Edit` réussi, liste gardée si la relecture échoue) | §5.2 |
| R92 | aucun événement Superpowers depuis 30 minutes | état abandonné (minuteur, jamais calculé au rendu) : sort de la bande, reste dans `/clair` | §5.2 |

## Limite de l'oracle

L'oracle (`oracle.ts`) ne rend, par appel, que l'hôte et une issue parmi `succes`, `echec`,
`refus`, `interrompu`, `attente`, `inconnu` (type `Truth`), plus les workflows terminés ou non et
l'étape Superpowers. Le rejeu ne compare que cela. Les états fins de la table (`code N` contre
`fait`, `délai dépassé`, `limité`, `confirmation manquante`, la nature, le drapeau `tronqué`, le
texte exact des rangées et de la carte) ne sont pas vérifiés par le rejeu : ils reposent sur les
tests purs, les goldens et les propriétés. Un état fin faux qui garde la même issue passe donc le
rejeu.

## Désaccords relevés (étape 2) — TRANCHÉS le 2026-10-21

Confrontation de la table au code (`hooks/*`) et aux tests existants, **après** sa rédaction.
« La table dit X, le mod fait Y » ; l'utilisateur a tranché chaque ligne le 2026-10-21. Une ligne
« le mod a tort » est devenue un test rouge puis un correctif ; « la table a tort » ou décision,
la ligne de la table a été réécrite avec la décision comme source. Les colonnes « le mod faisait »
décrivent l'état avant arbitrage.

| id | statut | lignes | la table disait | le mod faisait | décision |
|---|---|---|---|---|---|
| D1 | TRANCHÉ (2026-10-21) | R53, §5.4 | dans le pipeline, le signe d'un état prend son ton de §5.4 (`limité`, `confirmation manquante`, `erreur d'usage`, `erreur de config` : attention) | tout `✗` du pipeline était en ton erreur et le mot d'état en texte ; ex. `délai dépassé` en erreur dans le pipeline, en attention sur la rangée | le mod avait tort, corrigé : un même état a un seul ton, signe et mot d'état |
| D2 | TRANCHÉ (2026-10-21) | R53, §4.1 | la machine se reconnaît à sa couleur, partout | dans le pipeline la machine était en ton texte | le mod avait tort, corrigé : la machine garde sa couleur dans le pipeline |
| D3 | TRANCHÉ (2026-10-21) | R69, règle | un appel sans machine prouvée reste visible dans la carte | un appel à hôte nul n'entrait jamais dans `hostOrder` : aucune ligne, non compté ; un `incertain` sur `machine inconnue` donnait `0 machine · 0 appel` | le mod avait tort, corrigé : ligne `machine inconnue` avec son compte et son dernier résultat, comptée dans le résumé |
| D4 | TRANCHÉ (2026-10-21) | R93, §3 critère 13 | `machine · état` entier à 40 colonnes | un nom de 60 caractères occupait la ligne : `✓ machine-xxxx…`, l'état disparaissait | décision : couper le **nom** (`machine-xx… · fait`) et garder l'état entier ; largeur en cellules |
| D5 | TRANCHÉ (2026-10-21) | R48, R49, R50 | spec 0.2 : ces textes n'avaient pas de ligne → `échec` | états en plus `accès refusé` (✗ erreur, rien n'a tourné) et `délai dépassé` (✗ attention, compté comme appel, nature affichée) ; `Request cancelled by client` → `interrompu` | la table avait tort : garder le mod (texte du bridge comme preuve) ; table et §5.4 de la spec amendées |
| D6 | TRANCHÉ (2026-10-21) | R84 | la spec 0.2 ne connaissait pas d'étape `spec` | un `Write`/`Edit` sous `docs/superpowers/specs/` pendant le cadrage passe à l'étape `spec`, bande `spécification` | la table avait tort : garder le mod |
| D7 | TRANCHÉ (2026-10-21) | R20 | un appel n'est `en cours` qu'une fois le dialogue de permission passé | `tool.call` est levé **avant** le dialogue ; le mod pose `en cours` dès son début (amendement A1) | garder le mod ; R20 réécrite, aucun changement de code |
| D8 | TRANCHÉ (2026-10-21) | §4.2, R83-R88 | la ligne Superpowers seulement pendant que Claude travaille (`isWorking`) | aussi quand un agent lancé en arrière-plan sous le plan tourne encore | la table avait tort : garder le mod |
| D9 | TRANCHÉ (2026-10-21) | R53, R57, §5.4 | `décliné` : signe `○`, atténué | le pipeline d'un appel décliné écrivait `✗ accord · rien n'a tourné`, `✗` en ton erreur | le mod avait tort, corrigé : `○ accord refusé`, atténué |
| D10 | TRANCHÉ (2026-10-21) | R53, R11 | une machine non prouvée s'écrit `machine inconnue` | dans le pipeline elle s'écrivait `machine` | le mod avait tort, corrigé : même mot que la rangée |
| D11 | TRANCHÉ (2026-10-21) | R13, R52 | outil `multi` : un hôte sans élément lisible dans `results` est `? incertain` | sans élément, chaque hôte prenait le résultat global : `✓ fait` (MCP), `✓ code ?` (CLI sortie 6) | le mod avait tort, corrigé : `? incertain` par hôte sans preuve ; les hôtes lisibles restent classés individuellement |
| D12 | TRANCHÉ (2026-10-21) | R76 | phases ou nom illisibles : `workflow en cours` | sans nom lisible, la bande écrivait `● workflow` seul | le mod avait tort, corrigé : `workflow en cours` |
| D13 | TRANCHÉ (2026-10-21) | R51, §5.4 | le drapeau tronqué portait le signe `⚠` (§5.4) ; §5.1 l'écrit `· tronqué` | suffixe `· tronqué` en ton attention, sans `⚠` | la spec se contredisait : garder le mod (le signe de tête reste celui de l'état) ; `⚠` retiré de la ligne « tronqué » de §5.4 |

Corrections de la table pendant l'étape 2 (sources primaires relues, pas le code du mod) :
R12 (critère 4 : `ssh_status` n'est pas compté, donc un outil `hostless` n'a pas de rangée) et
R38 (bloc `Exit code: N` toujours écrit par `exec` quand la commande a tourné,
`bridge-mcp/src/domain/use_cases/execute_command.rs:647-651`). Les deux ont été remarquées en
lisant le mod ; la décision repose sur la spec et sur la source du bridge.

## Arbitrages de la tâche 8 (rejeu) — 2026-10-21

Relevés par l'oracle du rejeu (`tests/replay/oracle.ts`), tranchés par l'utilisateur :

| id | lignes | question | décision |
|---|---|---|---|
| Q1 | R25, R46, R52 | résultat MCP au texte vide | réussi : `fait` (le mod avait raison) ; `isError` : `échec` (R46) ; R52 réécrite |
| Q2 | R52 | code de sortie CLI hors de 0 à 6 | `? incertain` : le mod avait tort (il rendait `échec`), corrigé derrière un test rouge |
| Q3 | R38 | `exec` sorti 0 sans bloc `Exit code: N` | `fait` (le mod avait raison) ; R38 réécrite, son erreur de fait corrigée (sortie 1 pour tout code distant non nul) |
| — | R23, R24 | `interrupted` du résultat Bash ; résultat après la fin de boucle | R23 : `interrupted: true` = interrompu ; R24 : filet, le résultat arrivé ensuite décide |
