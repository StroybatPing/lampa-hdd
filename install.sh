#!/usr/bin/env bash
# Встановлення lampa-hdd на macOS: TorrServer + Jackett + міст + віддача плагіна.
# Все живе в теці проєкту, служби реєструються як launchd-агенти користувача.
set -euo pipefail

HOME_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
TORRSERVER_VERSION="${TORRSERVER_VERSION:-MatriX.144.1}"
JACKETT_VERSION="${JACKETT_VERSION:-v0.24.2517}"

DOWNLOAD_DIR="${DOWNLOAD_DIR:-$HOME/Downloads/Торенти}"
MOVIES_DIR="${MOVIES_DIR:-$HOME/Movies/Фільми}"
SERIES_DIR="${SERIES_DIR:-$HOME/Movies/Серіали}"
WEB_PORT="${WEB_PORT:-8095}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

case "$(uname -m)" in
  arm64) ARCH=arm64; JACKETT_ASSET=Jackett.Binaries.macOSARM64.tar.gz ;;
  *)     ARCH=amd64; JACKETT_ASSET=Jackett.Binaries.macOS.tar.gz ;;
esac

say "1/5 · Каталоги"
mkdir -p "$HOME_DIR"/{torrserver/data,jackett/config,logs} "$DOWNLOAD_DIR" "$MOVIES_DIR" "$SERIES_DIR"

say "2/5 · TorrServer $TORRSERVER_VERSION ($ARCH)"
if [ ! -x "$HOME_DIR/torrserver/TorrServer" ]; then
  curl -fsSL -o "$HOME_DIR/torrserver/TorrServer" \
    "https://github.com/YouROK/TorrServer/releases/download/$TORRSERVER_VERSION/TorrServer-darwin-$ARCH"
  chmod +x "$HOME_DIR/torrserver/TorrServer"
fi

say "3/5 · Jackett $JACKETT_VERSION"
if [ ! -x "$HOME_DIR/jackett/Jackett/jackett" ]; then
  curl -fsSL -o /tmp/jackett.tar.gz \
    "https://github.com/Jackett/Jackett/releases/download/$JACKETT_VERSION/$JACKETT_ASSET"
  tar xzf /tmp/jackett.tar.gz -C "$HOME_DIR/jackett"
  rm -f /tmp/jackett.tar.gz
fi

say "4/5 · Конфіг мосту"
if [ ! -f "$HOME_DIR/bridge/config.json" ]; then
  python3 - "$HOME_DIR" "$DOWNLOAD_DIR" "$MOVIES_DIR" "$SERIES_DIR" <<'PY'
import json, sys
home, downloads, movies, series = sys.argv[1:5]
cfg = json.load(open(f'{home}/bridge/config.example.json'))
cfg['downloadDir'] = downloads
cfg['library'] = {'movie': movies, 'series': series}
json.dump(cfg, open(f'{home}/bridge/config.json', 'w'), ensure_ascii=False, indent=2)
PY
  echo "створено bridge/config.json — впишіть у нього ключ Jackett"
else
  echo "bridge/config.json уже є, не чіпаю"
fi

say "5/5 · Служби launchd"
agent() { # ім'я, аргументи програми…
  local name="$1"; shift
  local args=""
  for a in "$@"; do args+="    <string>$a</string>"$'\n'; done
  cat > "$AGENTS/com.lampa.$name.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lampa.$name</string>
  <key>ProgramArguments</key>
  <array>
$args  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME_DIR/logs/$name.out.log</string>
  <key>StandardErrorPath</key><string>$HOME_DIR/logs/$name.err.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/com.lampa.$name" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.lampa.$name.plist"
  echo "  запущено com.lampa.$name"
}

agent torrserver "$HOME_DIR/torrserver/TorrServer" --port 8090 \
  --path "$HOME_DIR/torrserver/data" --logpath "$HOME_DIR/logs/torrserver.log"
agent jackett "$HOME_DIR/jackett/Jackett/jackett" --NoRestart \
  --DataFolder "$HOME_DIR/jackett/config"
agent bridge "$(command -v node)" "$HOME_DIR/bridge/server.js"

cat <<EOF

Готово.

  Jackett      http://localhost:9117      — додайте трекери, скопіюйте API Key
                                            у bridge/config.json
  TorrServer   http://localhost:8090
  Міст         http://localhost:8091/health

Лишилось віддати плагін у мережу, наприклад через Caddy:

  cp Caddyfile.example /usr/local/etc/Caddyfile   # виправте шляхи всередині
  brew services start caddy

і додати в Lampa (Налаштування → Розширення) адресу
  http://<ip-цього-компʼютера>:$WEB_PORT/hdd.js
EOF
