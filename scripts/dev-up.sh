#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
export PM2_HOME="$ROOT_DIR/.pm2-dev"
PM2_NAMESPACE="dev"
APPS=(eks-dashboard-backend eks-dashboard-frontend)

pm2_status_filtered() {
  local app_name="$1"
  local table_raw table_plain row_plain row_colored line status mark header footer
  table_raw=$(FORCE_COLOR=1 pm2 ls --namespace "$PM2_NAMESPACE" 2>/dev/null || true)
  if [[ -z "$table_raw" ]]; then
    echo "[PM2] ${app_name} not found"
    return 0
  fi

  table_plain=$(printf "%s\n" "$table_raw" | sed -E 's/\x1b\[[0-9;]*m//g')
  line=$(printf "%s\n" "$table_plain" | awk -v name="$app_name" '$0 ~ name {print NR; exit 0}')
  if [[ -z "$line" ]]; then
    echo "[PM2] ${app_name} not found"
    return 0
  fi

  row_plain=$(printf "%s\n" "$table_plain" | awk -v n="$line" 'NR==n {print}')
  status=$(printf "%s\n" "$row_plain" | awk -F '│' '{gsub(/ /,"",$9); print $9}')
  if [[ "$status" == "online" ]]; then
    mark="✓"
  else
    mark="$status"
  fi
  echo "[PM2] ${app_name} ${mark}"

  header=$(printf "%s\n" "$table_raw" | awk 'NR<=3 {print}')
  footer=$(printf "%s\n" "$table_raw" | awk 'END {print}')
  row_colored=$(printf "%s\n" "$table_raw" | awk -v n="$line" 'NR==n {print}')
  printf "%s\n" "$header"
  printf "%s\n" "$row_colored"
  printf "%s\n" "$footer"
}

pm2_status_compact() {
  for name in "${APPS[@]}"; do
    pm2_status_filtered "$name"
  done
}

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
pm2_status_compact || true

echo "[dev-up] Done. Frontend dev on http://localhost:5173 (default). Backend on http://localhost:3000/api"
