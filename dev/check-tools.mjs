// Vérifie la forme de mode-clair/hooks/tools.generated.ts (généré hors dépôt par
// `bridge-mcp --json list-tools`, voir le README) : chaque entrée porte les trois booléens
// hostless, multi, session, le booléen codeWithoutError et une nature ∈ {lecture, peut-modifier}.
// Usage : node dev/check-tools.mjs [chemin]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DEFAULT = new URL('../mode-clair/hooks/tools.generated.ts', import.meta.url)
const BOOLEANS = ['hostless', 'multi', 'session', 'codeWithoutError']
const NATURES = new Set(['lecture', 'peut-modifier'])

// Renvoie la liste des erreurs (vide si la table est conforme).
export function checkTools(source) {
  const start = source.indexOf('export const TOOLS')
  if (start === -1) return ['table TOOLS introuvable']
  const open = source.indexOf('= {', start)
  const close = source.indexOf('\n}', open)
  if (open === -1 || close === -1) return ['table TOOLS illisible']
  const errors = []
  let count = 0
  for (const raw of source.slice(open + 3, close).split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const m = /^([A-Za-z0-9_]+): \{(.*)\},?$/.exec(line)
    if (!m) {
      errors.push(`entrée illisible : ${line}`)
      continue
    }
    count++
    const [, name, body] = m
    for (const key of BOOLEANS) {
      if (!new RegExp(`\\b${key}: (true|false)\\b`).test(body)) errors.push(`${name} : ${key} manquant ou non booléen`)
    }
    const nature = /\bnature: '([^']*)'/.exec(body)
    if (!nature || !NATURES.has(nature[1])) errors.push(`${name} : nature absente ou hors {lecture, peut-modifier}`)
  }
  if (count === 0 && errors.length === 0) errors.push('table TOOLS vide')
  return errors
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = checkTools(readFileSync(process.argv[2] ?? DEFAULT, 'utf8'))
  for (const e of errors) console.error(`::error::tools.generated.ts : ${e}`)
  if (errors.length > 0) process.exit(1)
  console.log('tools.generated.ts : forme conforme')
}
