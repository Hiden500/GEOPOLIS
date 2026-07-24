"""
extract_kinneret.py

Добавляет озеро Кинерет (Галилейское море) в scripts/map/out/lakes_1946.geojson
как отдельную LAK-фичу. Источник — Natural Earth ne_10m_lakes ("Sea of
Galilee"), та же провенанс-линия, что и остальные озёра файла (Мёртвое море,
Арал, Каспий, Великие озёра — все из Natural Earth).

Контекст: до 2026-07-19-f Кинерет НЕ был отдельным водоёмом — округ
"Kinneret" в geoBoundaries ISR ADM2 включает воду озера сплошным полигоном,
поэтому подрайон Tiberias (build_palestine_1946.py) закрывал озеро сушей, и
оно рендерилось как земля. По просьбе пользователя вырезаем его в настоящее
озеро (build_asia_1946.py::clip_asia_against_lakes обрезает Tiberias по
этому полигону, дальше озеро рендерится фоном-водой как Мёртвое море).

lakes_1946.geojson — внешний, hand-maintained input (как ownership_1946.json),
ни один build-скрипт его не перегенерирует целиком. Этот скрипт ИДЕМПОТЕНТЕН
(повторный запуск не дублирует фичу) и НЕ входит в FULL_REBUILD_STEPS —
запускается разово при добавлении/обновлении озера. Провенанс — в
scripts/map/README.md ("Внешние источники").

Запуск: python scripts/map/build/extract_kinneret.py
"""
from paths import out, source
import json
from shapely.geometry import shape, box, mapping
from shapely.ops import unary_union
from pyproj import Geod

GEOD = Geod(ellps="WGS84")
NE_LAKES = source("naturalearth/ne_10m_lakes.geojson")
LAKES_OUT = out("lakes_1946.geojson")
NAME_RU = "Кинерет (Галилейское море)"
# bbox поиска озера в наборе Natural Earth (Кинерет ~35.52-35.64E, 32.72-32.90N)
KINNERET_BBOX = box(35.4, 32.6, 35.75, 32.95)


def area_km2(geom):
    a, _ = GEOD.geometry_area_perimeter(geom)
    return abs(a) / 1e6


def main():
    with open(NE_LAKES, encoding="utf-8") as f:
        ne = json.load(f)
    matches = []
    for ft in ne["features"]:
        g = shape(ft["geometry"])
        if g.intersects(KINNERET_BBOX):
            name = ft["properties"].get("name") or ""
            if "galilee" in name.lower() or "tiberias" in name.lower() or "kinneret" in name.lower():
                matches.append(g)
    if not matches:
        print("  ВНИМАНИЕ: 'Sea of Galilee' не найдено в ne_10m_lakes.geojson — озеро не добавлено")
        return
    lake = unary_union(matches)

    with open(LAKES_OUT, encoding="utf-8") as f:
        lakes = json.load(f)
    for ft in lakes["features"]:
        if ft["properties"].get("name") == NAME_RU:
            # обновляем геометрию (идемпотентно), не дублируем
            ft["geometry"] = mapping(lake)
            ft["properties"]["area_km2"] = round(area_km2(lake), 1)
            with open(LAKES_OUT, "w", encoding="utf-8") as fo:
                json.dump(lakes, fo, ensure_ascii=False)
            print(f"  Кинерет обновлён ({round(area_km2(lake),1)} km2), фич в lakes: {len(lakes['features'])}")
            return

    lakes["features"].append({
        "type": "Feature",
        "properties": {
            "name": NAME_RU,
            "region_type": "lake",
            "area_km2": round(area_km2(lake), 1),
            "note": "Natural Earth ne_10m_lakes 'Sea of Galilee'. Отдельное озеро "
                     "с 2026-07-19-f: округ Kinneret в geoBoundaries ISR включает "
                     "воду сплошняком, из-за чего Tiberias раньше закрывал озеро "
                     "сушей.",
        },
        "geometry": mapping(lake),
    })
    with open(LAKES_OUT, "w", encoding="utf-8") as f:
        json.dump(lakes, f, ensure_ascii=False)
    print(f"  Кинерет добавлен ({round(area_km2(lake),1)} km2), фич в lakes: {len(lakes['features'])}")


if __name__ == "__main__":
    main()
