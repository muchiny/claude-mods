// Aides Node de tests/dev/workflows.test.ts (le programme TypeScript du dépôt n'a pas les types Node) :
// lire un workflow, en tirer le motif du grep d'hygiène des fixtures, l'exécuter avec grep -P.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

/** Texte de .github/workflows/<nom>. */
export function workflow(name) {
  return readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
}

/** Motif PCRE du pas « Replay fixtures are anonymised » de ci.yml. */
export function hygienePattern() {
  const m = /grep -rnP --include='\*\.ts' '(.*)' \\$/m.exec(workflow('ci.yml'))
  if (m === null) throw new Error('motif du grep d’hygiène introuvable dans ci.yml')
  return m[1]
}

/** Vrai si grep -P trouve `pattern` dans `text` (comme le pas de CI, qui échoue alors). */
export function grepFinds(pattern, text) {
  const r = spawnSync('grep', ['-P', pattern], { input: text, encoding: 'utf8' })
  if (r.status === 2) throw new Error(`grep -P : ${r.stderr}`)
  return r.status === 0
}

/** Corps `run: |` du pas `name: <step>` de `wf` (indentation retirée), ou null. */
export function runOf(wf, step) {
  const lines = wf.split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${step}`)
  if (at < 0) return null
  const run = lines.findIndex((l, i) => i > at && l.trim() === 'run: |')
  if (run < 0) return null
  const body = []
  for (const l of lines.slice(run + 1)) {
    if (l.trim() !== '' && !l.startsWith('          ')) break
    body.push(l.slice(10))
  }
  return body.join('\n')
}

/**
 * Exécute le pas « Tag distant égal au commit vérifié » de release.yml dans un clone jetable (/var/tmp) d'un
 * dépôt nu `origin` : tag annoté ou léger `v1.0.0` sur le commit vérifié (GITHUB_SHA), puis, si `moved`,
 * déplacé sur un commit suivant. Rend le code de sortie du pas.
 */
export function tagCheck({ annotated, moved }) {
  const dir = mkdtempSync(join('/var/tmp', 'tag-check-'))
  try {
    const git = (cwd, ...a) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
    const origin = join(dir, 'origin.git')
    const work = join(dir, 'work')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
    execFileSync('git', ['clone', '-q', origin, work], { stdio: 'ignore' })
    writeFileSync(join(work, 'a'), '1')
    git(work, 'add', 'a')
    git(work, 'commit', '-qm', 'un')
    const sha = git(work, 'rev-parse', 'HEAD')
    git(work, 'tag', ...(annotated ? ['-a', '-m', 'v1.0.0'] : []), 'v1.0.0')
    git(work, 'push', '-q', 'origin', 'main', 'v1.0.0')
    if (moved) {
      writeFileSync(join(work, 'a'), '2')
      git(work, 'commit', '-qam', 'deux')
      git(work, 'tag', '-f', ...(annotated ? ['-a', '-m', 'v1.0.0'] : []), 'v1.0.0')
      git(work, 'push', '-qf', 'origin', 'main', 'v1.0.0')
      git(work, 'checkout', '-q', sha)
    }
    const script = runOf(workflow('release.yml'), 'Tag distant égal au commit vérifié')
    if (script === null) return 'pas absent'
    const r = spawnSync('bash', ['-e', '-c', script], {
      cwd: work,
      env: { PATH: process.env.PATH, HOME: dir, TAG: 'v1.0.0', GITHUB_SHA: sha },
      encoding: 'utf8',
    })
    return r.status
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
