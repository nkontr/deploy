"""etl-service: HTTP-обёртка над ETL (только стандартная библиотека).

GET  /health                        — без токена: жив ли сервис и идёт ли загрузка
POST /internal/etl/load             — запустить загрузку (202; 409, если уже идёт)
GET  /internal/etl/status           — последний запуск из etl.load_run + флаг running
POST /internal/etl/demo-project     — добавить демо-проект для notifier
POST /internal/etl/prices           — парсинг цен калькулятора (202; 409, если уже идёт)
GET  /internal/etl/prices/status    — последний запуск из etl.price_run + флаг running
POST /internal/etl/addresses        — адреса юрлиц из ЕГРЮЛ (DaData) в пределах суточного лимита (202; 409)
GET  /internal/etl/addresses/status — итог последнего прохода + сколько адресов уже в кэше
Цены парсятся и сами: после старта, если сегодня ещё не парсились, и раз в PRICES_EVERY_HOURS (24).
Адреса запрашиваются сами раз в сутки, если задан DADATA_API_KEY (бесплатный лимит — 10 000 в сутки).
/internal/* требуют заголовок X-Internal-Token (сравнение за постоянное время).
"""
import hmac
import json
import logging
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

log = logging.getLogger("etl.server")


def serve(url, connect, load_fn, demo_fn, prices_fn, addresses_fn):
    port = int(os.environ.get("PORT", "8084"))
    token = os.environ.get("INTERNAL_TOKEN", "internal_dev_token")
    auto = os.environ.get("AUTO_LOAD", "if-empty")       # if-empty | always | never
    prices_every = float(os.environ.get("PRICES_EVERY_HOURS", "24"))   # 0 — только по запросу
    lock = threading.Lock()
    prices_lock = threading.Lock()
    addresses_lock = threading.Lock()
    addresses_last = {}

    def start_addresses():
        if not addresses_lock.acquire(blocking=False):
            return False

        def run():
            started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
            try:
                details, status = addresses_fn(url), "ok"
            except Exception as e:
                log.exception("адреса ЕГРЮЛ")
                details, status = {"error": str(e)}, "failed"
            addresses_last.update(status=status, startedAt=started,      # итог — до снятия блокировки:
                                  finishedAt=time.strftime("%Y-%m-%dT%H:%M:%S%z"), details=details)
            addresses_lock.release()                                     # статус не увидит «не идёт, итога нет»

        threading.Thread(target=run, daemon=True, name="etl-addresses").start()
        return True

    def addresses_schedule():
        """Раз в сутки, если есть ключ DaData и данные уже загружены (адреса привязываются к core.company)."""
        if not os.environ.get("DADATA_API_KEY"):
            return
        while True:
            try:
                with connect(url, autocommit=True) as c:
                    loaded = c.execute("SELECT 1 FROM etl.load_run WHERE status = 'ok' LIMIT 1").fetchone()
                if loaded and not lock.locked():
                    start_addresses()
                    time.sleep(24 * 3600)
                    continue
            except Exception:
                log.exception("плановый запрос адресов")
            time.sleep(300)                       # загрузка ещё не прошла — проверим через 5 минут

    def start_prices():
        if not prices_lock.acquire(blocking=False):
            return False

        def run():
            try:
                prices_fn(url)
            except Exception:
                log.exception("парсинг цен")
            finally:
                prices_lock.release()

        threading.Thread(target=run, daemon=True, name="etl-prices").start()
        return True

    def last_prices():
        with connect(url, autocommit=True) as c:
            row = c.execute("SELECT id, started_at, finished_at, status, details FROM etl.price_run "
                            "ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        return {"id": row[0], "startedAt": row[1].isoformat(), "status": row[3],
                "finishedAt": row[2].isoformat() if row[2] else None, "details": row[4]}

    def prices_schedule():
        """После старта — если за последние PRICES_EVERY_HOURS удачного парсинга не было, дальше — по таймеру."""
        if prices_every <= 0:
            return
        while True:
            try:
                with connect(url, autocommit=True) as c:
                    fresh = c.execute("SELECT 1 FROM etl.price_run WHERE status = 'ok' "
                                      "AND started_at > now() - make_interval(secs => %s) LIMIT 1",
                                      (prices_every * 3600,)).fetchone()
                if not fresh:
                    log.info("плановый парсинг цен (раз в %s ч)", prices_every)
                    start_prices()
            except Exception:
                log.exception("плановый парсинг цен")
            time.sleep(prices_every * 3600)

    def start_load():
        if not lock.acquire(blocking=False):
            return False

        def run():
            try:
                load_fn(url)
            finally:
                lock.release()

        threading.Thread(target=run, daemon=True, name="etl-load").start()
        return True

    def last_run():
        with connect(url, autocommit=True) as c:
            row = c.execute("SELECT id, started_at, finished_at, status, details FROM etl.load_run "
                            "ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return None
        return {"id": row[0], "startedAt": row[1].isoformat(), "status": row[3],
                "finishedAt": row[2].isoformat() if row[2] else None, "details": row[4]}

    def autostart():
        try:
            if auto == "never":
                return
            if auto == "if-empty":
                with connect(url, autocommit=True) as c:      # connect() ждёт БД с повторами
                    if c.execute("SELECT 1 FROM etl.load_run WHERE status = 'ok' LIMIT 1").fetchone():
                        log.info("успешная загрузка уже была — автозапуск пропущен (AUTO_LOAD=if-empty)")
                        return
            log.info("автозапуск загрузки (AUTO_LOAD=%s)", auto)
            start_load()
        except Exception:
            log.exception("автозапуск не удался")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if self.path.startswith("/health"):          # healthcheck Docker раз в 10 с — не засоряем лог
                return
            log.info("%s %s", self.address_string(), fmt % args)

        def send(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def err(self, status, code, message):
            # формат ошибок как во всех сервисах (00-common): details присутствует, null — если уточнять нечего
            self.send(status, {"error": {"code": code, "message": message, "details": None}})

        def authorized(self):
            got = self.headers.get("X-Internal-Token", "")
            if hmac.compare_digest(got.encode(), token.encode()):
                return True
            self.err(401, "UNAUTHORIZED", "нужен заголовок X-Internal-Token")
            return False

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/health":
                return self.send(200, {"status": "ok", "running": lock.locked()})
            if path == "/internal/etl/addresses/status":
                if not self.authorized():
                    return
                try:
                    with connect(url, autocommit=True) as c:
                        total, exact = c.execute("SELECT count(*), count(*) FILTER (WHERE qc_geo IN (0, 1)) "
                                                 "FROM etl.egrul_address").fetchone()
                except Exception as e:
                    return self.err(502, "UPSTREAM_UNAVAILABLE", f"БД недоступна: {e}")
                return self.send(200, {"running": addresses_lock.locked(), "last": addresses_last or None,
                                       "cached": total, "exact": exact})
            if path == "/internal/etl/prices/status":
                if not self.authorized():
                    return
                try:
                    return self.send(200, {"running": prices_lock.locked(), "last": last_prices()})
                except Exception as e:
                    log.exception("prices status")
                    return self.err(502, "UPSTREAM_UNAVAILABLE", f"БД недоступна: {e}")
            if path == "/internal/etl/status":
                if not self.authorized():
                    return
                try:
                    return self.send(200, {"running": lock.locked(), "last": last_run()})
                except Exception as e:
                    log.exception("status")
                    return self.err(502, "UPSTREAM_UNAVAILABLE", f"БД недоступна: {e}")
            self.err(404, "NOT_FOUND", "нет такого пути")

        def do_POST(self):
            path = self.path.split("?")[0]
            if path == "/internal/etl/load":
                if not self.authorized():
                    return
                if not start_load():
                    return self.err(409, "CONFLICT", "загрузка уже идёт")
                return self.send(202, {"status": "started"})
            if path == "/internal/etl/addresses":
                if not self.authorized():
                    return
                if not start_addresses():
                    return self.err(409, "CONFLICT", "адреса уже запрашиваются")
                return self.send(202, {"status": "started"})
            if path == "/internal/etl/prices":
                if not self.authorized():
                    return
                if not start_prices():
                    return self.err(409, "CONFLICT", "парсинг цен уже идёт")
                return self.send(202, {"status": "started"})
            if path == "/internal/etl/demo-project":
                if not self.authorized():
                    return
                try:
                    res = demo_fn(url)
                except Exception as e:
                    log.exception("demo-project")
                    return self.err(500, "INTERNAL_ERROR", str(e))
                if res is None:
                    return self.err(409, "CONFLICT", "справочник районов пуст — сначала выполните загрузку")
                return self.send(201, {"projectId": res[0], "municipality": res[1]})
            self.err(404, "NOT_FOUND", "нет такого пути")

    threading.Thread(target=autostart, daemon=True, name="etl-autostart").start()
    threading.Thread(target=prices_schedule, daemon=True, name="etl-prices-schedule").start()
    threading.Thread(target=addresses_schedule, daemon=True, name="etl-addresses-schedule").start()
    log.info("etl-service слушает :%d", port)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
    return 0
