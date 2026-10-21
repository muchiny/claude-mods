import { describe, expect, test } from 'claude-code/testing'

import type { ParsedCall } from '../../hooks/bridge'
import { isBridgeServer, parseCli, parseMcp, serverOf, splitShell, usefulLines } from '../../hooks/bridge'
import { TOOLS } from '../../hooks/tools.generated'

/** Un appel CLI attendu : ssh_disk_usage sur raspberry, sauf ce que `patch` change. */
function cli(patch: Partial<ParsedCall> = {}): ParsedCall {
  return {
    via: 'cli',
    tool: 'ssh_disk_usage',
    host: 'raspberry',
    nature: 'lecture',
    accordByOption: false,
    ownsExit: true,
    inLoop: false,
    ...patch,
  }
}

const parse = (line: string): ParsedCall[] => parseCli(line, TOOLS)

describe('splitShell : une ligne Bash découpée en commandes simples', () => {
  test('coupe sur && || ; | et le retour à la ligne, et garde l’opérateur qui suit', () => {
    expect(splitShell('a 1 && b 2 || c ; d | e\nf')).toEqual([
      { words: ['a', '1'], op: '&&' },
      { words: ['b', '2'], op: '||' },
      { words: ['c'], op: ';' },
      { words: ['d'], op: '|' },
      { words: ['e'], op: '\n' },
      { words: ['f'], op: '' },
    ])
  })

  test('& seul met en arrière-plan, |& est un tube', () => {
    expect(splitShell('a & b |& c')).toEqual([
      { words: ['a'], op: '&' },
      { words: ['b'], op: '|' },
      { words: ['c'], op: '' },
    ])
  })

  test('les opérateurs entre guillemets simples ou doubles ne coupent pas (point de relecture 2)', () => {
    expect(splitShell(`bridge-mcp exec raspberry 'cd /tmp && ls | wc -l; echo "x"' && echo "a; b || c"`)).toEqual([
      { words: ['bridge-mcp', 'exec', 'raspberry', 'cd /tmp && ls | wc -l; echo "x"'], op: '&&' },
      { words: ['echo', 'a; b || c'], op: '' },
    ])
  })

  test('échappements : antislash hors guillemets, dans les guillemets doubles, suite de ligne', () => {
    expect(splitShell(String.raw`echo a\;b "c\"d" 'e\f' "g\h"`)).toEqual([
      { words: ['echo', 'a;b', 'c"d', 'e\\f', 'g\\h'], op: '' },
    ])
    expect(splitShell('bridge-mcp tool ssh_disk_usage \\\n  host=raspberry')).toEqual([
      { words: ['bridge-mcp', 'tool', 'ssh_disk_usage', 'host=raspberry'], op: '' },
    ])
    expect(splitShell('echo "a\\\nb"')).toEqual([{ words: ['echo', 'ab'], op: '' }])
    expect(splitShell('echo ab\\\ncd')).toEqual([{ words: ['echo', 'abcd'], op: '' }])
  })

  test('le corps d’un heredoc n’est ni découpé ni lu comme des commandes (point de relecture 2)', () => {
    const line =
      "cat > /tmp/notes << 'EOF'\na && b; c | d\nbridge-mcp tool ssh_exec host=web command=x\nEOF\nbridge-mcp tool ssh_disk_usage host=raspberry"
    expect(splitShell(line)).toEqual([
      { words: ['cat'], op: '\n' },
      { words: ['bridge-mcp', 'tool', 'ssh_disk_usage', 'host=raspberry'], op: '' },
    ])
  })

  test('heredoc <<- dont le délimiteur est indenté de tabulations, suivi d’un tube', () => {
    expect(splitShell('cat <<-"FIN" | wc -l\n\tx && y\n\tFIN\nbridge-mcp status')).toEqual([
      { words: ['cat'], op: '|' },
      { words: ['wc', '-l'], op: '\n' },
      { words: ['bridge-mcp', 'status'], op: '' },
    ])
  })

  test('heredoc dans une substitution entre guillemets, apostrophe et parenthèse comprises', () => {
    const line =
      "git commit -m \"$(cat <<'EOF'\nl'outil && la suite; fin | ok )\nEOF\n)\" && bridge-mcp --json tool ssh_disk_usage host=raspberry"
    expect(splitShell(line)).toEqual([
      { words: ['git', 'commit', '-m', "$(cat <<'EOF'\nl'outil && la suite; fin | ok )\nEOF\n)"], op: '&&' },
      { words: ['bridge-mcp', '--json', 'tool', 'ssh_disk_usage', 'host=raspberry'], op: '' },
    ])
  })

  test('$( ), ${ } et accents graves restent un seul mot, tels quels', () => {
    expect(splitShell('H=$(cat h; echo) bridge-mcp exec "$H" `echo a && b` ${A:-a b}')).toEqual([
      { words: ['H=$(cat h; echo)', 'bridge-mcp', 'exec', '$H', '`echo a && b`', '${A:-a b}'], op: '' },
    ])
    expect(splitShell('echo "a `b && c` d"')).toEqual([{ words: ['echo', 'a `b && c` d'], op: '' }])
    expect(splitShell('echo $(f (x) y) z')).toEqual([{ words: ['echo', '$(f (x) y)', 'z'], op: '' }])
    expect(splitShell('echo $(printf \'%s)\' "x)" \\) `echo )`) fin')).toEqual([
      { words: ['echo', '$(printf \'%s)\' "x)" \\) `echo )`)', 'fin'], op: '' },
    ])
  })

  test('les redirections et leur cible sont retirées des mots', () => {
    expect(
      splitShell(
        'bridge-mcp tool ssh_disk_usage host=raspberry 2>&1 >/tmp/out < /dev/null &>> log <<< mot >| f | head -5',
      ),
    ).toEqual([
      { words: ['bridge-mcp', 'tool', 'ssh_disk_usage', 'host=raspberry'], op: '|' },
      { words: ['head', '-5'], op: '' },
    ])
    expect(splitShell('echo 2 > /tmp/f; echo a2>/tmp/f')).toEqual([
      { words: ['echo', '2'], op: ';' },
      { words: ['echo', 'a2'], op: '' },
    ])
  })

  test('commentaires, lignes vides et parenthèses retirés ; # dans un mot reste', () => {
    expect(splitShell('# vérifier\n\n(cd /tmp && bridge-mcp status) # local\necho a#b')).toEqual([
      { words: ['cd', '/tmp'], op: '&&' },
      { words: ['bridge-mcp', 'status'], op: '\n' },
      { words: ['echo', 'a#b'], op: '' },
    ])
  })

  test('une chaîne vide entre guillemets est un mot ; une ligne vide ne donne rien', () => {
    expect(splitShell("printf '' x")).toEqual([{ words: ['printf', '', 'x'], op: '' }])
    expect(splitShell('  \n ; ')).toEqual([])
    expect(splitShell('echo a # fin')).toEqual([{ words: ['echo', 'a'], op: '' }])
  })

  test('guillemets ou substitution non fermés : la fin de la ligne fait partie du mot', () => {
    expect(splitShell("echo 'a && b")).toEqual([{ words: ['echo', 'a && b'], op: '' }])
    expect(splitShell('echo "a; b')).toEqual([{ words: ['echo', 'a; b'], op: '' }])
    expect(splitShell('echo $(a && b')).toEqual([{ words: ['echo', '$(a && b'], op: '' }])
    expect(splitShell('echo `a && b')).toEqual([{ words: ['echo', '`a && b'], op: '' }])
    expect(splitShell('cat <<EOF\nbridge-mcp tool ssh_disk_usage host=raspberry')).toEqual([
      { words: ['cat'], op: '\n' },
    ])
  })
})

describe('parseCli : appels au bridge par la CLI (refs/bridge-facts.md §1)', () => {
  test('tool et son alias t, arguments clé=valeur coupés au premier =', () => {
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry path=/')).toEqual([cli()])
    expect(parse('bridge-mcp t ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp tool ssh_exec host=raspberry command="a=b c"')).toEqual([
      cli({ tool: 'ssh_exec', nature: 'peut-modifier' }),
    ])
  })

  test('mot programme par son nom de base, après affectations, préfixes et mots-clés do/then', () => {
    for (const line of [
      './target/debug/bridge-mcp tool ssh_disk_usage host=raspberry',
      '~/.local/bin/bridge-mcp tool ssh_disk_usage host=raspberry',
      'RUST_LOG=off NO_COLOR=1 bridge-mcp tool ssh_disk_usage host=raspberry',
      'timeout 30 bridge-mcp tool ssh_disk_usage host=raspberry',
      'timeout -k 5 -s KILL 30s bridge-mcp tool ssh_disk_usage host=raspberry',
      'env -u HOME -C /tmp A=1 bridge-mcp tool ssh_disk_usage host=raspberry',
      'sudo -u root -g adm -E bridge-mcp tool ssh_disk_usage host=raspberry',
      'nice -n 10 bridge-mcp tool ssh_disk_usage host=raspberry',
    ]) {
      expect(parse(line)).toEqual([cli()])
    }
    expect(parse('if true; then bridge-mcp tool ssh_disk_usage host=raspberry; fi')).toEqual([cli({ ownsExit: false })])
  })

  test('une ligne sans bridge-mcp comme programme ne compte pas', () => {
    expect(parse('echo bridge-mcp tool ssh_disk_usage host=raspberry')).toEqual([])
    expect(parse('bridge-mcp-old tool ssh_disk_usage host=raspberry')).toEqual([])
    expect(parse('cargo test')).toEqual([])
    expect(parse('')).toEqual([])
  })

  test('options globales avant la sous-commande, leurs valeurs consommées, formes -cX et --opt=valeur (§1.1)', () => {
    expect(
      parse(
        'bridge-mcp -c /tmp/c.yaml --json --jq .x --columns a,b --limit 5 --output-format tsv tool ssh_disk_usage host=raspberry',
      ),
    ).toEqual([cli()])
    expect(
      parse(
        "bridge-mcp -c/tmp/c.yaml --config=/tmp/c.yaml --limit=5 --columns=a,b --jq='.x' --output-format=tsv t ssh_disk_usage host=raspberry",
      ),
    ).toEqual([cli()])
    expect(parse('bridge-mcp --config /tmp/c.yaml tool ssh_disk_usage host=raspberry')).toEqual([cli()])
  })

  test('options entre tool et le nom, et entre le nom et le premier argument (vérifié sur le binaire)', () => {
    expect(parse('bridge-mcp tool --json --limit 5 ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp tool ssh_disk_usage --limit 5 --json host=raspberry')).toEqual([cli()])
  })

  test('après le premier argument, ou après --, une option est un argument (amendement A5, §0.1.2)', () => {
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry --dry-run')).toEqual([cli()])
    expect(parse('bridge-mcp tool ssh_exec host=raspberry command=uptime --yes')).toEqual([
      cli({ tool: 'ssh_exec', nature: 'peut-modifier' }),
    ])
    expect(parse('bridge-mcp tool ssh_disk_usage -- --dry-run host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry --help')).toEqual([cli()])
    expect(parse('bridge-mcp t ssh_exec host=raspberry command=uptime --yes')).toEqual([
      cli({ tool: 'ssh_exec', nature: 'peut-modifier' }),
    ])
  })

  test('--yes avant le premier argument : accord donné par option', () => {
    for (const line of [
      'bridge-mcp --yes tool ssh_exec host=raspberry command=uptime',
      'bridge-mcp tool --yes ssh_exec host=raspberry command=uptime',
      'bridge-mcp tool ssh_exec --yes host=raspberry command=uptime',
      `bridge-mcp tool ssh_exec --json-args '{"host":"raspberry","command":"uptime"}' --yes`,
      `bridge-mcp t ssh_exec --json-args '{"host":"raspberry","command":"uptime"}' --yes`,
    ]) {
      expect(parse(line)).toEqual([cli({ tool: 'ssh_exec', nature: 'peut-modifier', accordByOption: true })])
    }
  })

  test('--json-args : le JSON donne l’hôte et les clé=valeur sont ignorées, comme dans le bridge (§1.2)', () => {
    expect(parse(`bridge-mcp tool ssh_disk_usage --json-args '{"host":"raspberry","path":"/"}'`)).toEqual([cli()])
    expect(parse(`bridge-mcp tool --json-args='{"host":"win2025"}' ssh_disk_usage host=raspberry`)).toEqual([
      cli({ host: 'win2025' }),
    ])
    expect(parse(`bridge-mcp tool ssh_disk_usage --json-args '{"host":'`)).toEqual([cli({ host: null })])
    expect(parse(`bridge-mcp tool ssh_disk_usage --json-args '["raspberry"]'`)).toEqual([cli({ host: null })])
    expect(parse('bridge-mcp tool ssh_disk_usage --json-args null')).toEqual([cli({ host: null })])
    expect(parse('bridge-mcp tool ssh_disk_usage --json-args')).toEqual([cli({ host: null })])
  })

  test('machine inconnue : variable, substitution, accent grave, valeur vide ou absente', () => {
    for (const line of [
      'bridge-mcp tool ssh_disk_usage host=$H',
      'bridge-mcp tool ssh_disk_usage host="${HOST}"',
      'bridge-mcp tool ssh_disk_usage host=$(cat h)',
      'bridge-mcp tool ssh_disk_usage host=web-$N',
      'bridge-mcp tool ssh_disk_usage host=`hostname`',
      'bridge-mcp tool ssh_disk_usage host=',
      'bridge-mcp tool ssh_disk_usage path=/',
    ]) {
      expect(parse(line)).toEqual([cli({ host: null })])
    }
  })

  test('exec <hôte> <commande> : options -t/-w et options globales n’importe où (§1.2)', () => {
    const exec = cli({ tool: 'exec', nature: 'peut-modifier' })
    expect(parse("bridge-mcp exec raspberry 'df -h'")).toEqual([exec])
    expect(parse('bridge-mcp exec -t 30 -w /tmp raspberry ls')).toEqual([exec])
    expect(parse('bridge-mcp exec --timeout 30 --working-dir /tmp raspberry ls')).toEqual([exec])
    expect(parse('bridge-mcp exec --timeout=30 --working-dir=/tmp raspberry ls')).toEqual([exec])
    expect(parse('bridge-mcp exec --json raspberry uptime')).toEqual([exec])
    expect(parse('bridge-mcp exec -- raspberry uptime')).toEqual([exec])
    expect(parse('bridge-mcp exec "$H" uptime')).toEqual([cli({ tool: 'exec', nature: 'peut-modifier', host: null })])
  })

  test('upload et download : l’hôte est le premier argument, leurs options sont sautées (§1.2)', () => {
    expect(
      parse(
        'bridge-mcp upload --mode append --chunk-size 4096 --verify-checksum --preserve-permissions -p raspberry ./a.sh /tmp/a.sh',
      ),
    ).toEqual([cli({ tool: 'upload', nature: 'peut-modifier' })])
    expect(parse('bridge-mcp download --mode overwrite --chunk-size 1024 raspberry /var/log/syslog ./syslog')).toEqual([
      cli({ tool: 'download', nature: 'peut-modifier' }),
    ])
  })

  test('--dry-run : rien ne tourne pour tool et exec, mais upload et download transfèrent (amendement A6)', () => {
    for (const line of [
      'bridge-mcp --dry-run tool ssh_disk_usage host=raspberry',
      'bridge-mcp tool --dry-run ssh_disk_usage host=raspberry',
      'bridge-mcp tool ssh_disk_usage --dry-run host=raspberry',
      'bridge-mcp --dry-run exec raspberry uptime',
      'bridge-mcp exec raspberry uptime --dry-run',
    ]) {
      expect(parse(line)).toEqual([])
    }
    expect(parse('bridge-mcp --dry-run upload raspberry ./a /tmp/a')).toEqual([
      cli({ tool: 'upload', nature: 'peut-modifier' }),
    ])
    expect(parse('bridge-mcp download --dry-run raspberry /etc/hostname ./h')).toEqual([
      cli({ tool: 'download', nature: 'peut-modifier' }),
    ])
  })

  test('sous-commandes locales, aide, version et serveur : jamais comptés (amendement A11)', () => {
    for (const line of [
      'bridge-mcp list-tools --json',
      'bridge-mcp --json list-tools -g core --groups-only',
      'bridge-mcp describe-tool ssh_exec',
      'bridge-mcp dt ssh_exec',
      'bridge-mcp validate',
      'bridge-mcp status',
      'bridge-mcp config-diff',
      'bridge-mcp history --limit 20 --host raspberry',
      'bridge-mcp completions zsh',
      'bridge-mcp daemon status',
      'bridge-mcp help',
      'bridge-mcp serve',
      'bridge-mcp serve-http --bind 127.0.0.1:8080',
      'bridge-mcp',
      'bridge-mcp -c /tmp/c.yaml',
      'bridge-mcp --help',
      'bridge-mcp -h',
      'bridge-mcp --version',
      'bridge-mcp -V',
      'bridge-mcp tool --help',
      'bridge-mcp tool ssh_exec --help',
      'bridge-mcp exec -h',
      'bridge-mcp tool',
    ]) {
      expect(parse(line)).toEqual([])
    }
  })

  test('outils sans machine et méta-outils : jamais comptés (critère 4)', () => {
    expect(parse('bridge-mcp tool ssh_status')).toEqual([])
    expect(parse('bridge-mcp tool ssh_history host=raspberry')).toEqual([])
    expect(parse('bridge-mcp t ssh_output_fetch output_id=abc')).toEqual([])
    expect(parse('bridge-mcp tool mcp_search_tools query=disk')).toEqual([])
  })

  test('outil absent de la table : nature inconnue, jamais devinée, même pour un nom hérité d’Object', () => {
    expect(parse('bridge-mcp tool ssh_nope host=raspberry')).toEqual([cli({ tool: 'ssh_nope', nature: 'inconnu' })])
    expect(parse('bridge-mcp tool constructor host=raspberry')).toEqual([
      cli({ tool: 'constructor', nature: 'inconnu' }),
    ])
    expect(parse('bridge-mcp --bogus tool ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp tool - host=raspberry')).toEqual([cli({ tool: '-', nature: 'inconnu' })])
  })

  test('multi : une ligne par hôte du tableau JSON, machine inconnue sinon (§7)', () => {
    const multi = { tool: 'ssh_exec_multi', nature: 'peut-modifier' as const }
    expect(parse(`bridge-mcp tool ssh_exec_multi hosts='["raspberry","win2025"]' command=uptime`)).toEqual([
      cli(multi),
      cli({ ...multi, host: 'win2025' }),
    ])
    expect(parse(`bridge-mcp tool ssh_exec_multi hosts='["raspberry","$H"]' command=uptime`)).toEqual([
      cli(multi),
      cli({ ...multi, host: null }),
    ])
    expect(parse('bridge-mcp tool ssh_exec_multi hosts=raspberry,win2025 command=uptime')).toEqual([
      cli({ ...multi, host: null }),
    ])
    expect(parse("bridge-mcp tool ssh_exec_multi hosts='[]' command=uptime")).toEqual([cli({ ...multi, host: null })])
    expect(parse(`bridge-mcp tool ssh_metrics_multi --json-args '{"hosts":["raspberry"]}'`)).toEqual([
      cli({ tool: 'ssh_metrics_multi' }),
    ])
  })

  test('session : l’identifiant de session est noté, la machine vient de l’état', () => {
    const session = { tool: 'ssh_session_exec', host: null, nature: 'peut-modifier' as const }
    expect(parse('bridge-mcp tool ssh_session_exec session_id=abc command=pwd')).toEqual([
      cli({ ...session, sessionId: 'abc' }),
    ])
    expect(parse('bridge-mcp tool ssh_session_exec command=pwd')).toEqual([cli(session)])
    expect(parse('bridge-mcp tool ssh_session_exec session_id=$S command=pwd')).toEqual([cli(session)])
  })

  test('le code de sortie n’appartient qu’à la dernière commande simple de la ligne', () => {
    expect(
      parse('bridge-mcp tool ssh_disk_usage host=raspberry && bridge-mcp tool ssh_disk_usage host=win2025'),
    ).toEqual([cli({ ownsExit: false }), cli({ host: 'win2025' })])
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry | head')).toEqual([cli({ ownsExit: false })])
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry; echo "code=$?"')).toEqual([cli({ ownsExit: false })])
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry &')).toEqual([cli({ ownsExit: false })])
    expect(parse('cd /tmp && bridge-mcp tool ssh_disk_usage host=raspberry 2>&1')).toEqual([cli()])
    expect(parse('echo x | bridge-mcp tool ssh_disk_usage host=raspberry\n')).toEqual([cli()])
  })

  test('boucles for, while, until : machine inconnue, la sortie n’est pas la sienne', () => {
    expect(parse('for h in raspberry win2025; do bridge-mcp exec $h uptime; done')).toEqual([
      cli({ tool: 'exec', nature: 'peut-modifier', host: null, ownsExit: false, inLoop: true }),
    ])
    expect(parse('while read h; do bridge-mcp tool ssh_disk_usage host=raspberry; done < hosts.txt')).toEqual([
      cli({ host: null, ownsExit: false, inLoop: true }),
    ])
    expect(
      parse(`until false; do bridge-mcp tool ssh_exec_multi hosts='["raspberry","win2025"]' command=x; done`),
    ).toEqual([cli({ tool: 'ssh_exec_multi', nature: 'peut-modifier', host: null, ownsExit: false, inLoop: true })])
    expect(parse('for h in a; do echo $h; done; bridge-mcp tool ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('done; for h in a; do bridge-mcp tool ssh_disk_usage host=raspberry; done')).toEqual([
      cli({ host: null, ownsExit: false, inLoop: true }),
    ])
  })

  test('opérateurs dans les guillemets et dans un heredoc : un seul appel (point de relecture 2)', () => {
    expect(
      parse(
        'bridge-mcp tool ssh_exec host=raspberry command="systemctl is-active k3s && echo ok; journalctl -u k3s | tail -5"',
      ),
    ).toEqual([cli({ tool: 'ssh_exec', nature: 'peut-modifier' })])
    const heredoc =
      "cat <<'EOF' > /tmp/x.sh\nbridge-mcp tool ssh_exec host=win2025 command=ls && echo fin\nEOF\nbridge-mcp upload raspberry /tmp/x.sh /tmp/x.sh"
    expect(parse(heredoc)).toEqual([cli({ tool: 'upload', nature: 'peut-modifier' })])
  })
})

/** Un appel MCP attendu, même base. */
function mcp(patch: Partial<ParsedCall> = {}): ParsedCall {
  return cli({ via: 'mcp', ...patch })
}

describe('parseMcp : appels MCP au serveur du bridge', () => {
  test('serverOf : le segment entre mcp__ et le __ suivant, préfixe plugin_<plugin>_ retiré', () => {
    expect(serverOf('mcp__ssh-bridge__ssh_exec')).toBe('ssh-bridge')
    expect(serverOf('mcp__plugin_x_ssh-bridge__y')).toBe('ssh-bridge')
    expect(serverOf('mcp__plugin_bridge-mcp_bridge-mcp__ssh_exec')).toBe('bridge-mcp')
    expect(serverOf('mcp__plugin_tools_my_server__x')).toBe('my_server')
    expect(serverOf('mcp__github__get_me')).toBe('github')
    expect(serverOf('Bash')).toBeNull()
  })

  test('isBridgeServer : liste connue, nom du plugin compris, jamais une sous-chaîne', () => {
    for (const server of [
      'ssh-bridge',
      'bridge-mcp',
      'mcp-ssh-bridge',
      'plugin_x_ssh-bridge',
      'plugin_bridge-mcp_bridge',
    ]) {
      expect(isBridgeServer(server)).toBe(true)
    }
    for (const server of [
      'cc-plugin-bridge-health',
      'bridge',
      'ssh-bridge2',
      'github',
      'plugin_cc-bridge-health_server',
    ]) {
      expect(isBridgeServer(server)).toBe(false)
    }
  })

  test('mode direct : l’hôte est input.host, la nature vient de la table', () => {
    const input = { tool: 'mcp__ssh-bridge__ssh_disk_usage', tool_use_id: 'toolu_1', host: 'raspberry', path: '/' }
    expect(parseMcp('mcp__ssh-bridge__ssh_disk_usage', input, TOOLS)).toEqual([mcp()])
    expect(parseMcp('mcp__plugin_bridge-mcp_bridge__ssh_k8s_get', { host: 'pi-k3s' }, TOOLS)).toEqual([
      mcp({ tool: 'ssh_k8s_get', host: 'pi-k3s' }),
    ])
    expect(parseMcp('mcp__ssh-bridge__ssh_exec', { host: 'raspberry', command: 'uptime' }, TOOLS)).toEqual([
      mcp({ tool: 'ssh_exec', nature: 'peut-modifier' }),
    ])
  })

  test('mode progressif : mcp_call_tool -> arguments.name (espaces retirés) et arguments.arguments.host', () => {
    const call = 'mcp__ssh-bridge__mcp_call_tool'
    expect(parseMcp(call, { name: ' ssh_disk_usage ', arguments: { host: 'raspberry' } }, TOOLS)).toEqual([mcp()])
    expect(parseMcp(call, { name: 'ssh_disk_usage', arguments: '{"host":"raspberry"}' }, TOOLS)).toEqual([
      mcp({ host: null }),
    ])
    expect(parseMcp(call, { name: 'ssh_disk_usage' }, TOOLS)).toEqual([mcp({ host: null })])
    expect(parseMcp(call, { arguments: { host: 'raspberry' } }, TOOLS)).toEqual([])
    expect(parseMcp(call, { name: 42 }, TOOLS)).toEqual([])
    expect(parseMcp(call, undefined, TOOLS)).toEqual([])
    expect(parseMcp('mcp__ssh-bridge__ssh_disk_usage', null, TOOLS)).toEqual([mcp({ host: null })])
  })

  test('méta-outils et outils sans machine : rien à suivre (§6.4, critère 4)', () => {
    for (const meta of ['mcp_list_tool_groups', 'mcp_search_tools', 'mcp_describe_tool']) {
      expect(parseMcp(`mcp__ssh-bridge__${meta}`, {}, TOOLS)).toEqual([])
      expect(parseMcp('mcp__ssh-bridge__mcp_call_tool', { name: meta, arguments: {} }, TOOLS)).toEqual([])
    }
    expect(
      parseMcp(
        'mcp__ssh-bridge__mcp_call_tool',
        { name: 'mcp_call_tool', arguments: { name: 'ssh_disk_usage' } },
        TOOLS,
      ),
    ).toEqual([])
    expect(parseMcp('mcp__ssh-bridge__ssh_status', {}, TOOLS)).toEqual([])
    expect(parseMcp('mcp__ssh-bridge__mcp_call_tool', { name: 'ssh_status', arguments: {} }, TOOLS)).toEqual([])
    expect(parseMcp('mcp__ssh-bridge__ssh_history', { host: 'raspberry' }, TOOLS)).toEqual([])
  })

  test('un autre serveur ou un outil qui n’est pas MCP : rien', () => {
    expect(parseMcp('mcp__cc-plugin-bridge-health__check', { host: 'raspberry' }, TOOLS)).toEqual([])
    expect(parseMcp('mcp__github__get_me', {}, TOOLS)).toEqual([])
    expect(parseMcp('Bash', { command: 'bridge-mcp status' }, TOOLS)).toEqual([])
  })

  test('multi : une ligne par hôte ; une chaîne n’est pas un tableau d’hôtes', () => {
    const multi = { tool: 'ssh_exec_multi', nature: 'peut-modifier' as const }
    expect(
      parseMcp('mcp__ssh-bridge__ssh_exec_multi', { hosts: ['raspberry', 'win2025'], command: 'uptime' }, TOOLS),
    ).toEqual([mcp(multi), mcp({ ...multi, host: 'win2025' })])
    expect(
      parseMcp('mcp__ssh-bridge__ssh_exec_multi', { hosts: 'raspberry,win2025', command: 'uptime' }, TOOLS),
    ).toEqual([mcp({ ...multi, host: null })])
    expect(
      parseMcp(
        'mcp__ssh-bridge__mcp_call_tool',
        { name: 'ssh_metrics_multi', arguments: { hosts: ['raspberry'] } },
        TOOLS,
      ),
    ).toEqual([mcp({ tool: 'ssh_metrics_multi' })])
  })

  test('session et outil inconnu', () => {
    expect(parseMcp('mcp__ssh-bridge__ssh_session_exec', { session_id: 's-1', command: 'pwd' }, TOOLS)).toEqual([
      mcp({ tool: 'ssh_session_exec', host: null, nature: 'peut-modifier', sessionId: 's-1' }),
    ])
    expect(parseMcp('mcp__ssh-bridge__ssh_nope', { host: 'raspberry' }, TOOLS)).toEqual([
      mcp({ tool: 'ssh_nope', nature: 'inconnu' }),
    ])
    expect(parseMcp('mcp__ssh-bridge__toString', { host: 'raspberry' }, TOOLS)).toEqual([
      mcp({ tool: 'toString', nature: 'inconnu' }),
    ])
  })
})

describe('splitShell : formes limites du découpage', () => {
  const words = (line: string): string[] => splitShell(line).flatMap((seg) => seg.words)

  test('la tabulation et le retour chariot séparent les mots comme l’espace', () => {
    expect(splitShell('a\tb\rc')).toEqual([{ words: ['a', 'b', 'c'], op: '' }])
  })

  test('accent grave : un accent grave échappé ne ferme pas la substitution', () => {
    expect(words('echo `echo \\` x` y')).toEqual(['echo', '`echo \\` x`', 'y'])
    expect(words('echo `echo x')).toEqual(['echo', '`echo x'])
  })

  test('${ } : le contenu, espaces compris, reste dans le mot ; sans } il va jusqu’à la fin', () => {
    expect(words('echo ${A:-x y} z')).toEqual(['echo', '${A:-x y}', 'z'])
    expect(words('echo ${A}${B} y')).toEqual(['echo', '${A}${B}', 'y'])
    expect(words('echo ${a b')).toEqual(['echo', '${a b'])
  })

  test('une parenthèse ou une accolade sans $ avant elle n’ouvre ni substitution ni ${ }', () => {
    expect(words('echo a(b c)')).toEqual(['echo', 'a', 'b', 'c'])
    expect(words('echo a{b c}')).toEqual(['echo', 'a{b', 'c}'])
  })

  test('guillemet simple jamais fermé : le reste de la ligne est le mot', () => {
    expect(words("echo 'abc")).toEqual(['echo', 'abc'])
    expect(words("echo 'a b' c")).toEqual(['echo', 'a b', 'c'])
  })

  test('guillemets doubles : retour à la ligne gardé, antislash final gardé', () => {
    expect(words('echo "a\nb" c')).toEqual(['echo', 'a\nb', 'c'])
    expect(words('echo "a\\')).toEqual(['echo', 'a\\'])
  })

  test('guillemets doubles : une substitution $( ) ou ` ` garde ses propres guillemets', () => {
    expect(words('echo "$(echo "a b") c" z')).toEqual(['echo', '$(echo "a b") c', 'z'])
    expect(words('echo "x `echo "b c"` y" z')).toEqual(['echo', 'x `echo "b c"` y', 'z'])
    expect(words('echo "a(b "c" d)" z')).toEqual(['echo', 'a(b c d)', 'z'])
  })

  test('un antislash devant un caractère ordinaire le laisse seul', () => {
    expect(words('echo \\x')).toEqual(['echo', 'x'])
  })

  test('heredoc <<- : plusieurs tabulations en tête du délimiteur, aucune ailleurs', () => {
    expect(splitShell('cat <<-EOF\n\t\tx\n\t\tEOF\nbridge-mcp status')).toEqual([
      { words: ['cat'], op: '\n' },
      { words: ['bridge-mcp', 'status'], op: '' },
    ])
    expect(splitShell('cat <<-EOF\nE\tOF\nbridge-mcp status\nEOF\necho fin')).toEqual([
      { words: ['cat'], op: '\n' },
      { words: ['echo', 'fin'], op: '' },
    ])
  })

  test('heredoc dans $( ) : le corps, parenthèse comprise, ne ferme pas la substitution', () => {
    expect(words('echo $(cat <<EOF\n)\nEOF\n) x')).toEqual(['echo', '$(cat <<EOF\n)\nEOF\n)', 'x'])
    expect(words('echo $(cat <<E\n)\nE\n) x')).toEqual(['echo', '$(cat <<E\n)\nE\n)', 'x'])
    expect(words('echo $(cat <<EOF\na\nEOF\necho\n) y')).toEqual(['echo', '$(cat <<EOF\na\nEOF\necho\n)', 'y'])
    expect(words('echo $(cat <a<<EOF\n)\nEOF\n) y')).toEqual(['echo', '$(cat <a<<EOF\n)\nEOF\n)', 'y'])
  })

  test('retour à la ligne dans $( ) sans heredoc : la substitution continue', () => {
    expect(words('echo $(a\nb) c')).toEqual(['echo', '$(a\nb)', 'c'])
  })

  test('< seul, <<< et redirection finale ne sont pas des heredocs', () => {
    expect(splitShell('cat < in.txt\nbridge-mcp status')).toEqual([
      { words: ['cat'], op: '\n' },
      { words: ['bridge-mcp', 'status'], op: '' },
    ])
    expect(splitShell('cat <<<x\nbridge-mcp status')).toEqual([
      { words: ['cat'], op: '\n' },
      { words: ['bridge-mcp', 'status'], op: '' },
    ])
    expect(words('echo >')).toEqual(['echo'])
    expect(words('echo a &> f b')).toEqual(['echo', 'a', 'b'])
  })

  test('un mot collé à > ou < reste un mot ; seul un numéro de descripteur est retiré', () => {
    expect(words('echo a>b c')).toEqual(['echo', 'a', 'c'])
    expect(words('echo 2x>f')).toEqual(['echo', '2x'])
    expect(words('echo a 12>f')).toEqual(['echo', 'a'])
    expect(words('cat 0<in.txt')).toEqual(['cat'])
    expect(words('echo a 2>&1 b')).toEqual(['echo', 'a', 'b'])
  })

  test('|b : le caractère après un tube est lu', () => {
    expect(splitShell('a |b')).toEqual([
      { words: ['a'], op: '|' },
      { words: ['b'], op: '' },
    ])
  })
})

describe('parseCli : formes limites', () => {
  test('un premier mot qui contient = sans être une affectation est le programme', () => {
    expect(parse('./x=1 bridge-mcp tool ssh_disk_usage host=raspberry')).toEqual([])
    expect(parse('FOO=1 ./x=1 bridge-mcp tool ssh_disk_usage host=raspberry')).toEqual([])
  })

  test('préfixe sans programme derrière : aucun appel, jamais une erreur', () => {
    for (const line of ['sudo', 'sudo -u root', 'env', 'nice -n 5', 'timeout -s KILL', 'FOO=1', 'timeout']) {
      expect(parse(line)).toEqual([])
    }
  })

  test('-V et --version entre tool et le nom : rien ne tourne', () => {
    expect(parse('bridge-mcp tool -V ssh_disk_usage host=raspberry')).toEqual([])
    expect(parse('bridge-mcp tool --version ssh_disk_usage host=raspberry')).toEqual([])
    expect(parse('bridge-mcp -V tool ssh_disk_usage host=raspberry')).toEqual([])
  })

  test('la valeur d’une option globale n’est pas un argument de l’outil', () => {
    expect(parse('bridge-mcp --jq host=evil tool ssh_disk_usage path=/')).toEqual([cli({ host: null })])
    expect(parse('bridge-mcp --jq session_id=zz tool ssh_session_exec command=pwd')).toEqual([
      cli({ tool: 'ssh_session_exec', host: null, nature: 'peut-modifier' }),
    ])
  })

  test('le nom de l’outil n’est pas un argument, même avec un =', () => {
    expect(parse('bridge-mcp tool host=evil')).toEqual([cli({ tool: 'host=evil', nature: 'inconnu', host: null })])
  })

  test('un mot sans = n’est pas un argument : hosts n’est pas host=hosts', () => {
    expect(parse('bridge-mcp tool ssh_disk_usage hosts')).toEqual([cli({ host: null })])
    expect(parse('bridge-mcp tool ssh_disk_usage =x host=raspberry')).toEqual([cli()])
  })

  test('--json-args=valeur et --json-args valeur lisent le même JSON ; après les arguments, c’est un argument', () => {
    expect(parse(`bridge-mcp tool ssh_disk_usage --json-args='{"host":"win2025"}'`)).toEqual([cli({ host: 'win2025' })])
    expect(parse(`bridge-mcp tool ssh_disk_usage --json-args '{"host":"win2025"}'`)).toEqual([cli({ host: 'win2025' })])
    expect(parse('bridge-mcp tool ssh_disk_usage host=raspberry --json-args')).toEqual([cli()])
  })

  test('option qui prend une valeur : --limit=5 n’en consomme pas d’autre, --limit 5 oui', () => {
    expect(parse('bridge-mcp --limit=5 tool ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp --limit 5 tool ssh_disk_usage host=raspberry')).toEqual([cli()])
    expect(parse('bridge-mcp --yes=1 tool ssh_disk_usage host=raspberry')).toEqual([cli({ accordByOption: true })])
  })

  test('exec, upload, download avec une table d’outils vide : nature inconnue', () => {
    const unknown = (tool: string) => cli({ tool, nature: 'inconnu' })
    expect(parseCli('bridge-mcp exec raspberry ls', {})).toEqual([unknown('exec')])
    expect(parseCli('bridge-mcp upload raspberry a b', {})).toEqual([unknown('upload')])
    expect(parseCli('bridge-mcp tool ssh_disk_usage host=raspberry', {})).toEqual([unknown('ssh_disk_usage')])
  })

  test('option sans valeur à la fin de la ligne, ni sous-commande', () => {
    expect(parse('bridge-mcp --limit')).toEqual([])
    expect(parse('bridge-mcp --json --yes')).toEqual([])
  })
})

describe('serverOf et isBridgeServer : ancres', () => {
  test('mcp__ commence le nom et le nom d’outil finit la chaîne', () => {
    expect(serverOf('xmcp__ssh-bridge__ssh_exec')).toBeNull()
    expect(serverOf('mcp__ssh-bridge__a\nb')).toBeNull()
    expect(parseMcp('mcp__ssh-bridge__ssh_disk_usage\nx', { host: 'raspberry' }, TOOLS)).toEqual([])
  })

  test('plugin_<plugin>_<serveur> commence le segment et le finit', () => {
    expect(serverOf('mcp__xplugin_a_ssh-bridge__y')).toBe('xplugin_a_ssh-bridge')
    expect(isBridgeServer('xplugin_x_ssh-bridge')).toBe(false)
    expect(isBridgeServer('plugin_x_ssh-bridge\n')).toBe(false)
    expect(isBridgeServer('plugin_x_ssh-bridge')).toBe(true)
  })
})

describe('usefulLines : séquences de contrôle', () => {
  test('OSC (lien hypertexte) retiré, terminé par BEL ou ST', () => {
    expect(usefulLines('a\x1b]8;;http://x\x07lien\x1b]8;;\x07b')).toEqual(['alienb'])
    expect(usefulLines('a\x1b]0;titre\x1b\\b')).toEqual(['ab'])
  })

  test('\r non suivi de \n : seul ce qui suit le dernier \r reste', () => {
    expect(usefulLines('10%\r50%\r100%')).toEqual(['100%'])
    expect(usefulLines('a\r\nb')).toEqual(['a', 'b'])
  })

  test('CSI autre que SGR retiré', () => {
    expect(usefulLines('x\x1b[2Ky')).toEqual(['xy'])
    expect(usefulLines('\x1b[31mrouge\x1b[0m')).toEqual(['rouge'])
  })

  test('C0 (sauf \n et \t), DEL et C1 retirés', () => {
    expect(usefulLines('\x07bip')).toEqual(['bip'])
    expect(usefulLines('a\x00b\x7fc\x85d\x9fe')).toEqual(['abcde'])
    expect(usefulLines('a\tb')).toEqual(['a\tb'])
  })
})
