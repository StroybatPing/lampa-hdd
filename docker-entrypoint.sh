#!/bin/sh
# Якщо конфіг не змонтували — збираємо його зі змінних оточення.
set -e

CFG="${LAMPA_BRIDGE_CONFIG:-/config/config.json}"
mkdir -p "$(dirname "$CFG")"

if [ ! -f "$CFG" ]; then
  echo "Конфігу немає, збираю з оточення → $CFG"
  cat > "$CFG" <<EOF
{
  "port": ${BRIDGE_PORT:-8091},
  "bind": "${BRIDGE_BIND:-0.0.0.0}",
  "token": "${LAMPA_TOKEN:-}",
  "stateFile": "$(dirname "$CFG")/state.json",
  "transmissionRpc": "${TRANSMISSION_RPC:-http://transmission:9091/transmission/rpc}",
  "downloadDir": "${DOWNLOAD_DIR:-/downloads}",
  "library": {
    "movie": "${MOVIES_DIR:-/media/Movies}",
    "series": "${SERIES_DIR:-/media/Series}"
  },
  "jackett": {
    "url": "${JACKETT_URL:-http://jackett:9117}",
    "apiKey": "${JACKETT_API_KEY:-}"
  },
  "jellyfin": {
    "url": "${JELLYFIN_URL:-}",
    "apiKey": "${JELLYFIN_API_KEY:-}"
  },
  "pollSeconds": ${POLL_SECONDS:-60}
}
EOF
fi

exec "$@"
