#!/usr/bin/env bash
# Manually deploy a reviewed GHCR image to the existing New API Compose service.
# Examples:
#   BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh deploy ghcr.io/ludafenqi/wuchuang-api:stable
#   BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh deploy ghcr.io/ludafenqi/wuchuang-api@sha256:...
#   BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh rollback
set -Eeuo pipefail
umask 077

BASE_DIR="${BASE_DIR:-/opt/ai-gateway/new-api}"
SERVICE="${SERVICE:-new-api}"
HEALTH_URL="${HEALTH_URL:-https://wcai.113901.xyz/api/status}"
STATE_DIR="${STATE_DIR:-${BASE_DIR}/.wuchuang-release}"
OVERLAY="${BASE_DIR}/compose.wuchuang-image.yml"
ACTION="${1:-}"

err() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "${BACKUP_CONFIRMED:-}" == YES ]] || err 'Confirm a verified database backup first: BACKUP_CONFIRMED=YES'
[ -d "$BASE_DIR" ] || err "Missing Compose directory: $BASE_DIR"
cd "$BASE_DIR"

COMPOSE_FILE=""
for file in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [ -f "$file" ]; then COMPOSE_FILE="$file"; break; fi
done
[ -n "$COMPOSE_FILE" ] || err "No Compose file found under $BASE_DIR"
command -v docker >/dev/null || err 'Docker is not installed'
docker compose -f "$COMPOSE_FILE" config --services | grep -Fxq "$SERVICE" || err "Service $SERVICE not in $COMPOSE_FILE"
mkdir -p "$STATE_DIR"

if [ ! -e "$OVERLAY" ]; then
  printf 'services:\n  %s:\n    image: ${WUCHUANG_IMAGE:?Set WUCHUANG_IMAGE}\n' "$SERVICE" > "$OVERLAY"
fi

compose_with_image() {
  local ref="$1"
  shift
  WUCHUANG_IMAGE="$ref" docker compose -f "$COMPOSE_FILE" -f "$OVERLAY" "$@"
}

check_health() {
  local try
  for try in $(seq 1 12); do
    RESPONSE="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null || true)"
    if printf '%s' "$RESPONSE" | grep -Eq '"success"[[:space:]]*:[[:space:]]*true'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

case "$ACTION" in
  deploy)
    IMAGE="${2:-}"
    REQUESTED_IMAGE="$IMAGE"
    if [[ "$IMAGE" =~ ^ghcr\.io/ludafenqi/wuchuang-api@sha256:[0-9a-f]{64}$ ]]; then
      : # Already pinned.
    elif [[ "$IMAGE" == ghcr.io/ludafenqi/wuchuang-api:stable || "$IMAGE" =~ ^ghcr\.io/ludafenqi/wuchuang-api:sha-[0-9a-f]{40}$ ]]; then
      DIGEST="$(docker buildx imagetools inspect "$IMAGE" --format '{{.Manifest.Digest}}')"
      [[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || err 'The registry did not return a valid image digest'
      IMAGE="ghcr.io/ludafenqi/wuchuang-api@$DIGEST"
    else
      err 'Supply the GHCR stable tag, full sha-commit tag or digest'
    fi
    docker pull "$IMAGE"
    EXPECTED_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE")"
    CURRENT_CID="$(docker compose -f "$COMPOSE_FILE" ps -q "$SERVICE")"
    [ -n "$CURRENT_CID" ] || err "Current $SERVICE container not found; inspect Compose before deploying"
    OLD_IMAGE_ID="$(docker inspect -f '{{.Image}}' "$CURRENT_CID")"
    ROLLBACK_TAG="wuchuang-new-api:rollback-$(date -u +%Y%m%d%H%M%S)"
    docker image tag "$OLD_IMAGE_ID" "$ROLLBACK_TAG"
    printf '%s\n' "$ROLLBACK_TAG" > "$STATE_DIR/previous-image.txt"
    printf 'Saved local rollback image: %s\n' "$ROLLBACK_TAG"
    compose_with_image "$IMAGE" config --quiet
    compose_with_image "$IMAGE" up -d --no-deps "$SERVICE"
    NEW_CID="$(compose_with_image "$IMAGE" ps -q "$SERVICE")"
    [ -n "$NEW_CID" ] || err 'No container started after deployment'
    if [ "$(docker inspect -f '{{.Image}}' "$NEW_CID")" = "$EXPECTED_IMAGE_ID" ] &&
       [ "$(docker inspect -f '{{.State.Running}}' "$NEW_CID")" = true ] && check_health; then
      printf '%s\n' "$IMAGE" > "$STATE_DIR/current-image.txt"
      printf '%s\n' "$REQUESTED_IMAGE" > "$STATE_DIR/requested-image.txt"
      echo "OK. Deployed $IMAGE"
    else
      echo 'Health check failed. Attempting container-image rollback...' >&2
      compose_with_image "$ROLLBACK_TAG" up -d --no-deps "$SERVICE" || true
      err "New deployment failed. Checked rollback attempt; inspect logs and database schema."
    fi
    ;;
  rollback)
    [ -s "$STATE_DIR/previous-image.txt" ] || err 'No previous image recorded'
    PREVIOUS="$(cat "$STATE_DIR/previous-image.txt")"
    docker image inspect "$PREVIOUS" >/dev/null || err "Local rollback image missing: $PREVIOUS"
    compose_with_image "$PREVIOUS" up -d --no-deps "$SERVICE"
    echo "Rollback initiated to $PREVIOUS"
    echo 'Check health, logs and database compatibility manually.'
    ;;
  *)
    echo 'Usage:' >&2
    echo '  BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh deploy ghcr.io/ludafenqi/wuchuang-api:stable' >&2
    echo '  BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh deploy ghcr.io/ludafenqi/wuchuang-api@sha256:...' >&2
    echo '  BACKUP_CONFIRMED=YES ./wuchuang-deploy.sh rollback' >&2
    exit 2
    ;;
esac
