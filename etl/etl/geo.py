"""Где стоит компания без адреса (адреса в реестре МСП нет; юрлица с адресом из ЕГРЮЛ — addresses.py).

Центр населённого пункта (settlements.json), если центр подтверждается застройкой района из OSM
(buildings.csv.gz), иначе центр района / городского округа. Здания нужны только для этой проверки.
"""
import csv
import gzip
import math


CELL = 0.02                 # ячейка сетки, градусы (~2 км)
KM_PER_DEG = 111.32
TOWN_RADIUS_KM = 4.0        # город внутри района (Аксай, Сальск)
VILLAGE_RADIUS_KM = 2.0     # посёлок, хутор, станица


class Buildings:
    def __init__(self, path=None):
        self.by_muni, self.grid, self._near = {}, {}, {}
        if path is None or not path.exists():
            return
        with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                p = (float(r["lat"]), float(r["lon"]))
                self.by_muni.setdefault(r["municipality"], []).append(p)
                self.grid.setdefault(r["municipality"], {}).setdefault(_cell(*p), []).append(p)

    def __len__(self):
        return sum(map(len, self.by_muni.values()))

    def near(self, muni, lat, lon, radius_km):
        key = (muni, lat, lon, radius_km)
        if key not in self._near:
            grid = self.grid.get(muni, {})
            klat = KM_PER_DEG
            klon = KM_PER_DEG * math.cos(math.radians(lat))
            r_cells = int(radius_km / (KM_PER_DEG * CELL * math.cos(math.radians(lat)))) + 1
            ci, cj = _cell(lat, lon)
            out = []
            for i in range(ci - r_cells, ci + r_cells + 1):
                for j in range(cj - r_cells, cj + r_cells + 1):
                    for p in grid.get((i, j), ()):
                        if math.hypot((p[0] - lat) * klat, (p[1] - lon) * klon) <= radius_km:
                            out.append(p)
            out.sort()
            self._near[key] = out
        return self._near[key]


def _cell(lat, lon):
    return int(math.floor(lat / CELL)), int(math.floor(lon / CELL))


def place(buildings, muni, center, settlement=None, settlement_center=None):
    """-> (lat, lon, geo_precision) для компании без адреса: центр населённого пункта или района.

    Не случайное здание: точка на доме выглядит как настоящий адрес, а кластеры по таким точкам выдумывают,
    где внутри города компаний больше. Центр пункта честно говорит «где-то в х. Победа»: на уровне улиц
    карта рисует таких одним значком группы, точками — только компании с адресом из ЕГРЮЛ (addresses.py).
    """
    if settlement_center:
        radius = TOWN_RADIUS_KM if settlement.startswith("г.") else VILLAGE_RADIUS_KM
        # геокодер мог найти одноимённый хутор в другом районе — тогда застройки района рядом нет, пункту не верим
        if not len(buildings) or buildings.near(muni, settlement_center[0], settlement_center[1], radius):
            return round(settlement_center[0], 6), round(settlement_center[1], 6), "settlement"
    return round(center[0], 6), round(center[1], 6), "municipality"
