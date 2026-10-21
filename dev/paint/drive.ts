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
// Scénarios avec modèle : seulement si ANTHROPIC_API_KEY est présent, ou en local avec PAINT_USE_REAL_HOME=1
// (consentement explicite : copie le seul ~/.claude/.credentials.json dans le HOME jetable, mode 600,
// effacé à la fin ; consomme l'abonnement).
//
// Sorties dans --out (défaut $RUNNER_TEMP/paint-out ou /var/tmp/paint-out) : <nom>.bin (octets rejoués),
// <nom>.full.bin (tous les octets), <nom>.grid.txt (grille en texte), <nom>.ecarts.txt. Code 1 si un écart.
// Garde-fous WSL : refus sous 2 Gio de mémoire disponible ; 120 s au plus par scénario ; un seul Claude à la
// fois ; arrêt du groupe de processus par son PID, jamais par motif.
//
// Exécuté par node --experimental-strip-types (node-pty perd des octets sous bun 1.4.3).

import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pty from 'node-pty'
import { check, parseExpected } from './check.ts'
import { gridOf, gridText } from './replay.ts'
import { SCENARIOS, type Scenario, type Step } from './scenarios.ts'

const COLS = 100
const ROWS = 40
const SCENARIO_MS = 120_000
const WAIT_MS = 30_000
const SETTLE_CAP_MS = 10_000
const MIN_AVAILABLE_KIB = 2 * 1024 * 1024
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')
const CI = process.env.GITHUB_ACTIONS === 'true'
const LOGIN = /Select login method|Paste code here|Log in with your|Login with your/
// biome-ignore lint/suspicious/noControlCharactersInRegex: l'ESC (0x1b) et BEL (0x07) bornent les séquences retirées, c'est voulu
const ANSI = /\x1b\[[0-9;?<>=!]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g

type Outcome = { name: string; status: 'ok' | 'ecarts' | 'saute'; ecarts: string[] }

function args(): { only: string | null; out: string } {
  const a = process.argv.slice(2)
  const at = (flag: string) => {
    const i = a.indexOf(flag)
    return i >= 0 ? (a[i + 1] ?? null) : null
  }
  const base = process.env.RUNNER_TEMP ?? '/var/tmp'
  return { only: at('--only'), out: at('--out') ?? join(base, 'paint-out') }
}

function memoryOk(): boolean {
  const m = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'))
  return m === null || Number(m[1]) >= MIN_AVAILABLE_KIB
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // groupe déjà parti
  }
}

/** HOME jetable : .claude.json minimal, identifiants seulement sur consentement explicite. */
function makeHome(useRealCredentials: boolean): string {
  const base = process.env.RUNNER_TEMP ?? '/var/tmp'
  const home = mkdtempSync(join(base, 'paint-home-'))
  const cfg: Record<string, unknown> = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    projects: { [REPO]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true } },
  }
  const key = process.env.ANTHROPIC_API_KEY
  // Clé fournie par le secret de CI : la session la demande sinon (« Detected a custom API key »).
  if (key !== undefined && key !== '') cfg.customApiKeyResponses = { approved: [key.slice(-20)], rejected: [] }
  writeFileSync(join(home, '.claude.json'), JSON.stringify(cfg), { mode: 0o600 })
  mkdirSync(join(home, '.claude'), { mode: 0o700 })
  if (useRealCredentials) {
    const dst = join(home, '.claude', '.credentials.json')
    copyFileSync(join(homedir(), '.claude', '.credentials.json'), dst)
    chmodSync(dst, 0o600)
  }
  // Le faux bridge-mcp, en tête de PATH pour les scénarios avec modèle.
  mkdirSync(join(home, 'bin'))
  symlinkSync(join(HERE, 'fake-bridge-mcp.sh'), join(home, 'bin', 'bridge-mcp'))
  return home
}

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

type Run = { full: Buffer; cut: Buffer | null; login: boolean; error: string | null }

async function runScenario(s: Scenario, home: string): Promise<Run> {
  const claude = process.env.PAINT_CLAUDE ?? 'claude'
  const p = pty.spawn(claude, ['--plugin-dir', 'mode-clair', ...s.args], {
    name: 'xterm-256color',
    cols: COLS,
    rows: ROWS,
    cwd: REPO,
    env: envFor(home, s),
  })
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
  const run: Run = { full: Buffer.alloc(0), cut: null, login: false, error: null }

  async function step(st: Step): Promise<void> {
    if ('send' in st) p.write(st.send)
    else if ('capture' in st) run.cut = Buffer.concat(chunks)
    else if ('settle' in st) {
      const until = Math.min(Date.now() + SETTLE_CAP_MS, deadline)
      while (Date.now() - lastData < st.settle && Date.now() < until && !exited) await sleep(100)
    } else {
      const from = text.length
      const until = Math.min(Date.now() + (st.timeoutMs ?? WAIT_MS), deadline)
      while (!text.slice(from).includes(st.waitFor)) {
        if (LOGIN.test(text)) {
          run.login = true
          throw new Error('connexion requise')
        }
        if (exited) throw new Error(`Claude Code est sorti avant « ${st.waitFor} »`)
        if (Date.now() >= until) throw new Error(`« ${st.waitFor} » attendu, pas vu`)
        await sleep(100)
      }
    }
  }

  try {
    for (const st of s.steps) await step(st)
    p.write('/exit')
    await sleep(500)
    p.write('\r')
    await Promise.race([exit, sleep(10_000)])
  } catch (e) {
    run.error = e instanceof Error ? e.message : String(e)
  } finally {
    killGroup(p.pid)
    await Promise.race([exit, sleep(2000)])
  }
  run.full = Buffer.concat(chunks)
  return run
}

async function main(): Promise<number> {
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
    const home = makeHome(s.model && realHome && !hasKey)
    let r: Run
    try {
      r = await runScenario(s, home)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
    writeFileSync(join(out, `${s.name}.full.bin`), r.full)
    if (r.login) {
      console.log(CI ? '::notice::peinture sautée : connexion requise' : `${s.name} : sauté, connexion requise`)
      outcomes.push({ name: s.name, status: 'saute', ecarts: [] })
      continue
    }
    const bytes = r.cut ?? r.full
    writeFileSync(join(out, `${s.name}.bin`), bytes)
    const grid = await gridOf(new Uint8Array(bytes), COLS, ROWS)
    writeFileSync(join(out, `${s.name}.grid.txt`), `${gridText(grid)}\n`)
    const ecarts = r.error === null ? [] : [`session : ${r.error}`]
    if (r.cut === null && r.error === null) ecarts.push('session : aucune capture')
    ecarts.push(...check(grid, parseExpected(readFileSync(join(HERE, 'expected', `${s.name}.txt`), 'utf8'))))
    writeFileSync(join(out, `${s.name}.ecarts.txt`), ecarts.map((e) => `${e}\n`).join(''))
    outcomes.push({ name: s.name, status: ecarts.length === 0 ? 'ok' : 'ecarts', ecarts })
    console.log(`${s.name} : ${ecarts.length === 0 ? '0 écart' : `${ecarts.length} écart(s)`}`)
    for (const e of ecarts) console.log(`  - ${e}`)
  }
  writeFileSync(join(out, 'resume.json'), `${JSON.stringify(outcomes, null, 2)}\n`)
  return outcomes.some((o) => o.status === 'ecarts') ? 1 : 0
}

process.exitCode = await main()
