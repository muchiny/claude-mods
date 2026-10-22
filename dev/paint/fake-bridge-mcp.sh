#!/bin/sh
# Faux bridge-mcp pour la peinture (dev/paint/drive.ts le place en tête de PATH sous le nom bridge-mcp).
# Il imite stdout, stderr et code de sortie de la vraie CLI pour trois cas, rien d'autre ; une seule
# machine connue : host-a. Sources des formes : mode-clair/tests/replay/REFERENCE.md (R29, R33, R38).
#   bridge-mcp exec host-a <cmd>                    bloc Host/Command/Exit code: 0 puis STDOUT, code 0 (R38)
#   bridge-mcp exec <autre> <cmd>                   « Error: Unknown host: <autre> » sur stderr, code 3 (R29)
#   bridge-mcp tool ssh_exec host=host-a command=…  « [exit:2] » en tête de stdout, code 6 (R33)
set -u

if [ "${1:-}" = exec ] && [ $# -ge 3 ]; then
  host=$2
  shift 2
  if [ "$host" != host-a ]; then
    echo "Error: Unknown host: $host" >&2
    exit 3
  fi
  printf 'Host: host-a\nCommand: %s\nExit code: 0\nDuration: 12ms\n\n--- STDOUT ---\n 10:00:01 up 3 days,  2:04,  1 user,  load average: 0.00, 0.01, 0.05\n' "$*"
  exit 0
fi

if [ "${1:-}" = tool ] && [ "${2:-}" = ssh_exec ]; then
  case " $* " in
    *" host=host-a "*)
      printf '[exit:2]\nls: cannot access '"'"'/absent'"'"': No such file or directory\n'
      exit 6
      ;;
  esac
  echo "Error: Unknown host: ${3#host=}" >&2
  exit 3
fi

echo "error: unexpected argument '${1:-}' found" >&2
exit 2
