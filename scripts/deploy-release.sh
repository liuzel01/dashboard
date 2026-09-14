#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy a pre-built dashboard release downloaded from S3.
# Runtime secrets/configuration stay on the host and are never part of the
# release archive: backend .env, environments.json, and /root/.kube/config.

ROOT_DIR=${DASHBOARD_ROOT_DIR:-/opt/dashboard}
RELEASES_DIR="$ROOT_DIR/releases"
CURRENT_LINK="$ROOT_DIR/current"
KEEP_RELEASES=${DASHBOARD_KEEP_RELEASES:-5}

usage() {
  echo "Usage: $0 --artifact-uri s3://bucket/key.tar.gz --release-id ID --sha256 HEX" >&2
  exit 2
}

ARTIFACT_URI=""
RELEASE_ID=""
EXPECTED_SHA256=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --artifact-uri) ARTIFACT_URI=${2:-}; shift 2 ;;
    --release-id) RELEASE_ID=${2:-}; shift 2 ;;
    --sha256) EXPECTED_SHA256=${2:-}; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$ARTIFACT_URI" == s3://* ]] || usage
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || usage
[[ "$EXPECTED_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || usage

umask 027
mkdir -p "$RELEASES_DIR" "$ROOT_DIR/scripts"
TMP_DIR=$(mktemp -d "$ROOT_DIR/.deploy-${RELEASE_ID}.XXXXXX")
ARCHIVE="$TMP_DIR/release.tar.gz"
STAGED_DIR="$TMP_DIR/staged"
PREVIOUS_TARGET=""
SWITCHED=0

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

rollback() {
  if [[ "$SWITCHED" == 1 && -n "$PREVIOUS_TARGET" && -d "$PREVIOUS_TARGET" ]]; then
    echo "[deploy] health check failed; rolling back to $PREVIOUS_TARGET"
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_LINK"
    start_current_release
  fi
}
trap rollback ERR

start_current_release() {
  mkdir -p "$CURRENT_LINK/eks-dashboard-backend/logs" "$CURRENT_LINK/eks-dashboard-frontend/logs"
  chown root:root "$CURRENT_LINK/eks-dashboard-backend/logs" "$CURRENT_LINK/eks-dashboard-frontend/logs"
  for app in eks-dashboard-backend eks-dashboard-frontend; do
    pm2 delete "$app" --namespace prod >/dev/null 2>&1 || true
  done
  (cd "$CURRENT_LINK" && pm2 start ecosystem.prod.config.js --namespace prod >/dev/null)
  pm2 save >/dev/null 2>&1 || true
}

echo "[deploy] downloading $ARTIFACT_URI"
aws s3 cp "$ARTIFACT_URI" "$ARCHIVE" --only-show-errors
printf '%s  %s\n' "$EXPECTED_SHA256" "$ARCHIVE" | sha256sum -c -

mkdir -p "$STAGED_DIR"
tar -xzf "$ARCHIVE" -C "$STAGED_DIR"
[[ -f "$STAGED_DIR/ecosystem.prod.config.js" ]] || { echo "[deploy] missing ecosystem config" >&2; exit 1; }
[[ -d "$STAGED_DIR/eks-dashboard-backend/dist" ]] || { echo "[deploy] missing backend build" >&2; exit 1; }
[[ -d "$STAGED_DIR/eks-dashboard-frontend/dist" ]] || { echo "[deploy] missing frontend build" >&2; exit 1; }

# Carry host-only runtime configuration into the release.
RUNTIME_BACKEND_DIR="$CURRENT_LINK/eks-dashboard-backend"
if [[ ! -e "$RUNTIME_BACKEND_DIR" && -d "$ROOT_DIR/eks-dashboard-backend" ]]; then
  # First deployment from the existing /opt/dashboard checkout.
  RUNTIME_BACKEND_DIR="$ROOT_DIR/eks-dashboard-backend"
fi
if [[ -f "$RUNTIME_BACKEND_DIR/.env" ]]; then
  install -D -m 0600 "$RUNTIME_BACKEND_DIR/.env" \
    "$STAGED_DIR/eks-dashboard-backend/.env"
fi
if [[ -f "$RUNTIME_BACKEND_DIR/environments.json" ]]; then
  install -D -m 0600 "$RUNTIME_BACKEND_DIR/environments.json" \
    "$STAGED_DIR/eks-dashboard-backend/environments.json"
fi

RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"
rm -rf "$RELEASE_DIR"
mv "$STAGED_DIR" "$RELEASE_DIR"
chown -R root:root "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR/eks-dashboard-backend/logs" "$RELEASE_DIR/eks-dashboard-frontend/logs"
chown root:root "$RELEASE_DIR/eks-dashboard-backend/logs" "$RELEASE_DIR/eks-dashboard-frontend/logs"

echo "[deploy] installing production backend dependencies"
(cd "$RELEASE_DIR/eks-dashboard-backend" && npm ci --omit=dev)

if [[ -L "$CURRENT_LINK" || -e "$CURRENT_LINK" ]]; then
  PREVIOUS_TARGET=$(readlink -f "$CURRENT_LINK")
fi
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
SWITCHED=1

echo "[deploy] restarting PM2 applications"
start_current_release

sleep 3
pm2 describe eks-dashboard-backend --namespace prod >/dev/null
pm2 describe eks-dashboard-frontend --namespace prod >/dev/null

wait_for_http() {
  local url="$1"
  local mode="${2:-any}"
  local attempts=30
  local status
  while (( attempts > 0 )); do
    if [[ "$mode" == "success" ]]; then
      curl -fsS --max-time 3 -o /dev/null "$url" && return 0
    else
      # The Nest root route currently returns 404 by design; any completed
      # HTTP response still proves that the backend listener is alive.
      status=$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$url" || true)
      [[ "$status" =~ ^[0-9]{3}$ ]] && return 0
    fi
    attempts=$((attempts - 1))
    sleep 2
  done
  echo "[deploy] health check timed out: $url" >&2
  return 1
}

wait_for_http http://127.0.0.1:3000/
wait_for_http http://127.0.0.1:5173/ success

echo "[deploy] release $RELEASE_ID is healthy"
trap - ERR

# Keep the current release and the newest previous releases only.
mapfile -t OLD_RELEASES < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | awk 'NR > 1 {sub(/^[^ ]+ /, ""); print}' | tail -n +$((KEEP_RELEASES + 1)))
if [[ ${#OLD_RELEASES[@]} -gt 0 ]]; then
  rm -rf -- "${OLD_RELEASES[@]}"
fi
