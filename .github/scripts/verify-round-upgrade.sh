#!/usr/bin/env bash
set -euo pipefail
base=10630f3f183eecb6e73ddead4388cbaba2c5f60e
candidate=ae3f0a483373d599af0f95ece5ae6bfe13b3a402
out="$RUNNER_TEMP/upgrade-evidence"
mkdir -p "$out"
for version in base candidate; do
  ref="${!version}"
  git worktree add --detach "$RUNNER_TEMP/$version" "$ref"
  (
    cd "$RUNNER_TEMP/$version"
    test "$(git rev-parse HEAD)" = "$ref"
    mkdir -p web/dist
    touch web/dist/index.html
    go build -o "$RUNNER_TEMP/$version-api" .
  )
done

pid=
stop() {
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" || true
    pid=
  fi
}
trap stop EXIT
start() {
  local version="$1" name="$2"
  (
    cd "$RUNNER_TEMP"
    exec env SQL_DSN="$dsn" LOG_SQL_DSN="$log_dsn" SQLITE_PATH="$sqlite" \
      HOST=127.0.0.1 PORT=39919 NODE_TYPE=master UPDATE_TASK=false \
      REDIS_CONN_STRING= SESSION_SECRET=disposable-review-only GIN_MODE=release \
      "$RUNNER_TEMP/$version-api"
  ) > "$out/$name.log" 2>&1 &
  pid=$!
  for i in {1..90}; do
    kill -0 "$pid"
    if curl -fsS http://127.0.0.1:39919/api/status > "$out/$name-status.json" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

db() {
  case "$dialect" in
    sqlite)
      python3 - "$sqlite" "$1" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as con:
    for row in con.execute(sys.argv[2]):
        print(*row)
PY
      ;;
    mysql) docker exec "$MYSQL_CONTAINER" mysql -uroot -pdisposable-review-only -N -B -r "$name" -e "${1// key / \`key\` }" ;;
    postgres) docker exec "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -At -d "$name" -c "$1" ;;
  esac
}

for dialect in sqlite mysql postgres; do
  for mode in fresh upgrade; do
    name="review_${mode}"
    sqlite="$RUNNER_TEMP/$name.sqlite"
    dsn=
    log_dsn=
    case "$dialect" in
      mysql)
        docker exec "$MYSQL_CONTAINER" mysql -uroot -pdisposable-review-only -e "CREATE DATABASE $name CHARACTER SET utf8mb4; CREATE DATABASE ${name}_logs CHARACTER SET utf8mb4;"
        dsn="root:disposable-review-only@tcp(127.0.0.1:3306)/$name?parseTime=true"
        log_dsn="root:disposable-review-only@tcp(127.0.0.1:3306)/${name}_logs?parseTime=true"
        ;;
      postgres)
        for dbname in "$name" "${name}_logs"; do
          docker exec "$POSTGRES_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -c "CREATE DATABASE $dbname"
        done
        dsn="postgres://postgres:disposable-review-only@127.0.0.1:5432/$name?sslmode=disable"
        log_dsn="postgres://postgres:disposable-review-only@127.0.0.1:5432/${name}_logs?sslmode=disable"
        ;;
    esac
    if [ "$mode" = upgrade ]; then
      start base "$dialect-$mode-base"
      stop
      for pair in CheckSensitiveEnabled:true CheckSensitiveOnPromptEnabled:true SensitiveWords:upgrade_fixture; do
        db "DELETE FROM options WHERE key = '${pair%:*}'"
        db "INSERT INTO options (key,value) VALUES ('${pair%:*}','${pair#*:}')"
      done
      db "INSERT INTO system_tasks (task_id,type,status) VALUES ('legacy_fixture','legacy_fixture','succeeded')"
    fi
    for attempt in 1 2; do
      start candidate "$dialect-$mode-$attempt"
      stop
      if [ "$dialect" = sqlite ]; then
        db 'SELECT sqlite_version()'
        test "$(db "SELECT count(*) FROM pragma_index_list('system_tasks') WHERE name LIKE '%type_id%'")" = 1
      elif [ "$dialect" = mysql ]; then
        db 'SELECT version()'
        test "$(db "SELECT count(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name='system_tasks' AND index_name LIKE '%type_id%'")" = 2
      else
        db 'SELECT version()'
        test "$(db "SELECT count(*) FROM pg_indexes WHERE tablename='system_tasks' AND indexname LIKE '%type_id%'")" = 1
      fi
      if [ "$mode" = upgrade ]; then
        test "$(db "SELECT count(*) FROM system_tasks WHERE task_id='legacy_fixture' AND status='succeeded'")" = 1
        if db "INSERT INTO system_tasks (task_id,type,status) VALUES ('legacy_fixture','legacy_fixture','succeeded')" >/dev/null 2>&1; then
          echo "Unique task ID constraint was lost on $dialect" >&2
          exit 1
        fi
        test "$(db "SELECT count(*) FROM options WHERE key='SensitiveWords'")" = 0
        db "SELECT value FROM options WHERE value LIKE '%upgrade_fixture%'" | python3 -c 'import json,sys; items=json.load(sys.stdin); assert len(items)==1 and items[0]["plugin"]=="request-filter" and items[0]["enabled"] and items[0]["config"]["keywords"]=="upgrade_fixture"'
      fi
      echo "$dialect $mode start $attempt passed"
    done
  done
done | tee "$out/matrix.log"
