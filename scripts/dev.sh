#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-dev"
APPS=(eks-dashboard-backend eks-dashboard-frontend)

ensure_build() {
  echo "[dev] Installing deps and building backend..."
  pushd "$ROOT_DIR/eks-dashboard-backend" >/dev/null
  npm ci || npm install
  npm run build
  mkdir -p logs
  popd >/dev/null

  echo "[dev] Installing frontend deps..."
  pushd "$ROOT_DIR/eks-dashboard-frontend" >/dev/null
  npm ci || npm install
  mkdir -p logs
  popd >/dev/null
}

start() {
  ensure_build
  echo "[dev] Starting pm2 processes..."
  pm2 start "$ROOT_DIR/ecosystem.dev.config.js"
  pm2 save || true
  pm2 status --namespace dev || true
}

stop() {
  echo "[dev] Stopping apps..."
  for name in "${APPS[@]}"; do
    pm2 stop "$name" --namespace dev || true
  done
  pm2 save || true
  pm2 status --namespace dev || true
}

restart() {
  echo "[dev] Rebuilding backend..."
  ensure_build
  echo "[dev] Restarting apps..."
  for name in "${APPS[@]}"; do
    pm2 restart "$name" --namespace dev || true
  done
  pm2 status --namespace dev || true
}

delete() {
  echo "[dev] Deleting apps..."
  for name in "${APPS[@]}"; do
    pm2 delete "$name" --namespace dev || true
  done
  pm2 save || true
  pm2 status --namespace dev || true
}

status() {
  pm2 status --namespace dev || true
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  delete) delete ;;
  status) status ;;
  *)
    echo "Usage: $0 {start|stop|restart|delete|status}" >&2
    exit 1
    ;;
esac
