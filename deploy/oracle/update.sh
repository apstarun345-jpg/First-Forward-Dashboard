#!/usr/bin/env bash
# GitHub main par naya commit → pull + (zarurat ho to) npm install + restart. Kuch naya nahi → kuch nahi.
set -euo pipefail
APP_DIR=/opt/ffdash/app
cd "$APP_DIR"
sudo -u ffdash git fetch --quiet origin main
LOCAL=$(sudo -u ffdash git rev-parse HEAD); REMOTE=$(sudo -u ffdash git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0
CHANGED=$(sudo -u ffdash git diff --name-only "$LOCAL" "$REMOTE")
sudo -u ffdash git reset --hard --quiet origin/main
if echo "$CHANGED" | grep -qE '^package(-lock)?\.json$'; then sudo -u ffdash npm install --omit=dev --no-audit --no-fund; fi
systemctl restart ffdash
echo "deployed $(git rev-parse --short HEAD)"
