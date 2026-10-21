// Lance dev/replay/extract.ts sous bun dans un dossier jetable (/var/tmp) : dossier de projets vide,
// liste noire écrite avec le contenu et le mode demandés (absente si `deny` vaut null).
// Renvoie le code de sortie, le message d'erreur et la présence du fichier de sortie.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

export function runExtract({ deny, mode = 0o600, args = [] }) {
  const dir = mkdtempSync(join('/var/tmp', 'extract-'))
  // Nettoyé ici même : `process.on('exit')` ne se déclenche pas sous `bun test` (les dossiers fuyaient).
  try {
    mkdirSync(join(dir, 'projets'))
    const denylist = join(dir, 'denylist.txt')
    if (deny !== null) {
      writeFileSync(denylist, deny)
      chmodSync(denylist, mode)
    }
    const out = join(dir, 'sortie.ts')
    const r = spawnSync(
      process.execPath,
      [
        join(REPO, 'dev/replay/extract.ts'),
        join(dir, 'projets'),
        '--denylist',
        denylist,
        '--out',
        out,
        '--sample',
        join(dir, 'echantillon.md'),
        ...args,
      ],
      { encoding: 'utf8' },
    )
    return { status: r.status, stderr: r.stderr, written: existsSync(out) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Les dossiers /var/tmp/extract-* présents (fuite si un appel de runExtract en laisse). */
export function extractDirs() {
  return readdirSync('/var/tmp').filter((n) => n.startsWith('extract-'))
}
