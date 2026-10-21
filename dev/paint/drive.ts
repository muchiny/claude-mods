// Peinture du vrai terminal : npm run paint [-- --only <nom>] [--out <dossier>]
//
// Pour chaque scénario (scenarios.ts) : lance `claude --plugin-dir mode-clair` dans un pty (100 × 40,
// TERM=xterm-256color), avec un HOME jetable (sous $RUNNER_TEMP en CI, /var/tmp en local, jamais /tmp)
// qui ne contient qu'un .claude.json minimal (accueil passé, dossier du dépôt approuvé) : aucun réglage,
// plugin ni identifiant de l'utilisateur. Tape les touches, enregistre tous les octets, quitte par /exit,
// rejoue les octets capturés dans xterm headless (replay.ts) et les compare à expected/<nom>.txt (check.ts).
//
// Sans identifiant, Claude Code 2.1.306 ouvre la session (« Not logged in ») et /clair répond : les
// scénarios sans modèle n'ont besoin d'aucune connexion. Si un écran de connexion bloque quand même, le
// scénario est sauté (`::notice::peinture sautée : connexion requise` en CI) et la sortie reste 0.
// Scénarios avec modèle : seulement si ANTHROPIC_API_KEY est présent (vide = absent), ou en local avec
// PAINT_USE_REAL_HOME=1 (consentement explicite : copie le seul ~/.claude/.credentials.json dans le HOME
// jetable, mode 600, effacé à la fin et sur signal ; consomme l'abonnement). ATTENTION : un rafraîchissement
// du jeton dans le HOME jetable peut faire tourner le jeton de rafraîchissement et invalider la connexion
// réelle de l'utilisateur (voir home.mjs). Opt-in seulement.
//
// Sorties dans --out (défaut $RUNNER_TEMP/paint-out ou /var/tmp/paint-out) : <scénario>.full.bin (tous les
// octets) ; par capture, <capture>.bin (octets rejoués), <capture>.grid.txt (grille en texte),
// <capture>.ecarts.txt. Code 1 si un écart.
// Garde-fous WSL : refus sous 2 Gio de mémoire disponible ; 120 s au plus par scénario ; un seul Claude à la
// fois ; arrêt du groupe de processus par son PID, jamais par motif.
//
// Exécuté par node --experimental-strip-types (node-pty perd des octets sous bun 1.4.3).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'
import { check, parseExpected } from './check.ts'
import { createHome, installCleanup, killGroup, removeHome } from './home.mjs'
import { gridOf, gridText } from './replay.ts'
import { isLoginScreen, SCENARIOS, type Scenario, type Step } from './scenarios.ts'

const COLS = 100
const ROWS = 40
const SCENARIO_MS = 120_000
const WAIT_MS = 30_000
const SETTLE_CAP_MS = 10_000
const MIN_AVAILABLE_KIB = 2 * 1024 * 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const CI = process.env.GITHUB_ACTIONS === 'true'
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) et BEL (0x07) bornent les séquences retirées, c'est voulu
const ANSI = /\x1b\[[0-9;?<>=!]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g

type Outcome = { name: string; status: 'ok' | 'ecarts' | 'saute'; ecarts: string[] }

function args(): { only: string | null; out: string } {
  const a = process.argv.slice(2)
  const at = (flag: string) => {
    const i = a.indexOf(flag)
    return i >= 0 ? (a[i + 1] ?? null) : null
  }
  const base = process.env.RUNNER_TEMP || '/var/tmp'
  return { only: at('--only'), out: at('--out') ?? join(base, 'paint-out') }
}

function memoryOk(): boolean {
  const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))
  return m === null || Number(m[1]) >= MIN_AVAILABLE_KIB
}

/** Le Claude et le HOME en cours : installCleanup() les nettoie sur signal ou exception. */
const current: { home: string | null; pid: number | null } = { home: null, pid: null }

function envFor(home: string, s: Scenario): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    PATH: s.model ? `${join(home, 'bin')}:${process.env.PATH ?? ''}` : (process.env.PATH ?? ''),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    USER: process.env.USER ?? 'runner',
    // Pas de mise à jour dans le HOME jetable, pas de trafic non essentiel.
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (s.model && key !== undefined && key !== '') env.ANTHROPIC_API_KEY = key
  return env
}

type Run = { full: Buffer; cuts: { name: string; bytes: Buffer }[]; login: boolean; error: string | null }

async function runScenario(s: Scenario, home: string): Promise<Run> {
  const claude = process.env.PAINT_CLAUDE ?? 'claude'
  const p = pty.spawn(claude, ['--plugin-dir', 'mode-clair', ...s.args], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: REPO,
    env: envFor(home, s),
  })
  current.pid = p.pid
  const chunks: Buffer[] = []
  let text = ''
  let lastData = Date.now()
  let exited = false
  p.onData((d: string) => {
    chunks.push(Buffer.from(d, 'utf8'))
    text += d.replace(ANSI, '')
    lastData = Date.now()
  })
  const exit = new Promise<void>((done) =>
    p.onExit(() => {
      exited = true
      done()
    }),
  )
  const deadline = Date.now() + SCENARIO_MS
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const run: Run = { full: Buffer.alloc(0), cuts: [], login: false, error: null }

  // Écran de connexion ou de thème : cherché sur l'écran affiché (les ROWS dernières rangées de la grille
  // rejouée), pas sur tout le texte reçu depuis le début : un texte de connexion passé (sortie d'outil,
  // réponse du modèle) ne marque pas le scénario sauté.
  const blocked = async () => {
    const g = await gridOf(new Uint8Array(Buffer.concat(chunks)), COLS, ROWS)
    if (
      !isLoginScreen(
        g.rows
          .slice(-ROWS)
          .map((r) => r.text)
          .join('\n'),
      )
    )
      return
    run.login = true
    throw new Error('connexion requise')
  }

  // Une attente lit le texte reçu depuis la dernière saisie (pas depuis son propre début) : la réponse
  // peut arriver avant que l'attente commence (pendant le contrôle d'écran qui suit chaque pas).
  let sentAt = 0

  async function step(st: Step): Promise<void> {
    if ('send' in st) {
      sentAt = text.length
      p.write(st.send)
    } else if ('capture' in st) run.cuts.push({ name: st.capture, bytes: Buffer.concat(chunks) })
    else if ('settle' in st) {
      const until = Math.min(Date.now() + SETTLE_CAP_MS, deadline)
      while (Date.now() - lastData < st.settle && Date.now() < until && !exited) await sleep(100)
    } else {
      const from = sentAt
      const until = Math.min(Date.now() + (st.timeoutMs ?? WAIT_MS), deadline)
      for (let i = 0; !text.slice(from).includes(st.waitFor); i += 1) {
        if (i % 5 === 0) await blocked()
        if (exited) throw new Error(`Claude Code est sorti avant « ${st.waitFor} »`)
        if (Date.now() >= until) throw new Error(`« ${st.waitFor} » attendu, pas vu`)
        await sleep(100)
      }
    }
  }

  try {
    // Un écran de connexion ou de thème contient aussi ❯ : on le cherche après chaque pas, pas seulement
    // pendant une attente.
    for (const st of s.steps) {
      await step(st)
      await blocked()
    }
    p.write('/exit')
    await sleep(500)
    p.write('\r')
    await Promise.race([exit, sleep(10_000)])
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e)
  } finally {
    killGroup(p.pid)
    await Promise.race([exit, sleep(2000)])
    current.pid = null
  }
  run.full = Buffer.concat(chunks)
  return run
}

/** PAINT_USE_REAL_HOME=1 : le seul fichier d'identifiants, jamais lu ici, seulement copié (home.mjs). */
function realCredentials(): string {
  const f = join(homedir(), '.claude', '.credentials.json')
  if (!existsSync(f)) throw new Error('PAINT_USE_REAL_HOME=1 sans ~/.claude/.credentials.json')
  return f
}

async function main(): Promise<number> {
  installCleanup(current)
  const { only, out } = args()
  if (!memoryOk()) {
    console.error('mémoire disponible < 2 Gio : peinture refusée')
    return 1
  }
  const realHome = process.env.PAINT_USE_REAL_HOME === '1'
  const hasKey = (process.env.ANTHROPIC_API_KEY ?? '') !== ''
  mkdirSync(out, { recursive: true })
  const outcomes: Outcome[] = []
  for (const s of SCENARIOS) {
    if (only !== null && s.name !== only) continue
    if (s.model && !hasKey && !realHome) {
      console.log(`${s.name} : sauté (scénario avec modèle, ni ANTHROPIC_API_KEY ni PAINT_USE_REAL_HOME=1)`)
      continue
    }
    let r: Run
    try {
      current.home = createHome({
        repo: REPO,
        fakeBridge: join(HERE, 'fake-bridge-mcp.sh'),
        key: process.env.ANTHROPIC_API_KEY ?? '',
        credentials: s.model && realHome && !hasKey ? realCredentials() : null,
      })
      r = await runScenario(s, current.home as string)
    } finally {
      removeHome(current.home)
      current.home = null
    }
    writeFileSync(join(out, `${s.name}.full.bin`), r.full)
    if (r.login) {
      console.log(CI ? '::notice::peinture sautée : connexion requise' : `${s.name} : sauté, connexion requise`)
      outcomes.push({ name: s.name, status: 'saute', ecarts: [] })
      continue
    }
    const names = s.steps.flatMap((st) => ('capture' in st ? [st.capture] : []))
    for (const name of names) {
      const cut = r.cuts.find((c) => c.name === name)
      const bytes = cut?.bytes ?? r.full
      writeFileSync(join(out, `${name}.bin`), bytes)
      const grid = await gridOf(new Uint8Array(bytes), COLS, ROWS)
      writeFileSync(join(out, `${name}.grid.txt`), `${gridText(grid)}\n`)
      const ecarts = r.error === null ? [] : [`session : ${r.error}`]
      if (cut === undefined) ecarts.push('session : capture non faite (grille de tous les octets)')
      ecarts.push(...check(grid, parseExpected(readFileSync(join(HERE, 'expected', `${name}.txt`), 'utf8'))))
      writeFileSync(join(out, `${name}.ecarts.txt`), ecarts.map((e) => `${e}\n`).join(''))
      outcomes.push({ name, status: ecarts.length === 0 ? 'ok' : 'ecarts', ecarts })
      console.log(`${name} : ${ecarts.length === 0 ? '0 écart' : `${ecarts.length} écart(s)`}`)
      for (const e of ecarts) console.log(`  - ${e}`)
    }
  }
  writeFileSync(join(out, 'resume.json'), `${JSON.stringify(outcomes, null, 2)}\n`)
  return outcomes.some((o) => o.status === 'ecarts') ? 1 : 0
}

process.exitCode = await main()
