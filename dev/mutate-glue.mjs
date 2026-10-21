// Mutation ciblée de la colle register.tsx, sans Stryker (son instrumentation enveloppe les
// noms d'événements de on() dans un ternaire et le moteur ne charge plus le module).
// Mutations textuelles : === ↔ !==, && ↔ ||, `return next(e)` sans l'appel, if (cond) → true/false,
// littéraux numériques ±1 ; jamais dans les chaînes, commentaires, regex, gabarits, texte JSX,
// ni dans les arguments d'un on( qui précèdent le gestionnaire (événement et filtre).
//
// Chaque mutant tourne sur une copie du mod dans /var/tmp (jamais /tmp, tmpfs en RAM), sous
// `timeout 180 claude plugin test` et un garde-fou mémoire qui tue le groupe de processus.
// Usage : node dev/mutate-glue.mjs [--sample N --seed S] [--only id,id] [--concurrency C]
//         [--out reports/mutation-glue/result.json] [--list]
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// --- Analyse : quels caractères sont du code ---------------------------------------------------

const ID = /[\w$]/
const REGEX_BEFORE = new Set([...'(,=:[!&|?{};+-*%<>~^'])
const JSX_BEFORE = new Set([...'(,=:[!&|?{;>'])
const OPERAND_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await'])

// code[i] vaut true si le caractère i est du code (hors chaîne, commentaire, regex, gabarit, texte JSX).
function codeMask(src) {
  const code = new Array(src.length).fill(false)

  // Dernier caractère significatif du code et dernier mot : distinguent regex/division, JSX/comparaison.
  let prev = ''
  let word = ''
  const operandStart = (set) => prev === '' || set.has(prev) || OPERAND_WORDS.has(word)

  function quoted(i, q) {
    let j = i + 1
    while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1
    return j + 1
  }

  function template(i) {
    let j = i + 1
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') j += 2
      else if (src[j] === '$' && src[j + 1] === '{') j = scanCode(j + 2, true) + 1
      else j++
    }
    code.fill(false, i, j + 1) // les ${…} d'un gabarit ne sont pas mutés non plus
    return j + 1
  }

  function regex(i) {
    let j = i + 1
    let inClass = false
    while (j < src.length && (inClass || src[j] !== '/') && src[j] !== '\n') {
      if (src[j] === '\\') j++
      else if (src[j] === '[') inClass = true
      else if (src[j] === ']') inClass = false
      j++
    }
    j++
    while (j < src.length && /[a-z]/.test(src[j])) j++
    return j
  }

  // Un élément JSX : seules les expressions {…} sont du code.
  function jsx(i) {
    let j = i + 1
    while (j < src.length && src[j] !== '>' && !(src[j] === '/' && src[j + 1] === '>')) {
      if (src[j] === '{') j = scanCode(j + 1, true) + 1
      else if (src[j] === '"' || src[j] === "'") j = quoted(j, src[j])
      else j++
    }
    if (src[j] === '/') return j + 2
    j++
    while (j < src.length) {
      if (src[j] === '{') j = scanCode(j + 1, true) + 1
      else if (src[j] === '<' && src[j + 1] === '/') {
        while (j < src.length && src[j] !== '>') j++
        return j + 1
      } else if (src[j] === '<') j = jsx(j)
      else j++
    }
    return j
  }

  // Parcourt du code depuis i ; avec untilBrace, s'arrête sur l'accolade fermante de même niveau.
  function scanCode(i, untilBrace) {
    let depth = 0
    let j = i
    while (j < src.length) {
      const c = src[j]
      const next = src[j + 1]
      if (c === '/' && next === '/') {
        while (j < src.length && src[j] !== '\n') j++
        continue
      }
      if (c === '/' && next === '*') {
        const end = src.indexOf('*/', j + 2)
        j = end === -1 ? src.length : end + 2
        continue
      }
      if (/\s/.test(c)) {
        j++
        continue
      }
      let end
      if (c === "'" || c === '"') end = quoted(j, c)
      else if (c === '`') end = template(j)
      else if (c === '/' && operandStart(REGEX_BEFORE)) end = regex(j)
      else if (c === '<' && /[A-Za-z>]/.test(next ?? '') && operandStart(JSX_BEFORE)) end = jsx(j)
      if (end !== undefined) {
        j = end
        prev = 'a'
        word = ''
        continue
      }
      if (c === '}' && untilBrace && depth === 0) {
        prev = '}'
        word = ''
        return j
      }
      if (c === '{') depth++
      else if (c === '}') depth--
      code[j] = true
      if (ID.test(c)) {
        let k = j
        while (k < src.length && ID.test(src[k])) code[k++] = true
        word = src.slice(j, k)
        prev = 'a'
        j = k
        continue
      }
      prev = c
      word = ''
      j++
    }
    return j
  }

  scanCode(0, false)
  return code
}

// Indice de la parenthèse fermante qui répond à celle de `open`, en ne comptant que le code.
function closing(code, src, open) {
  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (!code[j]) continue
    if ('([{'.includes(src[j])) depth++
    else if (')]}'.includes(src[j]) && --depth === 0) return j
  }
  return -1
}

// Intervalles interdits : dans on(a, b, gestionnaire), tout ce qui précède la dernière virgule.
function forbidden(code, src) {
  const ranges = []
  for (const m of src.matchAll(/(?<![\w$.])on\(/g)) {
    const open = m.index + 2
    if (!code[m.index] || !code[open]) continue
    const end = closing(code, src, open)
    let depth = 0
    let lastComma = -1
    for (let j = open + 1; j < end; j++) {
      if (!code[j]) continue
      if ('([{'.includes(src[j])) depth++
      else if (')]}'.includes(src[j])) depth--
      else if (src[j] === ',' && depth === 0) lastComma = j
    }
    if (lastComma !== -1) ranges.push([open + 1, lastComma])
  }
  return ranges
}

// --- Mutants ---------------------------------------------------------------------------------

export function mutants(source) {
  const code = codeMask(source)
  const banned = forbidden(code, source)
  const allCode = (from, to) => {
    for (let j = from; j < to; j++) if (!code[j]) return false
    return true
  }
  const allowed = (from, to) => banned.every(([a, b]) => to <= a || from >= b)
  const found = []
  const add = (offset, from, to, kind) => {
    if (allowed(offset, offset + from.length)) found.push({ offset, from, to, kind })
  }

  for (const m of source.matchAll(/(?<![\w$.])if\s*\(/g)) {
    const open = m.index + m[0].length - 1
    if (!code[m.index] || !code[open]) continue
    const end = closing(code, source, open)
    if (end === -1) continue
    const cond = source.slice(open + 1, end)
    add(open + 1, cond, 'true', 'if-true')
    add(open + 1, cond, 'false', 'if-false')
  }
  for (const m of source.matchAll(/===|!==/g))
    if (allCode(m.index, m.index + 3)) add(m.index, m[0], m[0] === '===' ? '!==' : '===', 'op')
  for (const m of source.matchAll(/&&|\|\|/g))
    if (allCode(m.index, m.index + 2) && source[m.index + 2] !== '=')
      add(m.index, m[0], m[0] === '&&' ? '||' : '&&', 'op')
  for (const m of source.matchAll(/(?<![\w$.])return\s+(next\(e\))/g)) {
    const at = m.index + m[0].length - m[1].length
    if (allCode(m.index, m.index + 6) && allCode(at, at + m[1].length)) add(at, m[1], '{ ...e }', 'next')
  }
  for (const m of source.matchAll(/(?<![\w$.])\d[\d_]*(?:\.\d+)?(?![\w$])/g)) {
    if (!allCode(m.index, m.index + m[0].length)) continue
    const value = Number(m[0].replaceAll('_', ''))
    const sign = source.slice(0, m.index).trimEnd().at(-1)
    const down = value - 1 < 0 && (sign === '-' || sign === '+') ? `(${value - 1})` : String(value - 1)
    add(m.index, m[0], String(value + 1), 'plus')
    add(m.index, m[0], down, 'minus')
  }

  const lineOf = (offset) => source.slice(0, offset).split('\n').length
  const colOf = (offset) => offset - source.lastIndexOf('\n', offset - 1)
  const order = ['if-true', 'if-false', 'op', 'next', 'plus', 'minus']
  return found
    .sort((a, b) => a.offset - b.offset || order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(({ offset, from, to, kind }) => ({
      id: `L${lineOf(offset)}C${colOf(offset)}-${kind}`,
      line: lineOf(offset),
      from,
      to,
      offset,
    }))
}

export function apply(source, m) {
  return source.slice(0, m.offset) + m.to + source.slice(m.offset + m.from.length)
}

// Les lignes touchées, avant (-) et après (+).
export function diffOf(source, m) {
  const start = source.lastIndexOf('\n', m.offset - 1) + 1
  const endAt = source.indexOf('\n', m.offset + m.from.length)
  const end = endAt === -1 ? source.length : endAt
  const before = source.slice(start, end)
  const after = before.slice(0, m.offset - start) + m.to + before.slice(m.offset - start + m.from.length)
  const prefix = (sign, text) =>
    text
      .split('\n')
      .map((l) => `${sign} ${l}`)
      .join('\n')
  return `${prefix('-', before)}\n${prefix('+', after)}`
}

// Tirage sans remise à graine fixe (mulberry32), rendu dans l'ordre d'origine.
export function draw(items, n, seed) {
  let t = seed >>> 0
  const random = () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  const idx = items.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const k = Math.floor(random() * (i + 1))
    ;[idx[i], idx[k]] = [idx[k], idx[i]]
  }
  return idx
    .slice(0, Math.min(n, idx.length))
    .sort((a, b) => a - b)
    .map((i) => items[i])
}

// --- Exécution -------------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MOD = join(ROOT, 'mode-clair')
const GLUE = join(MOD, 'hooks', 'register.tsx')
const WORK = '/var/tmp'
// 8 Go par défaut (règle WSL) ; GLUE_MIN_AVAILABLE_MB l'ajuste pour un runner de CI.
const MIN_AVAILABLE_MB = Number(process.env.GLUE_MIN_AVAILABLE_MB ?? 8192)
const RSS_LIMIT_KB = 1.5 * 1024 * 1024
const TIMEOUT_S = 180

/** La source de register.tsx du dépôt. */
export function readGlue() {
  return readFileSync(GLUE, 'utf8')
}

/**
 * Mutants équivalents relus (identifiant → { empreinte, raison }) : ni lancés ni comptés survivants.
 */
export function readEquivalents() {
  return JSON.parse(readFileSync(join(ROOT, 'dev', 'mutate-glue-equivalents.json'), 'utf8'))
}

/** Empreinte d'un mutant : from, to et le texte des lignes touchées (16 chiffres hexadécimaux). */
export function fingerprint(source, m) {
  const start = source.lastIndexOf('\n', m.offset - 1) + 1
  const endAt = source.indexOf('\n', m.offset + m.from.length)
  const lines = source.slice(start, endAt === -1 ? source.length : endAt)
  return createHash('sha256').update(`${m.from}\0${m.to}\0${lines}`).digest('hex').slice(0, 16)
}

/**
 * Les entrées de la liste qui ne décrivent plus un mutant de `source` : identifiant absent (ligne
 * ou colonne déplacée) ou empreinte différente (ligne réécrite). Une telle liste est à relire.
 */
export function staleEquivalents(source, list) {
  const byId = new Map(mutants(source).map((m) => [m.id, m]))
  return Object.entries(list)
    .filter(([id, entry]) => {
      const m = byId.get(id)
      return m === undefined || entry.fingerprint !== fingerprint(source, m)
    })
    .map(([id]) => id)
}

/**
 * Verdict d'une exécution de `claude plugin test` : `killed` seulement si des tests ont échoué ;
 * `survived` si tous ont passé ; sinon `error` (délai, mémoire, lancement impossible, module ou
 * suite qui plante avant le bilan) : on ne sait pas, ce n'est pas un mutant tué.
 */
export function verdict(run) {
  if (run.reason === 'spawn') return { kind: 'error', cause: 'spawn-error' }
  if (run.reason === 'rss') return { kind: 'error', cause: 'rss-killed' }
  if (run.reason === 'timeout' || run.status === 124) return { kind: 'error', cause: 'timeout' }
  const passed = /^\s*(\d+) pass\s*$/m.exec(run.output)
  const failed = /^\s*(\d+) fail\s*$/m.exec(run.output)
  if (passed === null || failed === null) return { kind: 'error', cause: 'load-error' }
  if (Number(failed[1]) > 0) return run.status === 0 ? { kind: 'error', cause: 'load-error' } : { kind: 'killed' }
  if (run.status !== 0) return { kind: 'error', cause: 'load-error' }
  return Number(passed[1]) > 0 ? { kind: 'survived' } : { kind: 'error', cause: 'load-error' }
}

function availableMb() {
  const line = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+) kB/m)
  return line ? Number(line[1]) / 1024 : 0
}

// Mémoire (kB) de tous les processus du groupe `pgid` : la PSS (/proc/<pid>/smaps_rollup), qui
// partage entre processus les pages communes ; la somme des VmRSS les compterait plusieurs fois
// (claude et ses enfants bun partagent l'essentiel de leur code : 1,0 à 1,5 Go en VmRSS cumulé pour
// une exécution saine, mesuré). VmRSS en repli si smaps_rollup est illisible.
function memKb(pid) {
  try {
    const pss = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+) kB/m)
    if (pss) return Number(pss[1])
  } catch {
    // repli sur VmRSS
  }
  const rss = readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+) kB/m)
  return rss ? Number(rss[1]) : 0
}

function groupRssKb(pgid) {
  let total = 0
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[2]) !== pgid) continue
      total += memKb(pid)
    } catch {
      // processus terminé entre la liste et la lecture
    }
  }
  return total
}

// Lance `timeout 180 claude plugin test <copie>` dans son propre groupe, sous garde-fou mémoire.
export function runTests(dir) {
  return new Promise((done) => {
    const started = Date.now()
    let settled = false
    const resolve = (r) => {
      if (!settled) done(r)
      settled = true
    }
    const child = spawn('timeout', [String(TIMEOUT_S), 'claude', 'plugin', 'test', dir], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const keep = (chunk) => {
      output = (output + chunk).slice(-20000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    let reason = null
    const kill = (why) => {
      reason ??= why
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // groupe déjà terminé
      }
    }
    let peakKb = 0
    const watchdog = setInterval(() => {
      const kb = groupRssKb(child.pid)
      peakKb = Math.max(peakKb, kb)
      if (kb > RSS_LIMIT_KB) kill('rss')
    }, 2000)
    const hard = setTimeout(() => kill('timeout'), (TIMEOUT_S + 20) * 1000)
    child.on('error', (err) => {
      clearInterval(watchdog)
      clearTimeout(hard)
      resolve({ status: null, reason: 'spawn', ms: Date.now() - started, output: String(err), peakKb })
    })
    child.on('close', (status) => {
      clearInterval(watchdog)
      clearTimeout(hard)
      kill(null) // les petits-enfants éventuels du groupe
      if (reason === null && status === 124) reason = 'timeout'
      resolve({ status, reason, ms: Date.now() - started, output, peakKb })
    })
  })
}

async function runMutant(source, m) {
  const dir = mkdtempSync(join(WORK, 'glue-mutant-'))
  try {
    cpSync(MOD, join(dir, 'mode-clair'), { recursive: true })
    const text = m === null ? source : apply(source, m)
    writeFileSync(join(dir, 'mode-clair', 'hooks', 'register.tsx'), text)
    return await runTests(join(dir, 'mode-clair'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function option(argv, name) {
  const i = argv.indexOf(name)
  return i === -1 ? undefined : argv[i + 1]
}

async function main(argv) {
  const source = readGlue()
  const every = mutants(source)
  const only = option(argv, '--only')?.split(',')
  const sample = option(argv, '--sample')
  const seed = Number(option(argv, '--seed') ?? 1)
  const concurrency = Math.max(1, Number(option(argv, '--concurrency') ?? 1))
  const out = option(argv, '--out') ?? join(ROOT, 'reports', 'mutation-glue', 'result.json')
  const equivalents = readEquivalents()
  const stale = staleEquivalents(source, equivalents)
  if (stale.length > 0) {
    console.error(`::error::équivalents périmés (ligne déplacée ou réécrite), liste à relire : ${stale.join(', ')}`)
    return 2
  }
  const candidates = every.filter((m) => !(m.id in equivalents))
  let chosen = candidates
  if (only) chosen = every.filter((m) => only.includes(m.id))
  else if (sample !== undefined) chosen = draw(candidates, Number(sample), seed)
  if (argv.includes('--list')) {
    for (const m of chosen) console.log(`${m.id}\t${JSON.stringify(m.from)} → ${JSON.stringify(m.to)}`)
    console.log(`${chosen.length} / ${every.length} mutants`)
    return 0
  }

  const preflight = () => {
    const mb = availableMb()
    if (mb < MIN_AVAILABLE_MB) throw new Error(`mémoire disponible ${Math.round(mb)} Mo < ${MIN_AVAILABLE_MB} Mo`)
  }
  preflight()
  // Témoin : la copie non mutée doit passer, tests réellement lancés, avant tout mutant.
  const baseline = await runMutant(source, null)
  const reference = verdict(baseline)
  if (reference.kind !== 'survived') {
    console.error(
      `::error::la colle d'origine ne passe pas ses tests (${reference.cause ?? 'tests'})\n${baseline.output}`,
    )
    return 2
  }
  console.log(`référence : ${baseline.ms} ms ; ${chosen.length} / ${every.length} mutants`)

  const killed = []
  const survived = []
  const errors = []
  const queue = [...chosen]
  let done = 0
  const worker = async () => {
    for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
      preflight()
      const r = await runMutant(source, m)
      done++
      const base = { id: m.id, line: m.line, from: m.from, to: m.to, ms: r.ms }
      const v = verdict(r)
      if (v.kind === 'survived') survived.push({ ...base, diff: diffOf(source, m) })
      else if (v.kind === 'killed') killed.push(base)
      else errors.push({ ...base, cause: v.cause, peakKb: r.peakKb, output: r.output.slice(-2000) })
      const label = v.kind === 'survived' ? 'SURVIT' : v.kind === 'killed' ? 'tué' : `ERREUR (${v.cause})`
      console.log(`[${done}/${chosen.length}] ${m.id} ${label} ${r.ms} ms, ${Math.round(r.peakKb / 1024)} Mo`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  const byId = (a, b) =>
    every.indexOf(every.find((m) => m.id === a.id)) - every.indexOf(every.find((m) => m.id === b.id))
  const report = {
    file: 'mode-clair/hooks/register.tsx',
    total: every.length,
    ran: chosen.length,
    seed: sample === undefined ? null : seed,
    baselineMs: baseline.ms,
    equivalent: every
      .filter((m) => m.id in equivalents)
      .map((m) => ({ id: m.id, line: m.line, from: m.from, to: m.to, reason: equivalents[m.id].reason })),
    killed: killed.sort(byId),
    survived: survived.sort(byId),
    error: errors.sort(byId),
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `tués ${killed.length}, survivants ${survived.length}, erreurs ${errors.length}, équivalents écartés ${report.equivalent.length} → ${out}`,
  )
  for (const s of report.survived) console.log(`::warning::survivant ${s.id}\n${s.diff}`)
  // Tolérance zéro : une erreur est un verdict inconnu (la passe locale complète n'en a aucune).
  for (const e of report.error) console.log(`::error::mutant ${e.id} sans verdict (${e.cause})`)
  return survived.length === 0 && errors.length === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::${err.message}`)
      process.exit(3)
    },
  )
