#!/bin/sh
# Lance les tests du mod avec le mutant actif de Stryker.
#
# `claude plugin test` n'expose ni `process` ni l'environnement aux modules : le code instrumenté
# ne peut donc pas lire __STRYKER_ACTIVE_MUTANT__ et aucun mutant ne s'active (score 0 à vide).
# On travaille sur une copie jetable du mod, dont l'en-tête de Stryker reçoit l'identifiant
# du mutant en dur. La copie est sur le disque (/var/tmp), jamais dans le tmpfs en RAM.
set -eu

id="${__STRYKER_ACTIVE_MUTANT__:-}"
work=$(mktemp -d /var/tmp/mutant.XXXXXX)
trap 'rm -rf "$work"' EXIT

cp -R mode-clair "$work/mode-clair"
find "$work/mode-clair/hooks" -type f \( -name '*.ts' -o -name '*.tsx' \) -exec sed -i \
  -e "s/ns.activeMutant === undefined \&\& g.process \&\& g.process.env \&\& g.process.env.__STRYKER_ACTIVE_MUTANT__/ns.activeMutant === undefined/" \
  -e "s/ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;/ns.activeMutant = '$id';/" {} +

# Un mutant qui boucle sans fin est tué ici (code 124), pas laissé en arrière-plan.
timeout 180 claude plugin test "$work/mode-clair"
