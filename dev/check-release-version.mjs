// Vérifie qu'un tag de release `vX.Y.Z` correspond à la version de mode-clair/.claude-plugin/plugin.json.
// Usage : node dev/check-release-version.mjs <tag> [chemin du plugin.json]
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DEFAULT = new URL('../mode-clair/.claude-plugin/plugin.json', import.meta.url)

// Renvoie la liste des erreurs (vide si le tag et la version concordent).
export function checkReleaseVersion(pluginJson, tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return [`tag « ${tag ?? ''} » invalide : attendu vX.Y.Z`]
  let version
  try {
    version = JSON.parse(pluginJson).version
  } catch {
    return ['plugin.json illisible']
  }
  if (typeof version !== 'string' || version === '') return ['plugin.json : version absente']
  const attendue = tag.slice(1)
  if (version !== attendue) return [`plugin.json porte la version ${version}, le tag ${tag} demande ${attendue}`]
  return []
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = checkReleaseVersion(readFileSync(process.argv[3] ?? DEFAULT, 'utf8'), process.argv[2])
  for (const e of errors) console.error(`::error::release : ${e}`)
  if (errors.length > 0) process.exit(1)
  console.log(`release : le tag ${process.argv[2]} correspond à plugin.json`)
}
