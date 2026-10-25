#!/usr/bin/env bash
# =====================================================================
# Собрать и запустить все сервисы на сервере — по одному образу за раз:
#   bash /opt/radar/infra/deploy/build.sh
# Параллельная сборка Java/.NET/Go/Node на 2 ядрах держит CPU на 100 % минутами —
# хостинг однажды выключил машину посреди такой сборки. Вызывается из
# ci-deploy.sh (GitHub Actions) и вручную. git pull здесь не делается.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

P="--profile product2"
services="postgres nginx"
for s in etl core-api auth-service export-service calc-service notifier; do
  [ -f "$s/Dockerfile" ] && services="$services $s"
done

for s in $services; do
  [ "$s" = postgres ] && continue                      # готовый образ, собирать нечего
  echo "== build $s $(date +%T)"
  docker compose $P build -q "$s"
done

echo "== up $(date +%T)"
docker compose $P up -d --remove-orphans $services
docker image prune -f >/dev/null

# Сервисы стартуют не мгновенно — ждём ответа через nginx до 2 минут
for i in $(seq 1 24); do
  ok=1
  for h in auth core export calc notifier; do
    curl -fs -o /dev/null "http://127.0.0.1:${HTTP_PORT:-80}/healthz/$h" || ok=0
  done
  [ $ok = 1 ] && break
  sleep 5
done

docker compose $P ps --format "table {{.Name}}\t{{.Status}}"
[ $ok = 1 ] || { echo "== FAILED: не все /healthz ответили за 2 минуты"; exit 1; }
echo "== DONE $(date +%T) $(git log --oneline -1)"
