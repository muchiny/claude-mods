# Politique de sécurité

## Signaler une vulnérabilité

Ne publie pas la faille dans une issue ni une pull request. Utilise le signalement
privé de GitHub (Security Advisories) :

1. ouvre l'onglet **Security** du dépôt `muchiny/claude-mods` ;
2. clique sur **Report a vulnerability** ;
3. décris le problème, la version de `mode-clair` concernée et, si possible, comment le reproduire.

Je réponds dès que possible et je publie un correctif avant toute divulgation.

## Versions prises en charge

Seule la dernière version publiée de `mode-clair` reçoit des correctifs.

## Périmètre

Les mods observent seulement : ils ne font aucun appel réseau et n'écrivent pas dans ton projet.
Sont dans le périmètre : fuite d'information vers l'affichage ou les journaux, exécution de code
non voulue, chaîne de livraison (workflows GitHub Actions, archives de release et leur attestation).
