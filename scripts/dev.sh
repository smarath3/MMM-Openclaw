#!/bin/bash
set -euo pipefail

# ============================================================================
# MMM-Openclaw — Daily Dev Runner
# ============================================================================
# Starts MagicMirror with your .env settings for local development.
# The mock gateway must be running separately (or point to your real OpenClaw).
#
# Usage:
#   ./scripts/dev.sh              # normal mode
#   ./scripts/dev.sh --mock       # also starts mock gateway in background
#   ./scripts/dev.sh --server     # serveronly mode (browser at localhost:8080)
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MM_DIR="$PROJECT_ROOT/.magicmirror-dev"
ENV_FILE="$PROJECT_ROOT/.env"

# Load env
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
  echo "✓ Loaded .env"
fi

# Check MagicMirror exists
if [ ! -d "$MM_DIR" ]; then
  echo "✗ MagicMirror not found. Run ./scripts/setup-mac.sh first."
  exit 1
fi

# Handle flags
MOCK_PID=""
SERVER_ONLY=""
MOCK_ARGS=""

cleanup() {
  if [ -n "$MOCK_PID" ]; then
    echo "→ Stopping mock gateway (PID $MOCK_PID)..."
    kill "$MOCK_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

START_MOCK=""
for arg in "$@"; do
  case "$arg" in
    --mock)
      START_MOCK="1"
      ;;
    --server)
      SERVER_ONLY="--serveronly"
      echo "→ Server-only mode: open http://localhost:8080 in browser"
      ;;
    --whatsapp|--demo)
      MOCK_ARGS="$MOCK_ARGS $arg"
      ;;
  esac
done

if [ -n "$START_MOCK" ]; then
  echo "→ Starting mock gateway in background..."
  node "$PROJECT_ROOT/tools/mock-gateway.js" $MOCK_ARGS &
  MOCK_PID=$!
  echo "✓ Mock gateway running (PID $MOCK_PID)"
  sleep 1
fi

echo "→ Starting MagicMirror..."
echo ""
cd "$MM_DIR"

if [ -n "$SERVER_ONLY" ]; then
  node serveronly
else
  npm start
fi
