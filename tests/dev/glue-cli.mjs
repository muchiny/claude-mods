// Lance dev/mutate-glue.mjs en ligne de commande (validation des options : aucune mutation n'est lancée).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

export function runGlue(args, env = {}) {
  return spawnSync(process.execPath, ['dev/mutate-glue.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: REPO,
  })
}

// Un groupe détaché (sleep) et une copie factice sous /var/tmp, pour vérifier l'arrêt propre.
export async function stopFixture() {
  const { spawn } = await import('node:child_process')
  const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs')
  const dir = mkdtempSync('/var/tmp/glue-mutant-test-')
  mkdirSync(`${dir}/mode-clair`)
  writeFileSync(`${dir}/mode-clair/x`, 'x')
  const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
  const closed = new Promise((done) => child.on('close', (_code, signal) => done(signal)))
  return { pid: child.pid, dir, closed, exists: () => existsSync(dir) }
}

export function runModule(args) {
  return spawnSync(process.execPath, ['dev/mutate-module.mjs', ...args], { encoding: 'utf8', cwd: REPO })
}

// dev/mutation-floors.mjs sur des rapports synthétiques (un par module), écrits dans un dossier jetable.
export function runFloors(reports) {
  const dir = mkdtempSync('/var/tmp/floors-test-')
  try {
    const paths = reports.map((r, i) => {
      const p = `${dir}/r${i}.json`
      writeFileSync(p, JSON.stringify(r))
      return p
    })
    return spawnSync(process.execPath, ['dev/mutation-floors.mjs', ...paths], { encoding: 'utf8', cwd: REPO })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
