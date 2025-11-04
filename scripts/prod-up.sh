#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-prod"

echo "[prod-up] Installing deps and building backend..."
pushd "$ROOT_DIR/eks-dashboard-backend" >/dev/null
npm ci || npm install
npm run build
popd >/dev/null

echo "[prod-up] Installing deps and building frontend..."
pushd "$ROOT_DIR/eks-dashboard-frontend" >/dev/null
npm ci || npm install
npm run build
popd >/dev/null

echo "[prod-up] Starting with pm2 (backend + frontend preview)..."
pm2 start "$ROOT_DIR/ecosystem.prod.config.js"
pm2 save || true
pm2 status --namespace prod || true

echo "[prod-up] Done. Frontend on http://localhost:5173 . Backend on http://localhost:3000/api"
