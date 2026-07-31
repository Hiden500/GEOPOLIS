"""
build_seas_from_iho.py — водный слой, построенный из исходника IHO с берегом
из `game_map.json`.

Зачем. Нынешний `out/seas_1946.geojson` — статичный вход неизвестного
происхождения, поверх которого берег правился тремя компенсирующими шагами
пайплайна (`fix_sea_coastline_gaps` растит море к суше, `clip_land_by_water`
режет сушу по морю, `clip_sea_by_land` режет море по суше). Причина в том, что
источник морей — IHO Sea Areas v3 (публикация 1953): это делимитация МОРСКИХ
ОБЛАСТЕЙ, где кончается одно море и начинается другое, а НЕ береговая линия.
Берег у него свой и с `game_map.json` никогда не согласовывался
(`docs/provenance/MAP_GEOMETRY_PROVENANCE.md`).

Стратегия пользователя: берег берётся из `game_map.json` (там есть все
берега), вода накладывается на него, наложения снимаются в пользу суши. Этот
скрипт применяет её ОДИН РАЗ при построении файла, а не после.

Границы задачи (сужены пользователем 2026-07-31):

- **Скрипт НЕ входит в `MASTER_REBUILD_STEPS`** и не меняет
  `out/seas_1946.geojson`. Выход отдельный: `out/seas_iho_coastline.geojson`.
- **В мир не внедряется.** `SEA-` идентификаторы не переразмечаются,
  `ownership_1946.json`/`names_ru.json`/`translate_world.py` не трогаются.
- **Озёра не трогаются** — читаются как авторитетная вода и вычитаются.
- **Имена английские**, как в источнике (`NAME`). Русских имён нет намеренно.

Океаны остаются целыми, как в IHO (7 штук). Нарезкой на секторы занимается
пользователь отдельным скриптом — здесь её нет и быть не должно.

Метод (по одному морю, локально, без глобального union всей суши):

1. из полигона моря вычитается сырая суша `game_map.json`, попавшая в его
   bbox (STRtree) — вода физически не может лежать поверх суши;
2. вычитаются озёра — они авторитетны;
3. снимаются наложения море-море: площадь достаётся тому морю, что встретилось
   раньше по списку, у последующих вычитается (IHO-полигоны местами
   перекрываются, а `merge_world_1946.py` считает наложения ошибкой);
4. закрываются прибрежные разрывы: непокрытая ячейка, касающаяся суши,
   отдаётся географически верному морю — переиспользуется существующий движок
   `absorb_compact_gaps_multi`/`absorb_slivers_until_stable` из
   `fix_sea_coastline_gaps.py`, а не пишется свой.

Запуск:

    python scripts/map/build/build_seas_from_iho.py            # весь мир
    python scripts/map/build/build_seas_from_iho.py --no-absorb  # только шаги 1-3
    python scripts/map/build/build_seas_from_iho.py "Coral Sea" # одно море

Исходник (не под git, скачивается по ссылке из провенанса):
`scripts/map/sources/iho/oceans-seas.geo.json`
"""
from paths import game_map, out, source
import json
import sys
import time
from shapely.geometry import shape, mapping, box as shp_box
from shapely.strtree import STRtree
from shapely.ops import unary_union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2, to_polygonal
from fix_sea_coastline_gaps import safe_clip, absorb_compact_gaps_multi, TILES, BUFFER_DEG
from geometry_cleanup import absorb_slivers_until_stable

IHO_SOURCE = source("iho/oceans-seas.geo.json")
OUT_NAME = "seas_iho_coastline.geojson"

# Наложение море-море ниже этого порога — шум оцифровки, не спор за площадь.
# Порог `merge_world_1946.py` (0.0003 deg2) взят как верхняя граница
# допустимого, здесь на порядок строже, чтобы до слияния доходило чистое.
OVERLAP_EPS_DEG2 = 3e-5


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def load_land():
    """Сырая суша game_map.json + пространственный индекс по ней."""
    geoms = []
    for ft in load_features(game_map()):
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if not g.is_empty:
            geoms.append(g)
    return geoms, STRtree(geoms)


def load_lakes():
    geoms = []
    for ft in load_features(out("lakes_1946.geojson")):
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if not g.is_empty:
            geoms.append(g)
    return geoms, (STRtree(geoms) if geoms else None)


def subtract_local(geom, tree, geoms):
    """Вычитает из geom только те фичи индекса, что реально его задевают.

    Глобальный `unary_union` всей суши (4596 фич) здесь не нужен и вреден:
    он дорог по памяти и порождает лишнее нодирование на стыках, которых
    это море не касается.
    """
    idxs = tree.query(geom)
    hits = []
    for j in idxs:
        other = geoms[int(j)]
        if geom.intersects(other):
            hits.append(other)
    if not hits:
        return geom
    cut = geom.difference(unary_union(hits))
    if not cut.is_valid:
        cut = cut.buffer(0)
    return to_polygonal(cut)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_absorb = "--no-absorb" in sys.argv
    only = set(args) or None

    print(f"Исходник IHO: {IHO_SOURCE}")
    iho = load_features(IHO_SOURCE)
    print(f"  фич в источнике: {len(iho)}")

    print("Загрузка сырой суши game_map.json...")
    land_geoms, land_tree = load_land()
    print(f"  суша: {len(land_geoms)} фич")

    lake_geoms, lake_tree = load_lakes()
    print(f"  озёра (авторитетны, не изменяются): {len(lake_geoms)} фич")

    feats = []
    claimed = None          # уже занятая другими морями площадь
    dropped_land = 0.0
    dropped_lake = 0.0
    dropped_overlap = 0.0

    for i, ft in enumerate(iho, start=1):
        name = ft["properties"].get("NAME") or ft["properties"].get("name") or f"sea_{i}"
        if only and name not in only:
            continue
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        g = to_polygonal(g)
        before = area_km2(g)

        # 1. суша авторитетна — вода не может лежать поверх неё
        g = subtract_local(g, land_tree, land_geoms)
        after_land = area_km2(g)
        dropped_land += before - after_land

        # 2. озёра авторитетны
        if lake_tree is not None and not g.is_empty:
            g = subtract_local(g, lake_tree, lake_geoms)
        after_lake = area_km2(g)
        dropped_lake += after_land - after_lake

        # 3. наложения море-море — площадь у того, кто раньше по списку
        if claimed is not None and not g.is_empty:
            inter = g.intersection(claimed)
            if not inter.is_empty and inter.area > OVERLAP_EPS_DEG2:
                g = to_polygonal(g.difference(claimed))
                dropped_overlap += after_lake - area_km2(g)

        if g.is_empty or g.area <= 0:
            print(f"[{i}/{len(iho)}] {name}: ПУСТО после вычитания суши — пропущено")
            continue

        claimed = g if claimed is None else to_polygonal(unary_union([claimed, g]))
        feats.append({
            "type": "Feature",
            "properties": {"name": name,
                            "area_km2": round(area_km2(g), 1),
                            "source": "IHO Sea Areas v3"},
            "geometry": mapping(g),
        })
        print(f"[{i}/{len(iho)}] {name}: {area_km2(g):,.1f} km2 "
              f"(вычтено суши {before - after_land:,.1f})")

    print(f"\nВычтено суши: {dropped_land:,.1f} km2 | озёр: {dropped_lake:,.1f} | "
          f"наложений море-море: {dropped_overlap:,.1f}")

    if not no_absorb and not only:
        absorb_coastal_gaps(feats, land_geoms, land_tree, lake_geoms)

    path = out(OUT_NAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    print(f"\nЗаписано: {path} ({len(feats)} фич)")


def absorb_coastal_gaps(feats, land_geoms, land_tree, lake_geoms):
    """Прибрежные разрывы отдаются географически верному морю.

    Вычитание суши убирает воду ПОВЕРХ берега, но не закрывает полосы, где
    полигон IHO до берега не достаёт. Движок тот же, что уже используется
    пайплайном для этого класса, — свой не пишется.
    """
    print("\nЗакрытие прибрежных разрывов (тайлами)...")
    for tile_label, tile in TILES:
        t0 = time.time()
        tile_box = shp_box(*tile)

        relevant = [i for i, ft in enumerate(feats)
                    if shape(ft["geometry"]).intersects(tile_box)]
        if not relevant:
            print(f"[{tile_label}] морей: 0, пропущено")
            continue

        mutable, orig_idx = [], []
        for i in relevant:
            clipped = safe_clip(shape(feats[i]["geometry"]), tile_box)
            if clipped is None:
                continue
            mutable.append({"type": "Feature",
                            "properties": dict(feats[i]["properties"]),
                            "geometry": mapping(clipped)})
            orig_idx.append(i)
        if not mutable:
            print(f"[{tile_label}] морей: 0, пропущено")
            continue

        context = []
        for j in land_tree.query(tile_box):
            c = safe_clip(land_geoms[int(j)], tile_box)
            if c is not None:
                context.append(c)
        water = []
        for lg in lake_geoms:
            c = safe_clip(lg, tile_box)
            if c is not None:
                water.append(c)

        absorb_slivers_until_stable(mutable, context, water, tile_box, label=tile_label)
        absorb_compact_gaps_multi(mutable, context, water, tile_box, label=tile_label)

        added = 0.0
        for pos, i in enumerate(orig_idx):
            full_before = shape(feats[i]["geometry"])
            grown = unary_union([full_before, shape(mutable[pos]["geometry"])])
            if not grown.is_valid:
                grown = grown.buffer(0)
            grown = to_polygonal(grown)
            # берег авторитетен и после роста: движок мог зацепить сушу
            grown = subtract_local(grown, land_tree, land_geoms)
            added += area_km2(grown) - area_km2(to_polygonal(full_before))
            feats[i]["geometry"] = mapping(grown)
            feats[i]["properties"]["area_km2"] = round(area_km2(grown), 1)
        print(f"[{tile_label}] морей: {len(mutable)}, {added:+,.1f} km2, "
              f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
