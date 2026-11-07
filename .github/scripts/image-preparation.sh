#!/usr/bin/env bash
set -euo pipefail
evidence="$RUNNER_TEMP/image-evidence"
if [ "$1" = start ]; then
  docker image inspect "$IMAGE" > "$evidence/image-inspect.json"
  python3 - <<'PY'
import json, os
p=os.environ['RUNNER_TEMP']+'/image-evidence/'
i=json.load(open(p+'image-inspect.json'))[0]
assert i['Os']=='linux' and i['Architecture']=='amd64'
assert i['Config']['Entrypoint']==['/new-api']
assert i['Config']['WorkingDir']=='/data'
assert i['Config']['Labels']['org.opencontainers.image.revision']==os.environ['PRODUCT_SHA']
assert i['Config']['Labels']['org.opencontainers.image.source']=='https://github.com/ludafenqi/wuchuang-api'
json.dump(dict(productSHA=os.environ['PRODUCT_SHA'], workflowSHA=os.environ['GITHUB_SHA'], platform='linux/amd64', imageID=i['Id'], registryDigest=None, published=False),open(p+'image-identity.json','w'),indent=2)
PY
  docker create --name wucora-inspect "$IMAGE" > /dev/null
  mkdir -p "$evidence/licenses"
  docker cp wucora-inspect:/licenses/. "$evidence/licenses/"
  docker rm wucora-inspect > /dev/null
  for file in LICENSE NOTICE THIRD-PARTY-LICENSES.md; do
    cmp "product/$file" "$evidence/licenses/$file"
  done
  (cd "$evidence/licenses" && sha256sum *) > "$evidence/license-sha256.txt"
  docker network create --internal wucora-image-review > /dev/null
  docker network inspect wucora-image-review > "$evidence/network-inspect.json"
  docker run -d --name wucora-image-review --network wucora-image-review \
    --tmpfs /data:rw,size=256m \
    -e SQLITE_PATH=/data/isolated.db -e SQL_DSN= -e LOG_SQL_DSN= -e REDIS_CONN_STRING= \
    -e SESSION_SECRET=disposable-container-review-only-892ac212 \
    -e GIN_MODE=release -e UPDATE_TASK=false -e GLOBAL_API_RATE_LIMIT_ENABLE=false \
    -e CRITICAL_RATE_LIMIT=2000 -e HTTP_PROXY=http://127.0.0.1:1 \
    -e HTTPS_PROXY=http://127.0.0.1:1 -e NO_PROXY=127.0.0.1,localhost \
    "$IMAGE" > "$evidence/container-id.txt"
  address="$(docker inspect -f '{{(index .NetworkSettings.Networks "wucora-image-review").IPAddress}}' wucora-image-review)"
  [[ "$address" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+$ ]]
  printf 'CONTAINER_ORIGIN=http://%s:3000\n' "$address" >> "$GITHUB_ENV"
  for attempt in $(seq 1 120); do
    if curl --noproxy '*' --fail --silent "http://$address:3000/api/status" > "$evidence/status-before.json"; then exit 0; fi
    sleep 1
  done
  echo 'Container readiness failed' >&2
  exit 1
elif [ "$1" = finish ]; then
  docker logs wucora-image-review > "$evidence/container.log" 2>&1 || true
  docker inspect wucora-image-review > "$evidence/container-inspect.json" 2>/dev/null || true
  docker rm -f wucora-image-review > /dev/null 2>&1 || true
  docker network rm wucora-image-review > /dev/null 2>&1 || true
else
  exit 2
fi
