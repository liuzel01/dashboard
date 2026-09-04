#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/eks-dashboard-backend"

REGISTRY="${REGISTRY:-reghk.hashex.net}"
PROJECT="${PROJECT:-hash}"
IMAGE_NAME="${IMAGE_NAME:-dashboard-db-gateway-agent}"
DOCKERFILE="${DOCKERFILE:-$BACKEND_DIR/Dockerfile.agent}"
BUILD_CONTEXT="${BUILD_CONTEXT:-$BACKEND_DIR}"
PUSH_LATEST="${PUSH_LATEST:-true}"
DEFAULT_USER="${DEFAULT_USER:-admin}"
BUILD_PLATFORM="${BUILD_PLATFORM:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[error] docker command not found" >&2
  exit 1
fi

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "[error] Dockerfile not found: $DOCKERFILE" >&2
  exit 1
fi

if [[ -z "${TAG:-}" ]]; then
  GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo local)"
  TAG="$(date +%Y%m%d-%H%M%S)-${GIT_SHA}"
fi

IMAGE_REF="${REGISTRY}/${PROJECT}/${IMAGE_NAME}:${TAG}"
LATEST_REF="${REGISTRY}/${PROJECT}/${IMAGE_NAME}:latest"

REGISTRY_USER="${REGISTRY_USER:-}"
if [[ -z "$REGISTRY_USER" ]]; then
  read -r -p "Registry username [${DEFAULT_USER}]: " REGISTRY_USER
  REGISTRY_USER="${REGISTRY_USER:-$DEFAULT_USER}"
fi

REGISTRY_PASSWORD="${REGISTRY_PASSWORD:-}"
if [[ -z "$REGISTRY_PASSWORD" ]]; then
  read -r -s -p "Registry password: " REGISTRY_PASSWORD
  echo
fi

echo "[info] Logging in: ${REGISTRY}"
echo "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin

BUILD_CMD=(docker build -f "$DOCKERFILE" -t "$IMAGE_REF")
if [[ -n "$BUILD_PLATFORM" ]]; then
  BUILD_CMD+=(--platform "$BUILD_PLATFORM")
fi
BUILD_CMD+=("$BUILD_CONTEXT")

echo "[info] Building image: ${IMAGE_REF}"
"${BUILD_CMD[@]}"

echo "[info] Pushing image: ${IMAGE_REF}"
docker push "$IMAGE_REF"

if [[ "${PUSH_LATEST}" == "true" ]]; then
  echo "[info] Tagging latest: ${LATEST_REF}"
  docker tag "$IMAGE_REF" "$LATEST_REF"
  echo "[info] Pushing image: ${LATEST_REF}"
  docker push "$LATEST_REF"
fi

cat <<EOF
[done] Build and push completed.
  image: ${IMAGE_REF}
  latest: ${LATEST_REF} (PUSH_LATEST=${PUSH_LATEST})

Update deployment example:
  image: ${IMAGE_REF}
EOF
