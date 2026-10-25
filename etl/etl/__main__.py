"""ETL: etl.raw_* -> core.*.   python -m etl serve (сервис) | load | demo-project (разово из консоли)"""
import argparse
import csv
import gzip
import json
import logging
import os
import re
import sys
import time
from collections import Counter
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from . import addresses
from . import geo
from . import model
from . import prices
from . import normalize as nz

log = logging.getLogger("etl")
DATA = Path(os.environ.get("DATA_DIR") or Path(__file__).resolve().parent.parent / "data")
BATCH = 5000

SRC_COLS = ("src_no, name, subject_type, category, ogrn, inn, okved, region, district, city, settlement, "
            "is_new, included_at, excluded_at, phone, email, website, has_licenses, innovative, "
            "partnership, social, employees")
COMPANY_COLS = ("inn, ogrn, name, subject_type, size_category, okved_code, okved_name, industry, municipality_id, "
                "settlement, lat, lon, registered_at, is_new, employees, phone, email, website, has_licenses, "
                "is_innovative, is_social, revenue_est, revenue_growth_est, revenue_source, is_estimated, "
                "is_client, status, excluded_at, geo_precision")


# ---------------------------------------------------------------- подключение

def connect(url, autocommit=False):
    for attempt in range(1, 31):
        try:
            return psycopg.connect(url, autocommit=autocommit)
        except psycopg.OperationalError as e:
            if attempt == 30:
                raise
            log.warning("БД недоступна (%d/30): %s", attempt, str(e).strip().splitlines()[0])
            time.sleep(2)


# ---------------------------------------------------------------- справочники

def load_centroids(path, what):
    if not path.exists():
        raise RuntimeError(f"нет файла {path} — создайте его: python etl/tools/geocode_nominatim.py ({what})")
    raw = json.loads(path.read_text(encoding="utf-8"))
    out = {}
    for k, v in raw.items():
        out[k] = (float(v["lat"]), float(v["lon"])) if isinstance(v, dict) else (float(v[0]), float(v[1]))
    return out


def copy_gz(cur, path, table):
    """COPY из .csv.gz; колонки — из заголовка файла."""
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        cols = next(csv.reader(f))
    with cur.copy(f"COPY {table} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, HEADER true)") as cp:
        with gzip.open(path, "rb") as f:
            while chunk := f.read(1 << 20):
                cp.write(chunk)


# ---------------------------------------------------------------- компании

class Ctx:
    def __init__(self, muni, settlements, buildings, okved, fns):
        self.muni, self.settlements, self.buildings, self.okved, self.fns = muni, settlements, buildings, okved, fns
        self.skipped = Counter()
        self.geo = Counter()                  # сколько компаний на какой точности координат


def make_company(ctx, rec, is_client, status, excluded_at):
    inn = rec["inn"]
    place = nz.norm_municipality(rec.get("district"), rec.get("city"))
    if place is None or place[0] not in ctx.muni:
        ctx.skipped["no_place"] += 1
        return None
    mid, kind, lat0, lon0 = ctx.muni[place[0]]
    settlement = nz.settlement_of(rec.get("district"), rec.get("city"), rec.get("settlement"), place)
    lat, lon, precision = geo.place(ctx.buildings, place[0], (lat0, lon0), settlement,
                                    ctx.settlements.get(f"{place[0]}|{settlement}") if settlement else None)
    ctx.geo[precision] += 1

    subject = nz.subject_type_of(rec.get("subject_type"))
    size = nz.size_of(rec.get("category"))
    if size is None:
        ctx.skipped["unknown_size"] += 1
        size = "micro"
    code, oname = nz.split_okved(rec.get("okved"))
    industry = nz.industry_of(code, ctx.okved)
    registered = nz.parse_date(rec.get("included_at"))
    employees = nz.parse_int(rec.get("employees"))

    fns = ctx.fns.get(inn)
    if fns and fns[0] and fns[0] > 0:
        revenue, growth, source, estimated = round(fns[0], 2), model.growth_fns(fns[0], fns[1]), "fns", False
        if growth is None:                    # один год в ФНС или маленькая база — рост по модели, как у остальных
            growth = model.growth_model(inn, registered, industry)
    else:
        revenue = model.revenue_model(inn, size, subject, industry, employees)
        growth, source, estimated = model.growth_model(inn, registered, industry), "model", True

    return (inn, nz.clean_text(rec.get("ogrn")) or None, nz.clean_text(rec.get("name")) or "(без названия)",
            subject, size, code, oname, industry, mid, settlement, lat, lon, registered,
            nz.yes(rec.get("is_new")), employees,
            nz.clean_text(rec.get("phone")) or None, nz.clean_text(rec.get("email")) or None,
            nz.clean_text(rec.get("website")) or None,
            nz.yes(rec.get("has_licenses")), nz.yes(rec.get("innovative")), nz.yes(rec.get("social")),
            revenue, growth, source, estimated, is_client, status, excluded_at, precision)


def copy_companies(cur, rows):
    with cur.copy(f"COPY core.company ({COMPANY_COLS}) FROM STDIN") as cp:
        for r in rows:
            cp.write_row(r)


# ---------------------------------------------------------------- продукт 2

def resolve_invest_muni(raw, known):
    r = nz.norm_municipality(raw, "")
    if r is None:
        return None
    name, kind = r
    if name in known:
        return name, kind
    base = name[3:] if name.startswith("г. ") else name[:-4]
    for alt in ("г. " + base, base + " р-н"):
        if alt in known:
            return alt, ("city" if alt.startswith("г. ") else "district")
    return name, kind


def load_rules(path):
    with open(path, encoding="utf-8", newline="") as f:
        return [(r["keyword"].strip().lower(), r["industry"].strip(), [x for x in r["needs"].split("|") if x])
                for r in csv.DictReader(f) if r["keyword"].strip()]


def load_overrides(path):
    out = {}
    if path.exists():
        with open(path, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                out[r["src_no"].strip()] = r
    return out


def invest_stage(start, launch):
    # Лист МОД2 — реестр планов: проект со стартом в текущем году ещё на этапе проекта и разрешений,
    # для продаж это лучшее окно (связь, ИТ и безопасность можно заложить в проект). Допущение — в README.
    if start is not None and start >= model.CURRENT_YEAR:
        return "design"
    if launch is not None and launch <= model.CURRENT_YEAR:
        return "launch"
    return "construction"


def load_invest(cur, invest_rows, muni, muni_of_raw):
    rules = load_rules(DATA / "invest_keywords.csv")
    overrides = load_overrides(DATA / "invest_overrides.csv")
    n = 0
    for r in invest_rows:
        name = muni_of_raw.get(r["municipality"])
        if name is None:
            log.warning("инвестпроект №%s без муниципалитета — пропущен", r["src_no"])
            continue
        title = nz.clean_text(r["title"])
        low = title.lower()
        industry, needs = "other", []
        for kw, ind, nd in rules:
            if re.search(r"(?<!\w)" + re.escape(kw), low):
                industry, needs = ind, nd
                break
        start, launch = nz.parse_int(r["start_year"]), nz.parse_int(r["launch_year"])
        stage = invest_stage(start, launch)
        ov = overrides.get((r["src_no"] or "").strip())
        if ov:
            industry = ov.get("industry") or industry
            if ov.get("needs"):
                needs = [x for x in ov["needs"].split("|") if x]
            stage = ov.get("stage") or stage
        amount = nz.parse_num(r["amount_mln"])
        cur.execute(
            "INSERT INTO core.invest_project (municipality_id, initiator, title, is_key, curator, start_year, "
            "launch_year, amount_mln, jobs, stage, industry, needs) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (muni[name][0], nz.clean_text(r["initiator"]) or None, title or "(без названия)", nz.yes(r["is_key"]),
             nz.clean_text(r["curator"]) or None, start, launch,
             None if amount is None else round(amount, 2), nz.parse_int(r["jobs"]), stage, industry, needs))
        n += 1
    return n


# ---------------------------------------------------------------- load

def do_load(conn, run_id):
    t0 = time.time()
    # NON_MSP=exclude (по умолчанию): записи с категорией «Не является субъектом МСП» — не рынок МСП:
    # не-клиентов не загружаем, клиентов из этой категории помечаем исключёнными. NON_MSP=keep — вернуть как раньше.
    exclude_non_msp = os.environ.get("NON_MSP", "exclude").strip().lower() != "keep"
    log.info("записи «Не является субъектом МСП»: %s", "исключаем" if exclude_non_msp else "оставляем (NON_MSP=keep)")
    cur = conn.cursor()
    dcur = conn.cursor(row_factory=dict_row)

    # 0. очистка (company_location не трогаем)
    cur.execute("TRUNCATE etl.raw_rmsp, etl.raw_revenue")
    cur.execute("TRUNCATE core.municipality_stats, core.invest_project, core.company, core.municipality CASCADE")
    cur.execute("SELECT setval('core.municipality_id_seq', 1, false), setval('core.company_id_seq', 1, false), "
                "setval('core.invest_project_id_seq', 1, false)")

    # 1. сырьё
    rmsp_path, rev_path = DATA / "rmsp_61.csv.gz", DATA / "revenue_fns.csv.gz"
    if rmsp_path.exists():
        copy_gz(cur, rmsp_path, "etl.raw_rmsp")
    else:
        log.warning("WARN: нет %s — загружаю только клиентов (759). Сделайте выгрузку реестра.", rmsp_path)
    if rev_path.exists():
        copy_gz(cur, rev_path, "etl.raw_revenue")

    # клиенты (ИНН с восстановленным ведущим нулём)
    clients = {}
    for r in dcur.execute(f"SELECT {SRC_COLS} FROM etl.raw_clients ORDER BY src_no"):
        r["inn"] = nz.fix_inn(r["inn"], r["subject_type"])
        if r["inn"] and r["inn"] not in clients:
            clients[r["inn"]] = r
    log.info("клиентов в кейсе: %d", len(clients))

    # 2. муниципалитеты (клиенты + нужные строки реестра [+ инвестпроекты])
    names = {}
    for r in clients.values():
        p = nz.norm_municipality(r["district"], r["city"])
        if p:
            names[p[0]] = p[1]
    for r in dcur.execute("SELECT DISTINCT district, city FROM etl.raw_rmsp WHERE NOT is_excluded OR inn = ANY(%s)",
                          (list(clients),)):
        p = nz.norm_municipality(r["district"], r["city"])
        if p:
            names[p[0]] = p[1]

    invest_rows, muni_of_raw = [], {}
    if (DATA / "invest_keywords.csv").exists():
        invest_rows = list(dcur.execute("SELECT src_no, municipality, curator, is_key, initiator, title, "
                                        "start_year, launch_year, amount_mln, jobs FROM etl.raw_invest"))
        invest_rows.sort(key=lambda r: int(r["src_no"]) if (r["src_no"] or "").isdigit() else 10 ** 9)
        for r in invest_rows:
            res = resolve_invest_muni(r["municipality"], names)
            if res:
                muni_of_raw[r["municipality"]] = res[0]
                names.setdefault(res[0], res[1])
    if len(names) > 55:
        log.warning("WARN: %d муниципалитетов после нормализации (ожидалось ≤ ~55) — проверьте написание", len(names))

    # 3. справочник с центроидами
    centroids = load_centroids(DATA / "municipalities.json", "районы и города")
    missing = sorted(n for n in names if n not in centroids)
    if missing:
        raise RuntimeError("нет координат центроида для: " + "; ".join(missing))
    settlements = {}
    if (DATA / "settlements.json").exists():
        settlements = load_centroids(DATA / "settlements.json", "населённые пункты")
    buildings = geo.Buildings(DATA / "buildings.csv.gz")
    if not len(buildings):
        log.warning("WARN: нет data/buildings.csv.gz — компании встанут в случайные точки у центров районов "
                    "(python etl/tools/fetch_osm_buildings.py)")
    muni = {}
    for name in sorted(names):
        lat, lon = centroids[name]
        mid = cur.execute("INSERT INTO core.municipality (name, kind, lat, lon) VALUES (%s,%s,%s,%s) RETURNING id",
                          (name, names[name], lat, lon)).fetchone()[0]
        muni[name] = (mid, names[name], lat, lon)

    # 4–5. компании
    fns = {}
    years = {}
    for inn, year, income in cur.execute("SELECT inn, year, income FROM etl.raw_revenue"):
        if income is not None:
            years.setdefault(inn, {})[year] = float(income)
    for inn, ys in years.items():
        last = max(ys)
        fns[inn] = (ys[last], ys.get(last - 1))
    ctx = Ctx(muni, settlements, buildings, nz.load_okved_industry(DATA / "okved_industry.csv"), fns)

    client_rmsp, seen = {}, set()
    scur = conn.cursor(name="rmsp_stream", row_factory=dict_row)
    scur.execute(f"SELECT {SRC_COLS}, is_excluded FROM etl.raw_rmsp "
                 "WHERE NOT is_excluded OR inn = ANY(%s) ORDER BY inn, is_excluded", (list(clients),))
    while True:
        batch = scur.fetchmany(BATCH)
        if not batch:
            break
        out = []
        for r in batch:
            inn = r["inn"]
            if inn in clients:
                client_rmsp.setdefault(inn, r)       # первой идёт действующая запись
                continue
            if r["is_excluded"] or inn in seen:
                continue
            if exclude_non_msp and nz.is_non_msp(r["category"]):
                ctx.skipped["non_msp_not_loaded"] += 1
                continue
            seen.add(inn)
            row = make_company(ctx, r, False, "active", None)
            if row:
                out.append(row)
        copy_companies(cur, out)
    scur.close()

    out = []
    for inn in sorted(clients):
        case_row, rm = clients[inn], client_rmsp.get(inn)
        if rm is not None and not rm["is_excluded"]:
            if exclude_non_msp and nz.is_non_msp(rm["category"]):
                ctx.skipped["clients_non_msp_marked_excluded"] += 1
                row = make_company(ctx, rm, True, "excluded", nz.parse_date(rm["excluded_at"]))
            else:
                row = make_company(ctx, rm, True, "active", None)
        elif rm is not None:
            row = make_company(ctx, rm, True, "excluded", nz.parse_date(rm["excluded_at"]))
        else:
            row = make_company(ctx, case_row, True, "excluded", nz.parse_date(case_row["excluded_at"]))
        if row:
            out.append(row)
    copy_companies(cur, out)
    # Адреса из ЕГРЮЛ (кэш etl.egrul_address): точка на адресе вместо условной на здании нас. пункта
    addresses.apply(cur)
    geo_counts = dict(cur.execute("SELECT geo_precision, count(*) FROM core.company GROUP BY 1").fetchall())
    for k, v in ctx.skipped.items():
        log.warning("WARN: %s: %d строк", k, v)
    log.info("координаты: %s", geo_counts)

    # продукт 2
    invest_n = load_invest(cur, invest_rows, muni, muni_of_raw) if invest_rows else 0

    # 6. статистика районов — формула в БД
    white = cur.execute("SELECT core.refresh_municipality_stats()").fetchone()[0]
    if not 3 <= white <= 8:
        log.warning("WARN: белых пятен %d (цель 3–8) — калибруйте пороги", white)

    # 7. итог
    total, act, exc, others = cur.execute(
        "SELECT count(*), count(*) FILTER (WHERE is_client AND status='active'), "
        "count(*) FILTER (WHERE is_client AND status='excluded'), count(*) FILTER (WHERE NOT is_client) "
        "FROM core.company").fetchone()
    details = {"companies": total, "clients_active": act, "clients_excluded": exc, "others": others,
               "municipalities": len(muni), "white_spots": white, "invest_projects": invest_n,
               "skipped": dict(ctx.skipped), "geo_precision": geo_counts, "seconds": round(time.time() - t0, 1)}
    # clock_timestamp(), а не now(): now() внутри транзакции — время её начала, длительность выходила ~0 с
    cur.execute("UPDATE etl.load_run SET status='ok', finished_at=clock_timestamp(), details=%s WHERE id=%s",
                (Jsonb(details), run_id))
    log.info("ГОТОВО: %s", json.dumps(details, ensure_ascii=False))
    print(json.dumps(details, ensure_ascii=False, indent=2))


def cmd_load(url):
    ctl = connect(url, autocommit=True)              # журнал живёт отдельно: переживает откат
    run_id = ctl.execute("INSERT INTO etl.load_run DEFAULT VALUES RETURNING id").fetchone()[0]
    try:
        with connect(url) as conn:                   # одна транзакция: commit в конце, rollback при ошибке
            do_load(conn, run_id)
    except Exception as e:
        log.exception("ETL упал, транзакция откатена")
        ctl.execute("UPDATE etl.load_run SET status='failed', finished_at=clock_timestamp(), details=%s WHERE id=%s",
                    (Jsonb({"error": str(e)}), run_id))
        return 1
    return 0


def add_demo_project(url):
    """Один свежий проект (updated_at = now()) для демо уведомлений. -> (id, муниципалитет) или None."""
    with connect(url, autocommit=True) as conn:
        row = conn.execute("SELECT id, name FROM core.municipality ORDER BY id LIMIT 1").fetchone()
        if not row:
            return None
        pid = conn.execute(
            "INSERT INTO core.invest_project (municipality_id, initiator, title, is_key, start_year, launch_year, "
            "amount_mln, jobs, stage, industry, needs, updated_at) "
            "VALUES (%s, %s, %s, false, %s, %s, %s, %s, 'design', 'logistics', %s, now()) RETURNING id",
            (row[0], "Демо-инициатор", "Демо: строительство логистического центра", model.CURRENT_YEAR + 1,
             model.CURRENT_YEAR + 3, 500, 120, ["it_infra", "phys_security"])).fetchone()[0]
    return pid, row[1]


def cmd_demo_project(url):
    res = add_demo_project(url)
    if res is None:
        log.error("в core.municipality пусто — сначала python -m etl load")
        return 1
    print(f"добавлен проект id={res[0]}, муниципалитет: {res[1]}")
    return 0


def cmd_prices(url):
    """Парсинг цен калькулятора: прайсы Ростелекома + аналоги tinko.ru (etl/prices.py)."""
    with connect(url) as conn:
        status, _ = prices.run(conn, DATA)
    return 0 if status == "ok" else 1


def cmd_addresses(url):
    """Юридические адреса юрлиц из ЕГРЮЛ (DaData) в пределах суточного лимита (etl/addresses.py)."""
    with connect(url) as conn:
        return addresses.run(conn)


def cmd_serve(url):
    from .server import serve
    return serve(url, connect, cmd_load, add_demo_project, cmd_prices, cmd_addresses)


def main(argv=None):
    logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="python -m etl")
    ap.add_argument("command", choices=["load", "demo-project", "prices", "addresses", "serve"])
    args = ap.parse_args(argv)
    url = os.environ.get("DATABASE_URL")
    if not url:
        ap.error("не задан DATABASE_URL")
    res = {"load": cmd_load, "demo-project": cmd_demo_project, "prices": cmd_prices,
           "addresses": cmd_addresses, "serve": cmd_serve}[args.command](url)
    return 0 if isinstance(res, dict) else res


if __name__ == "__main__":
    sys.exit(main())
