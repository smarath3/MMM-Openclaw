#!/bin/bash
set -euo pipefail

# ============================================================================
# MMM-Openclaw — Deploy to Raspberry Pi
# ============================================================================
# Syncs module to Pi and restarts MagicMirror.
#
# Usage:
#   ./scripts/deploy.sh                  # deploy + restart
#   ./scripts/deploy.sh --dry-run        # preview what would sync
#   ./scripts/deploy.sh --no-restart     # deploy without restarting
#   ./scripts/deploy.sh --skills         # also deploy skills to OpenClaw
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_ROOT/.env"

# Defaults
PI_HOST="${PI_HOST:-pi@raspberrypi.local}"
PI_MODULE_PATH="${PI_MODULE_PATH:-/home/pi/MagicMirror/modules/MMM-Openclaw}"
DRY_RUN=""
NO_RESTART=""
DEPLOY_SKILLS=""

# Load env
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN="--dry-run" ;;
    --no-restart) NO_RESTART="1" ;;
    --skills)     DEPLOY_SKILLS="1" ;;
  esac
done

echo "🚀 Deploying MMM-Openclaw"
echo "   Target: ${PI_HOST}:${PI_MODULE_PATH}"
echo ""

# --------------------------------------------------------------------------
# 1. Sync module files
# --------------------------------------------------------------------------
echo "→ Syncing module files..."
rsync -avz $DRY_RUN \
  "$PROJECT_ROOT/MMM-Openclaw.js" \
  "$PROJECT_ROOT/MMM-Openclaw.css" \
  "$PROJECT_ROOT/node_helper.js" \
  "$PROJECT_ROOT/package.json" \
  "$PROJECT_ROOT/package-lock.json" \
  "${PI_HOST}:${PI_MODULE_PATH}/"

if [ -n "$DRY_RUN" ]; then
  echo "✓ Dry run complete (no files changed)"
  exit 0
fi

# --------------------------------------------------------------------------
# 2. Install dependencies on Pi
# --------------------------------------------------------------------------
echo "→ Installing dependencies on Pi..."
ssh "$PI_HOST" "cd ${PI_MODULE_PATH} && npm install --production --no-audit --no-fund"

# --------------------------------------------------------------------------
# 3. Optionally deploy skills to OpenClaw workspace
# --------------------------------------------------------------------------
if [ -n "$DEPLOY_SKILLS" ]; then
  OPENCLAW_SKILLS_PATH="${OPENCLAW_SKILLS_PATH:-/home/pi/.openclaw/skills}"
  echo "→ Deploying OpenClaw skills to ${PI_HOST}:${OPENCLAW_SKILLS_PATH}..."

  for skill_dir in "$PROJECT_ROOT/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    echo "  → $skill_name"
    rsync -avz \
      --exclude '.DS_Store' \
      "$skill_dir" \
      "${PI_HOST}:${OPENCLAW_SKILLS_PATH}/${skill_name}/"
  done
  echo "✓ Skills deployed"
fi

# --------------------------------------------------------------------------
# 4. Restart MagicMirror
# --------------------------------------------------------------------------
if [ -z "$NO_RESTART" ]; then
  echo "→ Restarting MagicMirror on Pi..."
  ssh "$PI_HOST" "pm2 restart MagicMirror 2>/dev/null || \
    (cd ~/MagicMirror && pm2 start npm --name MagicMirror -- start) || \
    echo 'Could not restart — start MagicMirror manually'"
  echo "✓ MagicMirror restarted"
fi

echo ""
echo "✅ Deployed!"
