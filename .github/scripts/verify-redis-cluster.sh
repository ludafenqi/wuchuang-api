#!/usr/bin/env bash
# Copyright (C) 2023-2026 QuantumNous
# SPDX-License-Identifier: AGPL-3.0-or-later
set -euo pipefail

# Disposable Linux-runner topology: three sharded masters and three replicas.
# No gateway image is built, exported, cached or published here.
prefix="wucora-cluster-${GITHUB_RUN_ID:-local}-$$"
containers=()
cleanup() {
  if ((${#containers[@]})); then docker rm -f "${containers[@]}" >/dev/null; fi
}
trap cleanup EXIT
addresses=()
for port in 7000 7001 7002 7003 7004 7005; do
  name="$prefix-$port"
  containers+=("$name")
  addresses+=("127.0.0.1:$port")
  docker run --detach --name "$name" --network host --tmpfs /data redis:7.4-alpine \
    redis-server --port "$port" --bind 127.0.0.1 --protected-mode yes \
    --cluster-enabled yes --cluster-config-file nodes.conf \
    --cluster-node-timeout 5000 --cluster-announce-ip 127.0.0.1 \
    --appendonly no --save '' >/dev/null
done
for port in 7000 7001 7002 7003 7004 7005; do
  ready=false
  for attempt in {1..30}; do
    if docker exec "${containers[0]}" redis-cli -p "$port" ping | grep -q PONG; then ready=true; break; fi
    sleep 1
  done
  "$ready"
done
docker exec "${containers[0]}" redis-cli -p 7000 --cluster create "${addresses[@]}" --cluster-replicas 1 --cluster-yes
ready=false
for attempt in {1..30}; do
  if docker exec "${containers[0]}" redis-cli -p 7000 cluster info | grep -q 'cluster_state:ok'; then ready=true; break; fi
  sleep 1
done
"$ready"
docker exec "${containers[0]}" redis-cli -p 7000 info server | grep redis_version
docker exec "${containers[0]}" redis-cli -p 7000 cluster nodes
TEST_AUTH_REDIS_CLUSTER_ADDRS="$(IFS=,; echo "${addresses[*]}")" \
  go test ./model -run '^TestAuthCacheRealRedisCluster$' -count=1 -v
