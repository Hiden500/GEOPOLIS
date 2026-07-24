"""
extract_kyrenia.py

SUPERSEDED (2026-07-19-i) — НЕ вызывается пайплайном (убран из
FULL_REBUILD_STEPS). Диагноз "Кирении нет в game_map.json целиком" был
неверным: проверка шла только по iso_a2=="CY", а полный Northern Cyprus
(3309.8 km2) лежит в том же файле под iso_a2=="-1" (тот же тег, что у
Кашмира/Спратли) и стыкуется с существующими 5 округами БЕЗ разрыва —
никакого внешнего источника/моста не требовалось. См.
build_europe_1946.py::add_cyprus_extra_territories за реальным фиксом и
docs/DECISIONS.md за полной историей. Файл оставлен на диске как
пройденный урок (см. также скилл find-existing-solutions), не удалён.

Округ Кирения (север Кипра) отсутствует в game_map.json целиком — ни один
из 5 CY-юнитов источника его не покрывает (та же природа находки, что и
Голанские высоты, 2026-07-19: реальная дыра в game_map.json/Natural Earth,
не баг build-скрипта — build_europe_1946.py::KEEP_AS_IS помечал "Кипр — 5
округов, не избыточно", не заметив, что реальных округов 6). Найдено
2026-07-19-g по прямому скриншоту пользователя ("часть Кипра потерялось").

Источник — geoBoundaries CYP ADM1 (коммит 9469f09, тот же, что уже
используется для Израиля/Палестины), CC0/CC BY. Файл на GitHub хранится
через Git LFS — raw.githubusercontent.com отдаёт только LFS-pointer,
качать нужно через media.githubusercontent.com/media/... (см. docstring).

Пишет Кирению отдельной фичей в scripts/map/out/europe_1946.geojson
(iso_a2="CY", тот же континент/страна, что и остальные 5 округов) — REQUIRES
europe_1946.geojson уже собранным (запускать ПОСЛЕ build_europe_1946.py).
Идемпотентен (повторный запуск не дублирует). НЕ входит в FULL_REBUILD_STEPS
как отдельный шаг ядра — добавь вызов в make_1946.py при следующей полной
пересборке Европы, либо запускай вручную после build_europe_1946.py.

Запуск: python scripts/map/build/extract_kyrenia.py
"""
from paths import out, source
import json
from shapely.geometry import shape, mapping, box as shp_box, LineString
from shapely.ops import unary_union, nearest_points
from pyproj import Geod
from geometry_cleanup import absorb_slivers_until_stable, load_water_geoms

GEOD = Geod(ellps="WGS84")
CYP_SRC = source("cyprus_hist/geoBoundaries-CYP-ADM1.geojson")
EUROPE_OUT = out("europe_1946.geojson")
NAME = "Kyrenia"


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def bridge_to_nearest(kyrenia_geom, other_cy_geoms, max_bridge_deg=0.06):
    """Разрыв Кирения-Никосия (~0.038 deg) не ловится absorb_slivers: полость
    между ними уже "покрыта" полигоном Средиземного моря (Eastern Basin) —
    он огрублён и заходит чуть дальше вглубь острова, чем настоящий берег
    (проверено: середина разрыва внутри полигона моря). Это НЕ настоящий
    пролив (Кирения физически соединена с остальным Кипром горным хребтом),
    а огрубление источника, поэтому absorb (который не трогает то, что уже
    "вода") корректно ничего не поглощает — здесь нужен явный минимальный
    мост, а не gap-first. Соединяем ближайшие точки тонкой (чуть шире
    половины разрыва) прямой лентой с плоскими торцами (cap_style=2,
    join_style=2 — без круглых "пипок"), не выпуклой оболочкой (та
    добавляла бы ~0.18 deg2 лишней площади, проверено и отброшено)."""
    nearest = min(other_cy_geoms, key=lambda g: kyrenia_geom.distance(g))
    gap = kyrenia_geom.distance(nearest)
    if gap == 0 or gap > max_bridge_deg:
        return kyrenia_geom
    p1, p2 = nearest_points(kyrenia_geom, nearest)
    bridge = LineString([p1, p2]).buffer(gap / 2 + 0.002, cap_style=2, join_style=2)
    bridged = unary_union([kyrenia_geom, bridge])
    if not bridged.is_valid:
        bridged = bridged.buffer(0)
    return bridged


def main():
    with open(CYP_SRC, encoding="utf-8") as f:
        cyp = json.load(f)
    kyrenia_geom = None
    for ft in cyp["features"]:
        if ft["properties"].get("shapeName") == NAME:
            kyrenia_geom = shape(ft["geometry"])
            break
    if kyrenia_geom is None:
        print(f"  ВНИМАНИЕ: '{NAME}' не найдена в geoBoundaries CYP ADM1 — не добавлено")
        return
    if not kyrenia_geom.is_valid:
        kyrenia_geom = kyrenia_geom.buffer(0)

    with open(EUROPE_OUT, encoding="utf-8") as f:
        europe = json.load(f)

    other_cy_geoms = [shape(ft["geometry"]) for ft in europe["features"]
                       if ft["properties"].get("iso_a2") == "CY"
                       and ft["properties"].get("name") != NAME]
    if other_cy_geoms:
        before_km2 = area_km2(kyrenia_geom)
        kyrenia_geom = bridge_to_nearest(kyrenia_geom, other_cy_geoms)
        after_km2 = area_km2(kyrenia_geom)
        if after_km2 > before_km2:
            print(f"  [BRIDGE] Кирения соединена с материковой частью Кипра "
                  f"(+{round(after_km2 - before_km2, 1)} km2 мостом)")

    kyrenia_ft = None
    for ft in europe["features"]:
        if ft["properties"].get("iso_a2") == "CY" and ft["properties"].get("name") == NAME:
            kyrenia_ft = ft
            break

    if kyrenia_ft is not None:
        kyrenia_ft["geometry"] = mapping(kyrenia_geom)
        kyrenia_ft["properties"]["area_km2"] = round(area_km2(kyrenia_geom), 1)
        print(f"  Кирения обновлена ({round(area_km2(kyrenia_geom),1)} km2)")
    else:
        kyrenia_ft = {
            "type": "Feature",
            "properties": {
                "iso_a2": "CY",
                "name": NAME,
                "source_adm1": ["geoBoundaries-CYP-Kyrenia"],
                "source_count": 1,
                "area_km2": round(area_km2(kyrenia_geom), 1),
                "merge_method": "historical_missing_unit",
                "note": "Округ Кирения отсутствовал в game_map.json целиком (не "
                         "покрыт ни одним из 5 CY-юнитов источника) - реальная дыра "
                         "в исходных данных, найдено 2026-07-19-g. Геометрия - "
                         "geoBoundaries CYP ADM1 (коммит 9469f09), CC0/CC BY.",
            },
            "geometry": mapping(kyrenia_geom),
        }
        europe["features"].append(kyrenia_ft)
        print(f"  Кирения добавлена ({round(area_km2(kyrenia_geom),1)} km2), фич в Европе: {len(europe['features'])}")

    # geoBoundaries (Кирения) и game_map.json (остальные 5 округов Кипра) —
    # независимые источники, стык не идеальный (~0.038° разрыв Кирения-
    # Никосия) — тот же класс шва, что и Голан/Газа-Синай. Gap-first
    # поглощение вместо ручной подгонки.
    other_cy = [ft for ft in europe["features"]
                 if ft["properties"].get("iso_a2") == "CY" and ft is not kyrenia_ft]
    minx, miny, maxx, maxy = shape(kyrenia_ft["geometry"]).bounds
    clip_box = shp_box(minx - 0.3, miny - 0.3, maxx + 0.3, maxy + 0.3)
    context = []
    for ft in europe["features"]:
        if ft is kyrenia_ft or ft in other_cy:
            continue
        g = shape(ft["geometry"])
        if g.intersects(clip_box):
            context.append(g.intersection(clip_box))
    context.extend(shape(ft["geometry"]) for ft in other_cy)
    water = load_water_geoms(clip_box)
    absorb_slivers_until_stable([kyrenia_ft], context, water, clip_box, label="Kyrenia")

    with open(EUROPE_OUT, "w", encoding="utf-8") as f:
        json.dump(europe, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
