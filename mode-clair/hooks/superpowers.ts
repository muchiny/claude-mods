// Superpowers vu de l'extérieur : à quelle étape en est la session, quel plan,
// quelle tâche. Module pur : aucun `$`, aucune horloge (l'heure est un argument).
//
// Seuls les skills d'étape créent ou font avancer l'état (spec §5.2) ; une
// écriture sous docs/superpowers/ ou un appel Agent complète un état existant
// sans jamais en créer un.
//
// Claude Code 2.1.300 lance les agents en arrière-plan par défaut : le tour
// principal peut finir pendant qu'un agent du plan tourne encore. Ces agents
// sont suivis (runningAgents) du résultat `async_launched` de leur appel
// jusqu'au turn.complete de leur boucle.

import type { Stage, Superpowers } from '../types'

/** Sans événement Superpowers depuis ce délai, l'état est marqué abandonné. */
export const STALE_MS = 30 * 60_000

const TASK_HEADING = /^###\s+(Task|Tâche|T{1,2})\s*(\d+)\b/
const TASK_IN_TEXT = /\b(Task|Tâche|T{1,2})\s*(\d+)\b/
const FENCE = /^\s*(?:```|~~~)/
const TITLE = /^#\s+(\S.*?)\s*$/
const PLAN_SUFFIX = /\s+[—–-]?\s*Implementation Plan$/i
const FINAL_REVIEW = /final (code )?review/i
const CODE_REVIEWER = /code-reviewer\.md/
const UNDER_DOCS = /(^|\/)docs\/superpowers\//
const SPEC_FILE = /(^|\/)docs\/superpowers\/specs\/[^/]+\.md$/
const PLAN_FILE = /(^|\/)docs\/superpowers\/plans\/[^/]+\.md$/

/** L'étape où mène un skill d'étape, `superpowers:x` ou `x` ; null pour tout autre skill. */
function stageOfSkill(skill: string): Stage | null {
  const colon = skill.indexOf(':')
  if (colon >= 0 && skill.slice(0, colon) !== 'superpowers') return null
  switch (skill.slice(colon + 1)) {
    case 'brainstorming':
      return 'cadrage'
    case 'writing-plans':
      return 'plan'
    case 'executing-plans':
    case 'subagent-driven-development':
      return 'taches'
    case 'requesting-code-review':
      return 'relecture'
    case 'finishing-a-development-branch':
      return 'fin'
    default:
      return null
  }
}

function fresh(stage: Stage, now: number): Superpowers {
  return {
    stage,
    planTitle: null,
    planPath: null,
    tasks: 0,
    current: null,
    lastEventAt: now,
    isStale: false,
    runningAgents: [],
  }
}

/** Un skill invoqué. Un skill qui n'est pas une étape rend la même référence. */
export function onSkill(sp: Superpowers | null, skill: string, now: number): Superpowers | null {
  const stage = stageOfSkill(skill)
  if (stage === null) return sp
  if (sp === null || stage === 'cadrage') return fresh(stage, now)
  return { ...sp, stage, lastEventAt: now, isStale: false }
}

/**
 * Un `Write` ou un `Edit` réussi. `text` est le contenu du fichier (le `content`
 * d'un Write, le fichier relu après un Edit), null si la relecture a échoué :
 * la liste de tâches précédente est alors gardée pour le même plan.
 */
export function onDocWrite(sp: Superpowers | null, path: string, text: string | null, now: number): Superpowers | null {
  if (sp === null) return null
  if (!UNDER_DOCS.test(path)) return sp
  const touched: Superpowers = { ...sp, lastEventAt: now, isStale: false }
  if (SPEC_FILE.test(path)) return sp.stage === 'cadrage' ? { ...touched, stage: 'spec' } : touched
  if (!PLAN_FILE.test(path)) return touched
  const stage: Stage = sp.stage === 'cadrage' || sp.stage === 'spec' ? 'plan' : sp.stage
  const samePlan = sp.planPath === path
  const base: Superpowers = { ...touched, stage, planPath: path, current: samePlan ? sp.current : null }
  if (text === null) return samePlan ? base : { ...base, planTitle: null, tasks: 0 }
  const plan = parsePlan(text)
  return { ...base, planTitle: plan.title, tasks: plan.tasks }
}

/**
 * Un appel `Agent`. Relecture finale : description `final review` /
 * `final code review`, ou prompt qui cite `code-reviewer.md`. Sinon le numéro
 * de tâche de la description fait avancer l'exécution du plan.
 */
export function onAgent(sp: Superpowers | null, description: string, prompt: string, now: number): Superpowers | null {
  if (sp === null) return null
  const onPlan = sp.stage === 'plan' || sp.stage === 'taches'
  if (FINAL_REVIEW.test(description) || CODE_REVIEWER.test(prompt)) {
    if (!onPlan && sp.stage !== 'relecture') return sp
    return { ...sp, stage: 'relecture', lastEventAt: now, isStale: false }
  }
  if (!onPlan) return sp
  const n = taskNumber(description) ?? 0
  if (n < 1 || (sp.tasks > 0 && n > sp.tasks)) return sp
  return { ...sp, stage: 'taches', current: n, lastEventAt: now, isStale: false }
}

/**
 * Titre (premier titre `# `, suffixe « Implementation Plan » retiré) et nombre
 * de tâches (numéros distincts des titres `### Task 3`, `### Tâche 3`,
 * `### T3`, `### TT3`). Les blocs de code clôturés sont sautés.
 */
export function parsePlan(text: string): { title: string | null; tasks: number } {
  let title: string | null = null
  let inFence = false
  const numbers = new Set<number>()
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const heading = TITLE.exec(line)
    if (heading !== null && title === null) title = String(heading[1]).replace(PLAN_SUFFIX, '')
    const task = TASK_HEADING.exec(line)
    if (task !== null) numbers.add(Number(task[2]))
  }
  return { title, tasks: numbers.size }
}

/** Le numéro de tâche cité dans un texte (`Implement Task 3: remote exit code`, `T9 implementer: write the criterion`), sinon null. */
export function taskNumber(text: string): number | null {
  const m = TASK_IN_TEXT.exec(text)
  return m === null ? null : Number(m[2])
}

/** Marque l'état abandonné après STALE_MS sans événement, et oublie ses agents ; même référence sinon. */
export function expire(sp: Superpowers | null, now: number): Superpowers | null {
  if (sp === null || sp.isStale || now - sp.lastEventAt < STALE_MS) return sp
  return { ...sp, isStale: true, runningAgents: [] }
}

/**
 * L'agentId d'un résultat `Agent` dont l'agent tourne encore : `status: "async_launched"`
 * (D:17578-17582). Un résultat `completed` porte aussi un agentId, mais son agent a fini et son
 * turn.complete est déjà passé ; `remote_launched` n'a pas d'agentId. Sinon null.
 */
export function runningAgentOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const r = result as { status?: unknown; agentId?: unknown }
  return r.status === 'async_launched' && typeof r.agentId === 'string' && r.agentId !== '' ? r.agentId : null
}

/**
 * Un agent lancé en arrière-plan pendant les tâches ou la relecture (étape posée par onAgent sur
 * ce même appel) : ajouté une fois. Hors du plan, déjà suivi, ou aucun état : même référence.
 */
export function onAgentLaunched(sp: Superpowers | null, agentId: string, now: number): Superpowers | null {
  if (sp === null || (sp.stage !== 'taches' && sp.stage !== 'relecture') || sp.runningAgents.includes(agentId))
    return sp
  return { ...sp, runningAgents: [...sp.runningAgents, agentId], lastEventAt: now, isStale: false }
}

/** La fin de la boucle d'un agent (turn.complete avec son agentId) : retiré ; même référence s'il n'était pas suivi. */
export function onAgentDone(sp: Superpowers | null, agentId: string, now: number): Superpowers | null {
  if (sp === null || !sp.runningAgents.includes(agentId)) return sp
  return { ...sp, runningAgents: sp.runningAgents.filter((id) => id !== agentId), lastEventAt: now, isStale: false }
}
