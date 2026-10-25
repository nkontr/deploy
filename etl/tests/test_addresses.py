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
