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
from paths import game_map, out
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


def load_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def safe_clip(geom, box):
    """`geom.intersection(box)` может вернуть GeometryCollection с
    вырожденными LineString-компонентами на касательных пересечениях
    (найдено 2026-07-19-o на построении `context`/`water` для клипа по
    clip_box — не только на итоговом union, как White Sea). Возвращает
    None, если после отсева не осталось полигональной части."""
    inter = geom.intersection(box)
    inter = to_polygonal(inter)
    if inter.is_empty or inter.geom_type not in ("Polygon", "MultiPolygon"):
        return None
    return inter


def to_polygonal(geom):
    """Отбрасывает вырожденные не-полигональные компоненты (LineString/
    Point с area=0) — найдено на White Sea: предыдущие `unary_union`/
    `buffer(0)` в багованных прогонах превратили геометрию в
    GeometryCollection из 12 нулевых LineString-артефактов + 1 настоящий
    Polygon. `absorb_slivers`/`absorb_compact_gaps` ожидают Polygon/
    MultiPolygon (`.boundary` на GeometryCollection даёт непредсказуемый
    результат, `cell.boundary.intersection(g.boundary)` может вернуть
    None вместо геометрии -> AttributeError чуть ниже по стеку)."""
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            return geom
        return unary_union(polys) if len(polys) > 1 else polys[0]
    return geom


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
    new_g = to_polygonal(new_g)
    added = area_km2(new_g) - area_km2(sea_geom)
    ft["geometry"] = mapping(new_g)
    ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
    print(f"  [COMPACT/{label}] дозакрыто компактных разрывов: {n} (+{added:.1f} km2)")
    return added


CLUSTER_DIST_DEG = 2.0
ANCHOR_AREA_DEG2 = 1.0


def cleanup_scattered_fragments(seas_feats):
    """Убирает оторванные фрагменты, приклеенные по ошибке предыдущим
    (багованным) прогоном этого скрипта до фикса 2026-07-19-o: для морей,
    чьи части лежат по разные стороны антимеридиана (Берингово/Чукотское,
    тихоокеанские "секторы"), `bounds()` всей фичи давал (-180, ..., 180,
    ...) — "локальный" clip_box оказывался почти всем земным шаром по
    долготе, `absorb_compact_gaps` подхватывал компактные разрывы у
    Норвегии/Исландии/Гренландии/Финляндии как будто это Берингово море
    (найдено пользователем на живом рендере: "Беринговое море разбросано
    по нескольким побережьям. Надо соединять только соседние").

    Кластеризует части каждой MultiPolygon-фичи по близости (порог
    CLUSTER_DIST_DEG). ПЕРВАЯ версия оставляла кластер, если его СУММАРНАЯ
    площадь была большой — оказалось недостаточно: у Берингова моря
    множество мелких (~0.01-0.04 deg2 каждый) оторванных фрагментов у
    Гренландии/Лабрадора кластеризовались МЕЖДУ СОБОЙ (они действительно
    близко друг к другу, просто не к настоящему Берингову морю) в один
    "достаточно крупный по сумме" кластер и выживали (85 из 117 частей
    остались за пределами реального региона моря после первой версии).
    Исправлено: кластер легитимен, только если содержит хотя бы ОДНУ часть
    с площадью >= ANCHOR_AREA_DEG2 ("ствол" моря — напр. два берега
    Берингова пролива по разные стороны антимеридиана, оба на порядки
    больше любого оторванного фрагмента) — рой мелких кусков без такого
    якоря отбрасывается целиком, независимо от суммарной площади роя."""
    for ft in seas_feats:
        g = to_polygonal(shape(ft["geometry"]))
        ft["geometry"] = mapping(g)
        if g.geom_type != "MultiPolygon":
            continue
        parts = list(g.geoms)
        n = len(parts)
        if n <= 1:
            continue
        parent = list(range(n))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[ra] = rb

        for a in range(n):
            for b in range(a + 1, n):
                if parts[a].distance(parts[b]) < CLUSTER_DIST_DEG:
                    union(a, b)

        clusters = {}
        for idx in range(n):
            clusters.setdefault(find(idx), []).append(idx)
        cluster_max_area = {r: max(parts[idx].area for idx in idxs) for r, idxs in clusters.items()}

        keep_idxs = set()
        for r, idxs in clusters.items():
            if cluster_max_area[r] >= ANCHOR_AREA_DEG2:
                keep_idxs.update(idxs)

        if len(keep_idxs) < n:
            dropped_idxs = [idx for idx in range(n) if idx not in keep_idxs]
            dropped_area = sum(area_km2(parts[idx]) for idx in dropped_idxs)
            new_g = unary_union([parts[idx] for idx in keep_idxs]) if keep_idxs else parts[0]
            ft["geometry"] = mapping(new_g)
            ft["properties"]["area_km2"] = round(area_km2(new_g), 1)
            print(f"  [CLEANUP] {ft['properties'].get('name')}: убрано "
                  f"{len(dropped_idxs)} оторванных фрагментов (-{dropped_area:.1f} km2)")


def finalize_no_overlaps(seas_feats):
    """Финальная защита ПОСЛЕ основного цикла: гарантирует 0 наложений
    МОРЕ-МОРЕ. Основной цикл читал соседние моря как context ЖИВЫМ (см.
    находку 2026-07-19-n), но даже с этим исправлением независимая (не
    общая) последовательность absorb-проходов не гарантирует partition без
    явного финального прохода — оставленные до фикса 433 пересечения
    (найдено merge_world_1946.py diagnostic) резолвятся здесь
    детерминированно: порядок списка = приоритет, каждое море обрезается
    по объединению ВСЕХ уже финализированных (более ранних по списку)
    морей.

    НЕ клипает по суше (было в первой версии этой функции — убрано по
    прямому указанию пользователя, 2026-07-19-o: "я просил взять сырую
    сушу из game_map... там я точно уверен что вся суша как надо. Потому
    что потом надо будет уже в конечном файле всё что не совпало обрезать
    по линии морей" — т.е. сырое побережье game_map.json авторитетно ДЛЯ
    МОРЯ уже сейчас; расхождения с кураторской сушей в местах, где эта
    сессия использовала другой источник геометрии (Газа/Западный берег -
    geoBoundaries, немецкие зоны, US-county-кластеры и т.п.) — известны,
    но их устранение ОТЛОЖЕНО на будущий проход, который будет резать
    СУШУ по линии моря, а не наоборот. Клипать море по кураторской суше
    сейчас означало бы искажать уже верно приклеенное побережье."""
    print("\nФинализация: 0 наложений море-море...")
    claimed = None
    for i, ft in enumerate(seas_feats):
        g = shape(ft["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if claimed is not None and g.intersects(claimed):
            g = g.difference(claimed)
        if not g.is_valid:
            g = g.buffer(0)
        g = to_polygonal(g)
        ft["geometry"] = mapping(g)
        ft["properties"]["area_km2"] = round(area_km2(g), 1)
        claimed = g if claimed is None else to_polygonal(unary_union([claimed, g]))
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

    if not only:
        print("Очистка оторванных фрагментов от предыдущих багованных прогонов...")
        cleanup_scattered_fragments(seas_feats)

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
        orig_geom = sea_geoms[i]
        before_area = area_km2(orig_geom)

        # ПО ЧАСТЯМ, не по bounds() всей фичи (2026-07-19-o): моря, чьи
        # части лежат по разные стороны антимеридиана (Берингово/Чукотское,
        # тихоокеанские "секторы") имели bounds() == (-180, ..., 180, ...) -
        # "локальный" clip_box оказывался почти всем земным шаром по
        # долготе, absorb_compact_gaps подхватывал компактные разрывы у
        # Норвегии/Исландии/Гренландии/Финляндии как будто это Берингово
        # море (найдено пользователем на живом рендере: "Беринговое море
        # разбросано по нескольким побережьям"). Каждая ЧАСТЬ считает СВОЙ
        # локальный bbox - если часть сама по себе действительно огромна
        # (Southern Ocean - кольцо вокруг всей Антарктиды, 1 часть) её
        # локальный bbox законно останется большим, это не баг для этого
        # конкретного случая.
        parts = list(orig_geom.geoms) if orig_geom.geom_type == "MultiPolygon" else [orig_geom]
        grown_parts = []
        total_context_n = 0
        total_water_n = 0
        for part in parts:
            minx, miny, maxx, maxy = part.bounds
            clip_box = shp_box(minx - BUFFER_DEG, miny - BUFFER_DEG,
                                maxx + BUFFER_DEG, maxy + BUFFER_DEG)

            land_idxs = land_tree.query(clip_box)
            context = []
            for j in land_idxs:
                j = int(j)
                g = land_geoms[j]
                clipped = safe_clip(g, clip_box)
                if clipped is not None:
                    context.append(clipped)

            water_idxs = water_tree.query(clip_box)
            water = []
            for j in water_idxs:
                j = int(j)
                if j == i:
                    continue
                # ЖИВОЕ чтение для других морей (j < len(seas_feats)) - см.
                # находку 2026-07-19-n (устаревший снимок -> наложения
                # море-море). Озёра (j >= len(seas_feats)) не мутируются.
                g = shape(seas_feats[j]["geometry"]) if j < len(seas_feats) else water_all_geoms[j]
                clipped = safe_clip(g, clip_box)
                if clipped is not None:
                    water.append(clipped)
            for other_part in parts:
                if other_part is part:
                    continue
                clipped = safe_clip(other_part, clip_box)
                if clipped is not None:
                    water.append(clipped)

            part_ft = {"type": "Feature", "properties": dict(ft["properties"]),
                       "geometry": mapping(part)}
            absorb_slivers_until_stable([part_ft], context, water, clip_box, label=name)
            absorb_compact_gaps(part_ft, context, water, clip_box, label=name)
            grown_parts.append(shape(part_ft["geometry"]))
            total_context_n += len(context)
            total_water_n += len(water)

        new_g = unary_union(grown_parts)
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        new_g = to_polygonal(new_g)
        ft["geometry"] = mapping(new_g)
        after_area = area_km2(new_g)
        added = after_area - before_area
        total_added_km2 += added
        dt = time.time() - t0
        print(f"[{i+1}/{len(seas_feats)}] {name}: +{added:.1f} km2 "
              f"(parts={len(parts)}, context={total_context_n}, water={total_water_n}, {dt:.1f}s)")

    print(f"\nВсего добавлено к морям: {total_added_km2:,.1f} km2")

    if not only:
        finalize_no_overlaps(seas_feats)

    with open(seas_path, "w", encoding="utf-8") as f:
        json.dump(seas_fc, f, ensure_ascii=False)
    print(f"Записано: {seas_path}")


if __name__ == "__main__":
    main()
