#!/usr/bin/env bash
set -euo pipefail
evidence="$RUNNER_TEMP/image-evidence"
network=wucora-image-review
mock_image='oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d'

record_runtime_inspect() {
  python3 - <<'PY'
import json, os, re, subprocess
p=os.environ['RUNNER_TEMP']+'/image-evidence/'
for name,output in [('wucora-image-review','container-inspect.json'),('wucora-image-mock','mock-container-inspect.json')]:
    result=subprocess.run(['docker','inspect',name],capture_output=True,text=True)
    if result.returncode: continue
    data=json.loads(result.stdout)
    for c in data:
        c['Config']['Env']=[e.split('=',1)[0]+'=[redacted]' if re.search(r'(SECRET|PASSWORD|TOKEN|API_KEY)',e.split('=',1)[0],re.I) else e for e in c['Config'].get('Env',[])]
    json.dump(data,open(p+output,'w'),indent=2)
PY
}

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
registry=json.load(open(p+'registry-resolution.json'))
assert registry['registryDigest']==os.environ['REGISTRY_DIGEST']
assert registry['imageReference']==os.environ['IMAGE']
assert registry['productSHA']==os.environ['PRODUCT_SHA']
assert registry['configDigest']==i['Id']
assert registry['imageReference'] in i.get('RepoDigests',[])
json.dump(dict(productSHA=os.environ['PRODUCT_SHA'],productTree=os.environ['PRODUCT_TREE'],workflowSHA=os.environ['GITHUB_SHA'],platform='linux/amd64',imageID=i['Id'],imageReference=os.environ['IMAGE'],registryDigest=registry['registryDigest'],platformManifestDigest=registry['platformManifestDigest'],configDigest=registry['configDigest'],published=True,rebuilt=False),open(p+'image-identity.json','w'),indent=2)
PY
  docker create --name wucora-inspect "$IMAGE" > /dev/null
  mkdir -p "$evidence/licenses" "$RUNNER_TEMP/license-blobs"
  docker cp wucora-inspect:/licenses/. "$evidence/licenses/"
  docker rm wucora-inspect > /dev/null
  for file in LICENSE NOTICE THIRD-PARTY-LICENSES.md; do
    git -C product show "$PRODUCT_SHA:$file" > "$RUNNER_TEMP/license-blobs/$file"
    cmp "$RUNNER_TEMP/license-blobs/$file" "$evidence/licenses/$file"
  done
  (cd "$evidence/licenses" && sha256sum *) > "$evidence/license-sha256.txt"
  python3 - <<'PY'
import hashlib, json, os, subprocess
p=os.environ['RUNNER_TEMP']+'/image-evidence/'
files=[]
for name in ['LICENSE','NOTICE','THIRD-PARTY-LICENSES.md']:
    data=open(p+'licenses/'+name,'rb').read()
    expected=subprocess.check_output(['git','-C','product','show',os.environ['PRODUCT_SHA']+':'+name])
    assert data==expected
    files.append(dict(file=name,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),matchesProductGitBlob=True))
json.dump(dict(productSHA=os.environ['PRODUCT_SHA'],files=files),open(p+'license-verification.json','w'),indent=2)
PY
  docker pull "$mock_image" > "$evidence/mock-image-pull.log"
  docker network create --internal "$network" > /dev/null
  docker network inspect "$network" > "$evidence/network-inspect.json"
  docker run -d --name wucora-image-mock --network "$network" \
    --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,size=16m,mode=1777 \
    --mount "type=bind,src=$GITHUB_WORKSPACE/automation/.github/scripts/image-mock.mjs,dst=/mock.mjs,readonly" \
    --entrypoint bun "$mock_image" /mock.mjs > "$evidence/mock-container-id.txt"
  docker run -d --name wucora-image-review --network "$network" \
    --tmpfs /data:rw,size=256m \
    -e SQLITE_PATH=/data/isolated.db -e SQL_DSN= -e LOG_SQL_DSN= -e REDIS_CONN_STRING= \
    -e SESSION_SECRET=disposable-registry-review-only-fe24147d \
    -e GIN_MODE=release -e UPDATE_TASK=false -e GLOBAL_API_RATE_LIMIT_ENABLE=false \
    -e CRITICAL_RATE_LIMIT=2000 -e HTTP_PROXY=http://127.0.0.1:1 \
    -e HTTPS_PROXY=http://127.0.0.1:1 -e NO_PROXY=127.0.0.1,localhost,wucora-image-mock \
    "$IMAGE" > "$evidence/container-id.txt"
  address="$(docker inspect -f '{{(index .NetworkSettings.Networks "wucora-image-review").IPAddress}}' wucora-image-review)"
  [[ "$address" =~ ^172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+$ ]]
  printf 'CONTAINER_ORIGIN=http://%s:3000\n' "$address" >> "$GITHUB_ENV"
  printf 'MOCK_UPSTREAM_ORIGIN=http://wucora-image-mock:8080\n' >> "$GITHUB_ENV"
  docker exec wucora-image-review readlink /proc/1/exe > "$evidence/runtime-executable.txt"
  test "$(cat "$evidence/runtime-executable.txt")" = /new-api
  docker exec wucora-image-review sha256sum /new-api > "$evidence/runtime-binary-sha256.txt"
  docker exec wucora-image-review sh -c 'grep " /data " /proc/mounts' > "$evidence/runtime-data-mount.txt"
  record_runtime_inspect
  mock_address="$(docker inspect -f '{{(index .NetworkSettings.Networks "wucora-image-review").IPAddress}}' wucora-image-mock)"
  for attempt in $(seq 1 120); do
    if curl --noproxy '*' --fail --silent "http://$mock_address:8080/health" > "$evidence/mock-health.json" && \
       curl --noproxy '*' --fail --silent "http://$address:3000/api/status" > "$evidence/status-before.json"; then exit 0; fi
    sleep 1
  done
  echo 'Container readiness failed' >&2
  exit 1
elif [ "$1" = finish ]; then
  mkdir -p "$evidence"
  if docker container inspect wucora-image-review > /dev/null 2>&1; then
    docker logs wucora-image-review 2>&1 | sed -E 's/(Bearer )[A-Za-z0-9._~+\/-]+/\1[redacted]/g' > "$evidence/container.log"
  fi
  record_runtime_inspect
  docker exec wucora-image-mock bun -e 'fetch("http://127.0.0.1:8080/stats").then(r=>r.text()).then(console.log)' > "$evidence/mock-stats.json" 2> "$evidence/mock-stats-error.log" || true
  docker rm -f wucora-image-review wucora-image-mock wucora-inspect > /dev/null 2>&1 || true
  docker network rm "$network" > /dev/null 2>&1 || true
  python3 - <<'PY'
import json, os, subprocess
p=os.environ['RUNNER_TEMP']+'/image-evidence/'
remaining={}
for name in ['wucora-image-review','wucora-image-mock','wucora-inspect']:
    remaining[name]=subprocess.run(['docker','container','inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
network_remaining=subprocess.run(['docker','network','inspect','wucora-image-review'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
json.dump(dict(containersRemaining=remaining,networkRemaining=network_remaining,passed=not any(remaining.values()) and not network_remaining),open(p+'cleanup.json','w'),indent=2)
assert not any(remaining.values()) and not network_remaining
PY
else
  exit 2
fi
