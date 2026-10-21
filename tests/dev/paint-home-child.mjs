// Processus témoin de tests/dev/paint-home.test.ts : crée un HOME jetable avec un faux fichier d'identifiants,
// lance un « Claude » factice (sleep, dans son propre groupe), installe le nettoyage de dev/paint/home.mjs,
// écrit {home, pid} sur stdout, puis attend un signal ou lève une exception (argument `throw`).
import { spawn } from 'node:child_process'
import { createHome, installCleanup } from '../../dev/paint/home.mjs'

const [base, credentials, mode] = process.argv.slice(2)
const current = { home: null, pid: null }
installCleanup(current)
current.home = createHome({ base, repo: '/depot', fakeBridge: '/bin/true', credentials })
const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' })
current.pid = child.pid
process.stdout.write(`${JSON.stringify({ home: current.home, pid: child.pid })}\n`)
if (mode === 'throw')
  setTimeout(() => {
    throw new Error('exception témoin')
  }, 200)
else setInterval(() => {}, 1000)
