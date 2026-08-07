"""
diagnose_sea_holes.py

Пермаментный диагностический скрипт (read-only, НЕ шаг пайплайна — как
audit_map_geometry.py). Находит класс
пропаж, который класс MISSING_LAND НЕ ловит: дыры-острова, вырезанные
внутри полигонов морей/озёр (interior rings), для которых на выходе нет
покрывающей суши. В отличие от MISSING_LAND (сверяет raw
game_map.json ADM1-записи против выхода — не ловит остров, у которого
вообще НЕТ ADM1-записи), этот скрипт чисто геометрический: дыра либо
покрыта сушей, либо нет, независимо от наличия исходных админ-данных.

Причина существования дыр: полигоны морей вырезаны по более детальному
источнику береговой линии, чем ADM1-слой game_map.json — для каждого
острова (вплоть до необитаемых скал) в море заранее вырезана точная дыра,
но соответствующая суша в game_map.json может отсутствовать вовсе, либо
присутствовать, но быть отброшена где-то в пайплайне (например,
threshold-based cleanup разбросанных фрагментов при гео-мерже штата).

Метод: для каждой interior-ring дыры площадью >= MIN_AREA_KM2 — прямая
геометрическая проверка `hole.difference(вся_суша_рядом)`; если остаток
>= MIN_AREA_KM2, это реальная непокрытая (или частично непокрытая) дыра.
Дополнительно классифицирует по совпадению с сырыми фичами game_map.json
(>30% площади дыры перекрыто одной сырой фичой = "matched", есть источник
для имени/владельца; иначе "unmatched" = нужен синтез суши прямо из формы
дыры без ADM1-источника).

Читает `client/public/world_1946.geojson` (уже собранный, "что реально в
игре") — для проверки текущего шипнутого состояния, как diagnose_missing_
land.py. Для "matched"-дыр есть автофикс: `fill_sea_holes.py` (ЯВЛЯЕТСЯ
шагом `FULL_REBUILD_STEPS`, в отличие от этого скрипта, — он работает на
пре-merge continent-файлах, не на этом уже собранном world-файле, см. его
докстринг).

Запуск: python scripts/map/build/diagnose_sea_holes.py
"""
from paths import game_map, out
import json
import math
import sys
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MIN_AREA_KM2 = 0.2
MATCH_RATIO = 0.3


def km2(geom_area_deg2, lat):
    return geom_area_deg2 * 111 * 111 * abs(math.cos(math.radians(lat)))


def find_holes(world_land, seas_and_lakes):
    holes = []
    for ft in seas_and_lakes:
        name = ft["properties"].get("name")
        g = shape(ft["geometry"])
        polys = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        for poly in polys:
            for interior in poly.interiors:
                hole = Polygon(interior)
                if not hole.is_valid:
                    hole = hole.buffer(0)
                b = hole.bounds
                area = km2(hole.area, hole.centroid.y)
                if area < MIN_AREA_KM2:
                    continue
                candidates = [g2 for g2, _n in world_land
                              if not (g2.bounds[2] < b[0] - 0.05 or g2.bounds[0] > b[2] + 0.05
                                      or g2.bounds[3] < b[1] - 0.05 or g2.bounds[1] > b[3] + 0.05)]
                land_union = unary_union(candidates) if candidates else None
                residual = hole.difference(land_union) if land_union is not None else hole
                res_area = km2(residual.area, hole.centroid.y) if not residual.is_empty else 0.0
                if res_area < MIN_AREA_KM2:
                    continue
                holes.append({
                    "sea_name": name, "area_km2": round(area, 2),
                    "residual_km2": round(res_area, 2),
                    "centroid": (round(hole.centroid.x, 4), round(hole.centroid.y, 4)),
                    "geom": hole,
                })
    return holes


def classify(holes, raw_geoms):
    for h in holes:
        hb = h["geom"].bounds
        best, best_ratio = None, 0.0
        for g, props in raw_geoms:
            gb = g.bounds
            if gb[2] < hb[0] - 0.1 or gb[0] > hb[2] + 0.1 or gb[3] < hb[1] - 0.1 or gb[1] > hb[3] + 0.1:
                continue
            try:
                inter = g.intersection(h["geom"]).area
            except Exception:
                continue
            if inter <= 0:
                continue
            ratio = inter / h["geom"].area
            if ratio > best_ratio:
                best_ratio, best = ratio, props
        h["raw_match"] = (best.get("name"), best.get("iso_a2"), round(best_ratio, 2)) \
            if best and best_ratio > MATCH_RATIO else None
    return holes


def main():
    import pathlib
    repo_root = pathlib.Path(__file__).resolve().parents[3]
    world_path = repo_root / "client" / "public" / "world_1946.geojson"
    with open(world_path, encoding="utf-8") as f:
        world = json.load(f)["features"]

    land_feats = [ft for ft in world if ft["properties"].get("region_id", "").startswith(
        ("EUR-", "ASI-", "NAM-", "SAM-", "AFR-", "OCE-", "ANT-"))]
    seas_lakes = [ft for ft in world if ft["properties"].get("region_id", "").startswith(("SEA-", "LAK-"))]
    world_land = [(shape(ft["geometry"]), ft["properties"].get("name")) for ft in land_feats]

    with open(game_map(), encoding="utf-8") as f:
        raw_feats = json.load(f)["features"]
    raw_geoms = []
    for ft in raw_feats:
        try:
            g = shape(ft["geometry"])
        except Exception:
            continue
        if not g.is_valid:
            g = g.buffer(0)
        raw_geoms.append((g, ft["properties"]))

    print(f"  суша: {len(land_feats)}, моря+озёра: {len(seas_lakes)}, сырых фич: {len(raw_geoms)}")
    holes = find_holes(world_land, seas_lakes)
    print(f"  найдено дыр (>= {MIN_AREA_KM2} km2, не покрыто сушей): {len(holes)}")

    holes = classify(holes, raw_geoms)
    matched = [h for h in holes if h["raw_match"]]
    unmatched = [h for h in holes if not h["raw_match"]]
    print(f"  совпало с сырым источником (>{int(MATCH_RATIO*100)}% площади): {len(matched)}")
    print(f"  БЕЗ источника (нужен синтез суши из формы дыры): {len(unmatched)}")

    print()
    print("  === Совпавшие, по (имя, iso) ===")
    from collections import Counter
    c = Counter((h["raw_match"][0], h["raw_match"][1]) for h in matched)
    for k, v in sorted(c.items(), key=lambda x: -x[1]):
        print(f"    {v:3d}  {k}")

    print()
    print("  === БЕЗ источника (синтез, сортировка по площади) ===")
    for h in sorted(unmatched, key=lambda x: -x["area_km2"]):
        print(f"    {h['sea_name']:45s} {h['area_km2']:8.2f} km2  {h['centroid']}")

    return holes


if __name__ == "__main__":
    main()
