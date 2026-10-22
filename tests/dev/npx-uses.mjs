// Les `npx` des workflows, scripts dev/ et package.json : npx télécharge et exécute un paquet absent (homonyme
// compris) ; après `npm ci`, on appelle node_modules/.bin/<outil> ou `npm run`.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

export function npxUses() {
  const files = ['package.json', 'stryker.config.json', 'stryker.pure.json', 'README.md']
  for (const dir of ['.github/workflows', 'dev']) {
    for (const f of readdirSync(join(REPO, dir), { recursive: true }))
      if (/\.(ya?ml|mjs|ts|sh|json)$/.test(String(f))) files.push(join(dir, String(f)))
  }
  const found = []
  for (const f of files) {
    if (!existsSync(join(REPO, f))) continue
    readFileSync(join(REPO, f), 'utf8')
      .split('\n')
      .forEach((line, i) => {
        // les commentaires qui expliquent l'interdiction ne comptent pas
        if (/\bnpx\b(?!\s+--no-install)/.test(line) && !/^\s*(\/\/|#)/.test(line)) found.push(`${f}:${i + 1}`)
      })
  }
  return found
}
