#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-dev"

echo "[dev-down] Stopping pm2 apps..."
pm2 delete eks-dashboard-frontend --namespace dev || true
pm2 delete eks-dashboard-backend --namespace dev || true
pm2 save || true
pm2 status --namespace dev || true
echo "[dev-down] Done."
