"""
clip_sea_by_land.py

Обрезает МОРЕ/ОЗЕРО по суше — обратное направление `clip_land_by_water.py`.
Для 19 фич, отложенных им в "ТРЕБУЕТ РЕВЬЮ" (2026-07-23), проблема не в
суше (реальный остров/округ — уже точная фича), а в самом водном полигоне:
часть "морей" в этом датасете — грубые океанские СЕКТОРЫ (bbox от экватора
до 49.7°с.ш. и т.п.) или крупные именованные моря низкого разрешения, без
выреза под мелкий остров/полуостров внутри их границ. Обрезать там сушу
(как `clip_land_by_water.py`) означало бы стереть реальную территорию
(Washington — San Juan -94.4%, French Southern Territories -97.7% — уже
случалось на первом прогоне `clip_land_by_water.py`, см. `docs/
DECISIONS.md`). Правильное направление здесь — обратное: земля точна,
обрезать нужно море/озеро вокруг неё.

Метод: ОБЩИЙ проход, не по явному списку имён — для каждой морской/озёрной
фичи находит ВСЮ пересекающуюся сушу (по всем 7 континентам) и вычитает
её объединение: `water = water.difference(unary_union(overlapping_land))`.
Запускается ПОСЛЕ `clip_land_by_water.py` — та часть наложений, что было
безопасно решить обрезкой суши (доля < 10%), уже решена там; здесь для
НИХ находить нечего (наложения уже нет, `.difference()` — no-op). Реально
затрагивает только фичи, оставленные `clip_land_by_water.py` нетронутыми
(19 суша↔вода, доля >= 10% — ровно то множество, где обрезка суши была бы
неверной). Явный список имён не нужен и не поддерживается — это тот же
инвариант "оставшееся наложение суша↔вода обязано разрешаться в пользу
суши", не точечный патч по 19 конкретным названиям.

НЕ трогает 1 известное наложение суша↔суша (Ponta Porã/Presidente Hayes) —
этот скрипт работает только с парами (вода, суша), земля-против-земли вне
scope (граница двух стран, другой класс решения).

Читает и пишет `out/seas_1946.geojson`/`out/lakes_1946.geojson` НАПРЯМУЮ —
оба уже "вручную поддерживаемые входы", как и `fix_sea_coastline_gaps.py`/
`fill_sea_holes.py` их читают/пишут. Часть `FULL_REBUILD_STEPS`, сразу
после `clip_land_by_water.py`, до `merge_world_1946.py`.

Идемпотентен: на уже обрезанных море/озере находит 0 наложений и ничего
не перезаписывает.

Запуск: python scripts/map/build/clip_sea_by_land.py
"""
from paths import out
import json
import sys
from shapely.geometry import shape, mapping
from shapely.strtree import STRtree
from shapely.ops import unary_union

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2, to_polygonal  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CONTINENT_FILES = [
    out("europe_1946.geojson"),
    out("asia_1946.geojson"),
    out("namerica_1946.geojson"),
    out("southamerica_1946.geojson"),
    out("africa_1946.geojson"),
    out("oceania_1946.geojson"),
    out("antarctica_1946.geojson"),
]

WATER_FILES = {
    "seas": out("seas_1946.geojson"),
    "lakes": out("lakes_1946.geojson"),
}

# Тот же нижний порог, что MIN_OVERLAP_DEG2 в clip_land_by_water.py —
# ниже него пересечение — машинный шум, не реальное наложение.
MIN_OVERLAP_DEG2 = 1e-7


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    land_geoms = []
    for path in CONTINENT_FILES:
        for ft in load_features(path):
            g = shape(ft["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            land_geoms.append(g)
    land_tree = STRtree(land_geoms)
    print(f"  суша: {len(land_geoms)} фич (все континенты)")

    n_clipped = 0
    total_removed = 0.0
    for label, path in WATER_FILES.items():
        feats = load_features(path)
        touched = False
        for ft in feats:
            water_g = shape(ft["geometry"])
            if not water_g.is_valid:
                water_g = water_g.buffer(0)
            cand_idxs = [int(j) for j in land_tree.query(water_g)]
            overlapping = []
            for j in cand_idxs:
                lg = land_geoms[j]
                inter = water_g.intersection(lg)
                if not inter.is_empty and inter.area > MIN_OVERLAP_DEG2:
                    overlapping.append(lg)
            if not overlapping:
                continue

            land_union = unary_union(overlapping)
            new_g = water_g.difference(land_union)
            if not new_g.is_valid:
                new_g = new_g.buffer(0)
            new_g = to_polygonal(new_g)
            if new_g.is_empty or new_g.geom_type not in ("Polygon", "MultiPolygon"):
                name = ft["properties"].get("name")
                print(f"  ОТКАЗ ({label}/{name}): клип дал {new_g.geom_type} — не применено")
                continue

            before_km2 = area_km2(water_g)
            after_km2 = area_km2(new_g)
            removed = before_km2 - after_km2
            ft["geometry"] = mapping(new_g)
            if "area_km2" in ft["properties"]:
                ft["properties"]["area_km2"] = round(after_km2, 1)
            touched = True
            n_clipped += 1
            total_removed += removed
            name = ft["properties"].get("name")
            print(f"  {label}/{name}: {before_km2:.1f} -> {after_km2:.1f} km2 (-{removed:.1f})")

        if touched:
            fc = {"type": "FeatureCollection", "features": feats}
            with open(path, "w", encoding="utf-8") as f:
                json.dump(fc, f, ensure_ascii=False)
            print(f"  Записано: {path}")

    print(f"\nВсего обрезано фич: {n_clipped}, снято площади у моря/озера: {total_removed:.1f} km2")


if __name__ == "__main__":
    main()
