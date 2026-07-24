"""
fix_lake_coastline_gaps.py

Закрывает разрывы суша<->озеро вокруг Великих озёр (Superior/Michigan-
Huron/Erie/Ontario) — найдены 2026-07-22 как вероятный побочный эффект
`refresh_lakes_from_ne10m.py` (новый детальный контур озера не сверялся с
существующей сушей на момент рефреша).

Направление ПРОТИВОПОЛОЖНОЕ `fix_sea_coastline_gaps.py`: там суша
авторитетна, растёт МОРЕ; здесь наоборот — озеро авторитетно (проверено,
см. ниже), растёт СУША (существующие штаты/провинция).

Почему озеро, а не суша, авторитетно здесь (2026-07-23, прямое измерение):
текущий контур озера (`out/lakes_1946.geojson`) даёт РОВНО 0.0 km2 разрыва
против СЫРОЙ суши `game_map.json` для всех 4 озёр — новый NE10m-контур
идеально согласован с исходными данными. Разрыв есть ТОЛЬКО против
КУРАТОРСКОЙ суши (`out/namerica_1946.geojson`, тот же geometric-кластер
county-split, что уже даёт Michigan-Crawford/Lapeer/Marquette как отдельные
regions, а не честный county-boundary passthrough) — т.е. это кураторская
суша отошла от истинного (= сырого = озёрного) берега, не наоборот.
Значит расти должна СУША, к авторитетному контуру озера, тем же gap-first
движком (`absorb_slivers_until_stable`, `geometry_cleanup.py`), что уже
используется для суши в остальном пайплайне (Gaza/Sinai/Кипр и т.д.) — это
СТАНДАРТНЫЙ случай (mutable=суша), а не sea-специфичный (в отличие от
`absorb_compact_gaps`, который снимает защиту от проглатывания
озёр-дыр — здесь эта защита нужна как обычно).

Область: bbox 4 Великих озёр + BUFFER_DEG — только North America. Все
остальные озёра/моря передаются как дополнительный авторитетный context
(на случай разрыва рядом с другим водоёмом), но реально задействовано
только для NAM.

Запуск: python scripts/map/build/fix_lake_coastline_gaps.py
"""
from paths import game_map, out
import json
import sys
from shapely.geometry import shape, mapping, box as shp_box
from shapely.strtree import STRtree
from shapely.ops import unary_union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import absorb_slivers_until_stable, resolve_same_iso_overlaps, area_km2  # noqa: E402

BUFFER_DEG = 0.5

GREAT_LAKES = ["Озеро Верхнее", "Озеро Мичиган-Гурон", "Озеро Эри", "Озеро Онтарио"]

NAM_PATH = out("namerica_1946.geojson")


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def main():
    lakes_feats = load_features(out("lakes_1946.geojson"))
    all_lake_geoms = []
    for ft in lakes_feats:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        all_lake_geoms.append((ft["properties"].get("name"), g))

    great_lakes = [(name, g) for name, g in all_lake_geoms if name in GREAT_LAKES]
    if len(great_lakes) != len(GREAT_LAKES):
        found = [name for name, _ in great_lakes]
        missing = [n for n in GREAT_LAKES if n not in found]
        print(f"  ВНИМАНИЕ: не найдены озёра {missing} в lakes_1946.geojson — прерываю")
        return

    minx = min(g.bounds[0] for _, g in great_lakes)
    miny = min(g.bounds[1] for _, g in great_lakes)
    maxx = max(g.bounds[2] for _, g in great_lakes)
    maxy = max(g.bounds[3] for _, g in great_lakes)
    clip_box = shp_box(minx - BUFFER_DEG, miny - BUFFER_DEG, maxx + BUFFER_DEG, maxy + BUFFER_DEG)
    print(f"  bbox Великих озёр (+{BUFFER_DEG}°): ({minx:.2f},{miny:.2f})-({maxx:.2f},{maxy:.2f})")

    # Клип по bbox — остальные 9 озёр (Каспий/Байкал/Виктория и т.д.) не
    # должны участвовать в polygonize (2026-07-23, найдено на этой же
    # правке: без клипа получаются "фантомные" ячейки-блобы у ДАЛЁКИХ озёр,
    # искажающие счётчик "пропущено компактных блобов" здесь же).
    lake_geoms = [g for _, g in all_lake_geoms if g.intersects(clip_box)]

    seas_feats = load_features(out("seas_1946.geojson"))
    sea_geoms = []
    for ft in seas_feats:
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            if not g.is_valid:
                g = g.buffer(0)
            sea_geoms.append(g)

    nam_feats = load_features(NAM_PATH)
    nam_tree = STRtree([shape(ft["geometry"]) for ft in nam_feats])
    relevant_idx = [int(i) for i in nam_tree.query(clip_box)
                    if shape(nam_feats[int(i)]["geometry"]).intersects(clip_box)]
    if not relevant_idx:
        print("  ВНИМАНИЕ: нет фич North America в bbox Великих озёр — прерываю")
        return

    mutable_feats = [nam_feats[i] for i in relevant_idx]
    before_geoms = {i: shape(nam_feats[i]["geometry"]) for i in relevant_idx}
    print(f"  суша North America в области: {len(mutable_feats)} фич")

    # water_geoms = все озёра (авторитетны) + моря рядом (на случай разрыва
    # у стыка с морем) — суша НЕ должна поглощать реальный водоём.
    water_geoms = lake_geoms + sea_geoms

    absorb_slivers_until_stable(mutable_feats, context_geoms=(), water_geoms=water_geoms,
                                 clip_box=clip_box, label="Great Lakes")
    n_overlap_fixed = resolve_same_iso_overlaps(mutable_feats, label="Great Lakes")

    total_added = 0.0
    added_pieces_by_idx = {}
    for i, ft in zip(relevant_idx, mutable_feats):
        nam_feats[i] = ft
        after_g = shape(ft["geometry"])
        added = area_km2(after_g) - area_km2(before_geoms[i])
        if abs(added) > 0.05:
            total_added += added
            added_pieces_by_idx[i] = after_g.difference(before_geoms[i])
            print(f"    {ft['properties'].get('name')}: +{added:.1f} km2")

    print(f"  Всего добавлено суше: {total_added:.1f} km2"
          + (f", исправлено наложений: {n_overlap_fixed}" if n_overlap_fixed else ""))

    with open(NAM_PATH, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": nam_feats}, f, ensure_ascii=False)
    print(f"  Записано: {NAM_PATH}")

    # Валидация: свежедобавленная суша должна лежать (почти) целиком внутри
    # сырой суши game_map.json — независимое подтверждение, что рост шёл к
    # истинному (= сырому = озёрному) берегу, а не куда-то ещё.
    with open(game_map(), encoding="utf-8") as f:
        raw_feats = json.load(f)["features"]
    raw_geoms = []
    for ft in raw_feats:
        try:
            g = shape(ft["geometry"])
        except Exception:
            continue
        if g.intersects(clip_box):
            if not g.is_valid:
                g = g.buffer(0)
            raw_geoms.append(g)
    raw_union = unary_union(raw_geoms)
    unexplained = 0.0
    for i, piece in added_pieces_by_idx.items():
        outside_raw = piece.difference(raw_union)
        outside_area = area_km2(outside_raw)
        if outside_area > 1.0:
            unexplained += outside_area
    print(f"  Валидация: {unexplained:.1f} km2 НОВОЙ суши (только добавленное этим прогоном)"
          f" ВНЕ сырого game_map.json (0 или мало = рост совпал с истинным берегом)")


if __name__ == "__main__":
    main()
