import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'

import { classify, parseMcp } from '../../hooks/bridge'
import { colorOf } from '../../hooks/colors'
import { EMPTY, finishCalls, startCalls } from '../../hooks/state'
import { TOOLS } from '../../hooks/tools.generated'
import { cardLines, cardText, fit, parseCard } from '../../hooks/view'
import { ENGINE_ROW, PLUGIN, world } from './world'

// Sortie de ssh_disk_usage, fixture des sources de bridge-mcp (src/mcp/tool_handlers/ssh_disk_usage.rs:344).
const DF = 'Filesystem Size Used Avail Use% Mounted\n/dev/sda1 10G 5G 5G 50% /\n'
// refs/bridge-facts.md §3.2 : par MCP, le texte d'une erreur est son Display, sans `Error: `.
const UNKNOWN_HOST = 'Unknown host: nohost'
// refs/bridge-facts.md §3.5.
const SSH_REFUSED = 'SSH connection failed to raspberry: Connection refused (os error 111)'

const ok = (text: string) => ({ result: { result: { content: [] }, text, isReadOnly: true as const } })
const failed = (text: string) => ({ result: { result: text, text, isError: true as const } })

async function runClair($: Engine, args = ''): Promise<string> {
  const ran = await $.command.run({
    command: 'clair',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  return ran.text ?? ''
}

/** Une ligne de sortie de commande, assez large pour que `fit` ne coupe rien. */
function mountCard($: Engine, text: string, command = 'clair') {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'CommandOutput',
    viewport: { columns: 200, rows: 40 },
    props: { command, args: '', text, isErrored: false },
  })
}

/** Le texte de chaque ligne de la carte, tel que le mod doit le dessiner. */
function cardRows(text: string): string[] {
  return parseCard(text).map((line) => line.map((piece) => piece.text).join(''))
}

describe('/clair : command.run et CommandOutput', () => {
  test('command.run rend la carte en texte, puis CommandOutput la dessine ligne à ligne', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    w.answers.set('toolu_2', failed(UNKNOWN_HOST))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_2', host: 'nohost' })
    const text = await runClair($)
    expect(text).toContain('raspberry')
    expect(text).toContain('nohost')
    const ui = await mountCard($, text)
    const drawn = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    expect(cardRows(text).length).toBeGreaterThan(0)
    for (const row of cardRows(text)) expect(drawn).toContain(row)
    expect(drawn).not.toContain(ENGINE_ROW)
    await ui.unmount()
  })

  test('une carte se redessine depuis son seul texte, même sans aucun état (session reprise, /clear)', async ($, on) => {
    const [parsed] = parseMcp('mcp__ssh-bridge__ssh_disk_usage', { host: 'raspberry' }, TOOLS)
    if (parsed === undefined) throw new Error('parseMcp ne reconnaît pas ssh_disk_usage')
    const outcome = classify(parsed, { isError: false, text: DF, interrupted: false, refusedByClaude: false }, TOOLS)
    const before = finishCalls(
      startCalls(EMPTY, 'toolu_old', undefined, [parsed], 1_000),
      'toolu_old',
      [outcome],
      1_000,
    )
    const text = cardText(cardLines(before, '', 1_000))
    const w = world(on)
    const ui = await mountCard($, text)
    const drawn = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    for (const row of cardRows(text)) expect(drawn).toContain(row)
    expect(drawn.some((t) => t.includes('raspberry'))).toBe(true)
    expect(w.state).toBeUndefined()
    expect(w.drawn).toHaveLength(0)
    await ui.unmount()
  })

  test('une ancienne carte reste telle qu’elle était quand l’état change', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    w.answers.set('toolu_2', failed(UNKNOWN_HOST))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    const old = await runClair($)
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_2', host: 'nohost' })
    const ui = await mountCard($, old)
    expect(await ui.find({ type: 'Text', text: /raspberry/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /nohost/ })).toBeUndefined()
    await ui.unmount()
  })

  test('/clair raspberry : le dernier appel de cette machine, avec son pipeline', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    w.answers.set('toolu_2', failed(UNKNOWN_HOST))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_2', host: 'nohost' })
    const text = await runClair($, 'raspberry')
    expect(text).toContain('dernier appel sur raspberry')
    expect(text).not.toContain('dernier appel sur nohost')
  })

  test('rien dans la session : une seule ligne, « rien depuis le début de la session »', async ($, on) => {
    world(on)
    const text = await runClair($)
    expect(cardRows(text)).toHaveLength(1)
    const ui = await mountCard($, text)
    expect(await ui.find({ type: 'Text', text: /rien depuis le début de la session/ })).toBeDefined()
    await ui.unmount()
  })

  // Spec §10 : le moteur passe à CommandOutput le texte précédé du nom du plugin (`mode-clair-sonde: …` relevé dans
  // props.text par la sonde de la tâche 2) ; la carte dessinée ne le montre pas, la machine garde la couleur de la bande.
  test('le texte réel de la rangée porte le nom du plugin : la carte ne le montre pas, la machine garde sa couleur', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', ok(DF))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    const text = await runClair($)
    const ui = await mountCard($, `mode-clair: ${text}`)
    const texts = await ui.findAll({ type: 'Text' })
    for (const row of cardRows(text)) expect(texts.map((t) => t.text)).toContain(row)
    expect(texts.filter((t) => t.text.includes('mode-clair'))).toHaveLength(0)
    expect(texts.filter((t) => t.text === 'raspberry').map((t) => t.props.color)).toContain(colorOf(0))
    await ui.unmount()
  })

  // Spec §4.4 : la carte est dessinée à la largeur de sa rangée (viewport), coupée par fit (spec §4.1, critère 13).
  test('la carte suit la largeur de sa rangée : à 30 colonnes, chaque ligne est coupée par fit', async ($, on) => {
    const w = world(on)
    w.answers.set('toolu_1', failed(SSH_REFUSED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry' })
    const text = await runClair($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      viewport: { columns: 30, rows: 40 },
      props: { command: 'clair', args: '', text, isErrored: false },
    })
    const drawn = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    const fitted = parseCard(text).map((line) =>
      fit(line, 30, true)
        .map((piece) => piece.text)
        .join(''),
    )
    expect(fitted.filter((row) => row.endsWith('…')).length).toBeGreaterThan(0)
    for (const row of fitted) expect(drawn).toContain(row)
    for (const t of drawn) expect([...t].length).toBeLessThanOrEqual(30)
    await ui.unmount()
  })

  // D4, R93 : un nom de machine plus long que la ligne est coupé sur la carte aussi, l'état reste entier.
  test('à 40 colonnes, le nom d’une machine de 60 caractères est coupé et l’état de la rangée reste entier', async ($, on) => {
    const w = world(on)
    const host = `machine-${'x'.repeat(52)}`
    w.answers.set('toolu_1', failed(SSH_REFUSED))
    await $.tool.call({ tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host })
    const text = await runClair($)
    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'CommandOutput',
      viewport: { columns: 40, rows: 40 },
      props: { command: 'clair', args: '', text, isErrored: false },
    })
    const drawn = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
    const row = drawn.find((t) => t.startsWith('machine-') && t.includes('… · 0 appel · '))
    expect(row).toMatch(/^machine-x+… · 0 appel · ✗ injoignable$/)
    for (const t of drawn) expect([...t].length).toBeLessThanOrEqual(40)
    await ui.unmount()
  })

  test('la sortie d’une autre commande reste celle du moteur', async ($, on) => {
    world(on)
    const ui = await mountCard($, 'Usage: /help', 'help')
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
    expect(await ui.find({ type: 'Text', text: ENGINE_ROW })).toBeDefined()
    await ui.unmount()
  })
})
