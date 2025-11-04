#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-prod"

echo "[prod-down] Stopping pm2 apps..."
pm2 delete eks-dashboard-frontend --namespace prod || true
pm2 delete eks-dashboard-backend --namespace prod || true
pm2 save || true
pm2 status --namespace prod || true
echo "[prod-down] Done."
