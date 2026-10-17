// Contrat d'état de mode-clair 0.2.0 : ce que le mod garde dans `$.state`.
//
// Données simples seulement (JSON), pour qu'un rechargement à chaud les garde
// et qu'un test les construise à la main. Les mots que la personne lit
// vivent dans hooks/view.ts. Fichier autonome : aucun import, aucune
// référence ; `Shaped` et `StateFamily` sont ceux du module 'claude-code'.

export type Tone = 'ok' | 'erreur' | 'attention' | 'accent' | 'attenue' | 'texte' | { machine: number }
export type Piece = { text: string; tone: Tone }
export type Line = Piece[]

export type CallState =
  | 'en-cours'
  | 'fait'
  | 'code'
  | 'injoignable'
  | 'machine-inconnue'
  | 'refuse'
  | 'limite'
  | 'confirmation-impossible'
  | 'confirmation-manquante'
  | 'echec-machine'
  | 'echec'
  | 'acces-refuse'
  | 'delai-depasse'
  | 'erreur-usage'
  | 'erreur-config'
  | 'refuse-claude'
  | 'decline'
  | 'interrompu'
  | 'incertain'
export type Nature = 'lecture' | 'peut-modifier' | 'inconnu'
export type Via = 'cli' | 'mcp'
export type Accord = 'aucun' | 'option' | 'formulaire-oui' | 'formulaire-non'

export type BridgeCall = {
  id: string // `${toolUseId}#${n}` (n = rang du segment ou de l'hôte, à partir de 0)
  toolUseId: string
  agentId?: string
  via: Via
  tool: string // nom d'outil bridge (ssh_disk_usage) ou sous-commande (exec, upload, download)
  host: string | null // null = machine inconnue
  nature: Nature
  state: CallState
  code?: number // code distant pour 'code' et 'echec-machine' (absent si inconnu)
  truncated: boolean
  reason?: string // première ligne utile brute quand elle n'est pas traduite
  accord: Accord
  startedAt: number
  endedAt?: number
}

export type Waiting = { tool: string; host: string | null; callId: string | null; since: number }

export type Stage = 'cadrage' | 'spec' | 'plan' | 'taches' | 'relecture' | 'fin'
export type Superpowers = {
  stage: Stage
  planTitle: string | null
  planPath: string | null
  tasks: number // 0 = inconnu
  current: number | null // tâche courante, null = inconnue
  lastEventAt: number
  isStale: boolean
  runningAgents: string[] // agentId des agents lancés en arrière-plan sous le plan (étape taches ou relecture) qui tournent encore
}

export type WorkflowStatus = 'en-cours' | 'fini' | 'echec' | 'arrete' | 'sans-nouvelles' | 'distant'
export type WorkflowAgent = { id: string; label: string; phase: string | null; state: 'en-cours' | 'fait' | 'echec' } // id = agentId du journal (tâche 8)
export type Workflow = {
  key: string // runId, sinon taskId
  toolUseId: string
  name: string
  phases: string[] // [] = inconnues
  journalPath: string | null
  consumed: number // longueur (unités UTF-16) du journal déjà analysée
  agents: WorkflowAgent[]
  status: WorkflowStatus
  lastGrowthAt: number
  startedAt: number
}

export type ClairState = {
  calls: BridgeCall[] // plus ancien d'abord, 200 au plus
  hostOrder: string[] // ordre de première apparition -> index de couleur
  seenAt: number // horodatage du dernier /clair (0 = jamais)
  waiting: Waiting | null
  superpowers: Superpowers | null
  workflows: Workflow[]
  sessions: Record<string, string> // id de session ssh -> hôte
}

declare module 'claude-code' {
  interface PluginState {
    'mode-clair': {
      state: Shaped<ClairState>
      rows: StateFamily<BridgeCall[]>
    }
  }
}
