"""Разбор ответа DaData и правило «точка на адресе» (etl/addresses.py) — без сети и БД."""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl import addresses  # noqa: E402


def opener_for(body):
    """Подмена urlopen: проверяет запрос и отдаёт заранее заданный ответ DaData."""
    seen = {}

    def opener(req, timeout):
        seen["url"], seen["auth"], seen["body"] = req.full_url, req.headers["Authorization"], json.loads(req.data)
        return io.BytesIO(json.dumps(body).encode())
    return opener, seen


PARTY = {"suggestions": [{"value": "ООО \"ТЕСТ\"", "data": {"address": {
    "value": "г Ростов-на-Дону, ул Большая Садовая, д 1",
    "unrestricted_value": "344002, Ростовская обл, г Ростов-на-Дону, ул Большая Садовая, д 1",
    "data": {"geo_lat": "47.2224", "geo_lon": "39.7188", "qc_geo": "0"}}}}]}


def test_lookup_parses_address_and_coords():
    opener, seen = opener_for(PARTY)
    found, address, lat, lon, qc = addresses.lookup("6164000000", "KEY", opener=opener)
    assert (found, lat, lon, qc) == (True, 47.2224, 39.7188, 0)
    assert address.startswith("344002, Ростовская обл")
    assert seen["auth"] == "Token KEY"
    assert seen["body"] == {"query": "6164000000", "branch_type": "MAIN", "count": 1}   # головная, не филиал


def test_lookup_not_found_and_no_coords():
    opener, _ = opener_for({"suggestions": []})
    assert addresses.lookup("0000000000", "KEY", opener=opener) == (False, None, None, None, None)
    no_geo = {"suggestions": [{"data": {"address": {"value": "Ростовская обл", "data": {"qc_geo": None}}}}]}
    opener, _ = opener_for(no_geo)
    assert addresses.lookup("6164000000", "KEY", opener=opener) == (True, "Ростовская обл", None, None, None)


def test_exact_only_house_level_inside_region():
    assert addresses.is_exact(0, 47.22, 39.72)
    assert addresses.is_exact(1, 47.22, 39.72)
    assert not addresses.is_exact(2, 47.22, 39.72)          # улица — точкой на доме не ставим
    assert not addresses.is_exact(0, 55.75, 37.62)          # Москва: адрес не в области
    assert not addresses.is_exact(0, None, None)


def test_run_without_key_is_skipped():
    assert addresses.run(conn=None, key="") == {"skipped": "нет DADATA_API_KEY"}


class FakeCursor:
    """Минимальная БД для run(): очередь ИНН, запись ответов, счётчики."""

    def __init__(self, inns):
        self.inns, self.rows, self._result = inns, {}, None

    def execute(self, sql, params=None):
        if sql.startswith("SELECT count(*) FROM etl.egrul_address"):
            self._result = [(0,)]
        elif sql.startswith("SELECT c.inn"):
            self._result = [(i,) for i in self.inns[:params[0]]]
        elif sql.startswith("INSERT INTO etl.egrul_address"):
            self.rows[params[0]] = params
        elif sql.startswith("UPDATE"):
            self.rowcount = len(self.rows)
        else:                                       # «сколько осталось»
            self._result = [(len(self.inns) - len(self.rows),)]
        return self

    def fetchone(self):
        return self._result[0]

    def fetchall(self):
        return self._result


class FakeConn:
    def __init__(self, cur):
        self.cur, self.commits = cur, 0

    def cursor(self):
        return self.cur

    def commit(self):
        self.commits += 1


def test_run_parallel_saves_every_inn_once():
    inns = [f"61{i:08d}" for i in range(450)]
    conn = FakeConn(FakeCursor(inns))
    res = addresses.run(conn, key="KEY", daily_limit=9000, pause=0, workers=4,
                        lookup_fn=lambda inn, key: (True, f"адрес {inn}", 47.2, 39.7, 0))
    assert res["requested"] == 450 and res["exact"] == 450 and res["errors"] == []
    assert set(conn.cur.rows) == set(inns)                        # каждый ИНН записан ровно один раз
    assert conn.commits >= 3                                      # пачками по 200, а не одной транзакцией


def test_run_retries_transient_and_skips_unlucky_inn():
    inns = [f"61{i:08d}" for i in range(300)]
    calls = {}

    def lookup(inn, key):
        calls[inn] = calls.get(inn, 0) + 1
        if inn == inns[10] and calls[inn] == 1:
            raise TimeoutError("handshake timed out")              # сбой один раз — повтор помогает
        if inn == inns[20]:
            raise TimeoutError("всегда таймаут")                   # не помогает — пропускаем, но идём дальше
        return True, "адрес", None, None, None

    conn = FakeConn(FakeCursor(inns))
    res = addresses.run(conn, key="KEY", daily_limit=9000, pause=0, workers=4, lookup_fn=lookup)
    assert res["requested"] == 299 and inns[10] in conn.cur.rows and inns[20] not in conn.cur.rows
    assert calls[inns[20]] == addresses.RETRIES + 1


def test_run_stops_on_403():
    inns = [f"61{i:08d}" for i in range(600)]

    def lookup(inn, key):
        if inn == inns[50]:
            raise addresses.urllib.error.HTTPError("u", 403, "Forbidden", {}, None)
        return True, "адрес", None, None, None

    conn = FakeConn(FakeCursor(inns))
    res = addresses.run(conn, key="KEY", daily_limit=9000, pause=0, workers=4, lookup_fn=lookup)
    assert res["requested"] == 199                                # первая пачка без 403-го, дальше — стоп
    assert "403" in res["errors"][0]
