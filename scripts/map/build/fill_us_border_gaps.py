"""
fill_us_border_gaps.py
geoBoundaries (округа США) - другой источник, чем Natural Earth (Канада/
Мексика в текущем файле). Граница не совпадает идеально: где-то заходит
("overlap", уже исправлено отдельно), где-то не доходит ("gap"). Этот
скрипт закрывает зазоры — тем же безопасным методом, что и для Китая:
один глобальный расчёт зазора, разбивка на связные куски, каждый кусок
строго одному (ближайшему) региону США. Никакого попарного сравнения
"США-регион x конкретный сосед" - именно это создавало пересечения
между самими регионами США в прошлый раз с Китаем.
"""
from paths import out
import json
import math
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
SRC = out("namerica_1946.geojson")
OUT = out("namerica_1946.geojson")


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def fill_gaps(features, target_iso, neighbor_iso_set, gap_threshold=0.3,
              max_blob_area=0.05, max_compactness_for_big=0.15):
    target_feats = [ft for ft in features if ft["properties"]["iso_a2"] == target_iso]
    neighbor_feats = [ft for ft in features if ft["properties"]["iso_a2"] in neighbor_iso_set]
    if not target_feats or not neighbor_feats:
        print("  нет фич для одной из сторон, пропуск")
        return

    target_geoms = {id(ft): shape(ft["geometry"]) for ft in target_feats}
    target_union = unary_union(list(target_geoms.values()))
    neighbor_union = unary_union([shape(ft["geometry"]) for ft in neighbor_feats])

    buffered_target = target_union.buffer(gap_threshold)
    buffered_neighbors = neighbor_union.buffer(gap_threshold)
    gap_zone = buffered_target.intersection(buffered_neighbors)
    gap_zone = gap_zone.difference(target_union).difference(neighbor_union)

    if gap_zone.is_empty:
        print("  зазоров не найдено")
        return

    raw_components = list(gap_zone.geoms) if gap_zone.geom_type.startswith("Multi") else [gap_zone]
    # строго только Polygon - отбрасываем любые вырожденные линии/точки/
    # GeometryCollection-артефакты от buffer/difference на этом же шаге,
    # а не молча union'им их позже
    components = []
    for c in raw_components:
        if c.geom_type != "Polygon" or c.area <= 1e-10:
            if c.area > 1e-10:
                print(f"  [ОТБРОШЕН] вырожденный тип геометрии: {c.geom_type}")
            continue
        components.append(c)

    accepted, rejected = [], []
    for c in components:
        if c.area > max_blob_area and compactness(c) > max_compactness_for_big:
            rejected.append(c)
        else:
            accepted.append(c)
    components = accepted
    for c in rejected:
        print(f"  [ПРОПУЩЕН] area={c.area:.4f} compactness={compactness(c):.3f} "
              f"centroid={[round(x,2) for x in c.centroid.coords[0]]} - похоже на блоб воды (озеро/залив)")

    print(f"  найдено {len(components)} связных компонент зазора (+{len(rejected)} пропущено как блобы воды)")

    assigned = {}
    for comp in components:
        best_ft, best_dist = None, None
        for ft in target_feats:
            d = target_geoms[id(ft)].distance(comp)
            if best_dist is None or d < best_dist:
                best_ft, best_dist = ft, d
        assigned.setdefault(id(best_ft), []).append(comp)

    for ft in target_feats:
        pieces = assigned.get(id(ft))
        if not pieces:
            continue
        orig_geom = target_geoms[id(ft)]
        orig_bounds = orig_geom.bounds
        current = orig_geom
        added = 0
        for piece in pieces:
            trial = unary_union([current, piece])
            if not trial.is_valid:
                trial = trial.buffer(0)
            # строгая проверка: тип должен остаться Polygon/MultiPolygon,
            # и границы не должны раздуться на десятки градусов (реальный
            # шов - локальная подвижка, а не скачок через континент)
            if trial.geom_type not in ("Polygon", "MultiPolygon"):
                print(f"    [ОТКАЗ] {ft['properties']['name']}: результат union "
                      f"типа {trial.geom_type}, кусок отброшен")
                continue
            nb = trial.bounds
            grew = max(orig_bounds[0] - nb[0], nb[2] - orig_bounds[2],
                        orig_bounds[1] - nb[1], nb[3] - orig_bounds[3])
            if grew > 2.0:
                print(f"    [ОТКАЗ] {ft['properties']['name']}: граница выросла "
                      f"на {grew:.2f}° (>2.0°), похоже на артефакт, кусок отброшен")
                continue
            current = trial
            added += 1
        if added == 0:
            continue
        ft["geometry"] = mapping(current)
        ft["properties"]["area_km2"] = round(area_km2(current), 1)
        print(f"    -> {ft['properties']['name']}: +{added} куск(ов) (из {len(pieces)} предложенных)")


def main():
    with open(SRC, encoding="utf-8") as f:
        fc = json.load(f)
    features = fc["features"]

    print("US x Canada/Mexico, проход 1:")
    fill_gaps(features, "US", {"CA", "MX"})
    print("US x Canada/Mexico, проход 2:")
    fill_gaps(features, "US", {"CA", "MX"})

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    print("Сохранено.")


if __name__ == "__main__":
    main()
