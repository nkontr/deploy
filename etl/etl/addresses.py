"""Юридические адреса юрлиц из ЕГРЮЛ через DaData («Организация по ИНН», findById/party).

В реестре МСП адреса нет — без него точка компании условная (здание в её населённом пункте, etl/geo.py).
Здесь: ИНН юрлиц -> DaData -> etl.egrul_address (кэш, переживает перезагрузку) -> core.company:
адрес в карточку, а при точности «дом» (qc_geo 0/1) и попадании в область — точка на адресе,
geo_precision = 'address'. У ИП адрес в ЕГРИП закрыт — их не запрашиваем.

Бесплатный тариф DaData — 10 000 запросов в сутки: очередь «клиенты РТ -> по выручке», лимит
DADATA_DAILY_LIMIT (9 000, с запасом). Без DADATA_API_KEY задача пропускается.
"""
import json
import logging
import os
import time
import urllib.request

log = logging.getLogger("etl.addresses")

URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party"
EXACT_QC = (0, 1)                        # 0 — точные координаты дома, 1 — ближайший дом
LAT, LON = (45.9, 50.3), (38.2, 44.4)    # рамка Ростовской области: адрес за её пределами точкой не ставим
PAUSE = 0.1                              # 10 запросов в секунду; лимит DaData — 30


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


def run(conn, key=None, daily_limit=None, lookup_fn=lookup, pause=PAUSE):
    """Один проход в пределах суточного лимита. Возвращает details для журнала."""
    key = key if key is not None else os.environ.get("DADATA_API_KEY", "")
    daily_limit = daily_limit if daily_limit is not None else int(os.environ.get("DADATA_DAILY_LIMIT", "9000"))
    if not key:
        log.info("DADATA_API_KEY не задан — адреса из ЕГРЮЛ не запрашиваем")
        return {"skipped": "нет DADATA_API_KEY"}
    cur = conn.cursor()
    used = cur.execute("SELECT count(*) FROM etl.egrul_address WHERE fetched_at > now() - interval '1 day'").fetchone()[0]
    inns = queue(cur, max(daily_limit - used, 0))
    done, exact, errors = 0, 0, []
    for inn in inns:
        try:
            found, address, lat, lon, qc = lookup_fn(inn, key)
        except Exception as e:                    # 403 — ключ или лимит, сеть — останавливаемся, продолжим завтра
            errors.append(f"{inn}: {e}")
            log.warning("DaData: %s — остановка, продолжим в следующий запуск", e)
            break
        cur.execute("INSERT INTO etl.egrul_address (inn, found, address, lat, lon, qc_geo) VALUES (%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT (inn) DO UPDATE SET found = EXCLUDED.found, address = EXCLUDED.address, "
                    "lat = EXCLUDED.lat, lon = EXCLUDED.lon, qc_geo = EXCLUDED.qc_geo, fetched_at = now()",
                    (inn, found, address, lat, lon, qc))
        done += 1
        exact += is_exact(qc, lat, lon)
        if done % 200 == 0:
            conn.commit()                         # прерванный проход не теряет уже полученное
            log.info("ЕГРЮЛ: %d из %d", done, len(inns))
        time.sleep(pause)
    applied = apply(cur)
    left = cur.execute("SELECT count(*) FROM core.company c LEFT JOIN etl.egrul_address e ON e.inn = c.inn "
                       "WHERE c.subject_type = 'legal' AND e.inn IS NULL").fetchone()[0]
    conn.commit()
    details = {"requested": done, "exact": exact, "companies_on_address": applied, "left": left,
               "used_today": used + done, "errors": errors[:3]}
    log.info("адреса ЕГРЮЛ: %s", details)
    return details
