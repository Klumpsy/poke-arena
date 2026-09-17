#!/bin/bash
# Poke Arena sync helper installer.
# Usage: curl -fsSL <site>/install.sh | bash -s -- <SYNC_TOKEN> <SUPABASE_URL> <SUPABASE_ANON_KEY>
set -euo pipefail

TOKEN="${1:-}"
SUPABASE_URL="${2:-}"
ANON_KEY="${3:-}"
if [ -z "$TOKEN" ] || [ -z "$SUPABASE_URL" ] || [ -z "$ANON_KEY" ]; then
  echo "Gebruik: install.sh <token> <supabase-url> <anon-key>" >&2
  exit 1
fi

STATE_FILE="$HOME/Library/Application Support/PokeTokenBar/companion-state.json"
if [ ! -f "$STATE_FILE" ]; then
  echo "PokeTokenBar-data niet gevonden op: $STATE_FILE" >&2
  echo "Installeer PokeTokenBar en open de app eerst een keer." >&2
  exit 1
fi

APP_DIR="$HOME/.poke-arena"
LABEL="nl.cube.poke-arena.sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents"

umask 077
cat > "$APP_DIR/config" <<CONF
SUPABASE_URL="$SUPABASE_URL"
ANON_KEY="$ANON_KEY"
TOKEN="$TOKEN"
STATE_FILE="$STATE_FILE"
CONF

cat > "$APP_DIR/sync.sh" <<'SYNC'
#!/bin/bash
set -euo pipefail
# shellcheck source=/dev/null
source "$HOME/.poke-arena/config"

PAYLOAD="$(mktemp)"
trap 'rm -f "$PAYLOAD"' EXIT
{
  printf '{"p_token":"%s","p_state":' "$TOKEN"
  cat "$STATE_FILE"
  printf '}'
} > "$PAYLOAD"

RESPONSE="$(curl -sS --fail-with-body --max-time 30 \
  -X POST "$SUPABASE_URL/rest/v1/rpc/sync_pokedex" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @"$PAYLOAD")" || {
  echo "$(date '+%F %T') sync mislukt: $RESPONSE" >> "$HOME/.poke-arena/sync.log"
  exit 1
}
echo "$(date '+%F %T') ok $RESPONSE" >> "$HOME/.poke-arena/sync.log"
tail -n 200 "$HOME/.poke-arena/sync.log" > "$HOME/.poke-arena/sync.log.tmp" && mv "$HOME/.poke-arena/sync.log.tmp" "$HOME/.poke-arena/sync.log"
SYNC
chmod 700 "$APP_DIR/sync.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/sync.sh</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>$STATE_FILE</string>
  </array>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardErrorPath</key><string>$APP_DIR/launchd.err</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Eerste sync..."
if /bin/bash "$APP_DIR/sync.sh"; then
  echo "Klaar. Je Pokémon staan in de arena. Sync draait automatisch bij elke wijziging."
else
  echo "Sync mislukt, zie $APP_DIR/sync.log" >&2
  exit 1
fi
