# -*- coding: utf-8 -*-
"""
Географическая (координатная) проверка capitalRegionId — самый сильный
доступный якорь, независимый от build-порядка и от того, как назван
регион: столичный регион страны должен быть тем, чей полигон СОДЕРЖИТ
реальную точку (lon, lat) её столицы.

Источник координат — server/src/scenarios/generateMapFeatures.ts::
CAPITAL_OVERRIDES (13 держав, курировано вручную для реалистичных
map-фич). Здесь координаты НЕ дублируются вторым независимым списком —
load_ts_capital_anchors() читает TS-файл как текст и извлекает те же
числа регэкспом (.agent/plans/capital-region-invariant.md: "не изобретай
второй список"). Если формат TS-файла существенно изменится, парсер
падает громко (ValueError), а не молча возвращает пустой/неполный набор —
проверка обязана быть заметно неработающей, а не тихо неработающей.

Point-in-polygon — обычный ray casting (even-odd), не Shapely: validate_
region_economy_1946.py и его тест исторически без внешних зависимостей
(см. test_validate_region_economy_1946.py, докстринг "без новых
зависимостей"), а полный geometry-стек (Shapely/pyproj) — только
build-пайплайн (scripts/map/AGENTS.md), не сам валидатор.

Тот же принцип "заметно неработающая, а не тихо неработающая" применён и к
geojson-стороне (2026-07-26, независимое ревью): build_region_geometries()
фильтрует features по properties.type == "region" — если этот ключ когда-
нибудь переименуют/переструктурируют в world_1946.geojson, фильтр молча
вернёт {} (или почти пусто), а find_containing_regions() будет возвращать
[] для КАЖДОГО якоря. validate_capital_geography() при пустом containing
пишет warning, а не молчит (см. её докстринг), так что per-анкорная
деградация видна и без этой проверки -- но ПОЛНАЯ потеря (0 регионов
вместо ~1400) это не "у DNK нет покрытия", это "invariant 15 не работает
вообще", и заслуживает жёсткого падения (ValueError), а не 13 строк [warn],
которые легко пролистать глазами наравне с обычным выводом. MIN_EXPECTED_
REGIONS ниже ловит это тем же способом, что и MIN_EXPECTED_TS_ANCHORS для
TS-стороны.
"""
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATE_MAP_FEATURES_TS = REPO_ROOT / "server" / "src" / "scenarios" / "generateMapFeatures.ts"
WORLD_GEOJSON = REPO_ROOT / "client" / "public" / "world_1946.geojson"

# Текущее число реальных записей в CAPITAL_OVERRIDES (generateMapFeatures.ts) —
# сверяется РОВНО (см. load_ts_capital_anchors: != , не < ), не "не меньше":
# порог-минимум пропускал бы молча ПОЯВЛЕНИЕ новой записи (константа осталась
# бы прежней, дырка в проверке на одну запись тихо вернулась бы) — находка 2
# независимого ревью 2026-07-26 (.agent/plans/capital-region-invariant.md).
# Раньше порог 10 при 13 реальных записях уже проходил мимо потери 3 из них
# молча (находка 6 того же ревью) — с точным сравнением оба направления
# (пропажа записи И появление новой) требуют явно обновить эту константу.
MIN_EXPECTED_TS_ANCHORS = 13

_TS_BLOCK_RE = re.compile(
    r"CAPITAL_OVERRIDES\s*:\s*Record<[^>]*>\s*=\s*\{(?P<body>.*?)\n\s*\};", re.S,
)
_TS_ENTRY_RE = re.compile(
    r'(?P<code>[A-Z][A-Za-z0-9]*)\s*:\s*\{\s*name:\s*"(?P<name>[^"]*)"\s*,\s*'
    r"coordinates:\s*\[\s*(?P<lon>-?[\d.]+)\s*,\s*(?P<lat>-?[\d.]+)\s*\]\s*\}"
)


def parse_ts_capital_overrides(ts_source: str) -> dict[str, tuple[float, float]]:
    """Чистая функция (текст -> якоря) — тестируется синтетическим TS-текстом,
    без чтения реального файла. Возвращает {код страны: (lon, lat)}."""
    block = _TS_BLOCK_RE.search(ts_source)
    if not block:
        raise ValueError(
            "CAPITAL_OVERRIDES не найден в generateMapFeatures.ts — формат файла "
            "изменился, парсер экономических якорей нужно обновить вместе с ним "
            "(scripts/map/economy_1946/capital_geography.py)."
        )
    anchors: dict[str, tuple[float, float]] = {}
    for m in _TS_ENTRY_RE.finditer(block.group("body")):
        anchors[m.group("code")] = (float(m.group("lon")), float(m.group("lat")))
    return anchors


def check_anchor_count(actual: int, expected: int) -> None:
    """Чистая функция -- сверяет РОВНО (!=), не "не меньше" (<): порог-минимум
    пропускал бы молча ПОЯВЛЕНИЕ новой записи, оставляя константу устаревшей
    (находка 2 независимого ревью 2026-07-26, .agent/plans/capital-region-
    invariant.md). Тестируется напрямую целыми числами, без парсинга TS и без
    чтения файла. Сообщение объясняет оба направления расхождения — сам факт
    "меньше/больше" не говорит, что чинить."""
    if actual == expected:
        return
    if actual < expected:
        direction = (
            f"меньше — вероятно, регэксп рассинхронизировался с форматом файла "
            f"(например, порядок полей/тип кавычек поменялся у одной из записей), "
            f"а не список реально сократился; почини регэксп в capital_geography.py"
        )
    else:
        direction = (
            f"больше — вероятно, в CAPITAL_OVERRIDES добавили новый легитимный "
            f"якорь; если так, обнови MIN_EXPECTED_TS_ANCHORS здесь на {actual}"
        )
    raise ValueError(
        f"Из generateMapFeatures.ts извлечено {actual} координатных якорей, "
        f"ожидалось ровно {expected} ({direction})."
    )


def load_ts_capital_anchors() -> dict[str, tuple[float, float]]:
    if not GENERATE_MAP_FEATURES_TS.exists():
        raise FileNotFoundError(f"{GENERATE_MAP_FEATURES_TS} не найден.")
    anchors = parse_ts_capital_overrides(GENERATE_MAP_FEATURES_TS.read_text(encoding="utf-8"))
    check_anchor_count(len(anchors), MIN_EXPECTED_TS_ANCHORS)
    return anchors


def _point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    """Ray casting (even-odd rule) для одного кольца GeoJSON-координат
    ([[lon, lat], ...], без замыкающей точки — не важно, замкнуто оно или
    нет: modulo-индексация ниже сама учитывает обе первую и последнюю точки)."""
    n = len(ring)
    inside = False
    x1, y1 = ring[0][0], ring[0][1]
    for i in range(1, n + 1):
        x2, y2 = ring[i % n][0], ring[i % n][1]
        if (y1 > y) != (y2 > y):
            x_intersect = (x2 - x1) * (y - y1) / (y2 - y1) + x1
            if x < x_intersect:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def _point_in_polygon_coords(x: float, y: float, polygon_coords: list) -> bool:
    """GeoJSON Polygon.coordinates: [exterior_ring, hole1, hole2, ...]."""
    if not polygon_coords or not _point_in_ring(x, y, polygon_coords[0]):
        return False
    return not any(_point_in_ring(x, y, hole) for hole in polygon_coords[1:])


def point_in_geometry(point: tuple[float, float], geometry: dict) -> bool:
    """point = (lon, lat). geometry — сырой GeoJSON geometry dict (Polygon
    или MultiPolygon). Другие типы (не встречаются среди region-фич
    world_1946.geojson) считаются не содержащими точку."""
    x, y = point
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "Polygon":
        return _point_in_polygon_coords(x, y, coords)
    if gtype == "MultiPolygon":
        return any(_point_in_polygon_coords(x, y, poly) for poly in coords)
    return False


def _bbox(geometry: dict) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []

    def collect_ring(ring):
        for pt in ring:
            xs.append(pt[0])
            ys.append(pt[1])

    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        for ring in coords:
            collect_ring(ring)
    elif gtype == "MultiPolygon":
        for poly in coords:
            for ring in poly:
                collect_ring(ring)
    if not xs:
        return (0.0, 0.0, 0.0, 0.0)
    return (min(xs), min(ys), max(xs), max(ys))


# Текущее ~1399-1406 (см. .agent/plans/capital-region-invariant.md). Порог
# держим с запасом (не точным, в отличие от MIN_EXPECTED_TS_ANCHORS — число
# регионов МЕНЯЕТСЯ легитимно почти при каждой правке геометрии, в отличие
# от 13 курированных держав), но достаточным, чтобы поймать конкретно
# найденный независимым ревью 2026-07-26 сценарий: properties.type
# переименован/переструктурирован в world_1946.geojson -> фильтр ниже молча
# возвращает {} (0 регионов) -- любой порог выше нуля уже ловит именно это.
MIN_EXPECTED_REGIONS = 1000


def build_region_geometries(features: list[dict]) -> dict[int, dict]:
    """Чистая функция (список GeoJSON features -> geometries) — тестируется
    синтетическим списком фич, без чтения реального файла. region numeric
    id -> {"geometry": GeoJSON geometry dict, "bbox": (minx, miny, maxx,
    maxy)}, только для features с properties.type == "region" (исключает
    "ocean"-фичи world_1946.geojson). bbox — дешёвый предфильтр перед точным
    ray casting (полигоны побережий/архипелагов бывают на тысячи точек).

    Падает громко (ValueError), если после фильтра осталось подозрительно
    мало регионов — см. MIN_EXPECTED_REGIONS и модульный докстринг: без
    этой проверки find_containing_regions() тихо возвращал бы [] для
    каждого якоря -- каждый анкор получил бы свой [warn] (validate_
    capital_geography это уже не пропускает молча), но 13 warning вместо
    12 честных проверок + 1 -- это фактически "invariant 15 сломан
    целиком", а не "чуть меньше покрытия", и должно падать, а не тонуть
    в обычном выводе."""
    out: dict[int, dict] = {}
    for feat in features:
        props = feat.get("properties", {})
        if props.get("type") != "region":
            continue
        geom = feat.get("geometry")
        if geom is None:
            continue
        out[props["id"]] = {"geometry": geom, "bbox": _bbox(geom)}
    if len(out) < MIN_EXPECTED_REGIONS:
        raise ValueError(
            f"world_1946.geojson: после фильтра properties.type == 'region' "
            f"осталось только {len(out)} регионов (ожидалось >= "
            f"{MIN_EXPECTED_REGIONS}) -- вероятно, properties.type "
            "переименован/переструктурирован в geojson (или файл повреждён/"
            "пуст), а не число регионов реально упало настолько. Если "
            "сокращение намеренное, обнови MIN_EXPECTED_REGIONS "
            "(scripts/map/economy_1946/capital_geography.py)."
        )
    return out


def load_region_geometries() -> dict[int, dict]:
    if not WORLD_GEOJSON.exists():
        raise FileNotFoundError(f"{WORLD_GEOJSON} не найден.")
    with open(WORLD_GEOJSON, encoding="utf-8") as f:
        gj = json.load(f)
    return build_region_geometries(gj.get("features", []))


def find_containing_regions(
    point: tuple[float, float], region_geometries: dict[int, dict],
) -> list[int]:
    """Все region id, чей полигон содержит point = (lon, lat). bbox-предфильтр
    перед точным containment-тестом (см. load_region_geometries)."""
    x, y = point
    result = []
    for rid, entry in region_geometries.items():
        minx, miny, maxx, maxy = entry["bbox"]
        if not (minx <= x <= maxx and miny <= y <= maxy):
            continue
        if point_in_geometry(point, entry["geometry"]):
            result.append(rid)
    return result
