#!/usr/bin/env bash
# =====================================================================
# Что сервер выполняет по ключу GitHub Actions — и только это: в
# /root/.ssh/authorized_keys ключ стоит с command="/root/ci-deploy.sh" и без
# shell/портов. Копия этого файла лежит в /root (а не запускается из репозитория),
# чтобы обновление кода не меняло саму процедуру входа. Обновить копию:
#   install -m 700 /opt/radar/infra/deploy/ci-deploy.sh /root/ci-deploy.sh
# Код сервер берёт сам — deploy-ключом /root/.ssh/radar_deploy (только чтение).
# =====================================================================
set -euo pipefail
exec 9>/run/radar-deploy.lock
flock -n 9 || { echo "Деплой уже идёт"; exit 1; }

cd /opt/radar
git fetch -q origin before-main
git checkout -q before-main
git merge -q --ff-only origin/before-main      # .env и данные не в git — их не трогаем
echo "== версия $(git log --oneline -1)"
bash infra/deploy/build.sh
