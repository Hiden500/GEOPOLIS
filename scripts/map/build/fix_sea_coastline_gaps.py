"""
fix_sea_coastline_gaps.py

Приклеивает моря/океаны (`out/seas_1946.geojson`, 113 фич) к побережью
ОРИГИНАЛЬНОГО `game_map.json` (сырой Natural Earth ADM1-датасет, до любых
правок этой сессии — Northern Cyprus-мост, Голан, Киркук, губернаторства
Западного берега, немецкие зоны и т.д.). Пользователь: "Возьми из
оригинальной карты только побережья... менять только морские полигоны,
не трогать сушу" (2026-07-19).

`out/seas_1946.geojson` — вручную поддерживаемый вход (как
`lakes_1946.geojson`/`ownership_1946.json`): ни один шаг пайплайна никогда
не пересчитывал его целиком, только точечно клипался (`clip_seas_against_
land` в build_europe_1946.py, запись -k). Разрывы вдоль побережья (полосы,
не покрытые ни сушей, ни морем — рендерятся фоном карты) — давний,
никогда не чинившийся класс проблемы.

Метод: тот же "gap-first" движок, что уже чинит разрывы СУШИ
(`geometry_cleanup.py::absorb_slivers_until_stable`), но инвертированный —
`mutable_feats` = ОДНА морская фича за проход, `context_geoms` = сырая
суша game_map.json (авторитетна, не двигается), `water_geoms` = ВСЕ
ОСТАЛЬНЫЕ моря/озёра (авторитетны — шов МЕЖДУ двумя морями не должен быть
ошибочно проглочен одним из них). По одной фиче за проход, не глобально:
`world_1946.geojson` (~35 МБ, 1521 фича) слишком велик для одного
`polygonize` по всему объединению — ни один существующий вызов
`absorb_slivers_until_stable` не работает в таком масштабе (все текущие —
1-4 mutable-фичи с локальным clip_box ±0.3-0.5°).

Только ДОБАВЛЯЕТ площадь морю (absorb_slivers никогда не отнимает) — уже
сделанные клипы (Кипр/Восточное Средиземноморье и т.п., сужение моря)
остаются на месте автоматически.
"""
from paths import game_map, out, REPO_ROOT
import json
import sys
import time
from shapely.geometry import shape, mapping, box as shp_box
from shapely.strtree import STRtree

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from geometry_cleanup import absorb_slivers_until_stable, area_km2
from shapely.ops import unary_union, polygonize

BUFFER_DEG = 0.5
# ВАЖНО: не client/public/world_1946.geojson - тот файл (после import_to_
# game.py) использует другую схему свойств (`type`/`continent`, БЕЗ
# `region_type`), фильтр по `region_type == "land"` там молча возвращает 0
# фич (найдено 2026-07-19: finalize_no_overlaps не находил ВООБЩЕ никакой
# суши - STRtree.query() на пустом списке всегда пуст, клип по суше
# бесшумно не срабатывал ни для одного моря). scripts/map/out/world_
# 1946.geojson (выход merge_world_1946.py, ДО import_to_game.py) хранит
# `region_type` explicit - используем его; суша там актуальна (не менялась
# этой правкой), даже если сами море/озеро-фичи внутри него ещё старые.
WORLD_PATH = out("world_1946.geojson")


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def absorb_compact_gaps(ft, context_geoms, water_geoms, clip_box, label=""):
    """Второй, более либеральный проход ПОСЛЕ absorb_slivers_until_stable —
    только для моря. `absorb_slivers` намеренно НЕ трогает крупные компактные
    ("не-ленточные") ячейки — предохранитель против проглатывания настоящих
    озёр-дыр (Кинерет и т.п.), нужный только когда MUTABLE — это СУША.
    Для моря этот предохранитель не нужен и вреден: в архипелагах/фьордах
    (Аляска-Панхандл/Британская Колумбия, найдено 2026-07-19 визуальной
    сверкой рендера — 11603.2 km2 уже приклеено первым проходом, но мелкие
    "компактные" разрывы между островами остались белыми пятнами фона)
    настоящий разрыв побережья часто выглядит компактным из-за формы
    окружающих островов, а не потому что это озеро. Все НАСТОЯЩИЕ водоёмы
    уже переданы как `water_geoms` (авторитетны) — значит любая непокрытая
    ячейка внутри локального clip_box этого моря, касающаяся суши, ПО
    ПОСТРОЕНИЮ обязана быть этим морем."""
    sea_geom = shape(ft["geometry"])
    all_geoms = [sea_geom] + list(context_geoms) + list(water_geoms)
    boundaries = unary_union([g.boundary for g in all_geoms])
    cells = list(polygonize(boundaries))
    frame = clip_box.boundary
    pieces = []
    n = 0
    for cell in cells:
        if cell.boundary.intersection(frame).length > 1e-9:
            continue
        rp = cell.representative_point()
        if any(g.contains(rp) for g in all_geoms):
            continue
        touches_land = any(cell.boundary.intersection(g.boundary).length > 1e-9
                            for g in context_geoms)
        if not touches_land:
            continue
        pieces.append(cell)
        n += 1
    if not pieces:
        return 0.0
    new_g = unary_union([sea_geom] + pieces)
    if not new_g.is_valid:
        new_g = new_g.buffer(0)
    added = area_km2(new_g) - area_km2(sea_geom)
    ft["geometry"] = mapping(new_g)
    ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
    print(f"  [COMPACT/{label}] дозакрыто компактных разрывов: {n} (+{added:.1f} km2)")
    return added


def finalize_no_overlaps(seas_feats, world_geojson_path):
    """Финальная защита ПОСЛЕ основного цикла: гарантирует 0 наложений
    море-море и 0 наложений море-СУША (по актуальному, кураторскому
    world_1946.geojson, не по сырому game_map.json, использованному как
    context в основном цикле).

    Море-море: основной цикл читал соседние моря как context ЖИВЫМ (см.
    правку выше), но даже с этим исправлением независимая (не общая)
    последовательность absorb-проходов не гарантирует partition без явного
    финального прохода — оставленные до фикса 433 пересечения (найдено
    merge_world_1946.py diagnostic) резолвятся здесь детерминированно:
    порядок списка = приоритет, каждое море обрезается по объединению ВСЕХ
    уже финализированных (более ранних по списку) морей.

    Море-суша: сырая суша game_map.json (авторитетный источник побережья
    по решению пользователя) может НЕ совпадать 1:1 с кураторской сушей
    world_1946.geojson там, где эта сессия использовала другой источник
    геометрии для конкретного региона (Газа/Западный берег — geoBoundaries
    PSE, а не Natural Earth; и т.п.) — Прованс/Лигурийское море 0.669 deg2
    показал, что расхождение может быть заметным, не только фоновым шумом.
    Финальный клип по кураторской суше убирает ЛЮБОЕ такое наложение,
    независимо от причины, не трогая саму сушу."""
    print("\nФинализация: 0 наложений море-море и море-суша...")
    with open(world_geojson_path, encoding="utf-8") as f:
        world = json.load(f)
    land_geoms = [shape(f["geometry"]) for f in world["features"]
                  if f["properties"].get("region_type") == "land"]
    land_tree = STRtree(land_geoms)

    claimed = None
    for i, ft in enumerate(seas_feats):
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if claimed is not None and g.intersects(claimed):
            g = g.difference(claimed)
        minx, miny, maxx, maxy = g.bounds
        clip_box = shp_box(minx - 0.1, miny - 0.1, maxx + 0.1, maxy + 0.1)
        local_land_idxs = land_tree.query(clip_box)
        local_land = [land_geoms[int(j)] for j in local_land_idxs if land_geoms[int(j)].intersects(clip_box)]
        if local_land:
            local_land_union = unary_union(local_land)
            if g.intersects(local_land_union):
                g = g.difference(local_land_union)
        if not g.is_valid:
            g = g.buffer(0)
        ft["geometry"] = mapping(g)
        ft["properties"]["area_km2"] = round(area_km2(g), 1)
        claimed = g if claimed is None else unary_union([claimed, g])
    print("Финализация завершена.")


def main():
    only = set(sys.argv[1:]) or None  # опционально: имена морей для теста

    print("Загрузка сырой суши game_map.json...")
    land_feats = load_features(game_map())
    land_geoms = []
    for ft in land_feats:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        land_geoms.append(g)
    land_tree = STRtree(land_geoms)
    print(f"  суша: {len(land_geoms)} фич")

    seas_path = out("seas_1946.geojson")
    with open(seas_path, encoding="utf-8") as f:
        seas_fc = json.load(f)
    seas_feats = seas_fc["features"]

    lakes_feats = load_features(out("lakes_1946.geojson"))

    sea_geoms = []
    for ft in seas_feats:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        sea_geoms.append(g)
    lake_geoms = []
    for ft in lakes_feats:
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        lake_geoms.append(g)

    water_all_geoms = sea_geoms + lake_geoms
    water_tree = STRtree(water_all_geoms)
    print(f"  море: {len(sea_geoms)} фич, озёра: {len(lake_geoms)} фич")

    total_added_km2 = 0.0
    for i, ft in enumerate(seas_feats):
        name = ft["properties"].get("name", f"sea_{i}")
        if only and name not in only:
            continue
        t0 = time.time()
        sea_geom = sea_geoms[i]
        minx, miny, maxx, maxy = sea_geom.bounds
        clip_box = shp_box(minx - BUFFER_DEG, miny - BUFFER_DEG,
                            maxx + BUFFER_DEG, maxy + BUFFER_DEG)

        land_idxs = land_tree.query(clip_box)
        context = []
        for j in land_idxs:
            j = int(j)
            g = land_geoms[j]
            if g.intersects(clip_box):
                context.append(g.intersection(clip_box))

        water_idxs = water_tree.query(clip_box)
        water = []
        for j in water_idxs:
            j = int(j)
            if j == i:
                continue
            # ЖИВОЕ чтение: для других морей (j < len(seas_feats)) фича
            # мутируется по ходу цикла (растёт), а `water_all_geoms[j]` —
            # застывший снимок ДО начала прогона. Использование застывшего
            # снимка даёт двум соседним морям устаревшее представление друг
            # о друге -> оба могут захватить одну и ту же спорную ячейку
            # независимо -> наложение море-море (найдено 2026-07-19 по
            # merge_world_1946.py diagnostic: 433 пересечения вместо ~6
            # фоновых). Озёра (j >= len(seas_feats)) не мутируются - для
            # них живое чтение не нужно, но безопасно.
            g = shape(seas_feats[j]["geometry"]) if j < len(seas_feats) else water_all_geoms[j]
            if g.intersects(clip_box):
                water.append(g.intersection(clip_box))

        before_area = area_km2(sea_geom)
        absorb_slivers_until_stable([ft], context, water, clip_box, label=name)
        absorb_compact_gaps(ft, context, water, clip_box, label=name)
        after_area = area_km2(shape(ft["geometry"]))
        added = after_area - before_area
        total_added_km2 += added
        dt = time.time() - t0
        print(f"[{i+1}/{len(seas_feats)}] {name}: +{added:.1f} km2 "
              f"(context={len(context)}, water={len(water)}, {dt:.1f}s)")

    print(f"\nВсего добавлено к морям: {total_added_km2:,.1f} km2")

    if not only:
        finalize_no_overlaps(seas_feats, WORLD_PATH)

    with open(seas_path, "w", encoding="utf-8") as f:
        json.dump(seas_fc, f, ensure_ascii=False)
    print(f"Записано: {seas_path}")


if __name__ == "__main__":
    main()
