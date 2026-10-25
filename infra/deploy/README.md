# Деплой на демо-сервер

Пуш в ветку `before-main` репозитория **github.com/nkontr/deploy** → GitHub Actions
(`.github/workflows/deploy.yml`) заходит на сервер по SSH → сервер скачивает `before-main`
и пересобирает сервисы по одному (`build.sh`). Ход и результат — во вкладке **Actions** репозитория.

```bash
git push mine before-main      # на Mac: remote mine = git@github.com:nkontr/deploy.git
```
Передеплоить без коммита: Actions → deploy → Run workflow.

## Как устроен доступ
| Ключ | Где | Что может |
| --- | --- | --- |
| `DEPLOY_SSH_KEY` (секрет репозитория) | `/root/.ssh/authorized_keys` на сервере с `command="/root/ci-deploy.sh"` | только запустить деплой: ни shell, ни проброса портов |
| `radar_deploy` | `/root/.ssh/radar_deploy` на сервере, открытая часть — Deploy keys репозитория | только читать репозиторий |

Секреты репозитория (Settings → Secrets and variables → Actions): `DEPLOY_SSH_KEY`, `DEPLOY_HOST`
(IP сервера), `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan` сервера — защита от подмены хоста).

## Руками на сервере
```bash
bash /opt/radar/infra/deploy/build.sh                       # пересобрать то, что уже скачано
cd /opt/radar && bash infra/smoke.sh                         # проверка
docker compose --profile product2 down -v && bash infra/deploy/build.sh   # с пустой БД (после правок infra/db/init)
```
Изменился `ci-deploy.sh` — обновить копию: `install -m 700 /opt/radar/infra/deploy/ci-deploy.sh /root/ci-deploy.sh`.

Первичная настройка нового сервера — `setup-server.sh` (`BRANCH=before-main REPO=git@github.com:nkontr/deploy.git`).
