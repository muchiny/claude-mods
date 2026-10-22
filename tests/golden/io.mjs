// Lecture et écriture des goldens : le seul endroit des tests qui touche au disque et à l'environnement.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))

export const updating = () => process.env.GOLDEN_UPDATE === '1'
export const goldenPath = (name) => join(dir, `${name}.txt`)
export const readGolden = (name) => (existsSync(goldenPath(name)) ? readFileSync(goldenPath(name), 'utf8') : null)
export const writeGolden = (name, text) => writeFileSync(goldenPath(name), text)
