// Textes exacts du moteur, relevés à la tâche 2 et écrits dans le spec §10 par dev/paint/sonde.py,
// recopiés sans retouche sous forme de littéraux JSON (tâche 5, étape 4). Ce sont les seules
// fixtures de tests/pure qui ne viennent pas de docs/superpowers/plans/refs/bridge-facts.md.
// Les motifs que classify lit vivent dans hooks/bridge.ts (ENGINE_REFUSAL_TEXTS,
// ENGINE_PERSISTED_TEXTS), seule source du mod ; ce fichier ne sert qu'aux tests.

/**
 * Spec §10, ligne « Texte exact d'un refus au dialogue de permission et d'un refus du classifieur » :
 * la première ligne non vide du texte lu par le modèle. Refus au dialogue en premier, refus du
 * classifieur en dernier : les tests moteur de la tâche 11 lisent RECORDED_REFUSALS[0] et
 * RECORDED_REFUSALS[RECORDED_REFUSALS.length - 1].
 */
export const RECORDED_REFUSALS: readonly string[] = [
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
  "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Interfere With Workloads]. If you have other tasks that don't depend on this action, continue working on those. IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways, e.g. do not use your ability to run tests to execute non-test actions. You should only try to work around this restriction in reasonable ways that do not attempt to bypass the intent behind this denial. If you believe this capability is essential to complete the user's request, first try a safer method. Get as much of the rest of the task done as you can, then STOP and explain to the user what you were trying to do and why you need this permission. Let the user decide how to proceed. To allow this type of action in the future, the user can add a permission rule for Bash to their settings.",
]

/**
 * Spec §10, ligne « Marque de sortie Bash persistée par Claude Code » : les lignes de la marque
 * (trois au plus, sans les nombres écrits par `seq`), séparées par des retours à la ligne.
 */
export const RECORDED_PERSISTED: readonly string[] = [
  '<persisted-output>\nOutput too large (575.1KB). Full output saved to: /home/user/.claude/projects/-var-tmp-mode-clair-paint-cwd/bbbbbbbb-cccc-4ddd-8eee-ffffffffffff/tool-results/bwo71rhn2.txt\nPreview (first 2KB):',
]
