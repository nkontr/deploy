"""Где стоит компания без адреса (etl/geo.py): центр нас. пункта, если он подтверждён застройкой района."""
import csv
import gzip
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from etl import geo  # noqa: E402

AKSAY = (47.271, 39.871)
DISTRICT = (47.30, 39.90)


def buildings(tmp_path):
    p = tmp_path / "b.csv.gz"
    with gzip.open(p, "wt", newline="") as f:
        w = csv.writer(f)
        w.writerow(["municipality", "lat", "lon"])
        for i in range(20):
            w.writerow(["Аксайский р-н", 47.27 + i * 0.0001, 39.87])
    return geo.Buildings(p)


def test_settlement_center_when_district_buildings_near(tmp_path):
    b = buildings(tmp_path)
    assert geo.place(b, "Аксайский р-н", DISTRICT, "г. Аксай", AKSAY) == (47.271, 39.871, "settlement")


def test_same_point_for_all_companies_of_settlement(tmp_path):
    # все компании пункта — в одной точке: на уровне улиц это одна группа, а не россыпь по домам
    b = buildings(tmp_path)
    assert len({geo.place(b, "Аксайский р-н", DISTRICT, "г. Аксай", AKSAY) for _ in range(5)}) == 1


def test_wrong_district_geocode_falls_back_to_district_center(tmp_path):
    b = buildings(tmp_path)        # одноимённый хутор в другом конце области: застройки района рядом нет
    assert geo.place(b, "Аксайский р-н", DISTRICT, "х. Далёкий", (46.0, 41.0)) == (47.3, 39.9, "municipality")


def test_no_settlement_or_no_buildings_file(tmp_path):
    b = buildings(tmp_path)
    assert geo.place(b, "Аксайский р-н", DISTRICT) == (47.3, 39.9, "municipality")
    empty = geo.Buildings(None)    # нет buildings.csv.gz — центру пункта верим без проверки
    assert geo.place(empty, "Аксайский р-н", DISTRICT, "х. Далёкий", (46.0, 41.0)) == (46.0, 41.0, "settlement")
