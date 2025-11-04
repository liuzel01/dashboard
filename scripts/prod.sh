#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-prod"
APPS=(eks-dashboard-backend eks-dashboard-frontend)

ensure_build() {
  echo "[prod] Installing deps and building backend..."
  pushd "$ROOT_DIR/eks-dashboard-backend" >/dev/null
  npm ci || npm install
  npm run build
  mkdir -p logs
  popd >/dev/null

  echo "[prod] Installing frontend deps..."
  pushd "$ROOT_DIR/eks-dashboard-frontend" >/dev/null
  npm ci || npm install
  npm run build
  mkdir -p logs
  popd >/dev/null
}

start() {
  ensure_build
  echo "[prod] Starting pm2 processes..."
  pm2 start "$ROOT_DIR/ecosystem.prod.config.js"
  pm2 save || true
  pm2 status --namespace prod || true
}

stop() {
  echo "[prod] Stopping apps..."
  for name in "${APPS[@]}"; do
    pm2 stop "$name" --namespace prod || true
  done
  pm2 save || true
  pm2 status --namespace prod || true
}

restart() {
  echo "[prod] Rebuilding and restarting apps..."
  ensure_build
  for name in "${APPS[@]}"; do
    pm2 restart "$name" --namespace prod || true
  done
  pm2 status --namespace prod || true
}

delete() {
  echo "[prod] Deleting apps..."
  for name in "${APPS[@]}"; do
    pm2 delete "$name" --namespace prod || true
  done
  pm2 save || true
  pm2 status --namespace prod || true
}

status() {
  pm2 status --namespace prod || true
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
