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
4. заполняется остаток — прибрежная полоса между генерализованным берегом
   IHO и реальным берегом `game_map`, плюс дыры самого источника. Кусок
   достаётся БЛИЖАЙШЕЙ ИСХОДНОЙ акватории IHO.

Пункт 4 — единственное правило вместо набора частных случаев. Расстояние
меряется до полигона ИСТОЧНИКА, а не до уже выросшего соседа, и отсюда само
собой получается то, что раньше приходилось чинить поштучно: если два моря
сходятся по прямой, точки остатка ближе к тому, на чьей стороне прямой лежат,
а точки на самой прямой равноудалены — значит граница заполнения СОВПАДАЕТ с
исходной линией раздела и продолжается прямой. Спецкода на Сан-Томе,
Гибралтар или Кергелен нет.

Прежняя версия раздавала остаток по «самой длинной общей границе» с уже
выросшим соседом: исход решала форма острова, линия раздела превращалась в
зубец, а ошибка накапливалась вдоль берега.

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
from shapely.geometry import shape, mapping, box as shp_box, Point as ShpPoint
from shapely.strtree import STRtree
from shapely.ops import unary_union

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import area_km2, to_polygonal
from fix_sea_coastline_gaps import safe_clip


def world_tiles(step_lon=60.0, step_lat=45.0):
    """ПОЛНОЕ покрытие мира тайлами, без дыр.

    Намеренно НЕ используется `TILES` из `fix_sea_coastline_gaps.py`: тот
    список покрывает лишь 79.4% мира (проверено), и всё, что в дыры попадает,
    ни одним проходом не обрабатывается. Кергелен лежит там на 100%,
    Гренландия на 53.8% — оба и остались с разрывами на первой версии слоя.
    Дефект унаследованный: та же дыра есть у действующего пайплайна.
    """
    tiles = []
    lon = -180.0
    while lon < 180.0:
        lat = -90.0
        while lat < 90.0:
            tiles.append((f"{lon:+.0f}..{lon + step_lon:+.0f} / {lat:+.0f}..{lat + step_lat:+.0f}",
                          (lon, lat, min(lon + step_lon, 180.0), min(lat + step_lat, 90.0))))
            lat += step_lat
        lon += step_lon
    return tiles


TILES = world_tiles()

IHO_SOURCE = source("iho/oceans-seas.geo.json")
OUT_NAME = "seas_iho_coastline.geojson"

# Наложение море-море ниже этого порога — шум оцифровки, не спор за площадь.
# Порог `merge_world_1946.py` (0.0003 deg2) взят как верхняя граница
# допустимого, здесь на порядок строже, чтобы до слияния доходило чистое.
OVERLAP_EPS_DEG2 = 3e-5

# Кусок остатка считается прилегающим к воде, если отстоит от неё не дальше
# этого. Не ноль: контуры двух независимых источников не совпадают узлами.
TOUCH_EPS_DEG = 1e-6

# В какой окрестности куска искать моря-претенденты.
CANDIDATE_DEG = 0.5

# Полуширина ниже этой — нить, а не акватория (та же величина, что в
# diagnose_seas_iho.py::THREAD). ~22 м.
THREAD_HALFWIDTH_DEG = 2e-4

# Запас за границей тайла: кусок, разрезанный швом, должен целиком помещаться
# в рабочую рамку того тайла, который его присваивает.
SEAM_MARGIN_DEG = 2.0

# Проходы заполнения и порог «сошлось».
FILL_PASSES = 4
FILL_SETTLED_KM2 = 1.0

# Предел дробления на линии раздела: ~22 м. Заведомо мельче допуска, с
# которым диагностика сверяет границу с источником (1e-3 град ≈ 111 м).
DIVIDE_MIN_CELL_DEG = 2e-4
# Страховка от бесконечной рекурсии на вырожденных стыках.
DIVIDE_MAX_DEPTH = 12


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


def keep_real_water(geom):
    """Нормализация, отличающая настоящую воду от машинного шума ПО ФОРМЕ.

    `to_polygonal` из `geometry_cleanup` выбрасывает части меньше
    DEGENERATE_AREA_DEG2 (1e-4 deg²) — на широте Фуцзяни это ~1.1 км², на
    широте Гренландии ~0.5 км². Для суши порог разумен, для воды губителен:
    залив между островами площадью 0.9 км² — настоящая вода, и выбрасывание
    возвращало ровно те разрывы, которые заполнение только что закрыло
    (проверено: 6 кусков 0.20–1.00 км², все касаются моря).

    Здесь фильтр по форме, а не по размеру: выбрасывается неполигональное,
    нулевое и НИТЕВИДНОЕ (полуширина = площадь/периметр ниже порога). Мелкий
    компактный кусок остаётся, длинная нить нулевой ширины — нет.
    """
    if geom.is_empty:
        return geom
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            return geom
        geom = unary_union(polys)
    if geom.geom_type == "MultiPolygon":
        keep = [p for p in geom.geoms
                if p.area > 0 and p.length > 0 and (p.area / p.length) >= THREAD_HALFWIDTH_DEG]
        if not keep:
            return geom
        geom = unary_union(keep) if len(keep) > 1 else keep[0]
    return geom


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
    return keep_real_water(cut)


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
    orig_geoms = []         # исходные полигоны IHO, выровнены по feats
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
        original = g            # до вычитаний — по нему меряется «ближайшая акватория»
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
        orig_geoms.append(original)
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
        # Проходов несколько: тайл считает остаток по состоянию воды НА СВОЙ
        # момент, и кусок, который станет прилегающим только после роста в
        # соседнем тайле, на первом проходе отбрасывается защитой «не море».
        # Так терялись 7487 км² у берега Антарктиды. Повтор до неподвижной
        # точки, а не ослабление порога: ослабление залило бы внутренние дыры
        # суши, которые эта же защита и бережёт.
        for p in range(1, FILL_PASSES + 1):
            print(f"\n--- проход {p} ---")
            added = fill_by_nearest_source(feats, orig_geoms, land_geoms,
                                            land_tree, lake_geoms)
            print(f"--- проход {p}: добавлено {added:,.1f} km2 ---")
            if added < FILL_SETTLED_KM2:
                break

    path = out(OUT_NAME)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f, ensure_ascii=False)
    print(f"\nЗаписано: {path} ({len(feats)} фич)")


def assign_adaptive(piece, cands, out, min_cell=None, depth=0):
    """Делит спорный кусок по ближайшей исходной акватории, уточняя ТОЛЬКО линию.

    Равномерная сетка здесь не годится: она оставляет лестницу с амплитудой в
    половину ячейки на всей линии раздела (на первой версии — 21.5 км «изогнутой»
    границы у Гибралтара, 30.8 км у Восточно-Китайского моря). Адаптивное
    дробление проверяет, согласны ли углы и центр куска насчёт ближайшей
    акватории: если согласны — кусок уходит целиком, дробить нечего; если нет —
    режется на четверти и рекурсия идёт только там, где проходит сама линия.
    Однородная вода стоит одну проверку, точность тратится на границу.
    """
    if min_cell is None:
        min_cell = DIVIDE_MIN_CELL_DEG
    minx, miny, maxx, maxy = piece.bounds
    span = max(maxx - minx, maxy - miny)

    probes = [piece.representative_point(),
              ShpPoint(minx, miny), ShpPoint(minx, maxy),
              ShpPoint(maxx, miny), ShpPoint(maxx, maxy)]
    verdicts = {nearest_source_idx(p, cands) for p in probes}

    if len(verdicts) == 1 or span <= min_cell or depth >= DIVIDE_MAX_DEPTH:
        idx = nearest_source_idx(piece.representative_point(), cands)
        if idx is not None:
            out.setdefault(idx, []).append(piece)
        return

    midx, midy = (minx + maxx) / 2.0, (miny + maxy) / 2.0
    for q in (shp_box(minx, miny, midx, midy), shp_box(midx, miny, maxx, midy),
              shp_box(minx, midy, midx, maxy), shp_box(midx, midy, maxx, maxy)):
        sub = piece.intersection(q)
        if sub.is_empty or sub.area <= 0:
            continue
        for part in (sub.geoms if sub.geom_type == "MultiPolygon" else [sub]):
            if part.area > 0:
                assign_adaptive(part, cands, out, min_cell, depth + 1)


def nearest_source_idx(geom, cands):
    """Индекс ближайшей ИСХОДНОЙ акватории IHO.

    Расстояние меряется до полигона ИСТОЧНИКА, а не до уже выросшего моря.
    В этом вся суть: если два моря сходятся по прямой, точки остатка ближе к
    тому, на чьей стороне прямой лежат, а точки на самой прямой равноудалены —
    значит граница заполнения совпадает с исходной линией раздела и
    продолжается прямой сама собой, без спецкода на конкретные острова.
    """
    best, best_d = None, None
    for i, g in cands:
        d = g.distance(geom)
        if best_d is None or d < best_d:
            best, best_d = i, d
    return best


def fill_by_nearest_source(feats, orig_geoms, land_geoms, land_tree, lake_geoms):
    """Остаток воды достаётся БЛИЖАЙШЕЙ исходной акватории IHO.

    Остаток бывает двух видов, и правило для обоих одно:

    1. прибрежная полоса между генерализованным берегом IHO и реальным берегом
       `game_map.json` — источник до берега просто не достаёт;
    2. дыры внутри воды, доставшиеся от самого источника (например стык с
       BRA-594 в Южной Атлантике).

    Заполняется только то, что КАСАЕТСЯ воды. Это защита, а не формальность:
    внутренние дыры суши (известный класс LAND_HOLE в стыках провинций) воды
    не касаются и морем не становятся.
    """
    orig_tree = STRtree(orig_geoms)
    total_added = 0.0

    for tile_label, tile in TILES:
        t0 = time.time()
        core_box = shp_box(*tile)
        # Работаем с запасом за границей тайла, а присваиваем только куски,
        # чей центр в ядре. Иначе кусок, разрезанный швом, в каждой половине
        # не касается воды и обе отбрасываются как «внутренняя дыра суши»:
        # так в Восточно-Китайском море терялось 44.7 км² ровно на lon=120.
        tile_box = shp_box(max(tile[0] - SEAM_MARGIN_DEG, -180.0),
                           max(tile[1] - SEAM_MARGIN_DEG, -90.0),
                           min(tile[2] + SEAM_MARGIN_DEG, 180.0),
                           min(tile[3] + SEAM_MARGIN_DEG, 90.0))

        sea_local = {}
        for i, ft in enumerate(feats):
            g = shape(ft["geometry"])
            if not g.intersects(tile_box):
                continue
            c = safe_clip(g, tile_box)
            if c is not None:
                sea_local[i] = c
        if not sea_local:
            print(f"[{tile_label}] морей: 0, пропущено")
            continue

        covered = [*sea_local.values()]
        for j in land_tree.query(tile_box):
            c = safe_clip(land_geoms[int(j)], tile_box)
            if c is not None:
                covered.append(c)
        for lg in lake_geoms:
            c = safe_clip(lg, tile_box)
            if c is not None:
                covered.append(c)

        leftover = tile_box.difference(unary_union(covered))
        if leftover.is_empty:
            print(f"[{tile_label}] остатка нет")
            continue

        seas_union = unary_union(list(sea_local.values()))
        pieces = list(leftover.geoms) if leftover.geom_type == "MultiPolygon" else [leftover]

        additions = {}
        skipped_inland = 0
        contested = 0
        for piece in pieces:
            if piece.area <= 0:
                continue
            # кусок обрабатывает тот тайл, в чьём ЯДРЕ его центр — ровно один раз
            if not core_box.contains(piece.representative_point()):
                continue
            # не касается воды -> это внутренняя дыра суши, не море
            if piece.distance(seas_union) > TOUCH_EPS_DEG:
                skipped_inland += 1
                continue
            cands = [(int(j), orig_geoms[int(j)])
                     for j in orig_tree.query(piece.buffer(CANDIDATE_DEG))]
            cands = [(i, g) for i, g in cands if i in sea_local]
            if not cands:
                continue
            if len(cands) == 1:
                additions.setdefault(cands[0][0], []).append(piece)
                continue
            # кусок оспаривают несколько морей — делим по линии, а не целиком
            contested += 1
            assign_adaptive(piece, cands, additions)

        added = 0.0
        for i, parts in additions.items():
            before = shape(feats[i]["geometry"])
            grown = unary_union([before, *parts])
            if not grown.is_valid:
                grown = grown.buffer(0)
            grown = keep_real_water(grown)
            grown = subtract_local(grown, land_tree, land_geoms)
            added += area_km2(grown) - area_km2(to_polygonal(before))
            feats[i]["geometry"] = mapping(grown)
            feats[i]["properties"]["area_km2"] = round(area_km2(grown), 1)

        total_added += added
        if abs(added) > 0.05 or skipped_inland:
            print(f"[{tile_label}] морей: {len(sea_local)}, кусков: {len(pieces)} "
                  f"(спорных {contested}, дыр суши пропущено {skipped_inland}), "
                  f"{added:+,.1f} km2, {time.time() - t0:.1f}s")
    return total_added


if __name__ == "__main__":
    main()
