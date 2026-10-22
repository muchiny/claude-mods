// Scénarios de la peinture : ce que drive.ts tape dans le vrai Claude Code, et l'attendu (expected/<nom>.txt)
// que check.ts compare à la grille capturée. Données pures.
//
// Pas : `send` tape des octets ; `waitFor` attend qu'un motif paraisse dans le texte reçu (séquences de
// contrôle retirées) ; `settle` attend que l'écran se taise `ms` millisecondes (au plus 10 s) ;
// `capture` fige les octets reçus jusque-là sous un nom : replay.ts les rejoue (avant /exit) et check.ts
// les compare à expected/<nom>.txt. Une capture au moins par scénario ; noms uniques sur tous les scénarios.

export type Step = { send: string } | { waitFor: string; timeoutMs?: number } | { settle: number } | { capture: string }

export type Scenario = {
  name: string
  /** Demande un appel au modèle : ne tourne qu'avec ANTHROPIC_API_KEY (ou PAINT_USE_REAL_HOME=1 en local). */
  model: boolean
  args: string[]
  steps: Step[]
}

/** L'invite de saisie est dessinée : la session est prête. */
const READY: Step[] = [{ waitFor: '❯' }, { settle: 2500 }]

/** /clair tapé puis validé (le menu des commandes s'ouvre entre les deux). */
const CLAIR: Step[] = [{ send: '/clair' }, { settle: 800 }, { send: '\r' }]

/** Modèle des scénarios avec modèle (le moins coûteux) ; une seule commande Bash autorisée. */
const MODEL_ARGS = ['--model', 'claude-haiku-5-5', '--allowedTools', 'Bash(bridge-mcp:*)']

function prompt(command: string): string {
  return (
    `Lance exactement cette commande avec l'outil Bash, une seule fois, puis réponds « fini » sans rien ` +
    `faire d'autre : ${command}`
  )
}

/** `marker` : un texte de la sortie du faux bridge-mcp, absent de l'invite tapée (sinon l'écho le montre). */
function modelScenario(name: string, command: string, marker: string): Scenario {
  return {
    name,
    model: true,
    args: MODEL_ARGS,
    steps: [
      ...READY,
      { send: prompt(command) },
      { settle: 500 },
      { send: '\r' },
      { waitFor: marker, timeoutMs: 60_000 },
      { settle: 4000 },
      ...CLAIR,
      { waitFor: 'appel', timeoutMs: 15_000 },
      { settle: 2000 },
      { capture: name },
    ],
  }
}

export const SCENARIOS: readonly Scenario[] = [
  // Au repos : ni étiquette SessionMode ni bande (rien quand il ne se passe rien), capture « repos ». Puis,
  // dans la même session, preuve positive que le mod est chargé (capture « repos-menu ») : « /clai » tapé,
  // non validé, ouvre le menu des commandes où paraît la description de /clair ; Ctrl+U vide la saisie.
  {
    name: 'repos',
    model: false,
    args: [],
    steps: [
      ...READY,
      { capture: 'repos' },
      { send: '/clai' },
      { waitFor: 'mode clair' },
      { settle: 1500 },
      { capture: 'repos-menu' },
      { send: '\x15' },
      { settle: 800 },
    ],
  },
  // /clair sans rien dans la session : la carte vide du golden card-vide.
  {
    name: 'clair-vide',
    model: false,
    args: [],
    steps: [
      ...READY,
      ...CLAIR,
      { waitFor: 'rien depuis le début de la session' },
      { settle: 2000 },
      { capture: 'clair-vide' },
    ],
  },
  modelScenario('exec-ok', 'bridge-mcp exec host-a uptime', 'up 3 days'),
  modelScenario('hote-inconnu', 'bridge-mcp exec host-z uptime', 'Unknown host'),
  modelScenario('exit-2', 'bridge-mcp tool ssh_exec host=host-a command="ls /absent"', 'exit:2'),
]

/**
 * Écran qui bloque la session sans identifiant : choix du thème (accueil), choix de la méthode de
 * connexion, collage du code OAuth. Lu sur le texte reçu, séquences de contrôle retirées : les espaces
 * peuvent y manquer (Ink avance le curseur au lieu d'écrire des blancs), d'où les \s*. Le pied
 * « Not logged in · Run /login » ne bloque rien et n'en est pas un.
 */
const BLOCKING_SCREENS: readonly RegExp[] = [
  /Select\s*login\s*method/,
  /Paste\s*code\s*here/,
  /Browser\s*didn['’]t\s*open/,
  /Choose\s*the\s*text\s*style/,
]

export function isLoginScreen(text: string): boolean {
  return BLOCKING_SCREENS.some((re) => re.test(text))
}
