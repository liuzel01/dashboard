#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-dev"

echo "[dev-up] Installing deps and building backend..."
pushd "$ROOT_DIR/eks-dashboard-backend" >/dev/null
npm ci || npm install
npm run build
popd >/dev/null

echo "[dev-up] Installing frontend deps..."
pushd "$ROOT_DIR/eks-dashboard-frontend" >/dev/null
npm ci || npm install
popd >/dev/null

echo "[dev-up] Starting with pm2 (backend + frontend dev server)..."
pm2 start "$ROOT_DIR/ecosystem.dev.config.js"
pm2 save || true
pm2 status --namespace dev || true

echo "[dev-up] Done. Frontend dev on http://localhost:5173 (default). Backend on http://localhost:3000/api"
