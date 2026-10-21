// Planchers de mutation par module : échoue si un score passe sous son plancher,
// relève le plancher (avec --write) quand un module le dépasse.
// Usage : node dev/mutation-floors.mjs reports/mutation-pure/mutation.json [--write]
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const FLOORS = new URL('./mutation-floors.json', import.meta.url)
const DETECTED = new Set(['Killed', 'Timeout'])
const UNDETECTED = new Set(['Survived', 'NoCoverage'])

const floorTo1 = (n) => Math.floor(n * 10 + 1e-9) / 10

// Score par module (en %, une décimale vers le bas) à partir du rapport JSON de Stryker.
export function scores(report) {
  const out = {}
  for (const [path, file] of Object.entries(report.files)) {
    let detected = 0
    let undetected = 0
    for (const m of file.mutants) {
      if (DETECTED.has(m.status)) detected++
      else if (UNDETECTED.has(m.status)) undetected++
    }
    const total = detected + undetected
    out[basename(path)] = total === 0 ? 100 : floorTo1((detected / total) * 100)
  }
  return out
}

// Compare aux planchers : { below: [...], raised: { module: score } }.
export function compare(measured, floors) {
  const below = []
  const raised = {}
  for (const [mod, floor] of Object.entries(floors)) {
    const score = measured[mod]
    if (score === undefined) below.push(`${mod} : absent du rapport`)
    else if (score < floor) below.push(`${mod} : ${score} % < plancher ${floor} %`)
    else if (score > floor) raised[mod] = score
  }
  return { below, raised }
}

function main(argv) {
  const report = argv.find((a) => !a.startsWith('--'))
  if (!report) {
    console.error('usage : node dev/mutation-floors.mjs <mutation.json> [--write]')
    return 2
  }
  const measured = scores(JSON.parse(readFileSync(report, 'utf8')))
  const floors = JSON.parse(readFileSync(FLOORS, 'utf8'))
  const { below, raised } = compare(measured, floors)
  for (const [mod, score] of Object.entries(measured))
    console.log(`${mod} : ${score} % (plancher ${floors[mod] ?? 'aucun'})`)
  if (below.length > 0) {
    for (const line of below) console.error(`::error::${line}`)
    return 1
  }
  if (Object.keys(raised).length > 0) {
    console.log(`planchers à relever : ${JSON.stringify(raised)}`)
    if (argv.includes('--write')) writeFileSync(FLOORS, `${JSON.stringify({ ...floors, ...raised }, null, 2)}\n`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)))
