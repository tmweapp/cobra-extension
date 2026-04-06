#!/bin/bash
# FireScrape Bridge — Installer
# Installa il Native Messaging host per Chrome/Chromium

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.firescrape.bridge"
SERVER_PATH="$SCRIPT_DIR/server.js"

# Chiedi Extension ID
echo "=== FireScrape Bridge Installer ==="
echo ""
echo "Per trovare l'Extension ID:"
echo "  1. Apri chrome://extensions"
echo "  2. Attiva 'Modalità sviluppatore'"
echo "  3. Copia l'ID sotto 'FireScrape'"
echo ""
read -p "Extension ID: " EXT_ID

if [ -z "$EXT_ID" ]; then
  echo "Errore: Extension ID richiesto"
  exit 1
fi

# Porta opzionale
read -p "Porta HTTP [9222]: " PORT
PORT=${PORT:-9222}

# API Key opzionale
read -p "API Key (vuoto = nessuna auth): " API_KEY

# Determina OS e percorso manifest
OS=$(uname -s)
case "$OS" in
  Darwin)
    MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    ;;
  Linux)
    MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    ;;
  *)
    echo "OS non supportato: $OS"
    echo "Su Windows usa install.bat"
    exit 1
    ;;
esac

mkdir -p "$MANIFEST_DIR"

# Crea wrapper script con variabili d'ambiente
WRAPPER="$SCRIPT_DIR/run-bridge.sh"
cat > "$WRAPPER" << WRAPPER_EOF
#!/bin/bash
export FIRESCRAPE_PORT=$PORT
export FIRESCRAPE_API_KEY=$API_KEY
exec node "$SERVER_PATH"
WRAPPER_EOF
chmod +x "$WRAPPER"

# Crea manifest
cat > "$MANIFEST_DIR/$HOST_NAME.json" << EOF
{
  "name": "$HOST_NAME",
  "description": "FireScrape Local Bridge — HTTP API on port $PORT",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXT_ID/"
  ]
}
EOF

echo ""
echo "=== Installazione completata ==="
echo "  Host manifest: $MANIFEST_DIR/$HOST_NAME.json"
echo "  Server:        $SERVER_PATH"
echo "  Porta HTTP:    $PORT"
echo "  API Key:       ${API_KEY:-nessuna}"
echo ""
echo "Riavvia Chrome per attivare il bridge."
echo ""
echo "Test rapido:"
echo "  curl http://127.0.0.1:$PORT/api/health"
echo "  curl -X POST http://127.0.0.1:$PORT/api/scrape"
