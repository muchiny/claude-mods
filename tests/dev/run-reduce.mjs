// Lance dev/replay/reduce-run.ts sous bun dans un dossier jetable (/var/tmp, mode 700) : une entrée qui,
// importée, écrit un témoin (preuve d'exécution), une liste noire factice (mode 600) et une sortie dans le
// dossier jetable. Renvoie le code de sortie, la présence du témoin et celle de la sortie.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

const scenario = (text) => ({
  id: 'bridge-cli-essai',
  source: 'replay',
  files: {},
  events: [
    {
      t: 0,
      kind: 'tool.call',
      tool: 'Bash',
      toolUseId: 'toolu_r0001',
      input: { command: 'bridge-mcp exec host-a lorem' },
      result: { result: 'ok', text },
      afterMs: 0,
    },
  ],
})

/**
 * `where` : 'private' (entrée dans le dossier privé passé par --private-dir), 'outside' (entrée hors du
 * dossier privé), 'link' (lien dans le dossier privé vers une entrée hors de lui), 'open' (dossier privé
 * en mode 755). `text` : sortie de l'appel du scénario d'entrée.
 */
export function runReduce({ where, text = 'Exit code 0' }) {
  const dir = mkdtempSync(join('/var/tmp', 'reduce-'))
  try {
    const priv = join(dir, 'prive')
    const other = join(dir, 'ailleurs')
    mkdirSync(priv, { mode: 0o700 })
    mkdirSync(other, { mode: 0o700 })
    if (where === 'open') chmodSync(priv, 0o755)
    const marker = join(dir, 'importe')
    const body =
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'x')\n` +
      `export const SCENARIOS: readonly Scenario[] = ${JSON.stringify([scenario(text)])}\n`
    const real = join(where === 'outside' || where === 'link' ? other : priv, 'entree.ts')
    writeFileSync(real, body, { mode: 0o600 })
    const input = where === 'link' ? join(priv, 'lien.ts') : real
    if (where === 'link') symlinkSync(real, input)
    const denylist = join(dir, 'denylist.txt')
    writeFileSync(denylist, 'machine-reelle-1\n', { mode: 0o600 })
    const out = join(dir, 'sortie.ts')
    const r = spawnSync(
      process.execPath,
      [
        join(REPO, 'dev/replay/reduce-run.ts'),
        input,
        '--max-bytes',
        '100000',
        '--denylist',
        denylist,
        '--out',
        out,
        '--private-dir',
        priv,
      ],
      { encoding: 'utf8' },
    )
    return { status: r.status, stderr: r.stderr, imported: existsSync(marker), written: existsSync(out) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
