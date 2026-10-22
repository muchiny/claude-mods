// Dépôt jetable (dans /var/tmp, disque) où main et feat divergent : main change la ligne 1,
// feat change la ligne 4. Renvoie le dossier, supprimé à la fin du processus.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function divergedRepo() {
  const dir = mkdtempSync(join('/var/tmp', 'gate-'))
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: dir })
  const file = join(dir, 'mode-clair/hooks/a.ts')
  git('init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'mode-clair/hooks'), { recursive: true })
  writeFileSync(file, 'l1\nl2\nl3\nl4\n')
  git('add', '.')
  git('commit', '-qm', 'init')
  git('checkout', '-qb', 'feat')
  writeFileSync(file, 'l1\nl2\nl3\nFEAT\n')
  git('commit', '-qam', 'feat')
  git('checkout', '-q', 'main')
  writeFileSync(file, 'MAIN\nl2\nl3\nl4\n')
  git('commit', '-qam', 'main')
  git('checkout', '-q', 'feat')
  return dir
}
