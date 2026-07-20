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
`context_geoms` = сырая суша game_map.json (авторитетна, не двигается),
`water_geoms` = озёра (авторитетны, их всего 12 — конкуренции с морями
не бывает). Моря — `mutable_feats`.

Полный прогон (без `--only`) обрабатывает моря НЕ по одному за проход, а
ГРУППАМИ по 7 грубым континентальным тайлам (`TILES`) — ВСЕ моря, чей bbox
пересекает тайл, передаются ОДНИМ совместным вызовом absorb_slivers_until_
stable/absorb_compact_gaps_multi. Так решается найденная 2026-07-20
проблема: спорная непокрытая ячейка суши, лежащая в буфере СРАЗУ
НЕСКОЛЬКИХ морей (залив Патраикос — и Ionian, и Aegean; побережье Норвегии
— и Baltic, и Skagerrak/North Sea), доставалась ПЕРВОМУ по списку морю при
последовательной обработке "одно море = авторитетный контекст для
остальных", а не географически верному — см. история в докстринге
`cleanup_scattered_fragments`. Многосторонний вызов отдаёт такую ячейку
морю с самой длинной общей границей, независимо от порядка списка.
Полный `world_1946.geojson` (~35 МБ, 1521 фича суши+океан-фич) целиком за
раз всё равно непрактичен — тайлы используют СЫРУЮ game_map.json (4596
фич) обрезанную по каждому тайлу, тот же приём, что уже применяет разовый
diagnose-скрипт.

`--only "Имя моря"` — старый per-sea путь для точечного теста ОДНОГО моря
(остальные моря авторитетны/неизменны в этом вызове — конкуренция не
проверяется, только для быстрой ручной проверки).

Только ДОБАВЛЯЕТ площадь морю (absorb_slivers/absorb_compact_gaps_multi
никогда не отнимают) — уже сделанные клипы (Кипр/Восточное Средиземноморье
и т.п., сужение моря) остаются на месте автоматически.
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

# Абсолютный порог "точно машинный шум, а не гео-фича" — найдено 2026-07-19-q
# на Ionian Sea/Inner Seas off the West Coast of Scotland/Norwegian Sea:
# десятки MultiPolygon-частей площадью 1e-18..1e-6 deg2 (вычислительная
# погрешность от повторных union/intersection/buffer(0), не остров).
# Применяется В `to_polygonal()` — на КАЖДОМ union/intersection в этом
# файле, не только в разовой чистке `cleanup_scattered_fragments` — иначе
# новый прогон снова накопит такой же мусор.
DEGENERATE_AREA_DEG2 = 1e-4


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
    """Отбрасывает (1) вырожденные не-полигональные компоненты (LineString/
    Point с area=0) — найдено на White Sea: предыдущие `unary_union`/
    `buffer(0)` в багованных прогонах превратили геометрию в
    GeometryCollection из 12 нулевых LineString-артефактов + 1 настоящий
    Polygon; (2) MultiPolygon-части площадью < DEGENERATE_AREA_DEG2 —
    машинный шум от тех же union/intersection/buffer(0), находимый уже
    ПОСЛЕ типа геометрии (Ionian Sea/Norwegian Sea/Inner Seas off the West
    Coast of Scotland, запись -q — части площадью 1e-18..1e-6 deg2,
    физически рядом с настоящим маленьким островом, из-за чего кластерная
    чистка их раньше не ловила). `absorb_slivers`/`absorb_compact_gaps`
    ожидают Polygon/MultiPolygon (`.boundary` на GeometryCollection даёт
    непредсказуемый результат, `cell.boundary.intersection(g.boundary)`
    может вернуть None вместо геометрии -> AttributeError чуть ниже по
    стеку)."""
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        geom = unary_union(polys) if len(polys) > 1 else (polys[0] if polys else geom)
    if geom.geom_type == "MultiPolygon":
        kept = [p for p in geom.geoms if p.area >= DEGENERATE_AREA_DEG2]
        if not kept:
            return geom
        if len(kept) < len(geom.geoms):
            geom = unary_union(kept) if len(kept) > 1 else kept[0]
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


def absorb_compact_gaps_multi(mutable_feats, context_geoms, water_geoms, clip_box, label=""):
    """Как `absorb_compact_gaps`, но для НЕСКОЛЬКИХ mutable-морей ОДНОВРЕМЕННО
    (2026-07-20, архитектурная правка — см. известное ограничение в
    докстринге `cleanup_scattered_fragments`). Корень найденного бага не в
    пост-обработке, а в самом механизме захвата: старый `main()` обрабатывал
    113 морей ПО ОЧЕРЕДИ, `water_geoms` = все ОСТАЛЬНЫЕ моря как
    АВТОРИТЕТНЫЙ (неизменяемый) контекст — значит спорная ячейка (лежащая в
    буфере НЕСКОЛЬКИХ морей: залив Патраикос рядом и с Ionian, и с Aegean;
    побережье Норвегии рядом и с Baltic, и со Skagerrak/North Sea)
    доставалась ПЕРВОМУ по списку морю, не географически верному — порядок
    списка, а не география, решал исход.

    Решение: если несколько морей одновременно MUTABLE (переданы в одном
    вызове), спорная ячейка отдаётся тому из них, с кем у неё САМАЯ ДЛИННАЯ
    общая граница (`cell.boundary.intersection(mg.boundary).length`) — тот
    же принцип, что уже использует `absorb_slivers` для суши. Если ячейка
    ещё ни с одним mutable-морем не граничит напрямую (изолированный разрыв
    без соседнего моря поблизости) — ближайшему по расстоянию. Не убирает
    предохранитель "компактных блобов" (как и `absorb_compact_gaps`) —
    архипелаги/фьорды дают ложно-компактные разрывы, а настоящие
    озёра-дыры уже переданы отдельно как `water_geoms`."""
    mutable_geoms = [shape(ft["geometry"]) for ft in mutable_feats]
    all_geoms = mutable_geoms + list(context_geoms) + list(water_geoms)
    boundaries = unary_union([g.boundary for g in all_geoms])
    cells = list(polygonize(boundaries))
    frame = clip_box.boundary

    additions = {}
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
        best_i, best_len = None, 0.0
        for idx, mg in enumerate(mutable_geoms):
            shared = cell.boundary.intersection(mg.boundary).length
            if shared > best_len:
                best_i, best_len = idx, shared
        if best_i is None:
            best_i = min(range(len(mutable_geoms)), key=lambda idx: cell.distance(mutable_geoms[idx]))
        additions.setdefault(best_i, []).append(cell)
        n += 1

    total_added = 0.0
    affected = 0
    for idx, pieces in additions.items():
        new_g = unary_union([mutable_geoms[idx]] + pieces)
        if not new_g.is_valid:
            new_g = new_g.buffer(0)
        new_g = to_polygonal(new_g)
        added = area_km2(new_g) - area_km2(mutable_geoms[idx])
        total_added += added
        affected += 1
        mutable_feats[idx]["geometry"] = mapping(new_g)
        mutable_feats[idx]["properties"]["area_km2"] = round(area_km2(new_g), 1)
    print(f"  [COMPACT-MULTI/{label}] дозакрыто компактных разрывов: {n} "
          f"(+{total_added:.1f} km2, морей затронуто: {affected})")
    return total_added


# Тайлы для новой (2026-07-20) tile-batched multi-sea обработки: те же 7
# грубых континентальных bbox, что уже проверены в разовом diagnose_global_
# gaps.py (совпадение имён/границ — чтобы before/after сравнение по одному
# и тому же diagnostic'у было яблоки-к-яблокам). Каждая ячейка суши в буфере
# НЕСКОЛЬКИХ морей решается СРАЗУ для ВСЕХ них через absorb_compact_gaps_
# multi/absorb_slivers_until_stable([...несколько mutable...]) — не по
# очереди, поэтому итог не зависит от порядка списка морей.
TILES = [
    ("Europe+Africa+MidEast", (-30, -40, 65, 75)),
    ("Asia", (60, 0, 180, 80)),
    ("N.America", (-170, 5, -50, 85)),
    ("S.America", (-90, -60, -30, 15)),
    ("Oceania", (110, -50, 180, 0)),
    ("Antarctica", (-180, -90, 180, -60)),
    ("Pacific dateline wrap", (-180, -60, -140, 75)),
]


CLUSTER_DIST_DEG = 0.3
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

    Три независимых фильтра, все три нужны:
    1. Безусловный отсев частей < DEGENERATE_AREA_DEG2 (машинный шум) ДО
       кластеризации — иначе шумовая часть наследует легитимность своего
       кластера просто потому, что физически рядом с настоящим маленьким
       островом (Ionian Sea/Norwegian Sea/Inner Seas off the West Coast of
       Scotland, найдено 2026-07-19-q).
    2. Кластеризация ОСТАВШИХСЯ частей по близости, легитимен кластер,
       только если содержит хотя бы одну часть с площадью >=
       ANCHOR_AREA_DEG2 ("ствол" моря).
    3. (2026-07-19-r, живой скриншот пользователя — Baltic Sea) порог
       CLUSTER_DIST_DEG был 2.0° — ТРАНЗИТИВНАЯ кластеризация через цепочку
       мелких частей позволяла связать генетически НЕСВЯЗАННЫЕ фрагменты:
       у Baltic Sea несколько частей (~30-100 км², побережье Норвегии/
       Skagerrak) оказались на 3.8-4.5° от настоящего балтийского "ствола",
       но проходили как "тот же кластер" через цепочку мелких соседних
       частей, каждый шаг которой был < 2°, хотя сумма шагов уводила
       далеко за пределы реального моря. Порог урезан до 0.3° (на порядок
       больше типичного зазора между СОСЕДНИМИ частями настоящего архипелага
       после absorb_compact_gaps, но на порядок меньше расстояния до чужого
       побережья) — не устраняет транзитивность полностью, но резко
       сокращает длину "моста", которым шум может дотянуться до дальнего
       анкера.

    ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (найдено 2026-07-20, НЕ устранено в этой правке —
    см. docs/DECISIONS.md запись -r/-s и .agent/plans/): этот же порог 0.3°
    также отбрасывает НЕКОТОРЫЕ законные, но геометрически далёкие от
    "ствола" куски — залив Патраикос (Ionian Sea, +122.7 km2), несколько
    настоящих прибрежных разрывов Британских островов, приклеенных гигантским
    "сектором" Атлантики (Bristol Channel/Thames Estuary/Moray Firth,
    суммарно тысячи km2). Пробовал заменить абсолютный порог на
    относительное сравнение "своё море vs ближайшее ДРУГОЕ море" — не
    сработало: расстояние до соседнего ЗАРЕГИСТРИРОВАННОГО моря почти
    всегда ~0 (соседние моря по построению КАСАЮТСЯ друг друга на границе
    пролива/берега — это нормально, не признак чужеродности), так что и
    легитимные, и нелегитимные далёкие куски одинаково "ближе к соседу, чем
    к своему стволу". Настоящая причина обеих групп бага — ОДНА: порядок
    обработки в main() (список морей по очереди) determ инирует, КАКОЕ море
    первым "застолбит" по-настоящему спорную (лежащую в буфере НЕСКОЛЬКИХ
    морей) непокрытую ячейку суши; правильное решение требует переписать
    сам механизм захвата ячеек (не текущий per-sea проход), а не эту
    пост-обработку. Оставлено как отложенный, задокументированный риск —
    не блокирует исправление Baltic/Ionian/Scotland/Norwegian-scattering,
    ради которого писалась эта функция."""
    total_degenerate = 0
    for ft in seas_feats:
        raw = shape(ft["geometry"])
        before_n = len(list(raw.geoms)) if raw.geom_type == "MultiPolygon" else 1
        g = to_polygonal(raw)  # уже отбрасывает и GeometryCollection-мусор, и части < DEGENERATE_AREA_DEG2
        after_n = len(list(g.geoms)) if g.geom_type == "MultiPolygon" else 1
        total_degenerate += max(0, before_n - after_n)
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
    print(f"  [CLEANUP] всего отброшено машинно-шумовых частей (< {DEGENERATE_AREA_DEG2} deg2): {total_degenerate}")


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

    if only:
        # Старый per-sea путь — оставлен для быстрой точечной проверки ОДНОГО
        # моря (`python fix_sea_coastline_gaps.py "Ionian Sea"`). Соседние
        # моря здесь читаются как АВТОРИТЕТНЫЙ (неизменяемый) `water` —
        # значит спорные (лежащие в буфере НЕСКОЛЬКИХ морей) ячейки достаются
        # ПЕРВОМУ по списку, не обязательно географически верному морю. Для
        # единственного явно указанного моря это не проблема (нет
        # конкурентов в ЭТОМ вызове) — само тестирование того же самого
        # порядкового эффекта проверяется полным (без --only) прогоном ниже.
        for i, ft in enumerate(seas_feats):
            name = ft["properties"].get("name", f"sea_{i}")
            if name not in only:
                continue
            t0 = time.time()
            orig_geom = sea_geoms[i]
            before_area = area_km2(orig_geom)
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
                    clipped = safe_clip(land_geoms[j], clip_box)
                    if clipped is not None:
                        context.append(clipped)

                water_idxs = water_tree.query(clip_box)
                water = []
                for j in water_idxs:
                    j = int(j)
                    if j == i:
                        continue
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
    else:
        # Новый tile-batched multi-sea путь (2026-07-20) — заменяет старый
        # per-sea-по-очереди проход для полного (без --only) прогона. Все
        # моря, чей bbox пересекает тайл, обрабатываются ОДНИМ совместным
        # вызовом absorb_slivers_until_stable/absorb_compact_gaps_multi —
        # спорная ячейка достаётся географически верному морю (самая длинная
        # общая граница), не первому по списку. Озёра остаются авторитетным
        # (неизменяемым) `water` — их не 113, конкуренция им не грозит.
        for tile_label, (minx, miny, maxx, maxy) in TILES:
            tile_box = shp_box(minx, miny, maxx, maxy)
            t0 = time.time()

            land_idxs = land_tree.query(tile_box)
            context = []
            for j in land_idxs:
                j = int(j)
                clipped = safe_clip(land_geoms[j], tile_box)
                if clipped is not None:
                    context.append(clipped)

            lake_idxs = STRtree(lake_geoms).query(tile_box) if lake_geoms else []
            water_fixed = []
            for j in lake_idxs:
                j = int(j)
                clipped = safe_clip(lake_geoms[j], tile_box)
                if clipped is not None:
                    water_fixed.append(clipped)

            relevant = []
            for i, ft in enumerate(seas_feats):
                g = shape(ft["geometry"])
                if g.intersects(tile_box):
                    relevant.append(i)

            mutable_feats = []
            orig_idx_by_pos = []
            for i in relevant:
                g = shape(seas_feats[i]["geometry"])
                clipped = safe_clip(g, tile_box)
                if clipped is None:
                    continue
                mutable_feats.append({"type": "Feature",
                                       "properties": dict(seas_feats[i]["properties"]),
                                       "geometry": mapping(clipped)})
                orig_idx_by_pos.append(i)

            if not mutable_feats:
                print(f"[{tile_label}] морей: 0, пропущено")
                continue

            absorb_slivers_until_stable(mutable_feats, context, water_fixed, tile_box, label=tile_label)
            absorb_compact_gaps_multi(mutable_feats, context, water_fixed, tile_box, label=tile_label)

            tile_added = 0.0
            for pos, i in enumerate(orig_idx_by_pos):
                grown_piece = shape(mutable_feats[pos]["geometry"])
                full_before = shape(seas_feats[i]["geometry"])
                new_g = unary_union([full_before, grown_piece])
                if not new_g.is_valid:
                    new_g = new_g.buffer(0)
                new_g = to_polygonal(new_g)
                added = area_km2(new_g) - area_km2(full_before)
                tile_added += added
                total_added_km2 += added
                seas_feats[i]["geometry"] = mapping(new_g)
                seas_feats[i]["properties"]["area_km2"] = round(area_km2(new_g), 1)

            dt = time.time() - t0
            print(f"[{tile_label}] морей: {len(mutable_feats)}, +{tile_added:.1f} km2, {dt:.1f}s")

    print(f"\nВсего добавлено к морям: {total_added_km2:,.1f} km2")

    if not only:
        # Второй прогон чистки ПОСЛЕ основного цикла (2026-07-19-r) — не
        # только до него. Живой скриншот пользователя показал, что Baltic
        # Sea/Ionian Sea снова получают оторванные фрагменты (побережье
        # Норвегии у Балтики) даже ПОСЛЕ первой чистки в начале main():
        # `absorb_compact_gaps` пересоздаёт их заново каждый прогон — у
        # моря с большим "стволом" (Балтика тянется от Дании до Финского
        # залива) локальный clip_box отдельных частей (даже с BUFFER_DEG
        # всего 0.5°) может случайно дотянуться до совершенно чужого,
        # никак не связанного побережья (Skagerrak/Норвегия), где
        # absorb_compact_gaps по построению подхватывает ЛЮБУЮ непокрытую
        # ячейку, касающуюся ЛЮБОЙ суши — не зная, что эта суша не имеет
        # отношения к Балтийскому морю. Чистка после основного цикла
        # убирает то, что цикл успел заново налепить.
        print("\nПовторная очистка после основного цикла...")
        cleanup_scattered_fragments(seas_feats)
        finalize_no_overlaps(seas_feats)

    with open(seas_path, "w", encoding="utf-8") as f:
        json.dump(seas_fc, f, ensure_ascii=False)
    print(f"Записано: {seas_path}")


if __name__ == "__main__":
    main()
