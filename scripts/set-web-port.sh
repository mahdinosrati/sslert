#!/usr/bin/env bash
# Run manually on the Docker host; the API never receives host/Docker access.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
port="${1:-}"
if [[ ! "$port" =~ ^[0-9]{4,5}$ ]] || (( 10#$port < 1024 || 10#$port > 65535 )); then
  echo 'Usage: sudo bash scripts/set-web-port.sh PORT (1024-65535)' >&2
  exit 2
fi
port=$((10#$port))
[[ -f .env ]] || { echo 'Missing .env; copy .env.example first.' >&2; exit 1; }
command -v ss >/dev/null || { echo 'Install iproute2 to check port availability.' >&2; exit 1; }
old_port=$(sed -n 's/^WEB_PORT=//p' .env | tail -1)
if [[ "$port" != "${old_port:-5173}" ]] && [[ -n "$(ss -H -ltn "sport = :$port")" ]]; then
  echo "Port $port is already in use." >&2
  exit 1
fi
backup=$(mktemp .env.before-port.XXXXXX)
cp -p .env "$backup"
next=$(mktemp .env.port.XXXXXX)
trap 'rm -f -- "$next"' EXIT
if grep -q '^WEB_PORT=' .env; then
  sed "s/^WEB_PORT=.*/WEB_PORT=$port/" .env > "$next"
else
  cat .env > "$next"
  printf '\nWEB_PORT=%s\n' "$port" >> "$next"
fi
chmod --reference=.env "$next"
cat "$next" > .env
if docker compose config -q && docker compose up -d --no-deps --force-recreate --wait web; then
  echo "Web port applied: $port. Previous .env: $backup"
  echo 'Update your firewall/reverse proxy if needed, then open the new address.'
else
  echo 'Apply failed; restoring previous .env and web container.' >&2
  cp -p "$backup" .env
  docker compose up -d --no-deps --force-recreate --wait web || true
  exit 1
fi
