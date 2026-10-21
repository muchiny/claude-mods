// Bout en bout de dev/paint/drive.ts sans réseau ni vrai Claude : PAINT_CLAUDE pointe un faux claude écrit
// dans un dossier jetable sous /var/tmp, qui sert aussi de RUNNER_TEMP (HOME jetables et sorties dedans).
// - `login` : écran de choix de connexion AVEC le curseur ❯, puis attente (exec sleep, PID noté) ;
// - `prompt` : une invite ❯ ordinaire ; « /clai » tapé fait paraître la ligne du menu de /clair ; /exit sort.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

const LOGIN = `#!/bin/sh
echo $$ > "$(dirname "$0")/pid"
printf 'Claude Code can be used with your Claude subscription\\r\\n'
printf 'Select login method:\\r\\n\\r\\n'
printf ' \\342\\235\\257 1. Claude account with subscription\\r\\n   2. Anthropic Console account\\r\\n'
exec sleep 60
`

const PROMPT = `#!/usr/bin/env node
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'pid'), String(process.pid))
process.stdout.write('Faux Claude\\r\\n\\r\\n\\u276f ')
process.stdin.setRawMode(true)
process.stdin.resume()
let buf = ''
let shown = false
process.stdin.on('data', (d) => {
  buf += d.toString()
  if (!shown && buf.includes('/clai')) {
    shown = true
    process.stdout.write('\\r\\n  \\u276f /clair   Carte du mode clair : machines, problèmes, plan et workflows en\\r\\n')
  }
  if (buf.includes('/exit\\r')) process.exit(0)
})
`

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Lance `npm run paint -- --only repos` contre le faux claude `kind` ; rend sortie, code et restes. */
export function paintWith(kind) {
  const base = mkdtempSync(join('/var/tmp', 'paint-drive-test-'))
  const fake = join(base, kind === 'login' ? 'claude.sh' : 'claude.cjs')
  writeFileSync(fake, kind === 'login' ? LOGIN : PROMPT)
  chmodSync(fake, 0o755)
  const env = {
    ...process.env,
    PAINT_CLAUDE: fake,
    RUNNER_TEMP: base,
    GITHUB_ACTIONS: 'true',
    ANTHROPIC_API_KEY: '',
    PAINT_USE_REAL_HOME: '',
  }
  const args = ['--experimental-strip-types', join(REPO, 'dev/paint/drive.ts'), '--only', 'repos']
  return new Promise((done, fail) => {
    const p = spawn('node', args, { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    p.stdout.on('data', (d) => {
      stdout += d
    })
    p.stderr.on('data', () => {})
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      fail(new Error('drive.ts bloqué'))
    }, 60_000)
    p.on('exit', (code) => {
      clearTimeout(timer)
      const pidFile = join(base, 'pid')
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0
      const r = {
        code,
        stdout,
        homesLeft: readdirSync(base).filter((n) => n.startsWith('paint-home-')).length,
        fakeStarted: pid > 0,
        fakeAlive: pid > 0 && alive(pid),
      }
      rmSync(base, { recursive: true, force: true })
      done(r)
    })
  })
}
