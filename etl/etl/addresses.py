"""Юридические адреса юрлиц из ЕГРЮЛ через DaData («Организация по ИНН», findById/party).

В реестре МСП адреса нет — без него точка компании условная (здание в её населённом пункте, etl/geo.py).
Здесь: ИНН юрлиц -> DaData -> etl.egrul_address (кэш, переживает перезагрузку) -> core.company:
адрес в карточку, а при точности «дом» (qc_geo 0/1) и попадании в область — точка на адресе,
geo_precision = 'address'. У ИП адрес в ЕГРИП закрыт — их не запрашиваем.

Бесплатный тариф DaData — 10 000 запросов в сутки: очередь «клиенты РТ -> по выручке», лимит
DADATA_DAILY_LIMIT (9 000, с запасом). Запросы — в DADATA_WORKERS (4) потока: ответ идёт ~0,5 с, по одному
9 000 адресов — полтора часа; у DaData предел 30 запросов в секунду с адреса. Без DADATA_API_KEY — пропуск.
"""
import json
import logging
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("etl.addresses")

URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
EXACT_QC = (0, 1)                        # 0 — точные координаты дома, 1 — ближайший дом
LAT, LON = (45.9, 50.3), (38.2, 44.4)    # рамка Ростовской области: адрес за её пределами точкой не ставим
PAUSE = 0.1                              # пауза в каждом потоке: 4 потока — до ~8 запросов в секунду
BATCH = 200                              # запросов между сохранениями: прерванный проход теряет не больше
RETRIES = 3                              # повторов на сбой сети / 429 / 5xx
MAX_BATCH_ERRORS = 20                    # столько ИНН в пачке не удалось — сеть легла, останавливаемся


def lookup(inn, key, opener=urllib.request.urlopen):
    """ИНН -> (found, address, lat, lon, qc_geo). Главная организация, не филиал."""
    req = urllib.request.Request(URL, data=json.dumps({"query": inn, "branch_type": "MAIN", "count": 1}).encode(),
                                 headers={"Authorization": f"Token {key}", "Content-Type": "application/json",
                                          "Accept": "application/json"})
    with opener(req, timeout=15) as r:
        suggestions = json.load(r).get("suggestions") or []
    if not suggestions:
        return False, None, None, None, None
    addr = (suggestions[0].get("data") or {}).get("address") or {}
    d = addr.get("data") or {}

    def num(v, cast):
        try:
            return cast(v)
        except (TypeError, ValueError):
            return None

    return True, addr.get("unrestricted_value") or addr.get("value"), num(d.get("geo_lat"), float), \
        num(d.get("geo_lon"), float), num(d.get("qc_geo"), int)


def fatal(e):
    """401/403 — неверный ключ или исчерпан суточный лимит: повторять бессмысленно."""
    return isinstance(e, urllib.error.HTTPError) and e.code in (401, 403)


def is_exact(qc_geo, lat, lon):
    return qc_geo in EXACT_QC and lat is not None and lon is not None \
        and LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]


def apply(cur):
    """Кэш ЕГРЮЛ -> core.company. Зовётся после каждой загрузки (ETL пересоздаёт company) и после запросов."""
    cur.execute("UPDATE core.company c SET address = e.address FROM etl.egrul_address e "
                "WHERE e.inn = c.inn AND e.found AND e.address IS NOT NULL")
    cur.execute("UPDATE core.company c SET lat = e.lat, lon = e.lon, geo_precision = 'address' "
                "FROM etl.egrul_address e WHERE e.inn = c.inn AND e.qc_geo = ANY(%s) "
                "AND e.lat BETWEEN %s AND %s AND e.lon BETWEEN %s AND %s",
                (list(EXACT_QC), LAT[0], LAT[1], LON[0], LON[1]))
    return cur.rowcount


def queue(cur, limit):
    """Ещё не запрошенные юрлица: сначала клиенты РТ, потом по выручке."""
    return [r[0] for r in cur.execute(
        "SELECT c.inn FROM core.company c LEFT JOIN etl.egrul_address e ON e.inn = c.inn "
        "WHERE c.subject_type = 'legal' AND e.inn IS NULL "
        "ORDER BY c.is_client DESC, c.revenue_est DESC NULLS LAST, c.inn LIMIT %s", (limit,)).fetchall()]


def run(conn, key=None, daily_limit=None, lookup_fn=lookup, pause=PAUSE, workers=None):
    """Один проход в пределах суточного лимита. Возвращает details для журнала."""
    key = key if key is not None else os.environ.get("DADATA_API_KEY", "")
    daily_limit = daily_limit if daily_limit is not None else int(os.environ.get("DADATA_DAILY_LIMIT", "9000"))
    workers = workers or int(os.environ.get("DADATA_WORKERS", "4"))
    if not key:
        log.info("DADATA_API_KEY не задан — адреса из ЕГРЮЛ не запрашиваем")
        return {"skipped": "нет DADATA_API_KEY"}
    cur = conn.cursor()
    used = cur.execute("SELECT count(*) FROM etl.egrul_address WHERE fetched_at > now() - interval '1 day'").fetchone()[0]
    inns = queue(cur, max(daily_limit - used, 0))

    def one(inn):
        """Сбой сети, таймаут, 429, 5xx — повтор с паузой; 401/403 (ключ, суточный лимит) — сразу ошибка."""
        for attempt in range(RETRIES + 1):
            try:
                return inn, lookup_fn(inn, key), None
            except Exception as e:
                if fatal(e) or attempt == RETRIES:
                    return inn, None, e
                time.sleep(pause + attempt + 1)
            finally:
                time.sleep(pause)

    done, exact, errors, stop = 0, 0, [], False
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start in range(0, len(inns), BATCH):
            batch_errors = 0
            for inn, res, err in pool.map(one, inns[start:start + BATCH]):   # запросы параллельно, запись — здесь
                if err is not None:                   # не сохраняем — ИНН останется в очереди на следующий раз
                    errors.append(f"{inn}: {err}")
                    batch_errors += 1
                    stop = stop or fatal(err)
                    continue
                found, address, lat, lon, qc = res
                cur.execute("INSERT INTO etl.egrul_address (inn, found, address, lat, lon, qc_geo) "
                            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (inn) DO UPDATE SET found = EXCLUDED.found, "
                            "address = EXCLUDED.address, lat = EXCLUDED.lat, lon = EXCLUDED.lon, "
                            "qc_geo = EXCLUDED.qc_geo, fetched_at = now()", (inn, found, address, lat, lon, qc))
                done += 1
                exact += is_exact(qc, lat, lon)
            conn.commit()                         # прерванный проход не теряет уже полученное
            log.info("ЕГРЮЛ: %d из %d", done, len(inns))
            if stop or batch_errors > MAX_BATCH_ERRORS:
                log.warning("DaData: %s — остановка, продолжим в следующий запуск", errors[-1])
                break
    applied = apply(cur)
    left = cur.execute("SELECT count(*) FROM core.company c LEFT JOIN etl.egrul_address e ON e.inn = c.inn "
                       "WHERE c.subject_type = 'legal' AND e.inn IS NULL").fetchone()[0]
    conn.commit()
    details = {"requested": done, "exact": exact, "companies_on_address": applied, "left": left,
               "used_today": used + done, "errors": errors[:3]}
    log.info("адреса ЕГРЮЛ: %s", details)
    return details
