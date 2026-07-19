"""
fill_palestine_egypt_gap.py

Газа/Беэр-Шева (build_palestine_1946.py, geoBoundaries) и Синай
(build_africa_1946.py, Natural Earth/game_map.json) — независимо
оцифрованные источники, из разных континентальных скриптов (build_asia_1946.py
строится ДО build_africa_1946.py в make_1946.py, поэтому clip_palestine_to_
neighbors в build_asia_1946.py физически не может учесть Египет — на момент
его запуска africa_1946.geojson ещё не существует). На стыке остаётся
реальный, измеримый зазор (не пересечение): Газа-Синай ~0.0205°,
Беэр-Шева-Синай ~0.0109° (touches()==False) — найдено 2026-07-19 по прямой
жалобе пользователя на видимый разрыв на рендере.

Тот же безопасный метод, что уже применяется для США/Канады-Мексики
(fill_us_border_gaps.py) и для Китая (build_china_1946_v2.py, ныне не
используется): один глобальный расчёт зазора между целевым набором (Газа +
Беэр-Шева) и соседом (Египет/Синай), разбивка на связные куски, каждый кусок
строго ближайшему региону цели. Синай (сосед) остаётся приоритетным — тот же
принцип, что и в clip_palestine_to_neighbors (граница соседей не двигается,
Палестина дозаполняется до неё).

Запускается ПОСЛЕ build_africa_1946.py (см. make_1946.py, FULL_REBUILD_STEPS) —
читает уже записанные asia_1946.geojson + africa_1946.geojson, правит только
Палестину, перезаписывает asia_1946.geojson.
"""
from paths import out
import math
import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
ASIA_PATH = out("asia_1946.geojson")
AFRICA_PATH = out("africa_1946.geojson")

TARGET_NAMES = {"Gaza", "Beersheba"}
GAP_THRESHOLD = 0.03
MAX_BLOB_AREA = 0.05
MAX_COMPACTNESS_FOR_BIG = 0.15


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def compactness(geom):
    perim = geom.length
    if perim == 0:
        return 0.0
    return 4 * math.pi * geom.area / (perim ** 2)


def main():
    with open(ASIA_PATH, encoding="utf-8") as f:
        asia_fc = json.load(f)
    with open(AFRICA_PATH, encoding="utf-8") as f:
        africa_fc = json.load(f)

    target_feats = [ft for ft in asia_fc["features"]
                      if ft["properties"].get("iso_a2") == "PS"
                      and ft["properties"].get("name") in TARGET_NAMES]
    neighbor_geoms = [shape(ft["geometry"]) for ft in africa_fc["features"]
                        if ft["properties"].get("iso_a2") == "EG"]
    if not target_feats or not neighbor_geoms:
        print("  нет фич для одной из сторон, пропуск")
        return

    target_geoms = {id(ft): shape(ft["geometry"]) for ft in target_feats}
    target_union = unary_union(list(target_geoms.values()))
    neighbor_union = unary_union(neighbor_geoms)
    buffered_neighbor = neighbor_union.buffer(GAP_THRESHOLD, join_style=3)

    # Газа и Беэр-Шева соседствуют друг с другом, поэтому их общий зазор с
    # Египтом — ОДНА длинная непрерывная лента вдоль всей границы (~200 км),
    # не набор отдельных пятен. Если считать зазор от их ОБЪЕДИНЕНИЯ разом
    # (как для несвязных целей типа штатов США в fill_us_border_gaps.py),
    # "ближайшая единая фича" получает ВСЮ ленту целиком — Газа рискует
    # утащить кусок у самого Эйлата, в сотне км от себя. Поэтому здесь
    # буфер и зазор считаются ОТДЕЛЬНО для каждой цели (её собственная
    # локальная лента), без общего "ближайший победитель забирает всё".
    assigned = {}
    for ft in target_feats:
        own_buffered = target_geoms[id(ft)].buffer(GAP_THRESHOLD, join_style=3)
        own_gap = own_buffered.intersection(buffered_neighbor)
        own_gap = own_gap.difference(target_union).difference(neighbor_union)
        if own_gap.is_empty:
            continue
        raw_components = list(own_gap.geoms) if own_gap.geom_type.startswith("Multi") else [own_gap]
        for c in raw_components:
            if c.geom_type != "Polygon" or c.area <= 1e-10:
                if c.area > 1e-10:
                    print(f"  [ОТБРОШЕН] {ft['properties']['name']}: вырожденный тип "
                          f"геометрии {c.geom_type}")
                continue
            if c.area > MAX_BLOB_AREA and compactness(c) > MAX_COMPACTNESS_FOR_BIG:
                print(f"  [ПРОПУЩЕН] {ft['properties']['name']}: area={c.area:.4f} "
                      f"compactness={compactness(c):.3f} centroid="
                      f"{[round(x, 2) for x in c.centroid.coords[0]]} - похоже на блоб воды")
                continue
            assigned.setdefault(id(ft), []).append(c)

    n_components = sum(len(v) for v in assigned.values())
    print(f"  найдено {n_components} компонент зазора (собственный буфер каждой цели)")

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
            if trial.geom_type not in ("Polygon", "MultiPolygon"):
                print(f"    [ОТКАЗ] {ft['properties']['name']}: результат union "
                      f"типа {trial.geom_type}, кусок отброшен")
                continue
            nb = trial.bounds
            grew = max(orig_bounds[0] - nb[0], nb[2] - orig_bounds[2],
                        orig_bounds[1] - nb[1], nb[3] - orig_bounds[3])
            # Порог 2.5° (не 0.5°, как для более коротких швов): реальная
            # граница Египет-Синай/Негев тянется ~200 км (диагональ bbox
            # зазора ~2.02°) - это ОДНА длинная тонкая лента вдоль всей общей
            # границы (ширина ~0.02°, совпадает с измеренным зазором
            # Газа-Синай 0.0205°/Беэр-Шева-Синай 0.0109°), не артефакт.
            # Настоящая защита от раздувания - GAP_THRESHOLD=0.03° буфера
            # (ни одна точка добавленного куска не дальше 0.03° ни от цели,
            # ни от соседа), а не эта проверка bbox.
            if grew > 2.5:
                print(f"    [ОТКАЗ] {ft['properties']['name']}: граница выросла "
                      f"на {grew:.3f}° (>2.5°), похоже на артефакт, кусок отброшен")
                continue
            current = trial
            added += 1
        if added == 0:
            continue
        ft["geometry"] = mapping(current)
        ft["properties"]["area_km2"] = round(area_km2(current), 1)
        print(f"    -> {ft['properties']['name']}: +{added} куск(ов) (из {len(pieces)} предложенных), "
              f"touches(Синай)={current.touches(neighbor_union) or current.intersects(neighbor_union)}")

    # Газа и Беэр-Шева добавляли свой локальный кусок независимо друг от
    # друга - у их общей границы оба буфера могли претендовать на одну и ту
    # же узкую полоску, создавая небольшое взаимное наложение (найдено
    # 2026-07-19: ~0.001 deg2 - не критично по площади, но по тому же
    # принципу, что и остальные внутренние швы Палестины, лишнее наложение
    # не оставляем). Газа - более специфичный/курированный подрайон,
    # Беэр-Шева - "остаточный" (см. build_palestine_1946.py) - приоритет
    # у Газы.
    gaza_ft = next((ft for ft in target_feats if ft["properties"]["name"] == "Gaza"), None)
    beersheba_ft = next((ft for ft in target_feats if ft["properties"]["name"] == "Beersheba"), None)
    if gaza_ft is not None and beersheba_ft is not None:
        gaza_g = shape(gaza_ft["geometry"])
        beersheba_g = shape(beersheba_ft["geometry"])
        if gaza_g.intersects(beersheba_g):
            trimmed = beersheba_g.difference(gaza_g)
            if not trimmed.is_valid:
                trimmed = trimmed.buffer(0)
            if trimmed.area > 1e-9:
                overlap_area = beersheba_g.intersection(gaza_g).area
                beersheba_ft["geometry"] = mapping(trimmed)
                beersheba_ft["properties"]["area_km2"] = round(area_km2(trimmed), 1)
                print(f"  [ВЗАИМНОЕ НАЛОЖЕНИЕ] Газа/Беэр-Шева: {overlap_area:.6f} deg2 "
                      f"- обрезано из Беэр-Шевы (Газа приоритетнее)")

    with open(ASIA_PATH, "w", encoding="utf-8") as f:
        json.dump(asia_fc, f, ensure_ascii=False)
    print("Сохранено в asia_1946.geojson.")


if __name__ == "__main__":
    main()
